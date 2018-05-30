//! Moved from `src/dep_key.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_types::*;

#[test]
fn stable_strings() {
    let k = DepKey::path(DepPath::prop("user", "name"));
    assert_eq!(k.to_stable_string(), "user.name");
    assert_eq!(DepKey::FieldStar("user".into()).to_stable_string(), "user.*");
}

#[test]
fn path_write_does_not_wake_sibling() {
    let name = DepKey::path(DepPath::prop("user", "name"));
    let id = DepKey::path(DepPath::prop("user", "id"));
    let notice =
        WriteNotice::Path { root: "user".into(), segs: vec![PathSeg::Ident("name".into())] };
    assert!(notice.matches(&name));
    assert!(!notice.matches(&id));
}

#[test]
fn path_write_does_not_wake_field_root() {
    let field = DepKey::field("tags");
    let star = DepKey::FieldStar("tags".into());
    let notice = WriteNotice::Path {
        root: "tags".into(),
        segs: vec![PathSeg::Ident("0".into()), PathSeg::Ident("label".into())],
    };
    assert!(!notice.matches(&field));
    assert!(notice.matches(&star));
}

#[test]
fn replace_wakes_all_under_root() {
    let name = DepKey::path(DepPath::prop("user", "name"));
    let notice = WriteNotice::Replace { root: "user".into() };
    assert!(notice.matches(&name));
    assert!(notice.matches(&DepKey::field("user")));
}
