//! Runtime trace ↔ Program Graph StableId causal replay.
//!
//! `explain write|update` from `*.program.json` edges; ingest/replay traces;
//! umbrella `check_causal_replay`.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use vmz_protocol::{
    CAUSAL_REPLAY_CHECK_SCHEMA, CAUSAL_REPLAY_SCHEMA, CausalReplayCheckReport,
    CausalReplayDocument, CausalReplayMatch, DxDiagnostic, EXPLAIN_SCHEMA, ExplainDocument,
    ExplainEdge, StableId, TRACE_SCHEMA, TraceDocument, TraceEvent,
};

#[derive(Debug, Clone)]
pub struct GraphEdge {
    pub kind: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct ProgramUnitView {
    pub chunk_id: String,
    pub path: PathBuf,
    pub edges: Vec<GraphEdge>,
}

fn sid(kind: &str, id: impl Into<String>) -> StableId {
    StableId { kind: kind.into(), id: id.into() }
}

fn parse_node(raw: &str) -> StableId {
    if let Some(rest) = raw.strip_prefix("binding:") {
        return sid("binding", rest);
    }
    if let Some(rest) = raw.strip_prefix("effect:") {
        return sid("effect", rest);
    }
    if let Some(rest) = raw.strip_prefix("capability:") {
        return sid("capability", rest);
    }
    if let Some(rest) = raw.strip_prefix("route:") {
        return sid("route_id", rest);
    }
    // Field / dep path token (e.g. `n`, `items.*.label`).
    sid("field", raw)
}

fn load_program_units(out_dir: &Path) -> Vec<ProgramUnitView> {
    let mut out = Vec::new();
    walk_programs(out_dir, &mut out);
    out.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));
    out
}

fn walk_programs(dir: &Path, out: &mut Vec<ProgramUnitView>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for ent in entries.flatten() {
        let path = ent.path();
        if path.is_dir() {
            walk_programs(&path, out);
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !name.ends_with(".program.json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(root) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let Some(units) = root.get("units").and_then(|v| v.as_array()) else {
            continue;
        };
        for unit in units {
            let chunk_id = unit
                .pointer("/deployment/chunkId")
                .and_then(|v| v.as_str())
                .or_else(|| unit.get("name").and_then(|v| v.as_str()))
                .unwrap_or("?")
                .to_string();
            let mut edges = Vec::new();
            if let Some(arr) = unit.pointer("/graph/edges").and_then(|v| v.as_array()) {
                for e in arr {
                    let Some(kind) = e.get("kind").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let Some(from) = e.get("from").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let Some(to) = e.get("to").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    edges.push(GraphEdge { kind: kind.into(), from: from.into(), to: to.into() });
                }
            }
            out.push(ProgramUnitView { chunk_id, path: path.clone(), edges });
        }
    }
}

pub fn chain_for_field(unit: &ProgramUnitView, field: &str) -> Vec<ExplainEdge> {
    let mut chain = Vec::new();
    for e in &unit.edges {
        if e.kind == "writes" && e.to == field {
            chain.push(ExplainEdge {
                from: parse_node(&e.from),
                to: parse_node(&e.to),
                reason: "writes".into(),
                precision: Some("exact".into()),
                span: None,
            });
        }
    }
    for e in &unit.edges {
        if e.kind == "reads" && e.to == field {
            chain.push(ExplainEdge {
                from: parse_node(&e.to),
                to: parse_node(&e.from),
                reason: "reads".into(),
                precision: Some("exact".into()),
                span: None,
            });
        }
    }
    chain
}

fn chain_for_binding(unit: &ProgramUnitView, binding_id: &str) -> Vec<ExplainEdge> {
    let node = format!("binding:{binding_id}");
    let mut fields = Vec::new();
    let mut chain = Vec::new();
    for e in &unit.edges {
        if e.kind == "reads" && e.from == node {
            fields.push(e.to.clone());
            chain.push(ExplainEdge {
                from: parse_node(&e.to),
                to: parse_node(&e.from),
                reason: "reads".into(),
                precision: Some("exact".into()),
                span: None,
            });
        }
    }
    for field in &fields {
        for e in &unit.edges {
            if e.kind == "writes" && e.to == *field {
                chain.insert(
                    0,
                    ExplainEdge {
                        from: parse_node(&e.from),
                        to: parse_node(&e.to),
                        reason: "writes".into(),
                        precision: Some("exact".into()),
                        span: None,
                    },
                );
            }
        }
    }
    chain
}

fn find_unit_for_field<'a>(
    units: &'a [ProgramUnitView],
    field: &str,
) -> Option<&'a ProgramUnitView> {
    units.iter().find(|u| {
        u.edges.iter().any(|e| (e.kind == "writes" || e.kind == "reads") && e.to == field)
    })
}

