//! ApplicationBase relocation for child apps compiled at logical base `/`.
//!
//! Child apps compile at logical base `/`. Deployment applies [`ApplicationBase`] to
//! RouteId/asset/server/resume/… surfaces. Bare root-absolute string literals are errors
//! unless marked `@vmz-external` or they carry a URI scheme.

use std::fs;
use std::path::{Path, PathBuf};

use vmz_protocol::{
    APPLICATION_BASE_SCHEMA, APPLICATION_RELOCATABLE_CHECK_SCHEMA, APPLICATION_RELOCATED_SCHEMA,
    APPLICATION_RELOCATION_SCHEMA, ApplicationBase, ApplicationDescriptor, ApplicationDiagnostic,
    ApplicationId, ApplicationRelocatableReport, ApplicationRelocationManifest,
    ApplicationSourceSpan, DIAG_INVALID_BASE, DIAG_INVALID_DESCRIPTOR, DIAG_NON_RELOCATABLE_URL,
    LogicalUrlEntry, RelocatedApplicationUrls, RelocatedUrlEntry,
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
        Err(msg) => Err(ApplicationDiagnostic {
            code: DIAG_INVALID_BASE.into(),
            severity: "error".into(),
            path: "<application-base>".into(),
            message: msg,
            span: None,
        }),
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
        return Err(ApplicationDiagnostic {
            code: DIAG_INVALID_BASE.into(),
            severity: "error".into(),
            path: "<relocation-manifest>".into(),
            message: format!(
                "relocation manifest logicalBase must be `/` (independent compile), got `{}`",
                manifest.logical_base
            ),
            span: None,
        });
    }
    let mut entries = Vec::with_capacity(manifest.entries.len());
    for e in &manifest.entries {
        let href = join_application_base(&base.base, &e.logical_path).map_err(|msg| {
            ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-manifest>".into(),
                message: format!("entry `{}` ({}): {msg}", e.id, e.kind),
                span: None,
            }
        })?;
        entries.push(RelocatedUrlEntry {
            id: e.id.clone(),
            kind: e.kind.clone(),
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

/// Default non-root proof base used by M1 checks when caller does not supply one.
pub const DEFAULT_RELOCATE_PROOF_BASE: &str = "/__vmz_relocated__/app";

/// Build a minimal logical manifest covering M1 surfaces for an ApplicationId.
pub fn sample_relocation_manifest(application_id: &str) -> ApplicationRelocationManifest {
    let id = application_id.to_string();
    ApplicationRelocationManifest {
        schema: APPLICATION_RELOCATION_SCHEMA.into(),
        application_id: ApplicationId(id.clone()),
        logical_base: "/".into(),
        entries: vec![
            entry("route", &format!("{id}.home"), "/"),
            entry("route", &format!("{id}.settings"), "/settings"),
            entry("asset", &format!("{id}.logo"), "/assets/logo.png"),
            entry("module", &format!("{id}.entry"), "/_vmz/entry.js"),
            entry("preload", &format!("{id}.preload"), "/_vmz/preload.js"),
            entry("form", &format!("{id}.save"), "/_vmz/actions/save"),
            entry("redirect", &format!("{id}.legacy"), "/legacy"),
            entry("canonical", &format!("{id}.canonical"), "/"),
            entry("sitemap", &format!("{id}.sitemap"), "/sitemap.xml"),
            entry("server", &format!("{id}.api"), "/_vmz/server/api"),
            entry("ssr", &format!("{id}.ssr"), "/_vmz/ssr"),
            entry("resume", &format!("{id}.resume"), "/_vmz/resume.js"),
            entry("sw", &format!("{id}.sw"), "/"),
            entry("sourcemap", &format!("{id}.map"), "/_vmz/entry.js.map"),
            entry("trace", &format!("{id}.trace"), "/_vmz/trace"),
            entry("error", &format!("{id}.error"), "/_vmz/error"),
        ],
    }
}

fn entry(kind: &str, id: &str, logical_path: &str) -> LogicalUrlEntry {
    LogicalUrlEntry { id: id.into(), kind: kind.into(), logical_path: logical_path.into() }
}

/// Prove independent `/` and non-root relocation for a package (M1).
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
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: package_root.display().to_string(),
                message: format!("manifest entry `{}`: {msg}", e.id),
                span: None,
            });
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
            Ok(Some(logical)) => diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-proof>".into(),
                message: format!(
                    "strip(base=`{base}`, href=`{}`) → `{logical}` but logicalPath is `{}`",
                    e.href, e.logical_path
                ),
                span: None,
            }),
            Ok(None) => diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-proof>".into(),
                message: format!("strip(base=`{base}`, href=`{}`) missed entry `{}`", e.href, e.id),
                span: None,
            }),
            Err(msg) => diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-proof>".into(),
                message: msg,
                span: None,
            }),
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
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-proof>".into(),
                message: format!(
                    "non-root base `{base}` left entry `{}` unprefixed (`{}`)",
                    e.id, e.href
                ),
                span: None,
            });
        }
        if !e.href.starts_with(base) {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_INVALID_BASE.into(),
                severity: "error".into(),
                path: "<relocation-proof>".into(),
                message: format!(
                    "relocated href `{}` for `{}` does not start with base `{base}`",
                    e.href, e.id
                ),
                span: None,
            });
        }
    }
}

