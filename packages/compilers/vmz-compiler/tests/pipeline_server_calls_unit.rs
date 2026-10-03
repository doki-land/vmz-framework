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

#[test]
fn preserves_method_context_for_static_server_calls_and_deduplicates() {
    let src = r#"
export default class UserCard {
  onMount() {
    UserCardServer.fetchUser();
    UserCardServer.fetchUser();
  }
  refresh() {
    return UserCardServer.refresh();
  }
}
UserCardServer.bootstrap();
"#;
    let calls = collect_server_class_calls(src, "UserCardServer");
    assert_eq!(calls.len(), 3, "{calls:?}");
    assert!(calls.iter().any(|call| {
        call.server_method == "fetchUser" && call.from_client_method.as_deref() == Some("onMount")
    }));
    assert!(calls.iter().any(|call| {
        call.server_method == "refresh" && call.from_client_method.as_deref() == Some("refresh")
    }));
    assert!(
        calls
            .iter()
            .any(|call| { call.server_method == "bootstrap" && call.from_client_method.is_none() })
    );
}

#[test]
fn restores_nested_class_context_and_keeps_callback_provenance() {
    let source = r#"
class Client {
  field = Server.initialize();
  outer() {
    class Nested {
      inner() { Server.nested(); }
    }
    const callback = () => Server.callback();
    function helper() { Server.helper(); }
    Server.afterNested();
  }
  static next() { Server.next(); }
}
Server.outside();
"#;
    let calls = collect_server_class_calls(source, "Server");
    let actual: Vec<_> = calls
        .iter()
        .map(|call| (call.server_method.as_str(), call.from_client_method.as_deref()))
        .collect();
    assert_eq!(
        actual,
        vec![
            ("initialize", None),
            ("nested", Some("inner")),
            ("callback", Some("outer")),
            ("helper", Some("outer")),
            ("afterNested", Some("outer")),
            ("next", Some("next")),
            ("outside", None),
        ]
    );
}