fn find_unit_for_binding<'a>(
    units: &'a [ProgramUnitView],
    binding_id: &str,
) -> Option<&'a ProgramUnitView> {
    let node = format!("binding:{binding_id}");
    units.iter().find(|u| u.edges.iter().any(|e| e.kind == "reads" && e.from == node))
}

fn find_unit_by_chunk<'a>(
    units: &'a [ProgramUnitView],
    chunk: &str,
) -> Option<&'a ProgramUnitView> {
    units.iter().find(|u| u.chunk_id == chunk || u.chunk_id.ends_with(chunk))
}

/// `write:<field>` or `write:<chunk>:<field>` → explain chain from Program Graph.
pub fn explain_write(out_dir: &Path, spec: &str, generation: u64) -> ExplainDocument {
    let units = load_program_units(out_dir);
    let (chunk_hint, field) = match spec.rsplit_once(':') {
        Some((chunk, field)) if !field.is_empty() && chunk.contains('/') => (Some(chunk), field),
        _ => (None, spec),
    };
    let unit = chunk_hint
        .and_then(|c| find_unit_by_chunk(&units, c))
        .or_else(|| find_unit_for_field(&units, field));
    let Some(unit) = unit else {
        return ExplainDocument {
            schema: EXPLAIN_SCHEMA.into(),
            target: format!("write:{spec}"),
            kind: "write".into(),
            chunk_id: None,
            deployment_unit: None,
            program: None,
            edge: None,
            session_generation: generation,
            contributions: vec![],
            chain: vec![],
            notes: Some(format!("no program graph edge for field `{field}`")),
        };
    };
    let chain = chain_for_field(unit, field);
    ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target: format!("write:{spec}"),
        kind: "write".into(),
        chunk_id: Some(unit.chunk_id.clone()),
        deployment_unit: None,
        program: Some(serde_json::json!({
            "path": unit.path.display().to_string().replace('\\', "/"),
            "edgeCount": unit.edges.len(),
        })),
        edge: None,
        session_generation: generation,
        contributions: vec![],
        chain,
        notes: Some(" write → effect → field → binding (Program Graph)".into()),
    }
}

/// `update:<chunk>#binding:<id>` | `update:binding:<id>` | `update:<field>`.
pub fn explain_update(out_dir: &Path, spec: &str, generation: u64) -> ExplainDocument {
    let units = load_program_units(out_dir);
    if let Some((chunk, rest)) = spec.split_once('#') {
        if let Some(id) = rest.strip_prefix("binding:") {
            let unit =
                find_unit_by_chunk(&units, chunk).or_else(|| find_unit_for_binding(&units, id));
            return explain_binding_doc(unit, id, format!("update:{spec}"), generation);
        }
    }
    if let Some(id) = spec.strip_prefix("binding:") {
        let unit = find_unit_for_binding(&units, id);
        return explain_binding_doc(unit, id, format!("update:{spec}"), generation);
    }
    // Field alias → same as write chain, kind=update.
    let mut doc = explain_write(out_dir, spec, generation);
    doc.target = format!("update:{spec}");
    doc.kind = "update".into();
    doc
}

fn explain_binding_doc(
    unit: Option<&ProgramUnitView>,
    binding_id: &str,
    target: String,
    generation: u64,
) -> ExplainDocument {
    let Some(unit) = unit else {
        return ExplainDocument {
            schema: EXPLAIN_SCHEMA.into(),
            target,
            kind: "update".into(),
            chunk_id: None,
            deployment_unit: None,
            program: None,
            edge: None,
            session_generation: generation,
            contributions: vec![],
            chain: vec![],
            notes: Some(format!("no reads edge for binding:{binding_id}")),
        };
    };
    let chain = chain_for_binding(unit, binding_id);
    ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target,
        kind: "update".into(),
        chunk_id: Some(unit.chunk_id.clone()),
        deployment_unit: None,
        program: Some(serde_json::json!({
            "path": unit.path.display().to_string().replace('\\', "/"),
            "bindingId": binding_id,
        })),
        edge: Some(serde_json::json!({ "selector": format!("binding:{binding_id}") })),
        session_generation: generation,
        contributions: vec![],
        chain,
        notes: Some(" update BindingId ← field ← effect (Program Graph)".into()),
    }
}

fn allowed_stable_kind(kind: &str) -> bool {
    matches!(kind, "binding" | "effect" | "field" | "route_id" | "capability" | "chunk" | "patch")
}

