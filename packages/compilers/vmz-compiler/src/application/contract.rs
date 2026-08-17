//! Application Collection / Mount — schema parse, ApplicationId resolution, mount collision.
//!
//! Host config is `applications.config.json5`; child identity is
//! `package.json#vmz.application`. Collection ⊥ Mount. No Mount IR.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use vmz_protocol::{
    APPLICATION_CATALOG_SCHEMA, APPLICATION_CHECK_SCHEMA, APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATIONS_CONFIG_SCHEMA, ApplicationCatalog, ApplicationCatalogEntry,
    ApplicationCheckReport, ApplicationCollection, ApplicationDescriptor, ApplicationDiagnostic,
    ApplicationGroup, ApplicationId, ApplicationMount, ApplicationSourceSpan, ApplicationsConfig,
    DIAG_DUPLICATE_ID, DIAG_DUPLICATE_MOUNT, DIAG_INVALID_CONFIG, DIAG_INVALID_DESCRIPTOR,
    DIAG_INVALID_ROUTE_BASE, DIAG_INVALID_SCHEMA, DIAG_MOUNT_COLLISION, DIAG_UNKNOWN_REFERENCE,
};

/// Host config filename for application collections and mounts (`applications.config.json5`).
pub const CONFIG_NAME: &str = "applications.config.json5";

/// Check host application composition against workspace package descriptors.
///
/// `package_roots` must be an explicit list (typically from Node workspace resolution).
/// Packages without `vmz.application` are ignored — directory location never auto-includes.
pub fn check_applications(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
) -> ApplicationCheckReport {
    let host_root = host_root.as_ref();
    let mut diagnostics = Vec::new();

    let descriptors = resolve_descriptors(package_roots, &mut diagnostics);
    let config_path = host_root.join(CONFIG_NAME);
    let (collections, mounts) = if config_path.is_file() {
        match load_applications_config(&config_path) {
            Ok(cfg) => {
                validate_config_schema(&cfg, &config_path, &mut diagnostics);
                (cfg.collections, cfg.mounts)
            }
            Err(diag) => {
                diagnostics.push(diag);
                (Vec::new(), Vec::new())
            }
        }
    } else {
        (Vec::new(), Vec::new())
    };

    let by_id = index_descriptors(&descriptors, &config_path, &mut diagnostics);
    validate_collection_refs(&collections, &by_id, &config_path, &mut diagnostics);
    validate_mounts(&mounts, &by_id, &config_path, &mut diagnostics);

    let catalog = build_catalog(&descriptors, &collections, &mounts);

    ApplicationCheckReport {
        schema: APPLICATION_CHECK_SCHEMA.into(),
        descriptors,
        collections,
        mounts,
        catalog,
        diagnostics,
    }
}

fn resolve_descriptors(
    package_roots: &[PathBuf],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<ApplicationDescriptor> {
    let mut out = Vec::new();
    // Stable order by package root path — never by discovery completion time.
    let mut roots: Vec<&PathBuf> = package_roots.iter().collect();
    roots.sort();

    for root in roots {
        let pkg_path = root.join("package.json");
        if !pkg_path.is_file() {
            continue;
        }
        let text = match fs::read_to_string(&pkg_path) {
            Ok(t) => t,
            Err(e) => {
                diagnostics.push(error(
                    DIAG_INVALID_DESCRIPTOR,
                    &pkg_path,
                    format!("read package.json failed: {e}"),
                    None,
                ));
                continue;
            }
        };
        let value: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                diagnostics.push(error(
                    DIAG_INVALID_DESCRIPTOR,
                    &pkg_path,
                    format!("package.json is not JSON: {e}"),
                    None,
                ));
                continue;
            }
        };
        let Some(app) = value.get("vmz").and_then(|v| v.get("application")) else {
            continue;
        };
        let package_name = value.get("name").and_then(|n| n.as_str()).map(str::to_string);
        if let Some(d) = parse_descriptor(app, root, package_name.as_deref(), &pkg_path, &text, diagnostics) { out.push(d) }
    }
    out
}

