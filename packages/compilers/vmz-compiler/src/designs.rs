//! Style Theme — first-class, language-agnostic design model under `/designs`.
//!
//! `tokens/` + `themes/` are **one** Theme: default table + named overlays.
//! SCSS / TW / CSS vars are projections of the same model — not parallel truths.

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::diagnostic::ReportedDiagnostic;

/// Stable theme identity (`default`, `dark`, …).
pub type ThemeId = String;

pub const DEFAULT_THEME_ID: &str = "default";
pub const DEFAULT_ACTIVATION_ATTR: &str = "data-theme";

/// One leaf in the theme key space: `["colors","action"]` → concrete CSS value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleTokenLeaf {
    pub path: Vec<String>,
    pub value: String,
}

/// Back-compat alias (same leaf type).
pub type DesignTokenEntry = StyleTokenLeaf;

/// One named table (default or overlay).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleThemeTable {
    pub id: ThemeId,
    pub entries: Vec<StyleTokenLeaf>,
}

/// Unified Style Theme owned by style core.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StyleTheme {
    pub default_id: ThemeId,
    /// Document/host activation attribute (first slice: `data-theme`).
    pub activation_attr: String,
    /// OS preference → ThemeId (e.g. `dark` → `dark`).
    pub prefers_color_scheme: BTreeMap<String, ThemeId>,
    /// Always includes the default table when tokens exist; overlays follow.
    pub tables: Vec<StyleThemeTable>,
}

impl Default for StyleTheme {
    fn default() -> Self {
        Self {
            default_id: DEFAULT_THEME_ID.to_string(),
            activation_attr: DEFAULT_ACTIVATION_ATTR.to_string(),
            prefers_color_scheme: BTreeMap::new(),
            tables: Vec::new(),
        }
    }
}

impl StyleTheme {
    pub fn is_empty(&self) -> bool {
        self.tables.iter().all(|t| t.entries.is_empty())
    }

    pub fn theme_ids(&self) -> Vec<ThemeId> {
        let mut ids: Vec<_> = self.tables.iter().map(|t| t.id.clone()).collect();
        ids.sort();
        ids.dedup();
        if ids.is_empty() {
            ids.push(self.default_id.clone());
        }
        ids
    }

    pub fn table(&self, id: &str) -> Option<&StyleThemeTable> {
        self.tables.iter().find(|t| t.id == id)
    }

    /// Merge default table with overlay `id` (overlay wins on same key path).
    pub fn resolve(&self, id: &str) -> Vec<StyleTokenLeaf> {
        let mut map: BTreeMap<String, StyleTokenLeaf> = BTreeMap::new();
        if let Some(base) = self.table(&self.default_id) {
            for e in &base.entries {
                map.insert(e.path.join("\0"), e.clone());
            }
        }
        if id != self.default_id {
            if let Some(over) = self.table(id) {
                for e in &over.entries {
                    map.insert(e.path.join("\0"), e.clone());
                }
            }
        }
        map.into_values().collect()
    }

    /// Engine projection: same keys, values rewritten to `var(--vmz-…)` so runtime
    /// theme activation (CSS) applies to TW utilities and SCSS alike.
    pub fn project_var_refs(&self, id: &str) -> Vec<StyleTokenLeaf> {
        self.resolve(id)
            .into_iter()
            .map(|e| StyleTokenLeaf {
                value: format!("var({})", css_var_name(&e.path)),
                path: e.path,
            })
            .collect()
    }

    /// Exact CSS custom-property names owned by this theme (`--vmz-…`).
    pub fn known_css_vars(&self) -> BTreeSet<String> {
        let mut set = BTreeSet::new();
        for table in &self.tables {
            for e in &table.entries {
                set.insert(css_var_name(&e.path));
            }
        }
        set
    }

    pub fn has_css_var(&self, name: &str) -> bool {
        let name = name.trim();
        self.tables.iter().flat_map(|t| t.entries.iter()).any(|e| css_var_name(&e.path) == name)
    }

    /// Leaf keys under a namespace (e.g. `colors` → `action`, `action-hover`).
    pub fn known_ns_keys(&self, ns: &str) -> BTreeSet<String> {
        let mut set = BTreeSet::new();
        for table in &self.tables {
            for e in &table.entries {
                if e.path.first().map(|s| s.as_str()) != Some(ns) || e.path.len() < 2 {
                    continue;
                }
                set.insert(e.path[1..].join("-"));
            }
        }
        set
    }

    pub fn has_ns_key(&self, ns: &str, key: &str) -> bool {
        self.known_ns_keys(ns).contains(key)
    }

