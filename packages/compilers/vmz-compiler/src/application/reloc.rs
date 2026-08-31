//! ApplicationBase relocation for child apps compiled at logical base `/`.
//!
//! Child apps compile at logical base `/`. Deployment applies [`ApplicationBase`] to
//! RouteId/asset/server/resume/… surfaces. Bare root-absolute string literals are errors
//! unless marked `@vmz-external` or they carry a URI scheme.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    APPLICATION_BASE_SCHEMA, APPLICATION_RELOCATABLE_CHECK_SCHEMA, APPLICATION_RELOCATED_SCHEMA,
    APPLICATION_RELOCATION_SCHEMA, ApplicationBase, ApplicationDescriptor, ApplicationDiagnostic,
    ApplicationId, ApplicationRelocatableReport, ApplicationRelocationManifest,
    ApplicationSourceSpan, DIAG_INVALID_BASE, DIAG_INVALID_DESCRIPTOR, DIAG_NON_RELOCATABLE_URL,
    LogicalUrlEntry, LogicalUrlKind, RelocatedApplicationUrls, RelocatedUrlEntry,
};
use walkdir::WalkDir;

use crate::application::{check_applications, normalize_route_base};

/// Parse and normalize an ApplicationBase.
pub fn parse_application_base(
    raw: &str,
    application_id: Option<ApplicationId>,
) -> Result<ApplicationBase, ApplicationDiagnostic> {
    match normalize_route_base(raw) {
        Ok(base) => {
            Ok(ApplicationBase { schema: APPLICATION_BASE_SCHEMA.into(), base, application_id })
        }
        Err(msg) => {
            Err(ApplicationDiagnostic::coded_error("<application-base>", DIAG_INVALID_BASE)
                .with_arg("detail", msg))
        }
    }
}

/// Join ApplicationBase with a logical absolute path (`/`-rooted).
pub fn join_application_base(base: &str, logical_path: &str) -> Result<String, String> {
    let base = normalize_route_base(base)?;
    let logical = normalize_logical_path(logical_path)?;
    if base == "/" {
        return Ok(logical);
    }
    if logical == "/" {
        return Ok(base);
    }
    Ok(format!("{base}{logical}"))
}

/// Strip ApplicationBase from a request path → logical path.
pub fn strip_application_base(base: &str, request_path: &str) -> Result<Option<String>, String> {
    let base = normalize_route_base(base)?;
    let req = normalize_logical_path(request_path)?;
    if base == "/" {
        return Ok(Some(req));
    }
    if req == base {
        return Ok(Some("/".into()));
    }
    let prefix = format!("{base}/");
    if let Some(rest) = req.strip_prefix(&prefix) {
        return Ok(Some(format!("/{rest}")));
    }
    Ok(None)
}

fn normalize_logical_path(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("logical path must not be empty".into());
    }
    if !raw.starts_with('/') {
        return Err(format!("logical path must be absolute (start with `/`), got `{raw}`"));
    }
    if raw.contains('?') || raw.contains('#') {
        return Err(format!("logical path must not contain query/hash, got `{raw}`"));
    }
    if raw.contains("//") {
        return Err(format!("logical path must not contain empty segments, got `{raw}`"));
    }
    if raw.len() > 1 && raw.ends_with('/') {
        return Ok(raw.trim_end_matches('/').to_string());
    }
    Ok(raw.to_string())
}

/// Apply ApplicationBase to every logical entry.
pub fn relocate_manifest(
    manifest: &ApplicationRelocationManifest,
    base: &ApplicationBase,
) -> Result<RelocatedApplicationUrls, ApplicationDiagnostic> {
    if manifest.logical_base != "/" {
        return Err(ApplicationDiagnostic::coded_error("<relocation-manifest>", DIAG_INVALID_BASE)
            .with_arg(
                "detail",
                format!(
                    "relocation manifest logicalBase must be `/` (independent compile), got `{}`",
                    manifest.logical_base
                ),
            ));
    }
    let mut entries = Vec::with_capacity(manifest.entries.len());
    for e in &manifest.entries {
        let href = join_application_base(&base.base, &e.logical_path).map_err(|msg| {
            ApplicationDiagnostic::coded_error("<relocation-manifest>", DIAG_INVALID_BASE)
                .with_arg("detail", format!("entry `{}` ({}): {msg}", e.id, e.kind))
        })?;
        entries.push(RelocatedUrlEntry {
            id: e.id.clone(),
            kind: e.kind,
            logical_path: e.logical_path.clone(),
            href,
        });
    }
    Ok(RelocatedApplicationUrls {
        schema: APPLICATION_RELOCATED_SCHEMA.into(),
        application_id: manifest.application_id.clone(),
        base: base.base.clone(),
        entries,
    })
}