fn parse_descriptor(
    app: &Value,
    package_root: &Path,
    package_name: Option<&str>,
    pkg_path: &Path,
    source: &str,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Option<ApplicationDescriptor> {
    let schema = app.get("schema").and_then(|s| s.as_str()).unwrap_or("");
    if schema != APPLICATION_DESCRIPTOR_SCHEMA {
        diagnostics.push(error(
            DIAG_INVALID_SCHEMA,
            pkg_path,
            format!(
                "vmz.application.schema must be `{APPLICATION_DESCRIPTOR_SCHEMA}`, got `{schema}`"
            ),
            find_span(source, "schema"),
        ));
        return None;
    }
    let id = match app.get("id").and_then(|s| s.as_str()) {
        Some(id) if !id.is_empty() && is_valid_application_id(id) => id.to_string(),
        Some(_) => {
            diagnostics.push(error(
                DIAG_INVALID_DESCRIPTOR,
                pkg_path,
                "vmz.application.id must be a non-empty stable ApplicationId (letters, digits, `-`, `_`, `.`)",
                find_span(source, "\"id\""),
            ));
            return None;
        }
        None => {
            diagnostics.push(error(
                DIAG_INVALID_DESCRIPTOR,
                pkg_path,
                "vmz.application.id is required (explicit ApplicationId; never derived from directory name)",
                find_span(source, "application"),
            ));
            return None;
        }
    };
    let entry_route = match app.get("entryRoute").and_then(|s| s.as_str()) {
        Some(r) if !r.is_empty() => r.to_string(),
        _ => {
            diagnostics.push(error(
                DIAG_INVALID_DESCRIPTOR,
                pkg_path,
                "vmz.application.entryRoute is required (stable RouteId, not a URL)",
                find_span(source, "entryRoute"),
            ));
            return None;
        }
    };

    let tags = app
        .get("tags")
        .and_then(|t| t.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect::<Vec<_>>())
        .unwrap_or_default();

    Some(ApplicationDescriptor {
        schema: schema.into(),
        id: ApplicationId(id),
        entry_route,
        title: app.get("title").and_then(|s| s.as_str()).map(str::to_string),
        summary: app.get("summary").and_then(|s| s.as_str()).map(str::to_string),
        tags,
        package_root: Some(package_root.display().to_string()),
        package_name: package_name.map(str::to_string),
    })
}

fn is_valid_application_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !id.contains('/')
        && !id.contains('\\')
}

fn load_applications_config(path: &Path) -> Result<ApplicationsConfig, ApplicationDiagnostic> {
    let text = fs::read_to_string(path)
        .map_err(|e| error(DIAG_INVALID_CONFIG, path, format!("read failed: {e}"), None))?;
    let value: Value = json5::from_str(&text)
        .map_err(|e| error(DIAG_INVALID_CONFIG, path, format!("JSON5 parse error: {e}"), None))?;
    parse_applications_config(value, path, &text)
}

fn parse_applications_config(
    value: Value,
    path: &Path,
    source: &str,
) -> Result<ApplicationsConfig, ApplicationDiagnostic> {
    let schema = value.get("schema").and_then(|s| s.as_str()).unwrap_or("").to_string();
    if schema != APPLICATIONS_CONFIG_SCHEMA {
        return Err(error(
            DIAG_INVALID_SCHEMA,
            path,
            format!(
                "applications.config schema must be `{APPLICATIONS_CONFIG_SCHEMA}`, got `{schema}`"
            ),
            find_span(source, "schema"),
        ));
    }

    let collections = match value.get("collections") {
        None => Vec::new(),
        Some(Value::Array(arr)) => {
            let mut out = Vec::new();
            for (i, item) in arr.iter().enumerate() {
                out.push(parse_collection(item, path, source, i)?);
            }
            out
        }
        Some(_) => {
            return Err(error(
                DIAG_INVALID_CONFIG,
                path,
                "`collections` must be an array (explicit order)",
                find_span(source, "collections"),
            ));
        }
    };

    let mounts = match value.get("mounts") {
        None => Vec::new(),
        Some(Value::Array(arr)) => {
            let mut out = Vec::new();
            for (i, item) in arr.iter().enumerate() {
                out.push(parse_mount(item, path, source, i)?);
            }
            out
        }
        Some(_) => {
            return Err(error(
                DIAG_INVALID_CONFIG,
                path,
                "`mounts` must be an array",
                find_span(source, "mounts"),
            ));
        }
    };

    Ok(ApplicationsConfig { schema, collections, mounts })
}

