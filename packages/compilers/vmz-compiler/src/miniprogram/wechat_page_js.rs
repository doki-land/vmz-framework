//! Seed WeChat `Page({ data })` from class field literals.
//!
//! WXML interpolations read `data`. Pack copies initializer text from the
//! page SFC; this is not a `setData` authoring API. Inits that mention `this`
//! stay out (they are not JSON-shaped literals).

use std::fs;
use std::path::{Path, PathBuf};

use crate::analyze::analyze_script;
use crate::parse::sfc::{ScriptKind, parse_vmz};

fn resolve_source(root: &Path, source: &str) -> Option<PathBuf> {
    let source = source.trim();
    if source.is_empty() {
        return None;
    }
    let direct = PathBuf::from(source);
    if direct.is_file() {
        return Some(direct);
    }
    let rel = root.join(source);
    rel.is_file().then_some(rel)
}

fn is_ident(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn is_packable_init(text: &str) -> bool {
    !text.contains("this.") && !text.contains("this[")
}

/// Field name + initializer text safe to embed in `Page({ data })`.
pub fn page_data_fields(root: &Path, module_source: &str) -> Vec<(String, String)> {
    let Some(path) = resolve_source(root, module_source) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(&path) else {
        return Vec::new();
    };
    let Ok(parsed) = parse_vmz(&path, text) else {
        return Vec::new();
    };
    let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
    let mut out = Vec::new();
    for field in &analyzed.decl.fields {
        if !is_ident(&field.name) {
            continue;
        }
        let Some(init) = field.init_text.as_deref().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        if !is_packable_init(init) {
            continue;
        }
        out.push((field.name.clone(), init.to_string()));
    }
    out
}

/// Chrome `Page({...})` source: optional `data`, tab `onShow`, share menu.
pub fn format_page_js(
    share_title_json: &str,
    fields: &[(String, String)],
    tab_selected: Option<u32>,
) -> String {
    let mut body = String::from("Page({\n");
    if !fields.is_empty() {
        body.push_str("  data: {\n");
        for (i, (name, init)) in fields.iter().enumerate() {
            body.push_str("    ");
            body.push_str(name);
            body.push_str(": ");
            body.push_str(init);
            if i + 1 != fields.len() {
                body.push(',');
            }
            body.push('\n');
        }
        body.push_str("  },\n");
    }
    if let Some(index) = tab_selected {
        body.push_str("  onShow() {\n");
        body.push_str(
            "    const bar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;\n",
        );
        body.push_str("    if (bar) {\n");
        body.push_str("      bar.setData({ selected: ");
        body.push_str(&index.to_string());
        body.push_str(" });\n");
        body.push_str("    }\n");
        body.push_str("  },\n");
    }
    body.push_str("  onShareAppMessage() { return { title: ");
    body.push_str(share_title_json);
    body.push_str(" }; }\n});\n");
    body
}
