//! `vmz explain style <node>` — Style Theme causal chain (doc 21).
//!
//! Target forms (after optional `style:` prefix):
//! - utility: `bg-action`, `tw:bg-action`
//! - css var: `--vmz-colors-action`
//! - leaf: `colors.action`
//! - global style: `designs/styles/index.scss` / `styles/index.scss`

use std::path::{Path, PathBuf};

use vmz_protocol::{EXPLAIN_SCHEMA, ExplainDocument, ExplainEdge, StableId};

use crate::designs::{DesignsBundle, StyleTheme, css_var_name, load_designs};
use crate::style_token_diag::{
    bare_utility, design_token_ref_from_utility, theme_leaf_ref_from_utility,
};

/// Build an ExplainDocument for a style node.
pub fn explain_style(root: &Path, session_generation: u64, spec: &str) -> ExplainDocument {
    let spec = normalize_style_spec(spec);
    let designs = load_designs(root);

    if let Some(doc) = explain_global_style(root, &designs, session_generation, &spec) {
        return doc;
    }
    if let Some(doc) = explain_token_or_utility(&designs, session_generation, &spec) {
        return doc;
    }

    ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target: format!("style:{spec}"),
        kind: "style".into(),
        chunk_id: None,
        deployment_unit: None,
        program: None,
        edge: None,
        session_generation,
        contributions: vec![],
        chain: vec![],
        notes: Some(format!(
            "unrecognized style node `{spec}` — try bg-action, --vmz-colors-action, colors.action, or designs/styles/index.scss"
        )),
    }
}

fn normalize_style_spec(spec: &str) -> String {
    let s = spec.trim();
    let s = s.strip_prefix("style:").unwrap_or(s).trim();
    let s = s.strip_prefix("tw:").unwrap_or(s).trim();
    s.to_string()
}

fn explain_global_style(
    root: &Path,
    designs: &DesignsBundle,
    session_generation: u64,
    spec: &str,
) -> Option<ExplainDocument> {
    let path = resolve_global_style_path(root, designs, spec)?;
    let rel = rel_display(root, &path);
    let is_entry = designs.style_entry.as_ref().is_some_and(|e| paths_equal(e, &path));
    let file_id = StableId { kind: "style_file".into(), id: rel.clone() };
    let entry_rel =
        designs.style_entry.as_ref().map(|e| rel_display(root, e)).unwrap_or_else(|| rel.clone());
    let entry_id = StableId { kind: "style_entry".into(), id: entry_rel };
    let asset_id = StableId { kind: "css_asset".into(), id: "vmz-style.css".into() };
    let mut chain = Vec::new();
    chain.push(ExplainEdge {
        from: file_id,
        to: entry_id.clone(),
        reason: if is_entry {
            "designs/styles entry (compiled as global SCSS)".into()
        } else {
            "must be @import/@use/@forward from designs/styles entry to compile".into()
        },
        precision: Some("exact".into()),
        span: None,
    });
    chain.push(ExplainEdge {
        from: entry_id,
        to: asset_id,
        reason: "SCSS style plugin emit → StyleEmitter Scss layer".into(),
        precision: Some("exact".into()),
        span: None,
    });
    Some(ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target: format!("style:{spec}"),
        kind: "style".into(),
        chunk_id: Some("vmz-style.css".into()),
        deployment_unit: None,
        program: None,
        edge: None,
        session_generation,
        contributions: vec![],
        chain,
        notes: Some(if is_entry {
            "global style entry is always emitted into vmz-style.css when present".into()
        } else {
            "sibling style files are only emitted when reachable from the entry".into()
        }),
    })
}

fn resolve_global_style_path(root: &Path, designs: &DesignsBundle, spec: &str) -> Option<PathBuf> {
    let looks_like_style = spec.contains('/')
        || spec.ends_with(".scss")
        || spec.ends_with(".sass")
        || spec.ends_with(".css")
        || spec.starts_with("styles");
    if !looks_like_style {
        return None;
    }
    let candidates = [
        root.join(spec),
        root.join("designs").join(spec),
        designs.root.join(spec),
        designs.root.join("styles").join(spec.trim_start_matches("styles/")),
    ];
    for c in candidates {
        if c.is_file() {
            return Some(c);
        }
    }
    let name = Path::new(spec).file_name()?.to_str()?;
    designs
        .style_files
        .iter()
        .chain(designs.style_entry.iter())
        .find(|p| p.file_name().and_then(|s| s.to_str()) == Some(name))
        .cloned()
}

