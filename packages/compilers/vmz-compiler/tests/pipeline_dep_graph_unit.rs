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

#[test]
fn link_tag_when_component_chunk_exists() {
    let dir = std::env::temp_dir().join(format!("vmz-dep-link-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    let link = dir.join("src/components/Link.vmz");
    let page = dir.join("src/pages/product.vmz");
    fs::write(
        &link,
        "<template><a>{href}</a></template>\n<script client>\nexport default class Link {}\n</script>\n",
    )
    .unwrap();
    fs::write(
        &page,
        "<template><Link href=\"/x\" /></template>\n<script client>\nexport default class Product {}\n</script>\n",
    )
    .unwrap();
    let src = dir.join("src");
    let units = vec![
        (link.clone(), VmzModuleKind::Component, chunk_id_for(&src, &link)),
        (page.clone(), VmzModuleKind::Page, chunk_id_for(&src, &page)),
    ];
    let g = ComponentGraph::build(&src, &units);
    assert_eq!(
        g.deps.get("pages/product").map(|v| v.as_slice()),
        Some(vec!["components/Link".to_string()].as_slice())
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn self_reference_has_no_static_deps() {
    let dir = std::env::temp_dir().join(format!("vmz-dep-self-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    let tree = dir.join("src/components/ProjectTree.vmz");
    let page = dir.join("src/pages/index.vmz");
    let card = dir.join("src/components/UserCard.vmz");
    fs::write(
        &tree,
        "<template><div v-for=\"n in nodes\" :key=\"n.id\"><ProjectTree v-if=\"n.children.length\" :nodes=\"n.children\" /></div></template>\n<script client>\nexport default class ProjectTree { nodes = []; }\n</script>\n",
    )
    .unwrap();
    fs::write(
        &card,
        "<template><p>c</p></template>\n<script client>\nexport default class UserCard {}\n</script>\n",
    )
    .unwrap();
    fs::write(
        &page,
        "<template><ProjectTree /><UserCard /></template>\n<script client>\nexport default class Index {}\n</script>\n",
    )
    .unwrap();
    let src = dir.join("src");
    let units = vec![
        (tree.clone(), VmzModuleKind::Component, chunk_id_for(&src, &tree)),
        (card.clone(), VmzModuleKind::Component, chunk_id_for(&src, &card)),
        (page.clone(), VmzModuleKind::Page, chunk_id_for(&src, &page)),
    ];
    let g = ComponentGraph::build(&src, &units);
    assert_eq!(g.deps.get("components/ProjectTree"), None);
    assert_eq!(
        g.deps.get("pages/index").map(|v| v.as_slice()),
        Some(
            vec!["components/ProjectTree".to_string(), "components/UserCard".to_string()].as_slice(),
        ),
    );
    let tree_ctors = g.child_ctors_for_chunk("components/ProjectTree");
    assert!(tree_ctors.is_empty(), "self-ref must use registry, not static import");
    let page_ctors = g.child_ctors_for_chunk("pages/index");
    assert_eq!(
        page_ctors.get("ProjectTree").map(String::as_str),
        Some("../components/ProjectTree.client.js"),
    );
    assert_eq!(
        page_ctors.get("UserCard").map(String::as_str),
        Some("../components/UserCard.client.js"),
    );
    assert!(!page_ctors.contains_key("Index"));
    let _ = fs::remove_dir_all(&dir);
}
