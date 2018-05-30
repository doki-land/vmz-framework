//! Moved from `src/pipeline/project.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_compiler::pipeline::project::*;

#[test]
fn skips_node_modules_and_loads_dep_src_components() {
    let root = std::env::temp_dir().join(format!("vmz-discover-ui-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(root.join("src/pages")).unwrap();
    fs::create_dir_all(root.join("node_modules/@vmz/ui/src/components")).unwrap();
    fs::write(
        root.join("package.json"),
        r#"{"name":"app","dependencies":{"@vmz/ui":"workspace:*"}}"#,
    )
    .unwrap();
    fs::write(
        root.join("src/pages/index.vmz"),
        "<template><Button /></template><script client>export default class IndexPage {}</script>",
    )
    .unwrap();
    fs::write(root.join("node_modules/@vmz/ui/package.json"), r#"{"name":"@vmz/ui"}"#).unwrap();
    fs::write(
        root.join("node_modules/@vmz/ui/src/components/Button.vmz"),
        "<template><button><slot /></button></template><script client>export default class Button {}</script>",
    )
    .unwrap();
    // Wrong location — must not be discovered (convention: src/components only).
    fs::create_dir_all(root.join("node_modules/@vmz/ui/src")).unwrap();
    fs::write(root.join("node_modules/@vmz/ui/src/Misplaced.vmz"), "<template><i/></template>")
        .unwrap();
    fs::create_dir_all(root.join("node_modules/other/src/components")).unwrap();
    fs::write(root.join("node_modules/other/src/components/Nope.vmz"), "<template><i/></template>")
        .unwrap();
    // `other` is not a dependency — must not appear.
    fs::write(root.join("node_modules/other/package.json"), r#"{"name":"other"}"#).unwrap();

    let found = discover_vmz_files(&root);
    let paths: Vec<_> = found
        .iter()
        .map(|(p, k)| (p.strip_prefix(&root).unwrap().to_string_lossy().replace('\\', "/"), *k))
        .collect();
    assert!(
        paths.iter().any(|(p, k)| {
            p.ends_with("src/components/Button.vmz") && *k == VmzModuleKind::Component
        }),
        "{paths:?}"
    );
    assert!(paths.iter().any(|(p, _)| p.ends_with("pages/index.vmz")), "{paths:?}");
    assert!(paths.iter().all(|(p, _)| !p.contains("Misplaced")), "{paths:?}");
    assert!(paths.iter().all(|(p, _)| !p.contains("Nope")), "{paths:?}");
    let _ = fs::remove_dir_all(&root);
}