fn parse_collection(
    value: &Value,
    path: &Path,
    source: &str,
    index: usize,
) -> Result<ApplicationCollection, ApplicationDiagnostic> {
    let id = value
        .get("id")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            error(
                DIAG_INVALID_CONFIG,
                path,
                format!("collections[{index}].id is required"),
                find_span(source, "collections"),
            )
        })?
        .to_string();
    let groups_val = value.get("groups").ok_or_else(|| {
        error(
            DIAG_INVALID_CONFIG,
            path,
            format!("collections[{index}].groups is required"),
            find_span(source, &id),
        )
    })?;
    let groups_arr = groups_val.as_array().ok_or_else(|| {
        error(
            DIAG_INVALID_CONFIG,
            path,
            format!("collections[{index}].groups must be an array"),
            find_span(source, &id),
        )
    })?;
    let mut groups = Vec::new();
    for (gi, g) in groups_arr.iter().enumerate() {
        groups.push(parse_group(g, path, source, index, gi)?);
    }
    Ok(ApplicationCollection { id, groups })
}

fn parse_group(
    value: &Value,
    path: &Path,
    source: &str,
    ci: usize,
    gi: usize,
) -> Result<ApplicationGroup, ApplicationDiagnostic> {
    let id = value
        .get("id")
        .and_then(|s| s.as_str())
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            error(
                DIAG_INVALID_CONFIG,
                path,
                format!("collections[{ci}].groups[{gi}].id is required"),
                find_span(source, "groups"),
            )
        })?
        .to_string();
    let apps = value.get("applications").and_then(|a| a.as_array()).ok_or_else(|| {
        error(
            DIAG_INVALID_CONFIG,
            path,
            format!("collections[{ci}].groups[{gi}].applications must be an array"),
            find_span(source, &id),
        )
    })?;
    let applications =
        apps.iter().filter_map(|v| v.as_str().map(|s| ApplicationId(s.to_string()))).collect();
    Ok(ApplicationGroup {
        id,
        title: value.get("title").and_then(|s| s.as_str()).map(str::to_string),
        applications,
    })
}

fn parse_mount(
    value: &Value,
    path: &Path,
    source: &str,
    index: usize,
) -> Result<ApplicationMount, ApplicationDiagnostic> {
    let application =
        value.get("application").and_then(|s| s.as_str()).filter(|s| !s.is_empty()).ok_or_else(
            || {
                error(
                    DIAG_INVALID_CONFIG,
                    path,
                    format!("mounts[{index}].application is required"),
                    find_span(source, "mounts"),
                )
            },
        )?;
    let route_base =
        value.get("routeBase").and_then(|s| s.as_str()).filter(|s| !s.is_empty()).ok_or_else(
            || {
                error(
                    DIAG_INVALID_CONFIG,
                    path,
                    format!("mounts[{index}].routeBase is required"),
                    find_span(source, application),
                )
            },
        )?;
    Ok(ApplicationMount {
        application: ApplicationId(application.to_string()),
        route_base: route_base.to_string(),
        deployment_ref: value.get("deploymentRef").and_then(|s| s.as_str()).map(str::to_string),
    })
}

