//! Collect `style:tw` and `@tailwind` sites from a `.vmz` source (experimental).

use std::path::{Path, PathBuf};

use oxc_span::Span;
use serde::{Deserialize, Serialize};
use vmz_compiler::{
    AttrValue, ParsedVmz, ReportedDiagnostic, TemplateNode, parse_template, parse_vmz,
};

/// Kind of TW entry found in source.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TwTokenKind {
    /// Element attribute `style:tw="…"`.
    StyleTw,
    /// File/module `@tailwind { … }` (or bare `@tailwind` marker) inside `<style>`.
    AtTailwind,
}

/// One utility / class token after whitespace split (static only).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TwTokenHit {
    /// Utility class text (e.g. `px-4`).
    pub token: String,
    /// Byte span in the original `.vmz` file (oxc `Span`).
    #[serde(with = "span_serde")]
    pub span: Span,
}

mod span_serde {
    use oxc_span::Span;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S: Serializer>(span: &Span, s: S) -> Result<S::Ok, S::Error> {
        (span.start, span.end).serialize(s)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Span, D::Error> {
        let (start, end) = <(u32, u32)>::deserialize(d)?;
        Ok(Span::new(start, end))
    }
}

/// One TW site (attribute or at-rule block).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TwSite {
    /// Whether this site is `style:tw` or `@tailwind`.
    pub kind: TwTokenKind,
    /// Source `.vmz` path.
    pub path: PathBuf,
    /// Byte span covering the site in the source file.
    #[serde(with = "span_serde")]
    pub span: Span,
    /// Static tokens when the value is a string literal / block body.
    pub tokens: Vec<TwTokenHit>,
    /// True when the site uses `{…}` interpolation — engine cannot resolve statically.
    pub dynamic: bool,
    /// Raw attribute / block text (for provenance / later engine input).
    pub raw: String,
}

/// Collection result for one `.vmz` file (or in-memory source).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TwCollection {
    /// Source path (or synthetic path for registration-only compiles).
    pub path: PathBuf,
    /// Every TW site discovered in the file.
    pub sites: Vec<TwSite>,
    /// Flattened static tokens (deduped, stable order).
    pub static_tokens: Vec<String>,
}

impl TwCollection {
    /// True when any site uses dynamic interpolation.
    pub fn has_dynamic(&self) -> bool {
        self.sites.iter().any(|s| s.dynamic)
    }
}

/// Collect from already-parsed SFC.
pub fn collect_from_vmz(parsed: &ParsedVmz) -> (TwCollection, Vec<ReportedDiagnostic>) {
    let mut diagnostics = Vec::new();
    let mut sites = Vec::new();

    let ir = match parse_template(&parsed.template.content) {
        Ok(ir) => ir,
        Err(e) => {
            diagnostics.push(ReportedDiagnostic::error(&parsed.path, format!("template: {e}")));
            return (
                TwCollection { path: parsed.path.clone(), sites, static_tokens: Vec::new() },
                diagnostics,
            );
        }
    };
    walk_nodes(
        &ir.roots,
        &parsed.path,
        &parsed.template.content,
        parsed.template.content_start,
        &mut sites,
        &mut diagnostics,
    );

    if let Some(style) = &parsed.style {
        collect_at_tailwind(
            &parsed.path,
            &style.content,
            style.content_start,
            &mut sites,
            &mut diagnostics,
        );
    }

    let static_tokens = flatten_tokens(&sites);
    (TwCollection { path: parsed.path.clone(), sites, static_tokens }, diagnostics)
}

/// Parse `.vmz` source then collect.
pub fn collect_from_source(
    path: impl AsRef<Path>,
    source: impl Into<String>,
) -> Result<(TwCollection, Vec<ReportedDiagnostic>), vmz_compiler::SfcError> {
    let parsed = parse_vmz(path, source)?;
    Ok(collect_from_vmz(&parsed))
}

fn walk_nodes(
    nodes: &[TemplateNode],
    path: &Path,
    template: &str,
    template_start: usize,
    sites: &mut Vec<TwSite>,
    diagnostics: &mut Vec<ReportedDiagnostic>,
) {
    for node in nodes {
        if let TemplateNode::Element { tag: _, attrs, children } = node {
            for attr in attrs {
                if attr.name != "style:tw" {
                    continue;
                }
                match &attr.value {
                    AttrValue::Static(raw) => {
                        let span =
                            locate_attr_value_span(template, template_start, "style:tw", raw)
                                .unwrap_or_else(|| {
                                    Span::new(template_start as u32, template_start as u32)
                                });
                        let tokens = split_tokens(raw, span);
                        sites.push(TwSite {
                            kind: TwTokenKind::StyleTw,
                            path: path.to_path_buf(),
                            span,
                            tokens,
                            dynamic: false,
                            raw: raw.clone(),
                        });
                    }
                    AttrValue::Interp(expr) => {
                        let span = locate_attr_name_span(template, template_start, "style:tw")
                            .unwrap_or_else(|| {
                                Span::new(template_start as u32, template_start as u32)
                            });
                        diagnostics.push(ReportedDiagnostic::advice(
                            path,
                            format!(
                                "style:tw with interpolation `{{{expr}}}` is a dynamic boundary; TW engine only answers static tokens (experimental adapter)"
                            ),
                        ));
                        // Attach span via error_at-style advice isn't available — use warning_at pattern:
                        // ReportedDiagnostic::advice has no span; upgrade to warning with label.
                        let _ = span;
                        sites.push(TwSite {
                            kind: TwTokenKind::StyleTw,
                            path: path.to_path_buf(),
                            span,
                            tokens: Vec::new(),
                            dynamic: true,
                            raw: format!("{{{expr}}}"),
                        });
                    }
                }
            }
            walk_nodes(children, path, template, template_start, sites, diagnostics);
        }
    }
}

