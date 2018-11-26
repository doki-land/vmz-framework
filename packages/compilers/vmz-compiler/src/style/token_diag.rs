//! Style Theme / global style diagnostics.
//!
//! - unknown `var(--vmz-...)` / semantic `style:tw` -> `vmz::style::unknown_design_token`
//! - unused Style Theme leaves -> `vmz::style::unused_design_token` (warning)
//! - unreferenced `designs/styles` siblings when `index.*` entry exists ->
//!   `vmz::style::unreferenced_global_style` (warning)

use std::collections::{BTreeSet, HashSet, VecDeque};
use std::path::{Path, PathBuf};

use oxc_span::Span;

use crate::designs::{DesignsBundle, StyleTheme, css_var_name};
use crate::diagnostic::ReportedDiagnostic;
use crate::project::discover_vmz_files;
use crate::sfc::parse_vmz;
use crate::tw::{TwRegistration, register_tw_from_parsed};

/// Diagnostic code for unknown `--vmz-...` / semantic `style:tw` theme refs.
pub const DIAG_UNKNOWN_DESIGN_TOKEN: &str = "vmz::style::unknown_design_token";
/// Diagnostic code for Style Theme leaves never referenced by CSS or `style:tw`.
pub const DIAG_UNUSED_DESIGN_TOKEN: &str = "vmz::style::unused_design_token";
/// Diagnostic code for `designs/styles` siblings not reachable from the entry.
pub const DIAG_UNREFERENCED_GLOBAL_STYLE: &str = "vmz::style::unreferenced_global_style";

/// Project-wide Style Theme + global style reference diagnostics.
pub fn validate_project_design_token_refs(
    root: &Path,
    designs: &DesignsBundle,
) -> Vec<ReportedDiagnostic> {
    let mut out = Vec::new();
    if !designs.missing && !designs.theme.is_empty() {
        let known_vars = designs.theme.known_css_vars();
        for path in &designs.style_files {
            if let Ok(text) = std::fs::read_to_string(path) {
                out.extend(validate_vmz_css_var_refs(&designs.theme, &known_vars, path, &text));
            }
        }
        if let Some(entry) = &designs.style_entry {
            if !designs.style_files.iter().any(|p| p == entry) {
                if let Ok(text) = std::fs::read_to_string(entry) {
                    out.extend(validate_vmz_css_var_refs(
                        &designs.theme,
                        &known_vars,
                        entry,
                        &text,
                    ));
                }
            }
        }
        for (path, _) in discover_vmz_files(root) {
            let Ok(source) = std::fs::read_to_string(&path) else {
                continue;
            };
            let Ok(parsed) = parse_vmz(&path, source) else {
                continue;
            };
            if let Some(style) = &parsed.style {
                out.extend(validate_vmz_css_var_refs(
                    &designs.theme,
                    &known_vars,
                    &path,
                    &style.content,
                ));
            }
            out.extend(validate_style_tw_design_token_refs(&designs.theme, &parsed));
        }
        out.extend(validate_unused_design_tokens(root, designs));
    }
    out.extend(validate_unreferenced_global_styles(designs));
    out
}

/// Diagnose unknown `--vmz-*` CSS variable references against a known theme var set.
///
/// Scans `text` for `var(--vmz-...)` uses and emits one error per unseen name.
pub fn validate_vmz_css_var_refs(
    theme: &StyleTheme,
    known: &BTreeSet<String>,
    path: &Path,
    text: &str,
) -> Vec<ReportedDiagnostic> {
    let _ = theme;
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for name in collect_vmz_css_var_refs(text) {
        if known.contains(&name) || !seen.insert(name.clone()) {
            continue;
        }
        out.push(
            ReportedDiagnostic::error(path, DIAG_UNKNOWN_DESIGN_TOKEN)
                .with_arg("name", name)
                .with_arg("detail", "no Style Theme leaf"),
        );
    }
    out
}

/// Diagnose Tailwind-style utility tokens in a parsed SFC that lack theme leaves.
///
/// Registers utilities from the parsed document and validates each against `theme`.
pub fn validate_style_tw_design_token_refs(
    theme: &StyleTheme,
    parsed: &crate::sfc::ParsedVmz,
) -> Vec<ReportedDiagnostic> {
    let mut regs = Vec::new();
    register_tw_from_parsed(parsed, &mut regs);
    validate_tw_registrations(theme, &regs, &parsed.source)
}