fn validate_config_schema(
    cfg: &ApplicationsConfig,
    path: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let _ = (cfg, path, diagnostics);
}

fn index_descriptors<'a>(
    descriptors: &'a [ApplicationDescriptor],
    config_path: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> HashMap<&'a str, &'a ApplicationDescriptor> {
    let _ = config_path;
    let mut by_id: HashMap<&str, &ApplicationDescriptor> = HashMap::new();
    for d in descriptors {
        let id = d.id.as_str();
        if let Some(prev) = by_id.get(id) {
            let prev_root = prev.package_root.as_deref().unwrap_or("(unknown)");
            let cur_root = d.package_root.as_deref().unwrap_or("(unknown)");
            diagnostics.push(error(
                DIAG_DUPLICATE_ID,
                Path::new(cur_root).join("package.json"),
                format!(
                    "ApplicationId `{id}` declared in both `{prev_root}` and `{cur_root}`; ApplicationId must be unique and explicit"
                ),
                None,
            ));
        } else {
            by_id.insert(id, d);
        }
    }
    by_id
}

fn validate_collection_refs(
    collections: &[ApplicationCollection],
    by_id: &HashMap<&str, &ApplicationDescriptor>,
    config_path: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let source = fs::read_to_string(config_path).unwrap_or_default();
    for col in collections {
        for group in &col.groups {
            for app in &group.applications {
                if !by_id.contains_key(app.as_str()) {
                    diagnostics.push(error(
                        DIAG_UNKNOWN_REFERENCE,
                        config_path,
                        format!(
                            "collection `{}` / group `{}` references unknown ApplicationId `{}` (no package.json#vmz.application with this id)",
                            col.id,
                            group.id,
                            app.as_str()
                        ),
                        find_span(&source, app.as_str()),
                    ));
                }
            }
        }
    }
}

fn validate_mounts(
    mounts: &[ApplicationMount],
    by_id: &HashMap<&str, &ApplicationDescriptor>,
    config_path: &Path,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let source = fs::read_to_string(config_path).unwrap_or_default();
    let mut seen_app: HashMap<&str, &str> = HashMap::new();
    let mut normalized: Vec<(usize, String, &str)> = Vec::new();

    for (i, mount) in mounts.iter().enumerate() {
        let app = mount.application.as_str();
        if !by_id.contains_key(app) {
            diagnostics.push(error(
                DIAG_UNKNOWN_REFERENCE,
                config_path,
                format!(
                    "mount references unknown ApplicationId `{app}` (no package.json#vmz.application with this id)"
                ),
                find_span(&source, app),
            ));
        }

        let base = match normalize_route_base(&mount.route_base) {
            Ok(b) => b,
            Err(msg) => {
                diagnostics.push(error(
                    DIAG_INVALID_ROUTE_BASE,
                    config_path,
                    format!("mounts[{i}] ({app}): {msg}"),
                    find_span(&source, &mount.route_base),
                ));
                continue;
            }
        };

        if let Some(prev_base) = seen_app.insert(app, &mount.route_base) {
            diagnostics.push(error(
                DIAG_DUPLICATE_MOUNT,
                config_path,
                format!(
                    "ApplicationId `{app}` has multiple mounts (`{prev_base}` and `{}`); one ApplicationId may have only one canonical mount base per deployment profile",
                    mount.route_base
                ),
                find_span(&source, app),
            ));
        }

        normalized.push((i, base, app));
    }

    for i in 0..normalized.len() {
        for j in (i + 1)..normalized.len() {
            let (ia, ref a, app_a) = normalized[i];
            let (ib, ref b, app_b) = normalized[j];
            if route_bases_collide(a, b) {
                diagnostics.push(error(
                    DIAG_MOUNT_COLLISION,
                    config_path,
                    format!(
                        "mount routeBase collision: mounts[{ia}] `{app_a}` → `{a}` overlaps mounts[{ib}] `{app_b}` → `{b}`"
                    ),
                    find_span(&source, if a.len() >= b.len() { a.as_str() } else { b.as_str() }),
                ));
            }
        }
    }
}

