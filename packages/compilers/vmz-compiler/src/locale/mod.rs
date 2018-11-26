//! Locale author JSON5 → [`LocalePlan`] (Rust-first; TS hosts consume the plan only).

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs;
use std::path::Path;

use serde_json::Value;
use vmz_protocol::{
    DIAG_CATALOG_PARSE, DIAG_LOCALE_DEFAULT_MISSING, DIAG_LOCALE_FALLBACK_CYCLE,
    DIAG_LOCALE_FALLBACK_UNKNOWN, DIAG_LOCALE_ID_COLLISION, DIAG_LOCALE_ID_INVALID,
    DIAG_LOCALE_MANIFEST_MISSING, LOCALE_MANIFEST_SCHEMA, LOCALE_PLAN_SCHEMA, LocaleEntry,
    LocaleManifestFile, LocalePlan, LocaleRoutingPolicy, ReportedDiagnostic,
};

/// Author manifest filenames under `locales/`.
pub const LOCALE_MANIFEST_JSON5: &str = "locales.json5";
/// JSON fallback when JSON5 is absent.
pub const LOCALE_MANIFEST_JSON: &str = "locales.json";

/// Load and normalize `locales/locales.json5` (or `.json`) into a [`LocalePlan`].
pub fn load_locale_plan(project_root: impl AsRef<Path>) -> LocalePlan {
    let project_root = project_root.as_ref();
    let locales_root = project_root.join("locales");
    let json5 = locales_root.join(LOCALE_MANIFEST_JSON5);
    let json = locales_root.join(LOCALE_MANIFEST_JSON);
    let path = if json5.is_file() {
        json5
    } else if json.is_file() {
        json
    } else {
        let rel = format!("locales/{LOCALE_MANIFEST_JSON5}");
        return LocalePlan::missing_manifest(
            rel.clone(),
            ReportedDiagnostic::coded_warning(rel, DIAG_LOCALE_MANIFEST_MISSING).with_arg("detail", "locales/locales.json5 missing — declare LocaleId policy under /locales (native i18n, not an afterthought)"),
        );
    };

    let rel = path
        .strip_prefix(project_root)
        .unwrap_or(path.as_path())
        .to_string_lossy()
        .replace('\\', "/");

    let text = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            return LocalePlan {
                schema: LOCALE_PLAN_SCHEMA.into(),
                manifest_schema: LOCALE_MANIFEST_SCHEMA.into(),
                source_path: Some(rel.clone()),
                default_locale: String::new(),
                locales: Vec::new(),
                fallback: BTreeMap::new(),
                routing: default_routing(),
                missing: "error".into(),
                diagnostics: vec![ReportedDiagnostic::coded_error(rel, DIAG_CATALOG_PARSE).with_arg("detail", format!("read locales manifest failed: {e}"))],
            };
        }
    };

    load_locale_plan_from_source(&text, &rel)
}

/// Parse author locale manifest source (JSON5 or JSON) into a [`LocalePlan`].
pub fn load_locale_plan_from_source(source: &str, source_path: impl Into<String>) -> LocalePlan {
    let source_path = source_path.into();
    let value: Value = match json5::from_str(source) {
        Ok(v) => v,
        Err(e) => {
            return LocalePlan {
                schema: LOCALE_PLAN_SCHEMA.into(),
                manifest_schema: LOCALE_MANIFEST_SCHEMA.into(),
                source_path: Some(source_path.clone()),
                default_locale: String::new(),
                locales: Vec::new(),
                fallback: BTreeMap::new(),
                routing: default_routing(),
                missing: "error".into(),
                diagnostics: vec![ReportedDiagnostic::coded_error(source_path, DIAG_CATALOG_PARSE).with_arg("detail", format!("locales.json5 parse failed: {e}"))],
            };
        }
    };

    let file: LocaleManifestFile = match serde_json::from_value(value) {
        Ok(f) => f,
        Err(e) => {
            return LocalePlan {
                schema: LOCALE_PLAN_SCHEMA.into(),
                manifest_schema: LOCALE_MANIFEST_SCHEMA.into(),
                source_path: Some(source_path.clone()),
                default_locale: String::new(),
                locales: Vec::new(),
                fallback: BTreeMap::new(),
                routing: default_routing(),
                missing: "error".into(),
                diagnostics: vec![ReportedDiagnostic::coded_error(source_path, DIAG_CATALOG_PARSE).with_arg("detail", format!("locales.json5 shape invalid: {e}"))],
            };
        }
    };

    normalize_locale_manifest(file, source_path)
}

/// Degrade arbitrary author JSON5 (message catalogs / route tables) to canonical JSON text.
///
/// Transitional adapter until MessageCatalog / RoutePlan services own those files.
/// Not a public semantic API — TS must not use this to re-interpret locale policy.
pub fn author_json5_to_canonical_json(source: &str) -> Result<String, String> {
    let value: Value = json5::from_str(source).map_err(|e| format!("JSON5 parse error: {e}"))?;
    serde_json::to_string(&value).map_err(|e| format!("JSON serialize error: {e}"))
}

fn default_routing() -> LocaleRoutingPolicy {
    LocaleRoutingPolicy { strategy: "prefix".into(), default_prefix: "include".into() }
}