fn validate_tw_registrations(
    theme: &StyleTheme,
    regs: &[TwRegistration],
    source: &str,
) -> Vec<ReportedDiagnostic> {
    let color_keys = theme.known_ns_keys("colors");
    let spacing_keys = theme.known_ns_keys("spacing");
    let has_colors = !color_keys.is_empty();
    let has_spacing = !spacing_keys.is_empty();
    if !has_colors && !has_spacing {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for reg in regs {
        let Some((ns, key)) = design_token_ref_from_utility(&reg.token) else {
            continue;
        };
        let known = match ns {
            "colors" if has_colors => &color_keys,
            "spacing" if has_spacing => &spacing_keys,
            _ => continue,
        };
        if known.contains(key) {
            continue;
        }
        let dedupe = format!("{}:{ns}.{key}", reg.path.display());
        if !seen.insert(dedupe) {
            continue;
        }
        let mut diag = if let Some(span) = locate_token_span(source, &reg.token) {
            ReportedDiagnostic::error_at(&reg.path, DIAG_UNKNOWN_DESIGN_TOKEN, span)
        } else {
            ReportedDiagnostic::error(&reg.path, DIAG_UNKNOWN_DESIGN_TOKEN)
        };
        diag = diag
            .with_arg("name", format!("{ns}.{key}"))
            .with_arg("token", reg.token.clone())
            .with_arg("detail", "no Style Theme leaf");
        out.push(diag);
    }
    out
}

/// When `designs/styles/index.*` is the entry, siblings not reached via `@import`/`@use`/`@forward`
/// are unreferenced (SCSS emit only compiles the entry).
pub fn validate_unreferenced_global_styles(designs: &DesignsBundle) -> Vec<ReportedDiagnostic> {
    let Some(entry) = designs.style_entry.as_ref() else {
        return Vec::new();
    };
    if designs.style_files.len() <= 1 {
        return Vec::new();
    }
    let styles_dir = entry.parent().unwrap_or_else(|| Path::new("."));
    let reachable = reachable_style_files(entry, styles_dir);
    let mut out = Vec::new();
    for path in &designs.style_files {
        if path == entry {
            continue;
        }
        let canon = canonicalize_lossy(path);
        if reachable.iter().any(|r| canonicalize_lossy(r) == canon) {
            continue;
        }
        let rel = path
            .strip_prefix(&designs.root)
            .unwrap_or(path)
            .display()
            .to_string()
            .replace('\\', "/");
        out.push(
            ReportedDiagnostic::warning(path, DIAG_UNREFERENCED_GLOBAL_STYLE)
                .with_arg("path", rel)
                .with_arg("detail", "not imported from designs/styles entry"),
        );
    }
    out
}

fn reachable_style_files(entry: &Path, styles_dir: &Path) -> HashSet<PathBuf> {
    let mut seen = HashSet::new();
    let mut q = VecDeque::new();
    q.push_back(entry.to_path_buf());
    while let Some(path) = q.pop_front() {
        let key = canonicalize_lossy(&path);
        if !seen.insert(key) {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for dep in collect_style_import_specs(&text) {
            if let Some(resolved) =
                resolve_style_import(styles_dir, path.parent().unwrap_or(styles_dir), &dep)
            {
                q.push_back(resolved);
            }
        }
    }
    seen.into_iter().collect()
}

fn canonicalize_lossy(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

/// Collect `@import` / `@use` / `@forward` path specs (quoted or url).
pub fn collect_style_import_specs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = text;
    let bytes = lower.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !lower.is_char_boundary(i) {
            i += 1;
            continue;
        }
        let rest = &lower[i..];
        let kind = if rest.starts_with("@import") {
            Some("@import")
        } else if rest.starts_with("@use") {
            Some("@use")
        } else if rest.starts_with("@forward") {
            Some("@forward")
        } else {
            None
        };
        let Some(kw) = kind else {
            i += rest.chars().next().map(|c| c.len_utf8()).unwrap_or(1);
            continue;
        };
        let mut j = i + kw.len();
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if lower[j..].starts_with("url(") {
            j += 4;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
        }
        let quote = lower.as_bytes().get(j).copied();
        if quote == Some(b'"') || quote == Some(b'\'') {
            let q = quote.unwrap() as char;
            j += 1;
            let start = j;
            while j < bytes.len() && lower.as_bytes()[j] as char != q {
                j += 1;
            }
            let spec = lower[start..j].trim().to_string();
            if !spec.is_empty() {
                out.push(spec);
            }
        }
        i = j.saturating_add(1);
    }
    out
}

fn resolve_style_import(styles_dir: &Path, from_dir: &Path, spec: &str) -> Option<PathBuf> {
    let spec = spec.trim().trim_start_matches("./");
    if spec.is_empty()
        || spec.starts_with("http:")
        || spec.starts_with("https:")
        || spec.starts_with("sass:")
    {
        return None;
    }
    let candidates = [
        from_dir.join(spec),
        styles_dir.join(spec),
        from_dir.join(format!("{spec}.scss")),
        from_dir.join(format!("{spec}.sass")),
        from_dir.join(format!("{spec}.css")),
        styles_dir.join(format!("{spec}.scss")),
        styles_dir.join(format!("{spec}.sass")),
        styles_dir.join(format!("{spec}.css")),
        from_dir.join(format!("_{spec}.scss")),
        styles_dir.join(format!("_{spec}.scss")),
    ];
    candidates.into_iter().find(|p| p.is_file())
}

/// Warn about design-token CSS variables defined in the theme but unused in the project.
///
/// Skips when designs are missing or the theme has no known vars; otherwise scans
/// project sources for `--vmz-*` and utility references.
pub fn validate_unused_design_tokens(
    root: &Path,
    designs: &DesignsBundle,
) -> Vec<ReportedDiagnostic> {
    let _ = root;
    if designs.missing || designs.theme.is_empty() {
        return Vec::new();
    }
    let known = designs.theme.known_css_vars();
    if known.is_empty() {
        return Vec::new();
    }
    let used = collect_project_used_css_vars(root, designs, &known);
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    for table in &designs.theme.tables {
        for e in &table.entries {
            let var = css_var_name(&e.path);
            if used.contains(&var) || !seen.insert(var.clone()) {
                continue;
            }
            let leaf = e.path.join(".");
            out.push(
                ReportedDiagnostic::warning(&designs.root, DIAG_UNUSED_DESIGN_TOKEN)
                    .with_arg("name", leaf)
                    .with_arg("var", var)
                    .with_arg("detail", "not referenced by var(--vmz-…) or style:tw"),
            );
        }
    }
    out
}

fn collect_project_used_css_vars(
    root: &Path,
    designs: &DesignsBundle,
    known: &BTreeSet<String>,
) -> BTreeSet<String> {
    let mut used = BTreeSet::new();
    for path in &designs.style_files {
        if let Ok(text) = std::fs::read_to_string(path) {
            mark_css_var_uses(&text, known, &mut used);
        }
    }
    if let Some(entry) = &designs.style_entry {
        if !designs.style_files.iter().any(|p| p == entry) {
            if let Ok(text) = std::fs::read_to_string(entry) {
                mark_css_var_uses(&text, known, &mut used);
            }
        }
    }
    for (path, _) in discover_vmz_files(root) {
        let Ok(source) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&path, source) else {
            continue;
        };
        if let Some(style) = &parsed.style {
            mark_css_var_uses(&style.content, known, &mut used);
        }
        let mut regs = Vec::new();
        register_tw_from_parsed(&parsed, &mut regs);
        for reg in regs {
            if let Some((ns, key)) = theme_leaf_ref_from_utility(&reg.token) {
                let var = css_var_name(&[ns.to_string(), key.to_string()]);
                if known.contains(&var) {
                    used.insert(var);
                }
            }
        }
    }
    used
}