fn load_own_descriptor(
    package_root: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Option<ApplicationDescriptor> {
    let report = check_applications(package_root, &[package_root.to_path_buf()]);
    for d in report.diagnostics {
        if d.code == DIAG_INVALID_DESCRIPTOR || d.code.starts_with("vmz::application::invalid_") {
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
                    diagnostics.push(ApplicationDiagnostic {
                        code: DIAG_NON_RELOCATABLE_URL.into(),
                        severity: "error".into(),
                        path: path.display().to_string(),
                        message: format!(
                            "root-absolute URL `{lit}` is not relocatable; use RouteId/AssetId/Server Capability ID, or mark with `@vmz-external` / use a URI scheme"
                        ),
                        span: Some(ApplicationSourceSpan {
                            path: path.display().to_string(),
                            start: start as u32,
                            end: end as u32,
                        }),
                    });
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
    let app_base = parse_application_base(base, Some(manifest.application_id.clone()))
        .map_err(|d| d.message)?;
    let relocated = relocate_manifest(&manifest, &app_base).map_err(|d| d.message)?;
    serde_json::to_string_pretty(&relocated).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("vmz-m1-{label}-{nanos}"));
        fs::create_dir_all(dir.join("src")).unwrap();
        dir
    }

    #[test]
    fn join_and_strip_roundtrip() {
        assert_eq!(join_application_base("/", "/settings").unwrap(), "/settings");
        assert_eq!(
            join_application_base("/examples/counter", "/settings").unwrap(),
            "/examples/counter/settings"
        );
        assert_eq!(join_application_base("/examples/counter", "/").unwrap(), "/examples/counter");
        assert_eq!(
            strip_application_base("/examples/counter", "/examples/counter/settings").unwrap(),
            Some("/settings".into())
        );
        assert_eq!(strip_application_base("/examples/counter", "/other").unwrap(), None);
    }

    #[test]
    fn relocatable_ok_without_bare_urls() {
        let dir = tmp("ok");
        fs::write(
            dir.join("package.json"),
            r#"{
  "name": "@t/counter",
  "vmz": {
    "application": {
      "schema": "vmz.application.v0",
      "id": "counter",
      "entryRoute": "counter.home"
    }
  }
}"#,
        )
        .unwrap();
        fs::write(
            dir.join("src").join("App.vmz"),
            r#"<template><p>{count}</p></template>
<script client>
export default class App {
  count = 0
  // @vmz-external
  docs = 'https://example.com/docs'
}
</script>
"#,
        )
        .unwrap();
        let report = check_application_relocatable(&dir, Some("/examples/counter"));
        assert!(!report.has_errors(), "{:?}", report.diagnostics);
        let settings =
            report.at_relocated.entries.iter().find(|e| e.logical_path == "/settings").unwrap();
        assert_eq!(settings.href, "/examples/counter/settings");
        let home = report.at_root.entries.iter().find(|e| e.logical_path == "/").unwrap();
        assert_eq!(home.href, "/");
    }

    #[test]
    fn bare_absolute_path_is_error() {
        let dir = tmp("bad");
        fs::write(
            dir.join("package.json"),
            r#"{
  "name": "@t/bad",
  "vmz": {
    "application": {
      "schema": "vmz.application.v0",
      "id": "bad",
      "entryRoute": "bad.home"
    }
  }
}"#,
        )
        .unwrap();
        fs::write(
            dir.join("src").join("x.vmz"),
            r#"<template><a href="/settings">x</a></template>
<script client>
export default class X {
  path = '/assets/logo.png'
}
</script>
"#,
        )
        .unwrap();
        let report = check_application_relocatable(&dir, None);
        assert!(report.has_errors());
        assert!(report.diagnostics.iter().any(|d| d.code == DIAG_NON_RELOCATABLE_URL));
    }
}
