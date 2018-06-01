//! Compile-time each rowKernel for static keyed rows (fixed element tree).
use vmz_compiler::pipeline::row_kernel::try_emit_row_kernel_js;
use vmz_types::{ViewAttr, ViewAttrValue, ViewNode};

fn attr_static(name: &str, value: &str) -> ViewAttr {
    ViewAttr {
        name: name.into(),
        value: ViewAttrValue::Static { value: value.into() },
        binding: None,
    }
}

fn attr_interp(name: &str, expr: &str) -> ViewAttr {
    ViewAttr {
        name: name.into(),
        value: ViewAttrValue::Interp { expr: expr.into() },
        binding: None,
    }
}

fn el(tag: &str, attrs: Vec<ViewAttr>, children: Vec<ViewNode>) -> ViewNode {
    ViewNode::Element { tag: tag.into(), attrs, children, each: None }
}

/// Representative keyed table row: texts + selected class + item-id actions.
fn keyed_table_row() -> (Vec<ViewAttr>, Vec<ViewNode>) {
    let attrs = vec![attr_interp("class", "selected === row.id ? \"danger\" : \"\"")];
    let children = vec![
        el(
            "td",
            vec![attr_static("class", "col-md-1")],
            vec![ViewNode::Interp { expr: "row.id".into(), binding: None }],
        ),
        el(
            "td",
            vec![attr_static("class", "col-md-4")],
            vec![el(
                "a",
                vec![attr_interp("onClick", "() => this.select(row.id)")],
                vec![ViewNode::Interp { expr: "row.label".into(), binding: None }],
            )],
        ),
        el(
            "td",
            vec![attr_static("class", "col-md-1")],
            vec![el(
                "a",
                vec![attr_interp("onClick", "() => this.remove(row.id)")],
                vec![el(
                    "span",
                    vec![
                        attr_static("class", "glyphicon glyphicon-remove"),
                        attr_static("aria-hidden", "true"),
                    ],
                    vec![],
                )],
            )],
        ),
        el("td", vec![attr_static("class", "col-md-6")], vec![]),
    ];
    (attrs, children)
}

#[test]
fn keyed_static_row_emits_row_kernel() {
    let (attrs, children) = keyed_table_row();
    let fields = vec!["rows".into(), "selected".into()];
    let scope = vec!["row".into(), "index".into()];
    let aliases = vec![("row".into(), "box1.item".into()), ("index".into(), "box1.index".into())];
    let js = try_emit_row_kernel_js(
        "tr",
        &attrs,
        &children,
        "row",
        "box1",
        &fields,
        &scope,
        &aliases,
        Some("box1.item.id"),
    );
    assert!(js.is_some(), "expected rowKernel for static keyed row");
    let js = js.unwrap();
    assert!(js.contains("rowKernel:"), "{js}");
    assert!(js.contains("hydrate:"), "{js}");
    assert!(js.contains("data-vmz-act"), "{js}");
    assert!(js.contains("create:"), "{js}");
    assert!(js.contains("insertBefore"), "{js}");
    assert!(js.contains("cloneNode"), "{js}");
    assert!(js.contains("itemFields"), "{js}");
    assert!(js.contains("keyField"), "{js}");
    assert!(js.contains("actArgField"), "{js}");
    assert!(js.contains("hostFields"), "{js}");
    // Host/item fields come from expression analysis (fixture uses selected/id).
    assert!(js.contains("hostFields: [\"selected\"]"), "{js}");
    assert!(js.contains("actArgField: \"id\""), "{js}");
    assert!(js.contains("item.id") || js.contains("item.label"), "{js}");
    // Create must not go through hydrate.call (inlined path locals).
    assert!(!js.contains("hydrate.call"), "{js}");
}

/// Same structural pattern with different host/item names — proves no selected/id hardcoding.
fn keyed_row_alt_fields() -> (Vec<ViewAttr>, Vec<ViewNode>) {
    let attrs = vec![attr_interp("class", "activeKey === row.key ? \"on\" : \"off\"")];
    let children = vec![
        el("li", vec![], vec![ViewNode::Interp { expr: "row.title".into(), binding: None }]),
        el("button", vec![attr_interp("onClick", "() => this.pick(row.key)")], vec![]),
    ];
    (attrs, children)
}

#[test]
fn row_kernel_uses_analyzed_host_and_item_fields() {
    let (attrs, children) = keyed_row_alt_fields();
    let fields = vec!["items".into(), "activeKey".into()];
    let scope = vec!["row".into(), "index".into()];
    let aliases = vec![("row".into(), "box1.item".into()), ("index".into(), "box1.index".into())];
    let js = try_emit_row_kernel_js(
        "div",
        &attrs,
        &children,
        "row",
        "box1",
        &fields,
        &scope,
        &aliases,
        Some("box1.item.key"),
    )
    .expect("rowKernel for alt field names");
    assert!(js.contains("hostFields: [\"activeKey\"]"), "{js}");
    assert!(js.contains("actArgField: \"key\""), "{js}");
    assert!(js.contains("keyField: \"key\""), "{js}");
    assert!(js.contains("item.title"), "{js}");
    assert!(js.contains("this.activeKey"), "{js}");
    assert!(!js.contains("selected"), "{js}");
}
