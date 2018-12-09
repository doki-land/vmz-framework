//! Documents author config → [`DocumentRoutePlan`] (Rust-first; TS hosts consume the plan).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;
use vmz_protocol::{
    DIAG_DOCUMENT_CONFIG_DEFAULT_LOCALE, DIAG_DOCUMENT_CONFIG_INVALID,
    DIAG_DOCUMENT_CONFIG_MISSING, DIAG_DOCUMENT_FALLBACK_SILENT, DOCUMENT_ROUTE_PLAN_SCHEMA,
    DocumentCollectionPlan, DocumentMountPlan, DocumentRoutePlan, ReportedDiagnostic,
};

/// Preferred author filename under `documents/`.
pub const DOCUMENT_CONFIG_JSON5: &str = "documents.config.json5";
/// JSON author filename.
pub const DOCUMENT_CONFIG_JSON: &str = "documents.config.json";
/// Declaration-only TypeScript author filename (`export default { … }`).
pub const DOCUMENT_CONFIG_TS: &str = "documents.config.ts";
/// Declaration-only JavaScript author filename.
pub const DOCUMENT_CONFIG_JS: &str = "documents.config.js";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentConfigFile {
    #[serde(default)]
    default_locale: Option<String>,
    #[serde(default)]
    locales: BTreeMap<String, LocaleLabelWire>,
    #[serde(default)]
    collections: BTreeMap<String, CollectionWire>,
    /// Forbidden when true — silent whole-page fallback.
    #[serde(default)]
    fallback: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum LocaleLabelWire {
    Label(String),
    Object {
        #[serde(default)]
        label: Option<String>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionWire {
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    mount: Option<String>,
}

/// Load `documents/documents.config.{json5,json,ts,js}` into a [`DocumentRoutePlan`].
pub fn load_document_route_plan(project_root: impl AsRef<Path>) -> DocumentRoutePlan {
    let project_root = project_root.as_ref();
    let documents_root = project_root.join("documents");
    let candidates =
        [DOCUMENT_CONFIG_JSON5, DOCUMENT_CONFIG_JSON, DOCUMENT_CONFIG_TS, DOCUMENT_CONFIG_JS];
    let mut found: Option<PathBuf> = None;
    for name in candidates {
        let p = documents_root.join(name);
        if p.is_file() {
            found = Some(p);
            break;
        }
    }
    let Some(path) = found else {
        let rel = format!("documents/{DOCUMENT_CONFIG_JSON5}");
        return DocumentRoutePlan {
            schema: DOCUMENT_ROUTE_PLAN_SCHEMA.into(),
            source_path: Some(rel.clone()),
            default_locale: None,
            locale_labels: BTreeMap::new(),
            collections: default_collections(),
            mounts: default_mounts(),
            silent_fallback_requested: false,
            diagnostics: vec![
                ReportedDiagnostic::coded_warning(rel, DIAG_DOCUMENT_CONFIG_MISSING).with_arg(
                    "detail",
                    "documents.config.json|json5|ts|js missing under /documents",
                ),
            ],
        };
    };

    let rel = path
        .strip_prefix(project_root)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");

    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            return DocumentRoutePlan {
                schema: DOCUMENT_ROUTE_PLAN_SCHEMA.into(),
                source_path: Some(rel.clone()),
                default_locale: None,
                locale_labels: BTreeMap::new(),
                collections: Vec::new(),
                mounts: Vec::new(),
                silent_fallback_requested: false,
                diagnostics: vec![
                    ReportedDiagnostic::coded_error(rel, DIAG_DOCUMENT_CONFIG_INVALID)
                        .with_arg("detail", format!("read documents config failed: {e}")),
                ],
            };
        }
    };

    let file_name = path.file_name().and_then(|s| s.to_str()).unwrap_or(DOCUMENT_CONFIG_JSON5);
    load_document_route_plan_from_source(&text, &rel, file_name)
}

/// Parse author documents config source into a [`DocumentRoutePlan`].
///
/// `file_name` selects decode strategy (`.json5`/`.json` vs declaration `.ts`/`.js`).
pub fn load_document_route_plan_from_source(
    source: &str,
    source_path: impl Into<String>,
    file_name: &str,
) -> DocumentRoutePlan {
    let source_path = source_path.into();
    let value = match decode_author_config(source, file_name) {
        Ok(v) => v,
        Err(msg) => {
            return DocumentRoutePlan {
                schema: DOCUMENT_ROUTE_PLAN_SCHEMA.into(),
                source_path: Some(source_path.clone()),
                default_locale: None,
                locale_labels: BTreeMap::new(),
                collections: Vec::new(),
                mounts: Vec::new(),
                silent_fallback_requested: false,
                diagnostics: vec![
                    ReportedDiagnostic::coded_error(source_path, DIAG_DOCUMENT_CONFIG_INVALID)
                        .with_arg("detail", msg),
                ],
            };
        }
    };

    let file: DocumentConfigFile = match serde_json::from_value(value) {
        Ok(f) => f,
        Err(e) => {
            return DocumentRoutePlan {
                schema: DOCUMENT_ROUTE_PLAN_SCHEMA.into(),
                source_path: Some(source_path.clone()),
                default_locale: None,
                locale_labels: BTreeMap::new(),
                collections: Vec::new(),
                mounts: Vec::new(),
                silent_fallback_requested: false,
                diagnostics: vec![
                    ReportedDiagnostic::coded_error(source_path, DIAG_DOCUMENT_CONFIG_INVALID)
                        .with_arg("detail", format!("documents config shape invalid: {e}")),
                ],
            };
        }
    };

    normalize_document_config(file, source_path)
}

fn decode_author_config(source: &str, file_name: &str) -> Result<Value, String> {
    if file_name.ends_with(".json5") || file_name.ends_with(".json") {
        return json5::from_str(source).map_err(|e| format!("documents config parse failed: {e}"));
    }
    if file_name.ends_with(".ts") || file_name.ends_with(".js") {
        let jsonish = coerce_declaration_export_default(source)?;
        return json5::from_str(&jsonish)
            .map_err(|e| format!("documents declaration parse failed: {e}"));
    }
    Err(format!("unsupported documents config filename: {file_name}"))
}

/// Strip comments and require `export default { … }` — declaration object only.
fn coerce_declaration_export_default(raw: &str) -> Result<String, String> {
    let mut s = raw.to_string();
    // Block comments then line comments (author declaration files only).
    while let Some(start) = s.find("/*") {
        let Some(end_rel) = s[start + 2..].find("*/") else {
            return Err("unclosed block comment in documents config".into());
        };
        let end = start + 2 + end_rel + 2;
        s.replace_range(start..end, " ");
    }
    let mut cleaned = String::new();
    for line in s.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") {
            continue;
        }
        cleaned.push_str(line);
        cleaned.push('\n');
    }
    let trimmed = cleaned.trim();
    let body = if let Some(rest) = trimmed.strip_prefix("export") {
        let rest = rest.trim_start();
        let Some(rest) = rest.strip_prefix("default") else {
            return Err("expected `export default { … }` (JSON-compatible declaration only)".into());
        };
        let rest = rest.trim_start().trim_end_matches(';').trim();
        rest.to_string()
    } else {
        return Err("expected `export default { … }` (JSON-compatible declaration only)".into());
    };
    Ok(body)
}

