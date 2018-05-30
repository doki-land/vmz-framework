//! Moved from `src/pipeline/dep_graph.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_compiler::affected::chunk_id_for;
use vmz_compiler::pipeline::dep_graph::*;
use vmz_compiler::project::VmzModuleKind;

#[test]
fn reverse_edge_page_depends_on_component() {
    let dir = std::env::temp_dir().join(format!("vmz-dep-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    let card = dir.join("src/components/UserCard.vmz");
    let page = dir.join("src/pages/index.vmz");
    fs::write(
        &card,
        "<template><p>c</p></template>\n<script client>\nexport default class UserCard {}\n</script>\n",
    )
    .unwrap();
    fs::write(
        &page,
        "<template><UserCard /></template>\n<script client>\nexport default class Index {}\n</script>\n",
    )
    .unwrap();
    let src = dir.join("src");
    let units = vec![
        (card.clone(), VmzModuleKind::Component, chunk_id_for(&src, &card)),
        (page.clone(), VmzModuleKind::Page, chunk_id_for(&src, &page)),
    ];
    let g = ComponentGraph::build(&src, &units);
    assert_eq!(
        g.deps.get("pages/index").map(|v| v.as_slice()),
        Some(vec!["components/UserCard".to_string()].as_slice())
    );
    let expanded = g.expand_importers(["components/UserCard".into()]);
    assert!(expanded.contains("pages/index"));
    assert!(expanded.contains("components/UserCard"));
    let _ = fs::remove_dir_all(&dir);
}
