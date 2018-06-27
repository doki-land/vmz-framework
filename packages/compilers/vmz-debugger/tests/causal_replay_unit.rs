//! Moved from `src/causal_replay.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::PathBuf;

use vmz_debugger::causal_replay::*;
use vmz_protocol::{ProgramEdgeKind, StableIdKind, TraceStatus};

#[test]
fn ingest_rejects_bad_kind() {
    let doc = ingest_runtime_trace(r#"[{"kind":"write","stableId":{"kind":"bogus","id":"x"}}]"#);
    assert_eq!(doc.status, TraceStatus::Invalid);
}

#[test]
fn chain_for_field_orders_write_then_read() {
    let unit = ProgramUnitView {
        chunk_id: "components/Card".into(),
        path: PathBuf::from("x"),
        edges: vec![
            GraphEdge { kind: ProgramEdgeKind::Reads, from: "binding:0".into(), to: "n".into() },
            GraphEdge {
                kind: ProgramEdgeKind::Writes,
                from: "effect:increment".into(),
                to: "n".into(),
            },
        ],
    };
    let chain = chain_for_field(&unit, "n");
    assert_eq!(chain.len(), 2);
    assert_eq!(chain[0].from.kind(), StableIdKind::Effect);
    assert_eq!(chain[1].to.kind(), StableIdKind::Binding);
}
