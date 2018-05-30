//! Moved from `src/pipeline/server_calls.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::pipeline::server_calls::*;

#[test]
fn finds_onmount_fetch_user() {
    let src = r#"
export default class UserCard {
  async onMount() {
    this.user = await UserCardServer.fetchUser();
  }
  other() {}
}
"#;
    let calls = collect_server_class_calls(src, "UserCardServer");
    assert!(
        calls.iter().any(|c| {
            c.server_method == "fetchUser" && c.from_client_method.as_deref() == Some("onMount")
        }),
        "{calls:?}"
    );
}