    pub fn summary(&self) -> StyleThemeSummary {
        StyleThemeSummary {
            default_theme_id: self.default_id.clone(),
            theme_ids: self.theme_ids(),
            activation_attr: self.activation_attr.clone(),
            prefers_color_scheme: self.prefers_color_scheme.clone(),
            content_hash: self.content_hash(),
        }
    }

    /// Stable hash over default id, activation attr, prefers map, and all table leaves.
    pub fn content_hash(&self) -> String {
        let mut buf = String::new();
        buf.push_str(&self.default_id);
        buf.push('\n');
        buf.push_str(&self.activation_attr);
        buf.push('\n');
        for (scheme, id) in &self.prefers_color_scheme {
            buf.push_str(scheme);
            buf.push('=');
            buf.push_str(id);
            buf.push('\n');
        }
        let mut tables = self.tables.clone();
        tables.sort_by(|a, b| a.id.cmp(&b.id));
        for table in &tables {
            buf.push_str(&table.id);
            buf.push('\n');
            let mut entries = table.entries.clone();
            entries.sort_by(|a, b| a.path.cmp(&b.path));
            for e in &entries {
                buf.push_str(&e.path.join("."));
                buf.push('=');
                buf.push_str(&e.value);
                buf.push('\n');
            }
        }
        crate::plugin::sha256_hex_bytes(buf.as_bytes())
    }
}

/// Deployment / report slice (no leaf values).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StyleThemeSummary {
    pub default_theme_id: ThemeId,
    pub theme_ids: Vec<ThemeId>,
    pub activation_attr: String,
    pub prefers_color_scheme: BTreeMap<String, ThemeId>,
    pub content_hash: String,
}

/// `/designs` inventory: Style Theme + styles entry contract.
#[derive(Debug, Clone, Default)]
pub struct DesignsBundle {
    pub root: PathBuf,
    pub missing: bool,
    pub theme: StyleTheme,
    pub style_entry: Option<PathBuf>,
    pub style_files: Vec<PathBuf>,
    pub diagnostics: Vec<ReportedDiagnostic>,
}

/// Legacy accessor used by older call sites.
impl DesignsBundle {
    pub fn tokens(&self) -> &[StyleTokenLeaf] {
        self.theme.table(&self.theme.default_id).map(|t| t.entries.as_slice()).unwrap_or(&[])
    }
}

/// Load `/designs` into a unified [`StyleTheme`] + styles inventory.
pub fn load_designs(project_root: &Path) -> DesignsBundle {
    let root = project_root.join("designs");
    if !root.is_dir() {
        return DesignsBundle { root, missing: true, ..Default::default() };
    }

    let mut diagnostics = Vec::new();
    let (default_id, activation_attr, prefers_color_scheme) =
        load_theme_meta(&root.join("theme.json"), &mut diagnostics);

    let mut default_entries = Vec::new();
    for path in list_json(&root.join("tokens")) {
        match load_flat_json(&path) {
            Ok(entries) => default_entries.extend(entries),
            Err(msg) => diagnostics.push(ReportedDiagnostic::error(&path, msg)),
        }
    }

    let mut tables = Vec::new();
    tables.push(StyleThemeTable { id: default_id.clone(), entries: default_entries });

    for path in list_json(&root.join("themes")) {
        let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("theme").to_string();
        if id == default_id {
            diagnostics.push(ReportedDiagnostic::warning(
                &path,
                format!("theme id `{id}` collides with default theme id; overlay still applied"),
            ));
        }
        match load_flat_json(&path) {
            Ok(entries) => {
                if let Some(existing) = tables.iter_mut().find(|t| t.id == id) {
                    existing.entries.extend(entries);
                } else {
                    tables.push(StyleThemeTable { id, entries });
                }
            }
            Err(msg) => diagnostics.push(ReportedDiagnostic::error(&path, msg)),
        }
    }

    let styles_dir = root.join("styles");
    let style_files = list_style_files(&styles_dir);
    let style_entry = ["index.scss", "index.sass", "index.css"]
        .into_iter()
        .map(|n| styles_dir.join(n))
        .find(|p| p.is_file());

    DesignsBundle {
        root,
        missing: false,
        theme: StyleTheme { default_id, activation_attr, prefers_color_scheme, tables },
        style_entry,
        style_files,
        diagnostics,
    }
}

