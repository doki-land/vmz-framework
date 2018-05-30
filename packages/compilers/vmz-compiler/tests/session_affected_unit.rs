//! Moved from `src/session/affected.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::PathBuf;

use std::fs;
use vmz_compiler::session::affected::*;

#[test]
fn leaf_vmz_dirt_affects_only_that_unit_without_importers() {
    let dir = std::env::temp_dir().join(format!("vmz-aff-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    let a = dir.join("src/components/A.vmz");
    let b = dir.join("src/components/B.vmz");
    fs::write(
        &a,
        "<template><p>a</p></template>\n<script client>\nexport default class A {}\n</script>\n",
    )
    .unwrap();
    fs::write(
        &b,
        "<template><p>b</p></template>\n<script client>\nexport default class B {}\n</script>\n",
    )
    .unwrap();
    let plan = plan_affected(&dir, &[a.clone()]);
    assert!(!plan.full);
    assert_eq!(plan.units.len(), 1);
    assert!(paths_eq(&plan.units[0].source, &a));
    assert_eq!(plan.units[0].chunk_id, "components/A");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dirty_component_rebuilds_importing_page() {
    let dir = std::env::temp_dir().join(format!("vmz-aff-rev-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    let card = dir.join("src/components/Card.vmz");
    let page = dir.join("src/pages/index.vmz");
    fs::write(
        &card,
        "<template><p>c</p></template>\n<script client>\nexport default class Card {}\n</script>\n",
    )
    .unwrap();
    fs::write(
        &page,
        "<template><Card /></template>\n<script client>\nexport default class Index {}\n</script>\n",
    )
    .unwrap();
    let plan = plan_affected(&dir, &[card.clone()]);
    assert!(!plan.full);
    let chunks: Vec<_> = plan.units.iter().map(|u| u.chunk_id.as_str()).collect();
    assert!(chunks.contains(&"components/Card"));
    assert!(chunks.contains(&"pages/index"));
    assert_eq!(plan.seed_chunks, vec!["components/Card".to_string()]);
    assert!(!plan.island_only());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dirty_designs_forces_full_rebuild() {
    let dir = std::env::temp_dir().join(format!("vmz-aff-designs-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    fs::create_dir_all(dir.join("designs/tokens")).unwrap();
    let page = dir.join("src/pages/Index.vmz");
    fs::write(
        &page,
        "<template><p>x</p></template>\n<script client>\nexport default class IndexPage {}\n</script>\n",
    )
    .unwrap();
    let token = dir.join("designs/tokens/colors.json");
    fs::write(&token, "{\"colors\":{\"action\":\"#3366ff\"}}").unwrap();
    let plan = plan_affected(&dir, &[token.clone()]);
    assert!(plan.full, "designs dirt must be full");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dependency_ui_component_chunk_id_is_under_components() {
    let src_root = std::path::PathBuf::from(r"E:\app\src");
    let linked = std::path::PathBuf::from(r"E:\app\node_modules\@vmz\ui\src\components\Button.vmz");
    let real = std::path::PathBuf::from(r"E:\packages\ui\vmz-ui\src\components\Button.vmz");
    assert_eq!(chunk_id_for(&src_root, &linked), "components/Button");
    assert_eq!(chunk_id_for(&src_root, &real), "components/Button");
}