/// Default non-root URL base used by relocation checks when the caller omits one.
pub const DEFAULT_RELOCATE_PROOF_BASE: &str = "/__vmz_relocated__/app";

/// Build a sample logical URL manifest covering all relocation surface kinds for one app.
///
/// Useful as a fixture input for relocation proofs; paths are relative to the app root.
pub fn sample_relocation_manifest(application_id: &str) -> ApplicationRelocationManifest {
    let id = application_id.to_string();
    ApplicationRelocationManifest {
        schema: APPLICATION_RELOCATION_SCHEMA.into(),
        application_id: ApplicationId(id.clone()),
        logical_base: "/".into(),
        entries: vec![
            entry(LogicalUrlKind::Route, &format!("{id}.home"), "/"),
            entry(LogicalUrlKind::Route, &format!("{id}.settings"), "/settings"),
            entry(LogicalUrlKind::Asset, &format!("{id}.logo"), "/assets/logo.png"),
            entry(LogicalUrlKind::Module, &format!("{id}.entry"), "/_vmz/entry.js"),
            entry(LogicalUrlKind::Preload, &format!("{id}.preload"), "/_vmz/preload.js"),
            entry(LogicalUrlKind::Form, &format!("{id}.save"), "/_vmz/actions/save"),
            entry(LogicalUrlKind::Redirect, &format!("{id}.legacy"), "/legacy"),
            entry(LogicalUrlKind::Canonical, &format!("{id}.canonical"), "/"),
            entry(LogicalUrlKind::Sitemap, &format!("{id}.sitemap"), "/sitemap.xml"),
            entry(LogicalUrlKind::Server, &format!("{id}.api"), "/_vmz/server/api"),
            entry(LogicalUrlKind::Ssr, &format!("{id}.ssr"), "/_vmz/ssr"),
            entry(LogicalUrlKind::Resume, &format!("{id}.resume"), "/_vmz/resume.js"),
            entry(LogicalUrlKind::Sw, &format!("{id}.sw"), "/"),
            entry(LogicalUrlKind::Sourcemap, &format!("{id}.map"), "/_vmz/entry.js.map"),
            entry(LogicalUrlKind::Trace, &format!("{id}.trace"), "/_vmz/trace"),
            entry(LogicalUrlKind::Error, &format!("{id}.error"), "/_vmz/error"),
        ],
    }
}

fn entry(kind: LogicalUrlKind, id: &str, logical_path: &str) -> LogicalUrlEntry {
    LogicalUrlEntry { id: id.into(), kind, logical_path: logical_path.into() }
}

// Prove independent `/` and non-root relocation for a package .
///
/// Scans sources for non-relocatable root-absolute string literals and relocates a
/// logical manifest under `/` and `relocate_base`.
pub fn check_application_relocatable(
    package_root: impl AsRef<Path>,
    relocate_base: Option<&str>,
) -> ApplicationRelocatableReport {
    let package_root = package_root.as_ref();
    let mut diagnostics = Vec::new();

    let descriptor = load_own_descriptor(package_root, &mut diagnostics);
    let application_id =
        descriptor.as_ref().map(|d| d.id.as_str().to_string()).unwrap_or_else(|| "unknown".into());

    scan_non_relocatable_urls(package_root, &mut diagnostics);

    let manifest = sample_relocation_manifest(&application_id);
    // Ensure logical paths themselves are well-formed.
    for e in &manifest.entries {
        if let Err(msg) = normalize_logical_path(&e.logical_path) {
            diagnostics.push(
                ApplicationDiagnostic::coded_error(
                    package_root.display().to_string(),
                    DIAG_INVALID_BASE,
                )
                .with_arg("detail", format!("manifest entry `{}`: {msg}", e.id)),
            );
        }
    }

    let root_base = ApplicationBase {
        schema: APPLICATION_BASE_SCHEMA.into(),
        base: "/".into(),
        application_id: Some(ApplicationId(application_id.clone())),
    };
    let proof_raw = relocate_base.unwrap_or(DEFAULT_RELOCATE_PROOF_BASE);
    let relocated_base =
        match parse_application_base(proof_raw, Some(ApplicationId(application_id.clone()))) {
            Ok(b) => b,
            Err(d) => {
                diagnostics.push(d);
                ApplicationBase {
                    schema: APPLICATION_BASE_SCHEMA.into(),
                    base: DEFAULT_RELOCATE_PROOF_BASE.into(),
                    application_id: Some(ApplicationId(application_id.clone())),
                }
            }
        };

    let at_root = match relocate_manifest(&manifest, &root_base) {
        Ok(r) => {
            verify_roundtrip(&r, &root_base.base, &mut diagnostics);
            r
        }
        Err(d) => {
            diagnostics.push(d);
            empty_relocated(&application_id, "/")
        }
    };
    let at_relocated = match relocate_manifest(&manifest, &relocated_base) {
        Ok(r) => {
            verify_roundtrip(&r, &relocated_base.base, &mut diagnostics);
            verify_not_equal_to_logical_when_prefixed(&r, &relocated_base.base, &mut diagnostics);
            r
        }
        Err(d) => {
            diagnostics.push(d);
            empty_relocated(&application_id, &relocated_base.base)
        }
    };

    ApplicationRelocatableReport {
        schema: APPLICATION_RELOCATABLE_CHECK_SCHEMA.into(),
        application_id: Some(ApplicationId(application_id)),
        package_root: package_root.display().to_string(),
        manifest,
        at_root,
        at_relocated,
        diagnostics,
    }
}