/// Validate / normalize an inbound trace JSON into `vmz.dx.trace.v0`.
pub fn ingest_runtime_trace(trace_json: &str) -> TraceDocument {
    let Ok(v) = serde_json::from_str::<Value>(trace_json) else {
        return TraceDocument {
            schema: TRACE_SCHEMA.into(),
            events: vec![],
            status: "invalid".into(),
            notes: Some("invalid JSON".into()),
        };
    };
    let events_val = if v.get("schema").and_then(|s| s.as_str()) == Some(TRACE_SCHEMA) {
        v.get("events").cloned().unwrap_or(Value::Array(vec![]))
    } else if let Some(arr) = v.as_array() {
        Value::Array(arr.clone())
    } else if let Some(arr) = v.get("events").and_then(|e| e.as_array()) {
        Value::Array(arr.clone())
    } else {
        return TraceDocument {
            schema: TRACE_SCHEMA.into(),
            events: vec![],
            status: "invalid".into(),
            notes: Some("expected TraceDocument or TraceEvent[]".into()),
        };
    };
    let Some(arr) = events_val.as_array() else {
        return TraceDocument::empty("events must be array");
    };
    let mut events = Vec::new();
    for (i, item) in arr.iter().enumerate() {
        let Ok(mut ev) = serde_json::from_value::<TraceEvent>(item.clone()) else {
            return TraceDocument {
                schema: TRACE_SCHEMA.into(),
                events: vec![],
                status: "invalid".into(),
                notes: Some(format!("bad TraceEvent at {i}")),
            };
        };
        if !allowed_stable_kind(&ev.stable_id.kind) {
            return TraceDocument {
                schema: TRACE_SCHEMA.into(),
                events: vec![],
                status: "invalid".into(),
                notes: Some(format!("unsupported StableId.kind `{}` at {i}", ev.stable_id.kind)),
            };
        }
        if ev.kind.is_empty() {
            ev.kind = "event".into();
        }
        events.push(ev);
    }
    let status = if events.is_empty() { "empty" } else { "ready" };
    TraceDocument { schema: TRACE_SCHEMA.into(), events, status: status.into(), notes: None }
}

fn chain_contains(chain: &[ExplainEdge], id: &StableId) -> bool {
    chain.iter().any(|e| e.from == *id || e.to == *id)
}

fn explain_for_event(out_dir: &Path, ev: &TraceEvent, generation: u64) -> ExplainDocument {
    match ev.stable_id.kind.as_str() {
        "binding" => {
            let chunk = ev.chunk_id.as_deref().unwrap_or("");
            let spec = if chunk.is_empty() {
                format!("binding:{}", ev.stable_id.id)
            } else {
                format!("{chunk}#binding:{}", ev.stable_id.id)
            };
            explain_update(out_dir, &spec, generation)
        }
        "field" => explain_write(out_dir, &ev.stable_id.id, generation),
        "effect" => {
            // Resolve via field written by this effect.
            let units = load_program_units(out_dir);
            let node = format!("effect:{}", ev.stable_id.id);
            if let Some(unit) = units.iter().find(|u| u.edges.iter().any(|e| e.from == node)) {
                if let Some(e) = unit.edges.iter().find(|e| e.kind == "writes" && e.from == node) {
                    return explain_write(
                        out_dir,
                        &format!("{}:{}", unit.chunk_id, e.to),
                        generation,
                    );
                }
            }
            ExplainDocument {
                schema: EXPLAIN_SCHEMA.into(),
                target: format!("effect:{}", ev.stable_id.id),
                kind: "update".into(),
                chunk_id: ev.chunk_id.clone(),
                deployment_unit: None,
                program: None,
                edge: None,
                session_generation: generation,
                contributions: vec![],
                chain: vec![],
                notes: Some("effect has no writes edge".into()),
            }
        }
        _ => ExplainDocument {
            schema: EXPLAIN_SCHEMA.into(),
            target: format!("{}:{}", ev.stable_id.kind, ev.stable_id.id),
            kind: "update".into(),
            chunk_id: ev.chunk_id.clone(),
            deployment_unit: None,
            program: None,
            edge: None,
            session_generation: generation,
            contributions: vec![],
            chain: vec![],
            notes: Some("first-slice replay covers write/binding/effect only".into()),
        },
    }
}

