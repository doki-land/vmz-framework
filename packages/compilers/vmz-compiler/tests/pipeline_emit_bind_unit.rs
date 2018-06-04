//! Moved from `src/pipeline/emit.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::bind_field_idents;

#[test]
fn each_alias_member_keeps_property_name() {
    let fields = vec!["value".into(), "label".into(), "options".into()];
    let scope = vec!["opt".into()];
    let aliases = vec![("opt".into(), "box1.item".into())];
    assert_eq!(bind_field_idents("opt.value", &fields, &scope, &aliases), "box1.item.value");
    assert_eq!(bind_field_idents("opt.label", &fields, &scope, &aliases), "box1.item.label");
    assert_eq!(
        bind_field_idents("value === opt.value", &fields, &scope, &aliases),
        "this.value === box1.item.value"
    );
}

#[test]
fn string_literals_keep_field_name_substrings() {
    let fields = vec!["open".into(), "mono".into()];
    assert_eq!(
        bind_field_idents(
            "'chrome-select' + (open ? ' is-open' : '') + (mono ? ' is-mono' : '')",
            &fields,
            &[],
            &[]
        ),
        "'chrome-select' + (this.open ? ' is-open' : '') + (this.mono ? ' is-mono' : '')"
    );
}
