//! Built-in Link → `<a href>` via stable RouteId (A2).

use std::collections::BTreeMap;
use std::path::PathBuf;

use vmz_compiler::analyze::analyze_script;
use vmz_compiler::emit::emit_client_js_with_ir;
use vmz_compiler::pipeline::link::{
    RouteEntry, RouteTable, parse_static_link_params, realize_path_pattern, resolve_link_href,
};
use vmz_compiler::reactive_build::build_program_module_with_server;
use vmz_compiler::sfc::ScriptKind;
use vmz_compiler::template::parse_template;
use vmz_types::{ViewNode, ViewStatus};

fn demo_table() -> RouteTable {
    let mut table = RouteTable::default();
    table
        .insert(RouteEntry {
            route_id: "IndexPage".into(),
            path_pattern: "/".into(),
            chunk_id: "pages/index".into(),
            source: PathBuf::from("src/pages/index.vmz"),
            load: None,
            tab: None,
        })
        .unwrap();
    table
        .insert(RouteEntry {
            route_id: "AboutPage".into(),
            path_pattern: "/about".into(),
            chunk_id: "pages/about".into(),
            source: PathBuf::from("src/pages/about.vmz"),
            load: None,
            tab: None,
        })
        .unwrap();
    table
        .insert(RouteEntry {
            route_id: "ProductPage".into(),
            path_pattern: "/products/[id]".into(),
            chunk_id: "pages/products/[id]".into(),
            source: PathBuf::from("src/pages/products/[id].vmz"),
            load: Some("load".into()),
            tab: None,
        })
        .unwrap();
    table
}

#[test]
fn resolve_via_route_id_not_path() {
    let table = demo_table();
    let empty = BTreeMap::new();
    assert_eq!(resolve_link_href("IndexPage", &empty, &table).unwrap(), "/");
    assert_eq!(resolve_link_href("AboutPage", &empty, &table).unwrap(), "/about");
    let mut params = BTreeMap::new();
    params.insert("id".into(), "sku-1".into());
    assert_eq!(resolve_link_href("ProductPage", &params, &table).unwrap(), "/products/sku-1");
    assert!(resolve_link_href("/about", &empty, &table).unwrap_err().contains("RouteId"));
    assert!(
        resolve_link_href("products/[id]", &params, &table)
            .unwrap_err()
            .contains("unknown RouteId")
    );
}

#[test]
fn path_metadata_change_keeps_route_id() {
    let mut table = demo_table();
    table.by_id.get_mut("ProductPage").unwrap().path_pattern = "/catalog/:id".into();
    let mut params = BTreeMap::new();
    params.insert("id".into(), "sku-1".into());
    assert_eq!(resolve_link_href("ProductPage", &params, &table).unwrap(), "/catalog/sku-1");
}

#[test]
fn class_default_route_id_survives_path_rename() {
    // Default RouteId is class name — file move / path metadata change must not break Links.
    let mut table = RouteTable::default();
    table
        .insert(RouteEntry {
            route_id: "ProductPage".into(),
            path_pattern: "/old/[id]".into(),
            chunk_id: "pages/legacy/[id]".into(),
            source: PathBuf::from("src/pages/legacy/[id].vmz"),
            load: None,
            tab: None,
        })
        .unwrap();
    table.by_id.get_mut("ProductPage").unwrap().path_pattern = "/products/[id]".into();
    table.by_id.get_mut("ProductPage").unwrap().chunk_id = "pages/catalog/[id]".into();
    let mut params = BTreeMap::new();
    params.insert("id".into(), "sku-1".into());
    assert_eq!(resolve_link_href("ProductPage", &params, &table).unwrap(), "/products/sku-1");
}

#[test]
fn oxc_params_static_strings() {
    let p = parse_static_link_params("id: 'sku-1'").unwrap();
    assert_eq!(p.get("id").map(String::as_str), Some("sku-1"));
    assert_eq!(realize_path_pattern("/users/:id", &p).unwrap(), "/users/sku-1");
    let p2 = parse_static_link_params("{ id: \"sku-2\", tab: 'security' }").unwrap();
    assert_eq!(p2.get("id").map(String::as_str), Some("sku-2"));
    assert_eq!(p2.get("tab").map(String::as_str), Some("security"));
}

