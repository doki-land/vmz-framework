//! Recursive component tags compile (self-reference via deployment registry).

use std::fs;
use vmz_compiler::pipeline::compile::{CompileOptions, compile_project};

#[test]
fn recursive_component_project_compiles() {
    let dir = std::env::temp_dir().join(format!("vmz-recursive-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    fs::create_dir_all(dir.join("designs/tokens")).unwrap();
    fs::write(
        dir.join("designs/theme.json"),
        r#"{"default":"default","activationAttr":"data-theme"}"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/components/TreeNode.vmz"),
        r#"<template>
    <div v-for="node in nodes" :key="node.id" class="node">
        <span>{{ node.label }}</span>
        <TreeNode v-if="node.children?.length" :nodes="node.children" />
    </div>
</template>
<script client>
export default class TreeNode {
    nodes: { id: string; label: string; children?: { id: string; label: string; children?: unknown[] }[] }[] = [];
}
</script>
"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/pages/index.vmz"),
        r#"<template><TreeNode :nodes="roots" /></template>
<script client>
export default class Index {
    roots = [{ id: "a", label: "A", children: [{ id: "b", label: "B" }] }];
}
</script>
"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/Application.vmz"),
        r#"<template><slot /></template>
<script client>
export default class Application {}
</script>
"#,
    )
    .unwrap();

    let mut options = CompileOptions::default();
    options.out_dir = dir.join("dist");
    let report = compile_project(&dir, &options).expect("compile_project");
    assert!(
        report.diagnostics.iter().all(|d| !d.is_error()),
        "diagnostics: {:?}",
        report.diagnostics
    );
    let tree_js = dir.join("dist/components/TreeNode.client.js");
    assert!(tree_js.exists(), "missing TreeNode client emit at {}", tree_js.display());
    let tree_src = fs::read_to_string(&tree_js).expect("read TreeNode.client.js");
    assert!(
        !tree_src.contains("import TreeNode from"),
        "self-ref must not static-import itself: {tree_src}"
    );
    assert!(
        tree_src.contains("\"TreeNode\"") || tree_src.contains("'TreeNode'"),
        "expected registry tag for self-ref: {tree_src}"
    );
    let _ = fs::remove_dir_all(&dir);
}
