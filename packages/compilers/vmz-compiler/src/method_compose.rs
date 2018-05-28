//! Cross-method effect summary composition.
//!
//! When method A calls sibling B (`this.b()` / `this.#b()`), union B's reads/writes
//! into A's summary (transitively, fixed-point). Call edges stay on `MethodDecl.calls`
//! for diagnostics; summaries must not silently miss callees already on the graph.
//!
//! Conservative widen:
//! - cycles ?monotonic fixed-point (no silent miss)
//! - `opaque_callee` (dynamic `this[k]()`, or unresolved `this.foo`) ?`field.*` on
//!   every component field for both reads and writes; flag propagates through the
//!   call graph so callers also widen

use std::collections::HashMap;

use vmz_types::MethodDecl;

/// Merge callee reads/writes / opaque flags into callers via the class-local call graph,
/// then widen any method that (directly or transitively) has an opaque callee.
///
/// Idempotent. Cycles are handled by monotonic set growth until a fixed point.
pub fn compose_cross_method_rw(methods: &mut [MethodDecl], fields: &[String]) {
    if methods.is_empty() {
        return;
    }

    let name_to_idx: HashMap<String, usize> =
        methods.iter().enumerate().map(|(i, m)| (m.name.clone(), i)).collect();

    let callees: Vec<Vec<usize>> = methods
        .iter()
        .map(|m| m.calls.iter().filter_map(|c| name_to_idx.get(c).copied()).collect())
        .collect();
    drop(name_to_idx);

    // Bound iterations: each pass can only add paths / set opaque; stop when stable.
    let max_iters = methods.len().saturating_mul(2).max(1);
    for _ in 0..max_iters {
        let mut changed = false;
        for i in 0..methods.len() {
            for &j in &callees[i] {
                if i == j {
                    continue;
                }
                let (reads, writes, opaque, reasons) = {
                    let callee = &methods[j];
                    (
                        callee.reads.clone(),
                        callee.writes.clone(),
                        callee.opaque_callee,
                        callee.star_reasons.clone(),
                    )
                };
                let caller = &mut methods[i];
                if opaque && !caller.opaque_callee {
                    caller.opaque_callee = true;
                    changed = true;
                }
                for r in reads {
                    if !caller.reads.iter().any(|x| x == &r) {
                        caller.reads.push(r);
                        changed = true;
                    }
                }
                for w in writes {
                    if !caller.writes.iter().any(|x| x == &w) {
                        caller.writes.push(w);
                        changed = true;
                    }
                }
                for (f, reason) in reasons {
                    if !caller.star_reasons.iter().any(|(n, _)| n == &f) {
                        caller.star_reasons.push((f, reason));
                        changed = true;
                    }
                }
            }
        }
        if !changed {
            break;
        }
    }

    for m in methods.iter_mut() {
        if m.opaque_callee {
            widen_all_field_stars(m, fields);
        }
    }
}

/// Mark every component field as `field.*` on both reads and writes (Unknown-class deps).
fn widen_all_field_stars(method: &mut MethodDecl, fields: &[String]) {
    for f in fields {
        let star = format!("{f}.*");
        if !method.reads.iter().any(|r| r == &star) {
            method.reads.push(star.clone());
        }
        if !method.writes.iter().any(|w| w == &star) {
            method.writes.push(star);
        }
        if !method.star_reasons.iter().any(|(n, _)| n == f) {
            method.star_reasons.push((f.clone(), "opaque_callee".into()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use oxc_span::Span;

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
        assert!(
            methods[0].writes.iter().any(|w| w == "user.name"),
            "writes={:?}",
            methods[0].writes
        );
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
        assert!(
            on_click.reads.iter().any(|r| r == "user.profile.name"),
            "reads={:?}",
            on_click.reads
        );
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
}
