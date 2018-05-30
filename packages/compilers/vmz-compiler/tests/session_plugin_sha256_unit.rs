//! Moved from `src/session/plugin.rs` sha256 nested tests (cargo-cry).

#[test]
fn empty_sha() {
    assert_eq!(
        vmz_compiler::session::plugin::sha256_hex_bytes(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}
