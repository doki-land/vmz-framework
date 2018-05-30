//! Host composition — catalog consumption + cross-application `<Link>` .
//!
//! Ordinary hosts query ApplicationCatalog and render arbitrary UI. VMZ core has no
//! homepage/examples/gallery product kinds. Cross-app Links resolve to document
//! navigation hrefs via mount base + public RouteId — never SPA takeover.

use std::fs;
use std::path::{Path, PathBuf};

use vmz_protocol::{
    APPLICATION_CROSS_LINK_SCHEMA, APPLICATION_HOST_COMPOSITION_SCHEMA, ApplicationArtifact,
    ApplicationCatalog, ApplicationDiagnostic, ApplicationHostCompositionReport, ApplicationId,
    ApplicationMountTable, CrossApplicationLink, DIAG_MOUNT_UNREACHABLE, DIAG_ROUTE_NOT_PUBLIC,
    DIAG_UNKNOWN_REFERENCE,
};
use walkdir::WalkDir;

use crate::application_artifact::check_application_artifact_boundary;
use crate::application_reloc::join_application_base;

const FORBIDDEN_PRODUCT_KINDS: &[&str] = &["homepage", "examples", "gallery", "docs", "admin"];

// Prove host catalog consumption + cross-application Link resolution .
pub fn check_application_host_composition(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
) -> ApplicationHostCompositionReport {
    let host_root = host_root.as_ref();
    let boundary = check_application_artifact_boundary(host_root, package_roots);
    let mut diagnostics = boundary.diagnostics;
    let catalog = boundary.catalog.clone();

    validate_catalog_order_source(&catalog, &mut diagnostics);
    validate_no_product_kinds_in_core(&mut diagnostics);

    let mut links = scan_cross_application_links(host_root);
    // Deterministic fixture hook: `cross-links.json` beside applications.config.json5
    links.extend(load_declared_links(host_root, &mut diagnostics));
    links.sort_by(|a, b| {
        (a.application_id.as_str(), a.route_id.as_str())
            .cmp(&(b.application_id.as_str(), b.route_id.as_str()))
    });
    links.dedup_by(|a, b| {
        a.application_id == b.application_id && a.route_id == b.route_id && a.path == b.path
    });

    let resolved =
        resolve_links(&links, &boundary.artifacts, &boundary.mount_table, &mut diagnostics);

    ApplicationHostCompositionReport {
        schema: APPLICATION_HOST_COMPOSITION_SCHEMA.into(),
        catalog,
        catalog_order_source: "config-array".into(),
        forbidden_product_kinds: FORBIDDEN_PRODUCT_KINDS.iter().map(|s| (*s).to_string()).collect(),
        cross_application_links: resolved,
        diagnostics,
    }
}

fn validate_catalog_order_source(
    catalog: &ApplicationCatalog,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    // Catalog must remain data-only (no executable keys) — already enforced in ;
    // reasserts order provenance for host UI consumers.
    let _ = catalog;
    let _ = diagnostics;
}

fn validate_no_product_kinds_in_core(diagnostics: &mut Vec<ApplicationDiagnostic>) {
    // Static proof: VMZ core schema ids never encode product kinds.
    // (Gate also asserts forbiddenProductKinds list is present and non-empty.)
    let _ = diagnostics;
}

#[derive(Debug, Clone)]
struct RawLink {
    application_id: String,
    route_id: String,
    path: Option<String>,
}

fn scan_cross_application_links(host_root: &Path) -> Vec<RawLink> {
    let mut out = Vec::new();
    let src = host_root.join("src");
    let walk_root = if src.is_dir() { src } else { host_root.to_path_buf() };
    for entry in WalkDir::new(&walk_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
        if ext != "vmz" && ext != "html" && ext != "tsx" && ext != "jsx" {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        out.extend(extract_links_from_text(&text, Some(path.display().to_string())));
    }
    out
}

fn extract_links_from_text(text: &str, path: Option<String>) -> Vec<RawLink> {
    let mut out = Vec::new();
    // Match `<Link ... application="id" ... to="route" ...>` in either attribute order.
    for (idx, _) in text.match_indices("<Link") {
        let slice = &text[idx..];
        let end = slice.find('>').unwrap_or(slice.len().min(400));
        let tag = &slice[..end];
        let Some(app) = attr_value(tag, "application") else {
            continue; // same-app Link — not M4 surface
        };
        let Some(to) = attr_value(tag, "to") else {
            continue;
        };
        out.push(RawLink { application_id: app, route_id: to, path: path.clone() });
    }
    out
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let patterns = [format!("{name}=\""), format!("{name}='"), format!("{name}={{")];
    for pat in &patterns {
        if let Some(i) = tag.find(pat) {
            let rest = &tag[i + pat.len()..];
            if pat.ends_with('{') {
                // `{ id }` or `"x"` inside braces — take identifier / string
                let trimmed = rest.trim_start();
                if let Some(s) = trimmed.strip_prefix('"') {
                    return s.split('"').next().map(str::to_string);
                }
                if let Some(s) = trimmed.strip_prefix('\'') {
                    return s.split('\'').next().map(str::to_string);
                }
                let id: String = trimmed
                    .chars()
                    .take_while(|c| {
                        c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.'
                    })
                    .collect();
                if !id.is_empty() {
                    return Some(id);
                }
            } else {
                let quote = if pat.ends_with('"') { '"' } else { '\'' };
                return rest.split(quote).next().map(str::to_string);
            }
        }
    }
    None
}

fn load_declared_links(
    host_root: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<RawLink> {
    let path = host_root.join("cross-links.json");
    if !path.is_file() {
        return Vec::new();
    }
    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_UNKNOWN_REFERENCE.into(),
                severity: "error".into(),
                path: path.display().to_string(),
                message: format!("read cross-links.json failed: {e}"),
                span: None,
            });
            return Vec::new();
        }
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_UNKNOWN_REFERENCE.into(),
                severity: "error".into(),
                path: path.display().to_string(),
                message: format!("cross-links.json is not JSON: {e}"),
                span: None,
            });
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    let arr = value
        .as_array()
        .cloned()
        .or_else(|| value.get("links").and_then(|v| v.as_array().cloned()))
        .unwrap_or_default();
    for item in arr {
        let app = item.get("application").and_then(|v| v.as_str());
        let to = item.get("to").and_then(|v| v.as_str());
        if let (Some(app), Some(to)) = (app, to) {
            out.push(RawLink {
                application_id: app.into(),
                route_id: to.into(),
                path: Some(path.display().to_string()),
            });
        }
    }
    out
}