/// Optional `designs/theme.json`:
/// `{ "default": "default", "activationAttr": "data-theme", "prefersColorScheme": { "dark": "dark" } }`.
fn load_theme_meta(
    path: &Path,
    diagnostics: &mut Vec<ReportedDiagnostic>,
) -> (ThemeId, String, BTreeMap<String, ThemeId>) {
    let default_id = DEFAULT_THEME_ID.to_string();
    let activation = DEFAULT_ACTIVATION_ATTR.to_string();
    let prefers = BTreeMap::new();
    if !path.is_file() {
        return (default_id, activation, prefers);
    }
    let Ok(text) = std::fs::read_to_string(path) else {
        diagnostics.push(ReportedDiagnostic::warning(path, "cannot read theme.json"));
        return (default_id, activation, prefers);
    };
    let Ok(value) = serde_json::from_str::<Value>(&text) else {
        diagnostics.push(ReportedDiagnostic::error(path, "invalid theme.json"));
        return (default_id, activation, prefers);
    };
    let id = value.get("default").and_then(|v| v.as_str()).unwrap_or(DEFAULT_THEME_ID).to_string();
    let attr = value
        .get("activationAttr")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_ACTIVATION_ATTR)
        .to_string();
    let mut prefers_map = BTreeMap::new();
    if let Some(obj) = value.get("prefersColorScheme").and_then(|v| v.as_object()) {
        for (scheme, target) in obj {
            if let Some(tid) = target.as_str() {
                prefers_map.insert(scheme.to_string(), tid.to_string());
            } else {
                diagnostics.push(ReportedDiagnostic::warning(
                    path,
                    format!("prefersColorScheme.{scheme} must be a theme id string"),
                ));
            }
        }
    }
    (id, attr, prefers_map)
}

/// Emit CSS custom properties for the whole Style Theme.
///
/// Order: `:root` default → `@media (prefers-color-scheme: …)` → `[activationAttr]`
/// (explicit attribute wins over OS preference).
pub fn emit_style_theme_css(theme: &StyleTheme) -> String {
    if theme.is_empty() {
        return String::new();
    }
    let attr = &theme.activation_attr;
    let mut out = String::new();

    fn push_block(out: &mut String, selector: &str, entries: &[StyleTokenLeaf]) {
        if entries.is_empty() {
            return;
        }
        out.push_str(selector);
        out.push_str(" {\n");
        for t in entries {
            out.push_str(&format!("  {}: {};\n", css_var_name(&t.path), t.value));
        }
        out.push_str("}\n");
    }

    if let Some(base) = theme.table(&theme.default_id) {
        push_block(&mut out, ":root", &base.entries);
    }

    for (scheme, theme_id) in &theme.prefers_color_scheme {
        let resolved = theme.resolve(theme_id);
        if resolved.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("@media (prefers-color-scheme: {scheme}) {{\n"));
        push_block(&mut out, "  :root", &resolved);
        out.push_str("}\n");
    }

    // Explicit activation (including default) so cookie/toggle can override OS preference.
    for id in theme.theme_ids() {
        let resolved = theme.resolve(&id);
        if resolved.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        push_block(&mut out, &format!("[{attr}=\"{id}\"]"), &resolved);
    }
    out
}

/// Back-compat wrapper.
pub fn emit_designs_css(bundle: &DesignsBundle) -> String {
    emit_style_theme_css(&bundle.theme)
}

pub fn css_var_name(path: &[String]) -> String {
    let mut s = String::from("--vmz");
    for p in path {
        s.push('-');
        s.push_str(&p.replace('_', "-"));
    }
    s
}

fn load_flat_json(path: &Path) -> Result<Vec<StyleTokenLeaf>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let value: Value = serde_json::from_str(&text).map_err(|e| format!("json: {e}"))?;

    if let Some(arr) = value.get("entries").and_then(|v| v.as_array()) {
        let mut out = Vec::new();
        for item in arr {
            let path_segs = item
                .pointer("/key/path")
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if path_segs.is_empty() {
                continue;
            }
            let css = theme_value_to_css(item.get("value")).ok_or_else(|| {
                format!("unsupported native theme value for {}", path_segs.join("."))
            })?;
            out.push(StyleTokenLeaf { path: path_segs, value: css });
        }
        return Ok(out);
    }

    let obj = value.as_object().ok_or_else(|| "expected object root".to_string())?;
    let mut out = Vec::new();
    for (ns, ns_val) in obj {
        let Some(map) = ns_val.as_object() else {
            continue;
        };
        for (token, raw) in map {
            let css =
                value_to_css(raw).ok_or_else(|| format!("unsupported value for `{ns}.{token}`"))?;
            out.push(StyleTokenLeaf { path: vec![ns.clone(), token.clone()], value: css });
        }
    }
    Ok(out)
}

fn value_to_css(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

fn theme_value_to_css(v: Option<&Value>) -> Option<String> {
    let v = v?;
    if let Some(s) = v.as_str() {
        return Some(s.to_string());
    }
    if let Some(css) = v.pointer("/data/css").and_then(|x| x.as_str()) {
        return Some(css.to_string());
    }
    if let Some(s) = v.get("data").and_then(|x| x.as_str()) {
        return Some(s.to_string());
    }
    None
}

fn list_json(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json") {
            out.push(p);
        }
    }
    out.sort();
    out
}