#[test]
fn router_attr_shorthand_desugars() {
    use vmz_compiler::pipeline::link::parse_route_contract;
    use vmz_compiler::sfc::DataBlock;
    let block = DataBlock {
        content: String::new(),
        content_start: 0,
        lang: None,
        attrs: r#" path="/docs" "#.into(),
    };
    let c = parse_route_contract(&block).unwrap();
    assert_eq!(c.path.as_deref(), Some("/docs"));
    assert!(c.id.is_none());
    assert!(c.tab.is_none());
}

#[test]
fn router_tab_parses_order_label_icon() {
    use vmz_compiler::pipeline::link::parse_route_contract;
    use vmz_compiler::sfc::DataBlock;
    let block = DataBlock {
        content: r#"{ tab: { order: 0, label: "首页", icon: "assets/tab-home.svg" } }"#.into(),
        content_start: 0,
        lang: None,
        attrs: String::new(),
    };
    let c = parse_route_contract(&block).unwrap();
    let tab = c.tab.expect("tab");
    assert_eq!(tab.order, 0);
    assert_eq!(tab.label, "首页");
    assert_eq!(tab.icon, "assets/tab-home.svg");
    assert!(tab.selected_icon.is_none());
}

#[test]
fn router_tab_rejects_wechat_keys_and_unknown_fields() {
    use vmz_compiler::pipeline::link::parse_route_contract;
    use vmz_compiler::sfc::DataBlock;
    let wechat = DataBlock {
        content: r#"{ tabBar: { list: [] } }"#.into(),
        content_start: 0,
        lang: None,
        attrs: String::new(),
    };
    let err = parse_route_contract(&wechat).unwrap_err();
    assert!(err.contains("tabBar"), "{err}");
    let unknown = DataBlock {
        content: r#"{ tab: { order: 0, label: "首页", icon: "assets/a.svg", iconPath: "x.png" } }"#
            .into(),
        content_start: 0,
        lang: None,
        attrs: String::new(),
    };
    let err = parse_route_contract(&unknown).unwrap_err();
    assert!(err.contains("iconPath"), "{err}");
}

#[test]
fn path_pattern_skips_route_groups_and_boundaries() {
    use vmz_compiler::pipeline::link::{is_route_boundary_chunk, path_pattern_from_chunk};
    assert_eq!(path_pattern_from_chunk("pages/(marketing)/shop/index"), "/shop");
    assert_eq!(path_pattern_from_chunk("pages/(marketing)/shop/offer"), "/shop/offer");
    assert_eq!(path_pattern_from_chunk("pages/shop/index"), "/shop");
    assert!(is_route_boundary_chunk("pages/shop/Layout"));
    assert!(is_route_boundary_chunk("pages/(marketing)/Layout"));
    assert!(!is_route_boundary_chunk("pages/shop/index"));
}

#[test]
fn link_lowers_to_anchor_href() {
    let src = r#"
export default class IndexPage {}
"#;
    let client = analyze_script(ScriptKind::Client, src);
    let tpl = parse_template(
        r#"<nav><Link to="AboutPage">About</Link><Link to="ProductPage" params={ id: 'sku-1' }>Product</Link></nav>"#,
    );
    let table = demo_table();
    let program = build_program_module_with_server("t.vmz", &client.decl, &tpl, None, Some(&table));
    assert_eq!(program.units[0].view.status, ViewStatus::Native);
    let root = &program.units[0].view.roots[0];
    let ViewNode::Element { children, .. } = root else {
        panic!("expected nav element: {root:?}");
    };
    assert!(children.iter().all(|c| matches!(c, ViewNode::Element { tag, .. } if tag == "a")));

    let view = &program.units[0].view;
    let reactive = &program.units[0].reactive;
    let plan = &program.units[0].plan;
    let js =
        emit_client_js_with_ir(src, &client, &tpl, None, Some(reactive), Some(view), Some(plan))
            .unwrap();
    assert!(js.contains("api.el(\"a\")"), "{js}");
    assert!(js.contains("/about"), "{js}");
    assert!(js.contains("/products/sku-1"), "{js}");
    assert!(js.contains("data-vmz-route"), "{js}");
    assert!(js.contains("AboutPage"), "{js}");
    assert!(!js.contains("api.component(this, \"Link\""), "{js}");
}
