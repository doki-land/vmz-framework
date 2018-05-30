//! Moved from `src/reactive_ir.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::*;

#[test]
fn static_path_distinguishes_siblings() {
    let mut b = ReactiveComponentBuilder::new("Card");
    b.add_field("user", FieldKind::State);
    let name = b.from_dep_key(&DepKey::path(DepPath::prop("user", "name"))).unwrap();
    let avatar = b.from_dep_key(&DepKey::path(DepPath::prop("user", "avatar"))).unwrap();
    let c = b.finish();
    assert_eq!(name.to_stable_string(&c.state_slots, &c.properties, &c.exprs), "user.name");
    assert_eq!(avatar.to_stable_string(&c.state_slots, &c.properties, &c.exprs), "user.avatar");
    assert_ne!(name, avatar);
}

#[test]
fn module_json_contains_stable_paths() {
    let mut b = ReactiveComponentBuilder::new("Card");
    b.add_field("user", FieldKind::State);
    let reads = vec![b.from_dep_key(&DepKey::path(DepPath::prop("user", "name"))).unwrap()];
    let expr = b.intern_expr("user.name");
    b.add_binding(BindingKind::Text, reads, None, Some(expr), None);
    let module = ReactiveModule { source: "src/Card.vmz".into(), components: vec![b.finish()] };
    let json = module.to_json();
    assert!(json.contains("user.name"), "{json}");
    assert!(json.contains("\"kind\": \"static_path\""), "{json}");
}

#[test]
fn list_item_stable_and_json() {
    let mut b = ReactiveComponentBuilder::new("TagList");
    let tags = b.add_field("tags", FieldKind::State);
    let label = b.intern_prop("label");
    let key = b.intern_expr("tag.id");
    let path = IrDepPath::ListItem {
        list: tags,
        frames: vec![ListItemFrame { via: vec![], key: Some(key) }],
        path: vec![label],
    };
    b.add_binding(BindingKind::Text, vec![path.clone()], None, None, None);
    let c = b.finish();
    assert_eq!(
        path.to_stable_string(&c.state_slots, &c.properties, &c.exprs),
        "tags[key=tag.id].label"
    );
    let module = ReactiveModule { source: "TagList.vmz".into(), components: vec![c] };
    let json = module.to_json();
    assert!(json.contains("\"kind\": \"list_item\""), "{json}");
    assert!(json.contains("tags[key=tag.id].label"), "{json}");
}

#[test]
fn dynamic_path_from_index_and_leaf() {
    let mut b = ReactiveComponentBuilder::new("Pick");
    b.add_field("items", FieldKind::State);
    b.add_field("selected", FieldKind::State);
    let key = DepKey::path(DepPath {
        root: "items".into(),
        segs: vec![PathSeg::DynIndex("selected".into()), PathSeg::Ident("label".into())],
    });
    let path = b.from_dep_key(&key).unwrap();
    let c = b.finish();
    assert!(
        matches!(
            &path,
            IrDepPath::DynamicPath {
                steps,
                path: props,
                ..
            } if steps.len() == 1 && !steps[0].key_deps.is_empty() && props.len() == 1
        ),
        "{path:?}"
    );
    assert_eq!(
        path.to_stable_string(&c.state_slots, &c.properties, &c.exprs),
        "items[selected].label"
    );
    let deps = c.transitional_deps(&[path]);
    assert!(deps.iter().any(|d| d == "items.*.label"), "{deps:?}");
    assert!(deps.iter().any(|d| d == "selected"), "{deps:?}");
}

#[test]
fn multi_segment_dynamic_path_from_dep_key() {
    let mut b = ReactiveComponentBuilder::new("Grid");
    b.add_field("rows", FieldKind::State);
    b.add_field("ri", FieldKind::State);
    b.add_field("ci", FieldKind::State);
    let key = DepKey::path(DepPath {
        root: "rows".into(),
        segs: vec![
            PathSeg::DynIndex("ri".into()),
            PathSeg::Ident("cells".into()),
            PathSeg::DynIndex("ci".into()),
            PathSeg::Ident("value".into()),
        ],
    });
    let path = b.from_dep_key(&key).unwrap();
    let c = b.finish();
    assert!(
        matches!(
            &path,
            IrDepPath::DynamicPath { steps, path: props, .. }
                if steps.len() == 2 && props.len() == 1
        ),
        "{path:?}"
    );
    assert_eq!(
        path.to_stable_string(&c.state_slots, &c.properties, &c.exprs),
        "rows[ri].cells[ci].value"
    );
    let deps = c.transitional_deps(&[path]);
    assert!(deps.iter().any(|d| d == "rows.*.cells.*.value"), "{deps:?}");
    assert!(deps.iter().any(|d| d == "ri"), "{deps:?}");
    assert!(deps.iter().any(|d| d == "ci"), "{deps:?}");
}