fn list_style_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        match p.extension().and_then(|e| e.to_str()) {
            Some("scss" | "sass" | "css") => out.push(p),
            _ => {}
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn css_var_naming() {
        assert_eq!(css_var_name(&["colors".into(), "action".into()]), "--vmz-colors-action");
    }

    #[test]
    fn resolve_merges_overlay() {
        let theme = StyleTheme {
            default_id: "default".into(),
            activation_attr: "data-theme".into(),
            prefers_color_scheme: BTreeMap::new(),
            tables: vec![
                StyleThemeTable {
                    id: "default".into(),
                    entries: vec![
                        StyleTokenLeaf {
                            path: vec!["colors".into(), "action".into()],
                            value: "#3366ff".into(),
                        },
                        StyleTokenLeaf {
                            path: vec!["spacing".into(), "4".into()],
                            value: "1rem".into(),
                        },
                    ],
                },
                StyleThemeTable {
                    id: "dark".into(),
                    entries: vec![StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#93c5fd".into(),
                    }],
                },
            ],
        };
        let dark = theme.resolve("dark");
        let action =
            dark.iter().find(|e| e.path == ["colors".to_string(), "action".to_string()]).unwrap();
        assert_eq!(action.value, "#93c5fd");
        let spacing =
            dark.iter().find(|e| e.path == ["spacing".to_string(), "4".to_string()]).unwrap();
        assert_eq!(spacing.value, "1rem");
    }

    #[test]
    fn project_var_refs_for_engine() {
        let theme = StyleTheme {
            default_id: "default".into(),
            activation_attr: "data-theme".into(),
            prefers_color_scheme: BTreeMap::new(),
            tables: vec![StyleThemeTable {
                id: "default".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                }],
            }],
        };
        let projected = theme.project_var_refs("default");
        assert_eq!(projected[0].value, "var(--vmz-colors-action)");
    }

    #[test]
    fn emit_uses_activation_attr() {
        let theme = StyleTheme {
            default_id: "default".into(),
            activation_attr: "data-theme".into(),
            prefers_color_scheme: BTreeMap::new(),
            tables: vec![
                StyleThemeTable {
                    id: "default".into(),
                    entries: vec![StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#3366ff".into(),
                    }],
                },
                StyleThemeTable {
                    id: "dark".into(),
                    entries: vec![StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#93c5fd".into(),
                    }],
                },
            ],
        };
        let css = emit_style_theme_css(&theme);
        assert!(css.contains(":root"));
        assert!(css.contains("[data-theme=\"dark\"]"));
        assert!(css.contains("[data-theme=\"default\"]"));
        assert!(css.contains("--vmz-colors-action: #3366ff"));
        assert!(css.contains("--vmz-colors-action: #93c5fd"));
    }

    #[test]
    fn emit_prefers_color_scheme_media() {
        let theme = StyleTheme {
            default_id: "default".into(),
            activation_attr: "data-theme".into(),
            prefers_color_scheme: BTreeMap::from([("dark".into(), "dark".into())]),
            tables: vec![
                StyleThemeTable {
                    id: "default".into(),
                    entries: vec![StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#3366ff".into(),
                    }],
                },
                StyleThemeTable {
                    id: "dark".into(),
                    entries: vec![StyleTokenLeaf {
                        path: vec!["colors".into(), "action".into()],
                        value: "#93c5fd".into(),
                    }],
                },
            ],
        };
        let css = emit_style_theme_css(&theme);
        assert!(css.contains("@media (prefers-color-scheme: dark)"));
        assert!(css.contains("--vmz-colors-action: #93c5fd"));
    }

    #[test]
    fn content_hash_stable_and_sensitive() {
        let a = StyleTheme {
            default_id: "default".into(),
            activation_attr: "data-theme".into(),
            prefers_color_scheme: BTreeMap::new(),
            tables: vec![StyleThemeTable {
                id: "default".into(),
                entries: vec![StyleTokenLeaf {
                    path: vec!["colors".into(), "action".into()],
                    value: "#3366ff".into(),
                }],
            }],
        };
        let b = a.clone();
        assert_eq!(a.content_hash(), b.content_hash());
        let mut c = a.clone();
        c.tables[0].entries[0].value = "#000000".into();
        assert_ne!(a.content_hash(), c.content_hash());
        let mut d = a.clone();
        d.prefers_color_scheme.insert("dark".into(), "dark".into());
        assert_ne!(a.content_hash(), d.content_hash());
    }
}