fn normalize_locale_manifest(file: LocaleManifestFile, source_path: String) -> LocalePlan {
    let mut diagnostics = Vec::new();
    let mut locales = Vec::new();
    let mut seen = HashSet::new();

    for entry in file.locales {
        let id = entry.id;
        match validate_locale_id(&id) {
            Ok(()) => {}
            Err(msg) => {
                diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_ID_INVALID).with_arg("detail", msg));
                continue;
            }
        }
        if !seen.insert(id.clone()) {
            diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_ID_COLLISION).with_arg("detail", format!("duplicate LocaleId {id} in locales[]")));
            continue;
        }
        let direction = if entry.direction.is_empty() { "ltr".into() } else { entry.direction };
        locales.push(LocaleEntry { id, label: entry.label, direction });
    }

    let default_locale = file.default_locale;
    if default_locale.is_empty() || !seen.contains(&default_locale) {
        diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_DEFAULT_MISSING).with_arg("detail", format!(
                "defaultLocale {} missing from locales[]",
                serde_json::to_string(&default_locale).unwrap_or_else(|_| "\"\"".into())
            )));
    }

    let mut fallback = BTreeMap::new();
    for (from, chain) in file.fallback {
        if !seen.contains(&from) {
            diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_FALLBACK_UNKNOWN).with_arg("detail", format!("fallback key {from} is not a declared LocaleId")));
            continue;
        }
        let mut cleaned = Vec::new();
        for next in chain {
            if !seen.contains(&next) {
                diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_FALLBACK_UNKNOWN).with_arg("detail", format!("fallback {from} → unknown LocaleId {next}")));
                continue;
            }
            cleaned.push(next);
        }
        fallback.insert(from, cleaned);
    }

    if let Some(cycle) = detect_fallback_cycle(&fallback) {
        diagnostics.push(ReportedDiagnostic::coded_error(source_path.clone(), DIAG_LOCALE_FALLBACK_CYCLE).with_arg("detail", format!("fallback cycle: {}", cycle.join(" → "))));
    }

    let routing = file.routing.unwrap_or_else(default_routing);
    let missing = if file.missing.is_empty() { "error".into() } else { file.missing };

    LocalePlan {
        schema: LOCALE_PLAN_SCHEMA.into(),
        manifest_schema: LOCALE_MANIFEST_SCHEMA.into(),
        source_path: Some(source_path),
        default_locale,
        locales,
        fallback,
        routing,
        missing,
        diagnostics,
    }
}

fn validate_locale_id(name: &str) -> Result<(), String> {
    if name.is_empty() {
        return Err("empty LocaleId".into());
    }
    if name.contains('_') {
        return Err(format!("LocaleId must use '-' not '_': {name:?}"));
    }
    if name != name.to_ascii_lowercase() {
        return Err(format!("LocaleId must be lowercase ASCII (got {name:?})"));
    }
    // Lowercase BCP-47-ish: language[-script][-region]… (no regex crate dep).
    let mut parts = name.split('-');
    let Some(lang) = parts.next() else {
        return Err(format!("LocaleId is not lowercase BCP 47 form: {name:?}"));
    };
    if !(2..=3).contains(&lang.len()) || !lang.chars().all(|c| c.is_ascii_lowercase()) {
        return Err(format!("LocaleId is not lowercase BCP 47 form: {name:?}"));
    }
    for part in parts {
        if !(2..=8).contains(&part.len())
            || !part.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        {
            return Err(format!("LocaleId is not lowercase BCP 47 form: {name:?}"));
        }
    }
    Ok(())
}

fn detect_fallback_cycle(fallback: &BTreeMap<String, Vec<String>>) -> Option<Vec<String>> {
    let mut visiting = BTreeSet::new();
    let mut path = Vec::new();
    let mut stack = HashSet::new();

    fn walk(
        node: &str,
        fallback: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        stack: &mut HashSet<String>,
        path: &mut Vec<String>,
    ) -> Option<Vec<String>> {
        if stack.contains(node) {
            let mut cycle = path.clone();
            cycle.push(node.to_string());
            return Some(cycle);
        }
        if !visiting.insert(node.to_string()) {
            return None;
        }
        stack.insert(node.to_string());
        path.push(node.to_string());
        if let Some(nexts) = fallback.get(node) {
            for next in nexts {
                if let Some(c) = walk(next, fallback, visiting, stack, path) {
                    return Some(c);
                }
            }
        }
        path.pop();
        stack.remove(node);
        None
    }

    for key in fallback.keys() {
        visiting.clear();
        path.clear();
        stack.clear();
        if let Some(c) = walk(key, fallback, &mut visiting, &mut stack, &mut path) {
            return Some(c);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn loads_locales_fixture_plan() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/locales-fixture");
        let plan = load_locale_plan(&root);
        assert!(!plan.has_errors(), "{:?}", plan.diagnostics);
        assert_eq!(plan.default_locale, "zh-hans");
        assert_eq!(plan.locales.len(), 3);
        assert_eq!(plan.routing.strategy, "prefix");
        assert_eq!(plan.schema, LOCALE_PLAN_SCHEMA);
    }

    #[test]
    fn author_json5_roundtrip() {
        let json = author_json5_to_canonical_json("{ a: 1, b: 'x', }").unwrap();
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"], "x");
    }
}