/// Join trace events to explain chains; require StableId membership.
pub fn replay_causal(out_dir: &Path, trace_json: &str, generation: u64) -> CausalReplayDocument {
    let trace = ingest_runtime_trace(trace_json);
    if trace.status == "invalid" {
        return CausalReplayDocument {
            schema: CAUSAL_REPLAY_SCHEMA.into(),
            trace,
            matches: vec![],
            status: "failed".into(),
            notes: Some("trace invalid".into()),
        };
    }
    if trace.events.is_empty() {
        return CausalReplayDocument {
            schema: CAUSAL_REPLAY_SCHEMA.into(),
            trace,
            matches: vec![],
            status: "empty".into(),
            notes: Some("no events".into()),
        };
    }
    let mut matches = Vec::new();
    let mut all_ok = true;
    for (i, ev) in trace.events.iter().enumerate() {
        let explain = explain_for_event(out_dir, ev, generation);
        let in_chain = !explain.chain.is_empty() && chain_contains(&explain.chain, &ev.stable_id);
        if !in_chain {
            all_ok = false;
        }
        matches.push(CausalReplayMatch {
            event_index: i as u32,
            stable_id: ev.stable_id.clone(),
            in_chain,
            explain: Some(explain),
        });
    }
    CausalReplayDocument {
        schema: CAUSAL_REPLAY_SCHEMA.into(),
        trace,
        matches,
        status: if all_ok { "ready".into() } else { "failed".into() },
        notes: None,
    }
}

/// Umbrella check over current deployment artifacts.
pub fn check_causal_replay(out_dir: &Path, generation: u64) -> CausalReplayCheckReport {
    let units = load_program_units(out_dir);
    let mut diagnostics = Vec::new();
    if units.is_empty() {
        diagnostics.push(DxDiagnostic {
            path: String::new(),
            severity: "info".into(),
            message: "no *.program.json — build workspace first".into(),
            code: Some("dx.x5.program.empty".into()),
            span: None,
        });
        return CausalReplayCheckReport {
            schema: CAUSAL_REPLAY_CHECK_SCHEMA.into(),
            sample_explain: None,
            sample_replay: None,
            diagnostics,
            status: "preview".into(),
        };
    }

    // Prefer a unit that has both writes + reads on the same field.
    let mut sample_field: Option<(String, String)> = None;
    let mut sample_binding: Option<(String, String)> = None;
    for u in &units {
        for e in &u.edges {
            if e.kind == "writes" {
                sample_field = Some((u.chunk_id.clone(), e.to.clone()));
            }
            if e.kind == "reads" {
                if let Some(id) = e.from.strip_prefix("binding:") {
                    sample_binding = Some((u.chunk_id.clone(), id.to_string()));
                }
            }
        }
        if sample_field.is_some() && sample_binding.is_some() {
            break;
        }
    }

    let explain = if let Some((chunk, field)) = &sample_field {
        explain_write(out_dir, &format!("{chunk}:{field}"), generation)
    } else {
        ExplainDocument {
            schema: EXPLAIN_SCHEMA.into(),
            target: "write:?".into(),
            kind: "write".into(),
            chunk_id: None,
            deployment_unit: None,
            program: None,
            edge: None,
            session_generation: generation,
            contributions: vec![],
            chain: vec![],
            notes: Some("no writes edge in deployment programs".into()),
        }
    };

    let mut events = Vec::new();
    if let Some((chunk, field)) = &sample_field {
        events.push(TraceEvent {
            kind: "write".into(),
            stable_id: sid("field", field.clone()),
            dep: Some(field.clone()),
            t: Some(1),
            chunk_id: Some(chunk.clone()),
        });
    }
    if let Some((chunk, id)) = &sample_binding {
        events.push(TraceEvent {
            kind: "patch".into(),
            stable_id: sid("binding", id.clone()),
            dep: None,
            t: Some(2),
            chunk_id: Some(chunk.clone()),
        });
    }
    let trace = TraceDocument {
        schema: TRACE_SCHEMA.into(),
        events: events.clone(),
        status: if events.is_empty() { "empty".into() } else { "ready".into() },
        notes: Some("synthetic trace from Program Graph for causal_replay_check".into()),
    };
    let replay = replay_causal(out_dir, &trace.to_json(), generation);

    let status = if !explain.chain.is_empty() && replay.status == "ready" {
        "ready"
    } else if explain.chain.is_empty() {
        diagnostics.push(DxDiagnostic {
            path: String::new(),
            severity: "warning".into(),
            message: "sample write explain chain empty".into(),
            code: Some("dx.x5.explain.empty".into()),
            span: None,
        });
        "failed"
    } else {
        diagnostics.push(DxDiagnostic {
            path: String::new(),
            severity: "warning".into(),
            message: format!("causal replay status {}", replay.status),
            code: Some("dx.x5.replay.failed".into()),
            span: None,
        });
        "failed"
    };

    CausalReplayCheckReport {
        schema: CAUSAL_REPLAY_CHECK_SCHEMA.into(),
        sample_explain: Some(explain),
        sample_replay: Some(replay),
        diagnostics,
        status: status.into(),
    }
}
