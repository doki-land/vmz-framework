//! Moved from `src/style/explain.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::Path;
use vmz_compiler::StyleTheme;
use vmz_protocol::EXPLAIN_SCHEMA;

use std::collections::BTreeMap;
use vmz_compiler::designs::{StyleThemeTable, StyleTokenLeaf};
use vmz_compiler::style::explain::*;

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