/// Normalize mount base: must be absolute path starting with `/`, no trailing slash (except `/`).
pub fn normalize_route_base(raw: &str) -> Result<String, String> {
    if raw.is_empty() {
        return Err("routeBase must not be empty".into());
    }
    if !raw.starts_with('/') {
        return Err(format!("routeBase must start with `/`, got `{raw}`"));
    }
    if raw.contains('?') || raw.contains('#') {
        return Err(format!("routeBase must not contain query/hash, got `{raw}`"));
    }
    if raw.contains("//") {
        return Err(format!("routeBase must not contain empty segments, got `{raw}`"));
    }
    let trimmed = if raw.len() > 1 && raw.ends_with('/') {
        raw.trim_end_matches('/').to_string()
    } else {
        raw.to_string()
    };
    if trimmed != "/" && trimmed.ends_with('/') {
        return Err(format!("routeBase normalize failed for `{raw}`"));
    }
    Ok(trimmed)
}

fn route_bases_collide(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    if a == "/" || b == "/" {
        // Mounting at `/` collides with every other base in the same profile.
        return true;
    }
    let (longer, shorter) = if a.len() >= b.len() { (a, b) } else { (b, a) };
    longer.starts_with(shorter) && longer.as_bytes().get(shorter.len()) == Some(&b'/')
}

fn build_catalog(
    descriptors: &[ApplicationDescriptor],
    collections: &[ApplicationCollection],
    mounts: &[ApplicationMount],
) -> ApplicationCatalog {
    let mount_by_id: HashMap<&str, &str> =
        mounts.iter().map(|m| (m.application.as_str(), m.route_base.as_str())).collect();

    let mut membership: HashMap<&str, Vec<String>> = HashMap::new();
    let mut ordered_ids: Vec<&str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();

    for col in collections {
        for group in &col.groups {
            for app in &group.applications {
                let id = app.as_str();
                membership.entry(id).or_default().push(col.id.clone());
                if seen.insert(id) {
                    ordered_ids.push(id);
                }
            }
        }
    }

    let by_id: HashMap<&str, &ApplicationDescriptor> =
        descriptors.iter().map(|d| (d.id.as_str(), d)).collect();

    let applications = ordered_ids
        .into_iter()
        .filter_map(|id| {
            let d = by_id.get(id)?;
            Some(ApplicationCatalogEntry {
                id: ApplicationId(id.to_string()),
                entry_route: d.entry_route.clone(),
                title: d.title.clone(),
                summary: d.summary.clone(),
                tags: d.tags.clone(),
                collections: membership.get(id).cloned().unwrap_or_default(),
                route_base: mount_by_id.get(id).map(|s| (*s).to_string()),
            })
        })
        .collect();

    ApplicationCatalog {
        schema: APPLICATION_CATALOG_SCHEMA.into(),
        applications,
        collections: collections.to_vec(),
    }
}

fn error(
    code: &str,
    path: impl AsRef<Path>,
    message: impl Into<String>,
    span: Option<(u32, u32)>,
) -> ApplicationDiagnostic {
    let path = path.as_ref();
    let path_s = path.display().to_string();
    let mut d = ApplicationDiagnostic::coded_error(path_s.clone(), message, code);
    if let Some((start, end)) = span {
        d = d.with_source_span(ApplicationSourceSpan { path: path_s, start, end });
    }
    d
}

/// Best-effort byte span for a needle inside source (JSON5 labels).
fn find_span(source: &str, needle: &str) -> Option<(u32, u32)> {
    if needle.is_empty() {
        return None;
    }
    let bytes = source.as_bytes();
    let n = needle.as_bytes();
    bytes.windows(n.len()).position(|w| w == n).map(|start| {
        let start = start as u32;
        (start, start + n.len() as u32)
    })
}