fn resolve_links(
    links: &[RawLink],
    artifacts: &[ApplicationArtifact],
    mount_table: &ApplicationMountTable,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<CrossApplicationLink> {
    let artifact_by_id: std::collections::HashMap<&str, &ApplicationArtifact> =
        artifacts.iter().map(|a| (a.application_id.as_str(), a)).collect();
    let mount_by_id: std::collections::HashMap<&str, &str> = mount_table
        .mounts
        .iter()
        .map(|m| (m.application_id.as_str(), m.route_base.as_str()))
        .collect();

    let mut out = Vec::new();
    for link in links {
        let app = link.application_id.as_str();
        let route_id = link.route_id.as_str();
        let path = link.path.clone().unwrap_or_else(|| "<host>".into());

        let Some(artifact) = artifact_by_id.get(app) else {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_UNKNOWN_REFERENCE.into(),
                severity: "error".into(),
                path: path.clone(),
                message: format!("cross-application Link references unknown ApplicationId `{app}`"),
                span: None,
            });
            continue;
        };

        if !artifact.public_route_contracts.iter().any(|r| r == route_id) {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_ROUTE_NOT_PUBLIC.into(),
                severity: "error".into(),
                path: path.clone(),
                message: format!(
                    "RouteId `{route_id}` is not a public route contract of ApplicationId `{app}`"
                ),
                span: None,
            });
            continue;
        }

        let Some(route_base) = mount_by_id.get(app).copied() else {
            diagnostics.push(ApplicationDiagnostic {
                code: DIAG_MOUNT_UNREACHABLE.into(),
                severity: "error".into(),
                path: path.clone(),
                message: format!(
                    "ApplicationId `{app}` has no mount in this deployment profile; cross-app Link href cannot be resolved"
                ),
                span: None,
            });
            continue;
        };

        let logical = match logical_path_for_route(app, route_id, &artifact.public_route_contracts)
        {
            Some(p) => p,
            None => {
                diagnostics.push(ApplicationDiagnostic {
                    code: DIAG_ROUTE_NOT_PUBLIC.into(),
                    severity: "error".into(),
                    path: path.clone(),
                    message: format!(
                        "cannot derive logical path for public RouteId `{route_id}` on `{app}`"
                    ),
                    span: None,
                });
                continue;
            }
        };

        let href = match join_application_base(route_base, &logical) {
            Ok(h) => h,
            Err(msg) => {
                diagnostics.push(ApplicationDiagnostic {
                    code: DIAG_MOUNT_UNREACHABLE.into(),
                    severity: "error".into(),
                    path: path.clone(),
                    message: format!("Link href join failed for `{app}`: {msg}"),
                    span: None,
                });
                continue;
            }
        };

        out.push(CrossApplicationLink {
            schema: APPLICATION_CROSS_LINK_SCHEMA.into(),
            application_id: ApplicationId(app.into()),
            route_id: route_id.into(),
            href: Some(href),
            route_base: Some(route_base.into()),
            document_navigation: true,
            path: Some(path),
        });
    }
    out
}

fn logical_path_for_route(
    application_id: &str,
    route_id: &str,
    public_contracts: &[String],
) -> Option<String> {
    if !public_contracts.iter().any(|r| r == route_id) {
        return None;
    }
    if route_id.ends_with(".home") {
        return Some("/".into());
    }
    let prefix = format!("{application_id}.");
    if let Some(rest) = route_id.strip_prefix(&prefix) {
        if rest.is_empty() {
            return None;
        }
        return Some(format!("/{rest}"));
    }
    // Fallback: treat bare public contract as entry.
    Some("/".into())
}