fn normalize_document_config(file: DocumentConfigFile, source_path: String) -> DocumentRoutePlan {
    let mut diagnostics = Vec::new();
    let mut locale_labels = BTreeMap::new();
    for (id, label) in file.locales {
        let text = match label {
            LocaleLabelWire::Label(s) => s,
            LocaleLabelWire::Object { label } => label.unwrap_or_else(|| id.clone()),
        };
        locale_labels.insert(id, text);
    }

    let default_locale = file.default_locale.filter(|s| !s.is_empty());
    if let Some(ref d) = default_locale {
        if !locale_labels.is_empty() && !locale_labels.contains_key(d) {
            diagnostics.push(
                ReportedDiagnostic::coded_error(
                    source_path.clone(),
                    DIAG_DOCUMENT_CONFIG_DEFAULT_LOCALE,
                )
                .with_arg("detail", format!("defaultLocale {d} missing from locales")),
            );
        }
    }

    let silent_fallback_requested = matches!(&file.fallback, Some(serde_json::Value::Bool(true)));
    if silent_fallback_requested {
        diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_DOCUMENT_FALLBACK_SILENT).with_arg("detail", "silent whole-page fallback is forbidden; allow only explicit nav/metadata or per-page fallback"));
    }

    let mut collections = Vec::new();
    let mut mounts = Vec::new();
    for (id, c) in file.collections {
        let source_root = c.source.filter(|s| !s.is_empty()).unwrap_or_else(|| ".".into());
        let route_base = c.mount.filter(|s| !s.is_empty()).unwrap_or_else(|| "/docs".into());
        let mode = if route_base == "/" { "standalone".into() } else { "integrated".into() };
        mounts.push(DocumentMountPlan {
            collection_id: id.clone(),
            route_base: route_base.clone(),
            mode,
        });
        collections.push(DocumentCollectionPlan { id, source_root, route_base });
    }

    if collections.is_empty() {
        collections = default_collections();
        mounts = default_mounts();
    }

    DocumentRoutePlan {
        schema: DOCUMENT_ROUTE_PLAN_SCHEMA.into(),
        source_path: Some(source_path),
        default_locale,
        locale_labels,
        collections,
        mounts,
        silent_fallback_requested,
        diagnostics,
    }
}

fn default_collections() -> Vec<DocumentCollectionPlan> {
    vec![DocumentCollectionPlan {
        id: "default".into(),
        source_root: ".".into(),
        route_base: "/docs".into(),
    }]
}

fn default_mounts() -> Vec<DocumentMountPlan> {
    vec![DocumentMountPlan {
        collection_id: "default".into(),
        route_base: "/docs".into(),
        mode: "integrated".into(),
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loads_documents_fixture_plan() {
        let root =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/documents-fixture");
        let plan = load_document_route_plan(&root);
        assert!(!plan.has_errors(), "{:?}", plan.diagnostics);
        assert_eq!(plan.default_locale.as_deref(), Some("zh-hans"));
        assert_eq!(plan.collections.len(), 1);
        assert_eq!(plan.collections[0].route_base, "/docs");
        assert_eq!(plan.schema, DOCUMENT_ROUTE_PLAN_SCHEMA);
    }

    #[test]
    fn loads_declaration_ts_source() {
        let src = r#"
/**
 * comment
 */
export default {
    defaultLocale: 'zh-hans',
    locales: {
        'zh-hans': { label: '简体中文' },
    },
    collections: {
        default: {
            source: '.',
            mount: '/d',
        },
    },
};
"#;
        let plan = load_document_route_plan_from_source(
            src,
            "documents/documents.config.ts",
            "documents.config.ts",
        );
        assert!(!plan.has_errors(), "{:?}", plan.diagnostics);
        assert_eq!(plan.default_locale.as_deref(), Some("zh-hans"));
        assert_eq!(plan.mounts[0].route_base, "/d");
    }
}
