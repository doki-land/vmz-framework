//! Cross-method effect summary composition.
//!
//! When method A calls sibling B (`this.b` / `this.#b`), union B's reads/writes
//! into A's summary (transitively, fixed-point). Call edges stay on `MethodDecl.calls`
//! for diagnostics; summaries must not silently miss callees already on the graph.
//!
//! Conservative widen:
//! - cycles ?monotonic fixed-point (no silent miss)
//! - `opaque_callee` (dynamic `this[k]`, or unresolved `this.foo`) ?`field.*` on
//! every component field for both reads and writes; flag propagates through the
//! call graph so callers also widen

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