fn explain_token_or_utility(
    designs: &DesignsBundle,
    session_generation: u64,
    spec: &str,
) -> Option<ExplainDocument> {
    let resolved = resolve_ns_key(spec, &designs.theme)?;
    let leaf = format!("{}.{}", resolved.ns, resolved.key);
    let var = css_var_name(&[resolved.ns.clone(), resolved.key.clone()]);
    let in_theme = designs.theme.has_ns_key(&resolved.ns, &resolved.key);

    let util_id =
        resolved.utility.as_ref().map(|u| StableId { kind: "style_tw".into(), id: u.clone() });
    let token_id = StableId { kind: "design_token".into(), id: leaf.clone() };
    let var_id = StableId { kind: "css_var".into(), id: var.clone() };
    let designs_asset = StableId { kind: "css_asset".into(), id: "vmz-designs.css".into() };
    let tw_asset = StableId { kind: "css_asset".into(), id: "vmz-tw.css".into() };

    let mut chain = Vec::new();
    if let Some(uid) = &util_id {
        chain.push(ExplainEdge {
            from: uid.clone(),
            to: token_id.clone(),
            reason: format!("style:tw utility maps to Style Theme leaf `{leaf}`"),
            precision: Some("exact".into()),
            span: None,
        });
    }
    chain.push(ExplainEdge {
        from: token_id.clone(),
        to: var_id,
        reason: format!("Style Theme leaf lowers to `{var}`"),
        precision: Some("exact".into()),
        span: None,
    });
    chain.push(ExplainEdge {
        from: StableId { kind: "css_var".into(), id: var.clone() },
        to: designs_asset,
        reason: "StyleEmitter Designs layer (vmz-designs.css)".into(),
        precision: Some("exact".into()),
        span: None,
    });
    if util_id.is_some() {
        chain.push(ExplainEdge {
            from: token_id,
            to: tw_asset,
            reason: "TW plugin projects leaf as var(--vmz-…) → vmz-tw.css".into(),
            precision: Some("exact".into()),
            span: None,
        });
    }

    let notes = if in_theme {
        format!("style chain for `{leaf}` (`{var}`)")
    } else {
        format!(
            "style chain for `{leaf}` (`{var}`) — leaf NOT in Style Theme (unknown_design_token)"
        )
    };

    Some(ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target: format!("style:{spec}"),
        kind: "style".into(),
        chunk_id: Some(if resolved.utility.is_some() {
            "vmz-tw.css".into()
        } else {
            "vmz-designs.css".into()
        }),
        deployment_unit: None,
        program: None,
        edge: None,
        session_generation,
        contributions: vec![],
        chain,
        notes: Some(notes),
    })
}

struct ResolvedLeaf {
    ns: String,
    key: String,
    utility: Option<String>,
}

fn resolve_ns_key(spec: &str, theme: &StyleTheme) -> Option<ResolvedLeaf> {
    if let Some((ns, key)) =
        theme_leaf_ref_from_utility(spec).or_else(|| design_token_ref_from_utility(spec))
    {
        return Some(ResolvedLeaf {
            ns: ns.to_string(),
            key: key.to_string(),
            utility: Some(bare_utility(spec).to_string()),
        });
    }

    if let Some((ns, key)) = spec.split_once('.') {
        if !ns.is_empty() && !key.is_empty() && !spec.starts_with("--") {
            return Some(ResolvedLeaf { ns: ns.to_string(), key: key.to_string(), utility: None });
        }
    }

    for table in &theme.tables {
        for e in &table.entries {
            if e.path.len() < 2 {
                continue;
            }
            let var = css_var_name(&e.path);
            let dotted = e.path.join(".");
            if var == spec || dotted == spec {
                return Some(ResolvedLeaf {
                    ns: e.path[0].clone(),
                    key: e.path[1..].join("-"),
                    utility: None,
                });
            }
        }
    }

    if let Some(rest) = spec.strip_prefix("--vmz-") {
        // Prefer matching a known var; otherwise first-segment heuristic.
        for table in &theme.tables {
            for e in &table.entries {
                if css_var_name(&e.path) == spec && e.path.len() >= 2 {
                    return Some(ResolvedLeaf {
                        ns: e.path[0].clone(),
                        key: e.path[1..].join("-"),
                        utility: None,
                    });
                }
            }
        }
        let mut parts = rest.splitn(2, '-');
        let ns = parts.next()?.to_string();
        let key = parts.next()?.to_string();
        return Some(ResolvedLeaf { ns, key, utility: None });
    }

    None
}

fn rel_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root).unwrap_or(path).display().to_string().replace('\\', "/")
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    a.canonicalize().ok() == b.canonicalize().ok() || a == b
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::designs::{StyleThemeTable, StyleTokenLeaf};
    use std::collections::BTreeMap;

    #[test]
    fn resolve_utility_and_leaf() {
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
        let u = resolve_ns_key("bg-action", &theme).unwrap();
        assert_eq!(u.ns, "colors");
        assert_eq!(u.key, "action");
        assert_eq!(u.utility.as_deref(), Some("bg-action"));
        let l = resolve_ns_key("colors.action", &theme).unwrap();
        assert_eq!(l.ns, "colors");
        assert_eq!(l.key, "action");
        assert!(l.utility.is_none());
        let v = resolve_ns_key("--vmz-colors-action", &theme).unwrap();
        assert_eq!(v.ns, "colors");
        assert_eq!(v.key, "action");
    }

    #[test]
    fn explain_document_kind_style() {
        let doc = explain_style(Path::new("."), 0, "bg-action");
        assert_eq!(doc.kind, "style");
        assert_eq!(doc.schema, EXPLAIN_SCHEMA);
        assert!(!doc.chain.is_empty(), "{doc:?}");
    }
}