fn empty_relocated(application_id: &str, base: &str) -> RelocatedApplicationUrls {
    RelocatedApplicationUrls {
        schema: APPLICATION_RELOCATED_SCHEMA.into(),
        application_id: ApplicationId(application_id.into()),
        base: base.into(),
        entries: Vec::new(),
    }
}

fn verify_roundtrip(
    relocated: &RelocatedApplicationUrls,
    base: &str,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    for e in &relocated.entries {
        match strip_application_base(base, &e.href) {
            Ok(Some(logical)) if logical == e.logical_path => {}
            Ok(Some(logical)) => diagnostics.push(
                ApplicationDiagnostic::coded_error("<relocation-proof>", DIAG_INVALID_BASE)
                    .with_arg(
                        "detail",
                        format!(
                            "strip(base=`{base}`, href=`{}`) → `{logical}` but logicalPath is `{}`",
                            e.href, e.logical_path
                        ),
                    ),
            ),
            Ok(None) => diagnostics.push(
                ApplicationDiagnostic::coded_error("<relocation-proof>", DIAG_INVALID_BASE)
                    .with_arg(
                        "detail",
                        format!("strip(base=`{base}`, href=`{}`) missed entry `{}`", e.href, e.id),
                    ),
            ),
            Err(msg) => diagnostics.push(
                ApplicationDiagnostic::coded_error("<relocation-proof>", DIAG_INVALID_BASE)
                    .with_arg("detail", msg),
            ),
        }
    }
}

fn verify_not_equal_to_logical_when_prefixed(
    relocated: &RelocatedApplicationUrls,
    base: &str,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    if base == "/" {
        return;
    }
    for e in &relocated.entries {
        if e.logical_path != "/" && e.href == e.logical_path {
            diagnostics.push(
                ApplicationDiagnostic::coded_error("<relocation-proof>", DIAG_INVALID_BASE)
                    .with_arg(
                        "detail",
                        format!(
                            "non-root base `{base}` left entry `{}` unprefixed (`{}`)",
                            e.id, e.href
                        ),
                    ),
            );
        }
        if !e.href.starts_with(base) {
            diagnostics.push(
                ApplicationDiagnostic::coded_error("<relocation-proof>", DIAG_INVALID_BASE)
                    .with_arg(
                        "detail",
                        format!(
                            "relocated href `{}` for `{}` does not start with base `{base}`",
                            e.href, e.id
                        ),
                    ),
            );
        }
    }
}

fn load_own_descriptor(
    package_root: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Option<ApplicationDescriptor> {
    let report = check_applications(package_root, &[package_root.to_path_buf()]);
    for d in report.diagnostics {
        if d.code_string().as_deref() == Some(DIAG_INVALID_DESCRIPTOR)
            || d.code_string().as_deref().unwrap_or("").starts_with("vmz::application::invalid_")
        {
            diagnostics.push(d);
        }
    }
    report.descriptors.into_iter().next()
}

/// Scan package sources for bare root-absolute URL string literals.
pub fn scan_non_relocatable_urls(
    package_root: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let scan_roots = [package_root.join("src"), package_root.to_path_buf()];
    let mut seen = std::collections::HashSet::new();
    for root in scan_roots {
        if !root.exists() {
            continue;
        }
        for entry in WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            if !matches!(ext, "vmz" | "ts" | "tsx" | "js" | "jsx" | "mjs" | "cjs") {
                continue;
            }
            // Avoid double-scanning package root files when src also exists.
            let key = path.to_path_buf();
            if !seen.insert(key) {
                continue;
            }
            // Skip package.json / config at root when walking package_root.
            if path.file_name().and_then(|n| n.to_str()) == Some("package.json") {
                continue;
            }
            let Ok(text) = fs::read_to_string(path) else {
                continue;
            };
            scan_source_text(path, &text, diagnostics);
        }
    }
}

