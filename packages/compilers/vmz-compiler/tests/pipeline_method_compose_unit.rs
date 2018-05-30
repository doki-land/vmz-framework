//! Moved from `src/pipeline/method_compose.rs` (cargo-cry: tests next to Cargo.toml).

use oxc_span::Span;
use vmz_compiler::pipeline::method_compose::*;

fn method(name: &str, reads: &[&str], writes: &[&str], calls: &[&str]) -> MethodDecl {
    method_opaque(name, reads, writes, calls, false)
}

fn method_opaque(
    name: &str,
    reads: &[&str],
    writes: &[&str],
    calls: &[&str],
    opaque: bool,
) -> MethodDecl {
    MethodDecl {
        name: name.into(),
        is_async: false,
        is_static: false,
        is_private: name.starts_with('#'),
        http: None,
        reads: reads.iter().map(|s| (*s).to_string()).collect(),
        writes: writes.iter().map(|s| (*s).to_string()).collect(),
        calls: calls.iter().map(|s| (*s).to_string()).collect(),
        opaque_callee: opaque,
        star_reasons: Vec::new(),
        span: Span::default(),
    }
}

#[test]
fn composes_direct_callee_writes_into_caller() {
    let mut methods = vec![
        method("onClick", &[], &[], &["refresh"]),
        method("refresh", &[], &["user.name"], &[]),
    ];
    compose_cross_method_rw(&mut methods, &["user".into()]);
    assert!(methods[0].writes.iter().any(|w| w == "user.name"), "writes={:?}", methods[0].writes);
    assert_eq!(methods[0].calls, vec!["refresh".to_string()]);
    assert_eq!(methods[1].writes, vec!["user.name".to_string()]);
    assert!(!methods[0].opaque_callee);
}

#[test]
fn composes_transitive_chain() {
    let mut methods = vec![
        method("onClick", &[], &[], &["refresh"]),
        method("refresh", &[], &[], &["#load"]),
        method("#load", &["user.profile.name"], &["flags.ready"], &[]),
    ];
    compose_cross_method_rw(&mut methods, &["user".into(), "flags".into()]);
    let on_click = &methods[0];
    assert!(on_click.reads.iter().any(|r| r == "user.profile.name"), "reads={:?}", on_click.reads);
    assert!(on_click.writes.iter().any(|w| w == "flags.ready"), "writes={:?}", on_click.writes);
    let refresh = &methods[1];
    assert!(refresh.reads.iter().any(|r| r == "user.profile.name"));
    assert!(refresh.writes.iter().any(|w| w == "flags.ready"));
}

#[test]
fn composes_cycles_without_losing_paths() {
    let mut methods = vec![method("a", &["x"], &[], &["b"]), method("b", &[], &["y"], &["a"])];
    compose_cross_method_rw(&mut methods, &["x".into(), "y".into()]);
    assert!(methods[0].reads.iter().any(|r| r == "x"));
    assert!(methods[0].writes.iter().any(|w| w == "y"));
    assert!(methods[1].reads.iter().any(|r| r == "x"));
    assert!(methods[1].writes.iter().any(|w| w == "y"));
}

#[test]
fn idempotent() {
    let mut methods = vec![
        method("onClick", &[], &[], &["refresh"]),
        method("refresh", &["user"], &["user.name"], &[]),
    ];
    let fields = vec!["user".into()];
    compose_cross_method_rw(&mut methods, &fields);
    let once = methods.clone();
    compose_cross_method_rw(&mut methods, &fields);
    assert_eq!(methods, once);
}

#[test]
fn opaque_callee_widens_all_fields() {
    let mut methods = vec![method_opaque("run", &[], &[], &[], true)];
    compose_cross_method_rw(&mut methods, &["user".into(), "count".into()]);
    assert!(methods[0].reads.iter().any(|r| r == "user.*"));
    assert!(methods[0].reads.iter().any(|r| r == "count.*"));
    assert!(methods[0].writes.iter().any(|w| w == "user.*"));
    assert!(methods[0].writes.iter().any(|w| w == "count.*"));
}

#[test]
fn opaque_flag_propagates_to_caller_then_widens() {
    let mut methods = vec![
        method("onClick", &[], &[], &["run"]),
        method_opaque("run", &[], &["count"], &[], true),
    ];
    compose_cross_method_rw(&mut methods, &["user".into(), "count".into()]);
    assert!(methods[0].opaque_callee, "caller must inherit opaque");
    assert!(methods[0].reads.iter().any(|r| r == "user.*"));
    assert!(methods[0].writes.iter().any(|w| w == "user.*"));
    // Local precise write from callee still present on caller before/with stars.
    assert!(methods[0].writes.iter().any(|w| w == "count" || w == "count.*"));
}