fn mark_css_var_uses(text: &str, known: &BTreeSet<String>, used: &mut BTreeSet<String>) {
    for name in collect_vmz_css_var_refs(text) {
        if known.contains(&name) {
            used.insert(name);
        }
    }
}

/// Map a utility class to a semantic design-token `(namespace, key)` when the key is semantic.
///
/// Returns `None` for empty tokens or keys that fail the semantic design-key check.
pub fn design_token_ref_from_utility(token: &str) -> Option<(&'static str, &str)> {
    let bare = bare_utility(token);
    if bare.is_empty() {
        return None;
    }
    for (prefix, ns) in UTILITY_THEME_PREFIXES {
        if let Some(rest) = bare.strip_prefix(prefix) {
            if rest.is_empty() || !is_semantic_design_key(rest) {
                return None;
            }
            return Some((*ns, rest));
        }
    }
    None
}

/// Map a utility class to a theme-table `(namespace, key)` when the key is a theme leaf.
///
/// Like [`design_token_ref_from_utility`], but accepts theme leaf keys rather than
/// semantic design keys only.
pub fn theme_leaf_ref_from_utility(token: &str) -> Option<(&'static str, &str)> {
    let bare = bare_utility(token);
    if bare.is_empty() {
        return None;
    }
    for (prefix, ns) in UTILITY_THEME_PREFIXES {
        if let Some(rest) = bare.strip_prefix(prefix) {
            if rest.is_empty() || !is_theme_leaf_key(rest) {
                return None;
            }
            return Some((*ns, rest));
        }
    }
    None
}