fn collect_at_tailwind(
    path: &Path,
    style: &str,
    style_start: usize,
    sites: &mut Vec<TwSite>,
    diagnostics: &mut Vec<ReportedDiagnostic>,
) {
    let mut search_from = 0usize;
    while let Some(rel) = style[search_from..].find("@tailwind") {
        let abs = search_from + rel;
        let name_start = style_start + abs;
        let after = abs + "@tailwind".len();
        let rest = style[after..].trim_start();
        let (raw, end_in_style) = if rest.starts_with('{') {
            match find_matching_brace(style, after + (style[after..].len() - rest.len())) {
                Some(close) => {
                    let body = style[after + (style[after..].len() - rest.len()) + 1..close].trim();
                    (body.to_string(), close + 1)
                }
                None => {
                    diagnostics.push(ReportedDiagnostic::error_at(
                        path,
                        "unbalanced `@tailwind { … }` block",
                        Span::new(name_start as u32, (name_start + 9) as u32),
                    ));
                    return;
                }
            }
        } else {
            // Bare `@tailwind` marker (directives like base/components/utilities TBD).
            (String::new(), after)
        };
        let span = Span::new(name_start as u32, (style_start + end_in_style) as u32);
        let tokens = if raw.is_empty() {
            Vec::new()
        } else {
            // Inside @tailwind { .x { @apply a b } } — collect @apply tokens loosely.
            collect_apply_tokens(&raw, style_start + abs)
        };
        sites.push(TwSite {
            kind: TwTokenKind::AtTailwind,
            path: path.to_path_buf(),
            span,
            tokens,
            dynamic: false,
            raw,
        });
        search_from = end_in_style;
    }
}

fn collect_apply_tokens(block: &str, approx_start: usize) -> Vec<TwTokenHit> {
    let mut out = Vec::new();
    let mut search = 0usize;
    while let Some(rel) = block[search..].find("@apply") {
        let abs = search + rel;
        let after = abs + "@apply".len();
        let end = block[after..].find(';').map(|i| after + i).unwrap_or(block.len());
        let chunk = block[after..end].trim();
        let mut offset = approx_start + after;
        for tok in chunk.split_whitespace() {
            let start = offset as u32;
            let end = start + tok.len() as u32;
            out.push(TwTokenHit { token: tok.to_string(), span: Span::new(start, end) });
            offset += tok.len() + 1;
        }
        search = end.min(block.len().saturating_sub(1)) + 1;
        if search >= block.len() {
            break;
        }
    }
    out
}

fn find_matching_brace(s: &str, open_idx: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if open_idx >= bytes.len() || bytes[open_idx] != b'{' {
        return None;
    }
    let mut depth = 0i32;
    for (i, &b) in bytes.iter().enumerate().skip(open_idx) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn split_tokens(raw: &str, parent: Span) -> Vec<TwTokenHit> {
    let mut out = Vec::new();
    let mut byte = 0usize;
    for part in raw.split_whitespace() {
        if let Some(rel) = raw[byte..].find(part) {
            let start = parent.start as usize + byte + rel;
            let end = start + part.len();
            out.push(TwTokenHit {
                token: part.to_string(),
                span: Span::new(start as u32, end as u32),
            });
            byte += rel + part.len();
        }
    }
    out
}

fn locate_attr_value_span(
    template: &str,
    template_start: usize,
    name: &str,
    value: &str,
) -> Option<Span> {
    // Prefer `name="value"` then `name='value'`.
    let patterns = [format!("{name}=\"{value}\""), format!("{name}='{value}'")];
    for pat in &patterns {
        if let Some(rel) = template.find(pat) {
            let value_off = pat.find(value)?;
            let start = template_start + rel + value_off;
            let end = start + value.len();
            return Some(Span::new(start as u32, end as u32));
        }
    }
    locate_attr_name_span(template, template_start, name)
}

fn locate_attr_name_span(template: &str, template_start: usize, name: &str) -> Option<Span> {
    let rel = template.find(name)?;
    let start = template_start + rel;
    Some(Span::new(start as u32, (start + name.len()) as u32))
}

fn flatten_tokens(sites: &[TwSite]) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut out = Vec::new();
    for site in sites {
        for hit in &site.tokens {
            if seen.insert(hit.token.clone()) {
                out.push(hit.token.clone());
            }
        }
    }
    out
}