fn scan_source_text(path: &Path, text: &str, diagnostics: &mut Vec<ApplicationDiagnostic>) {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == b'\'' || c == b'"' || c == b'`' {
            let quote = c;
            let start = i;
            i += 1;
            let mut lit = String::new();
            let mut escaped = false;
            while i < bytes.len() {
                let ch = bytes[i];
                if escaped {
                    lit.push(ch as char);
                    escaped = false;
                    i += 1;
                    continue;
                }
                if ch == b'\\' {
                    escaped = true;
                    i += 1;
                    continue;
                }
                if ch == quote {
                    break;
                }
                // Template expressions — stop conservative scan inside `${`.
                if quote == b'`' && ch == b'$' && bytes.get(i + 1) == Some(&b'{') {
                    lit.clear();
                    break;
                }
                lit.push(ch as char);
                i += 1;
            }
            let end = (i + 1).min(bytes.len());
            if !lit.is_empty() && is_non_relocatable_candidate(&lit) {
                let marked = is_marked_external(text, start);
                if !marked {
                    diagnostics.push(ApplicationDiagnostic::coded_error(path.display().to_string(), DIAG_NON_RELOCATABLE_URL).with_arg("detail", format!(
                            "root-absolute URL `{lit}` is not relocatable; use RouteId/AssetId/Server Capability ID, or mark with `@vmz-external` / use a URI scheme"
                        )).with_source_span(ApplicationSourceSpan {
                            path: path.display().to_string(),
                            start: start as u32,
                            end: end as u32,
                        }));
                }
            }
            i = end;
            continue;
        }
        i += 1;
    }
}

fn is_non_relocatable_candidate(lit: &str) -> bool {
    if !lit.starts_with('/') || lit.starts_with("//") {
        return false;
    }
    // URI schemes are external by definition.
    if lit.contains("://") {
        return false;
    }
    // Allow pure protocol-ish forms already rejected above; require path-like.
    let rest = &lit[1..];
    if rest.is_empty() {
        // Bare `/` — still an absolute in-app URL; require RouteId.
        return true;
    }
    // Ignore regex-looking or glob noise with spaces.
    if lit.contains(' ') || lit.contains('\n') {
        return false;
    }
    // Typical in-app absolute paths.
    rest.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '.' | '_' | '-' | '~' | '%'))
}

fn is_marked_external(source: &str, lit_start: usize) -> bool {
    let before = &source[..lit_start];
    let line_start = before.rfind('\n').map(|i| i + 1).unwrap_or(0);
    let line_prefix = &source[line_start..lit_start];
    if line_prefix.contains("@vmz-external") {
        return true;
    }
    // Previous non-empty line.
    let head = &source[..line_start];
    if let Some(prev_nl) = head.rfind('\n') {
        let prev_line = source[prev_nl + 1..line_start].trim();
        if prev_line.contains("@vmz-external") {
            return true;
        }
    } else {
        let prev_line = head.trim();
        if prev_line.contains("@vmz-external") {
            return true;
        }
    }
    false
}

/// Relocate an arbitrary manifest JSON with a base string (N-API / CLI).
pub fn relocate_manifest_json(manifest_json: &str, base: &str) -> Result<String, String> {
    let manifest: ApplicationRelocationManifest = serde_json::from_str(manifest_json)
        .map_err(|e| format!("invalid relocation manifest JSON: {e}"))?;
    let app_base =
        parse_application_base(base, Some(manifest.application_id.clone())).map_err(|d| {
            d.args().and_then(|m| m.get("detail").cloned()).unwrap_or_else(|| d.to_string())
        })?;
    let relocated = relocate_manifest(&manifest, &app_base).map_err(|d| {
        d.args().and_then(|m| m.get("detail").cloned()).unwrap_or_else(|| d.to_string())
    })?;
    vmz_generator::to_pretty_json(&relocated).map_err(|e| e.to_string())
}