/// Strip important/`:` variants and opacity suffixes, leaving the bare utility name.
///
/// Example: `!hover:bg-action/50` becomes `bg-action`.
pub fn bare_utility(token: &str) -> &str {
    let t = token.trim();
    let t = t.strip_prefix('!').unwrap_or(t);
    let t = t.rsplit(':').next().unwrap_or(t);
    t.split('/').next().unwrap_or(t)
}

fn is_semantic_design_key(key: &str) -> bool {
    if key.is_empty() {
        return false;
    }
    let mut has_alpha = false;
    for c in key.chars() {
        match c {
            'a'..='z' => has_alpha = true,
            '-' | '_' => {}
            '0'..='9' => return false,
            _ => return false,
        }
    }
    has_alpha
}

fn is_theme_leaf_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| matches!(c, 'a'..='z' | '0'..='9' | '-' | '_'))
}

const UTILITY_THEME_PREFIXES: &[(&str, &str)] = &[
    ("scroll-mx-", "spacing"),
    ("scroll-my-", "spacing"),
    ("scroll-mt-", "spacing"),
    ("scroll-mr-", "spacing"),
    ("scroll-mb-", "spacing"),
    ("scroll-ml-", "spacing"),
    ("scroll-ms-", "spacing"),
    ("scroll-me-", "spacing"),
    ("scroll-px-", "spacing"),
    ("scroll-py-", "spacing"),
    ("scroll-pt-", "spacing"),
    ("scroll-pr-", "spacing"),
    ("scroll-pb-", "spacing"),
    ("scroll-pl-", "spacing"),
    ("scroll-ps-", "spacing"),
    ("scroll-pe-", "spacing"),
    ("scroll-m-", "spacing"),
    ("scroll-p-", "spacing"),
    ("space-x-", "spacing"),
    ("space-y-", "spacing"),
    ("gap-x-", "spacing"),
    ("gap-y-", "spacing"),
    ("min-w-", "spacing"),
    ("min-h-", "spacing"),
    ("max-w-", "spacing"),
    ("max-h-", "spacing"),
    ("inset-x-", "spacing"),
    ("inset-y-", "spacing"),
    ("px-", "spacing"),
    ("py-", "spacing"),
    ("pt-", "spacing"),
    ("pr-", "spacing"),
    ("pb-", "spacing"),
    ("pl-", "spacing"),
    ("ps-", "spacing"),
    ("pe-", "spacing"),
    ("mx-", "spacing"),
    ("my-", "spacing"),
    ("mt-", "spacing"),
    ("mr-", "spacing"),
    ("mb-", "spacing"),
    ("ml-", "spacing"),
    ("ms-", "spacing"),
    ("me-", "spacing"),
    ("gap-", "spacing"),
    ("inset-", "spacing"),
    ("top-", "spacing"),
    ("right-", "spacing"),
    ("bottom-", "spacing"),
    ("left-", "spacing"),
    ("start-", "spacing"),
    ("end-", "spacing"),
    ("size-", "spacing"),
    ("basis-", "spacing"),
    ("indent-", "spacing"),
    ("p-", "spacing"),
    ("m-", "spacing"),
    ("w-", "spacing"),
    ("h-", "spacing"),
    ("decoration-", "colors"),
    ("outline-", "colors"),
    ("divide-", "colors"),
    ("accent-", "colors"),
    ("caret-", "colors"),
    ("stroke-", "colors"),
    ("border-", "colors"),
    ("shadow-", "colors"),
    ("ring-", "colors"),
    ("fill-", "colors"),
    ("from-", "colors"),
    ("via-", "colors"),
    ("text-", "colors"),
    ("bg-", "colors"),
    ("to-", "colors"),
];

/// Collect unique-looking `--vmz-*` names referenced via `var(...)` in CSS/source text.
pub fn collect_vmz_css_var_refs(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'v' && text[i..].starts_with("var(") {
            let mut j = i + 4;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if text[j..].starts_with("--vmz-") {
                let start = j;
                j += 6;
                while j < bytes.len() {
                    let c = bytes[j];
                    if c.is_ascii_alphanumeric() || c == b'-' || c == b'_' {
                        j += 1;
                    } else {
                        break;
                    }
                }
                let name = text[start..j].to_string();
                if !out.iter().any(|n| n == &name) {
                    out.push(name);
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn locate_token_span(source: &str, token: &str) -> Option<Span> {
    source.find(token).map(|rel| {
        let start = rel as u32;
        Span::new(start, start + token.len() as u32)
    })
}
