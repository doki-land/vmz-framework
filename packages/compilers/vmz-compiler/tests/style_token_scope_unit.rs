//! Dependency-component token scope (Discussion #6.5).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use vmz_compiler::designs::{StyleThemeTable, StyleTokenLeaf};
use vmz_compiler::style::token_diag::*;
use vmz_compiler::{DesignsBundle, StyleTheme};

const BUTTON: &str = r#"<template>
  <button>x</button>
</template>
<style>
.button { color: var(--vmz-colors-action); }
</style>
<script client>
export default class Button {}
</script>
"#;

const TABLE: &str = r#"<template>
  <table>x</table>
</template>
<style>
.table { color: var(--vmz-table-only); }
</style>
<script client>
export default class Table {}
</script>
"#;

fn project_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-token-scope-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    write(&root.join("package.json"), r#"{"name":"scope-fixture","dependencies":{"@vmz/ui":"*"}}"#);
    write(&root.join("node_modules/@vmz/ui/package.json"), r#"{"name":"@vmz/ui"}"#);
    write(&root.join("node_modules/@vmz/ui/src/components/Button.vmz"), BUTTON);
    write(&root.join("node_modules/@vmz/ui/src/components/Table.vmz"), TABLE);
    root
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn designs(root: &Path) -> DesignsBundle {
    DesignsBundle {
        root: root.join("designs"),
        missing: false,
        theme: StyleTheme {
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
        },
        style_entry: None,
        style_files: vec![],
        diagnostics: vec![],
    }
}

fn unknown_tokens(root: &Path) -> Vec<vmz_compiler::ReportedDiagnostic> {
    let designs = designs(root);
    validate_project_design_token_refs(root, &designs)
        .into_iter()
        .filter(|d| d.code() == DIAG_UNKNOWN_DESIGN_TOKEN)
        .collect()
}

#[test]
fn unreferenced_dependency_tokens_do_not_fail() {
    let root = project_root("button-only");
    write(
        &root.join("src/pages/index.vmz"),
        r#"<template>
  <Button />
</template>
<script client>
export default class Index {}
</script>
"#,
    );
    let diags = unknown_tokens(&root);
    assert!(diags.is_empty(), "{diags:?}");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn referenced_dependency_token_missing_is_rooted_at_designs() {
    let root = project_root("table-used");
    write(
        &root.join("src/pages/index.vmz"),
        r#"<template>
  <Button />
  <Table />
</template>
<script client>
export default class Index {}
</script>
"#,
    );
    let designs = designs(&root);
    let diags: Vec<_> = validate_project_design_token_refs(&root, &designs)
        .into_iter()
        .filter(|d| d.code() == DIAG_UNKNOWN_DESIGN_TOKEN)
        .collect();
    assert_eq!(diags.len(), 1, "{diags:?}");
    assert!(diags[0].is_error());
    assert_eq!(diags[0].path(), designs.root);
    let args = diags[0].args().expect("args");
    assert_eq!(args.get("name").map(String::as_str), Some("--vmz-table-only"));
    assert_eq!(args.get("component").map(String::as_str), Some("Table"));
    assert_eq!(args.get("package").map(String::as_str), Some("@vmz/ui"));
    assert!(
        !diags.iter().any(|d| d.path().to_string_lossy().contains("node_modules")),
        "{diags:?}"
    );
    let _ = std::fs::remove_dir_all(&root);
}
