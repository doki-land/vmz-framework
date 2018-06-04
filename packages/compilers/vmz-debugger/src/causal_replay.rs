//! Runtime trace <-> Program Graph StableId causal replay.
//!
//! `explain write|update` from `*.program.json` edges; ingest/replay traces;
//! umbrella `check_causal_replay`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use vmz_protocol::{
    CAUSAL_REPLAY_CHECK_SCHEMA, CAUSAL_REPLAY_SCHEMA, CausalReplayCheckReport,
    CausalReplayCheckStatus, CausalReplayDocument, CausalReplayMatch, CausalReplayStatus,
    EXPLAIN_SCHEMA, ExplainDocument, ExplainEdge, ExplainEdgeRef, ExplainKind, ExplainProgramRef,
    ProgramEdgeKind, ProgramGraphEdge, ReportedDiagnostic, StableId, StableIdKind, TRACE_SCHEMA,
    TraceDocument, TraceEvent, TraceEventKind, TraceStatus,
};

/// One Program Graph edge loaded from `*.program.json`.
#[derive(Debug, Clone)]
pub struct GraphEdge {
    /// Closed edge kind (`reads` / `writes` / …).
    pub kind: ProgramEdgeKind,
    /// Source node token (e.g. `effect:increment`, `binding:0`, or a field path).
    pub from: String,
    /// Destination node token (often a field path such as `n`).
    pub to: String,
}

/// One deployment unit slice: chunk id, program path, and its graph edges.
#[derive(Debug, Clone)]
pub struct ProgramUnitView {
    /// Deployment chunk id (from `deployment.chunkId` or unit `name`).
    pub chunk_id: String,
    /// Path of the owning `*.program.json` file.
    pub path: PathBuf,
    /// Graph edges under this unit (`graph.edges`).
    pub edges: Vec<GraphEdge>,
}

/// Typed `*.program.json` loader slice (avoids `serde_json::Value` walks).
#[derive(Debug, Deserialize)]
struct ProgramFileWire {
    #[serde(default)]
    units: Vec<ProgramUnitWire>,
}

#[derive(Debug, Deserialize)]
struct ProgramUnitWire {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    deployment: Option<DeploymentWire>,
    #[serde(default)]
    graph: Option<GraphWire>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeploymentWire {
    #[serde(default)]
    chunk_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GraphWire {
    #[serde(default)]
    edges: Vec<ProgramGraphEdge>,
}

fn sid(kind: StableIdKind, id: impl Into<String>) -> StableId {
    StableId::new(kind, id)
}

fn parse_node(raw: &str) -> StableId {
    if let Some(rest) = raw.strip_prefix("binding:") {
        return sid(StableIdKind::Binding, rest);
    }
    if let Some(rest) = raw.strip_prefix("effect:") {
        return sid(StableIdKind::Effect, rest);
    }
    if let Some(rest) = raw.strip_prefix("capability:") {
        return sid(StableIdKind::Capability, rest);
    }
    if let Some(rest) = raw.strip_prefix("route:") {
        return sid(StableIdKind::RouteId, rest);
    }
    // Field / dep path token (e.g. `n`, `items.*.label`).
    sid(StableIdKind::Field, raw)
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
        let Ok(root) = serde_json::from_str::<ProgramFileWire>(&text) else {
            continue;
        };
        for unit in root.units {
            let chunk_id = unit
                .deployment
                .as_ref()
                .and_then(|d| d.chunk_id.clone())
                .or(unit.name)
                .unwrap_or_else(|| "?".into());
            let edges = unit
                .graph
                .map(|g| {
                    g.edges
                        .into_iter()
                        .map(|e| GraphEdge { kind: e.kind, from: e.from, to: e.to })
                        .collect()
                })
                .unwrap_or_default();
            out.push(ProgramUnitView { chunk_id, path: path.clone(), edges });
        }
    }
}

/// Build the typed explain chain for a field: `writes` edges first, then `reads`.
pub fn chain_for_field(unit: &ProgramUnitView, field: &str) -> Vec<ExplainEdge> {
    let mut chain = Vec::new();
    for e in &unit.edges {
        if e.kind == ProgramEdgeKind::Writes && e.to == field {
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
        if e.kind == ProgramEdgeKind::Reads && e.to == field {
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
        if e.kind == ProgramEdgeKind::Reads && e.from == node {
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
            if e.kind == ProgramEdgeKind::Writes && e.to == *field {
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
        u.edges.iter().any(|e| {
            (e.kind == ProgramEdgeKind::Writes || e.kind == ProgramEdgeKind::Reads) && e.to == field
        })
    })
}

fn find_unit_for_binding<'a>(
    units: &'a [ProgramUnitView],
    binding_id: &str,
) -> Option<&'a ProgramUnitView> {
    let node = format!("binding:{binding_id}");
    units
        .iter()
        .find(|u| u.edges.iter().any(|e| e.kind == ProgramEdgeKind::Reads && e.from == node))
}

fn find_unit_by_chunk<'a>(
    units: &'a [ProgramUnitView],
    chunk: &str,
) -> Option<&'a ProgramUnitView> {
    units.iter().find(|u| u.chunk_id == chunk || u.chunk_id.ends_with(chunk))
}

/// `write:<field>` or `write:<chunk>:<field>` -> explain chain from Program Graph.
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
            kind: ExplainKind::Write,
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
        kind: ExplainKind::Write,
        chunk_id: Some(unit.chunk_id.clone()),
        deployment_unit: None,
        program: Some(ExplainProgramRef {
            path: unit.path.display().to_string().replace('\\', "/"),
            edge_count: Some(unit.edges.len() as u64),
            binding_id: None,
        }),
        edge: None,
        session_generation: generation,
        contributions: vec![],
        chain,
        notes: Some("write -> effect -> field -> binding (Program Graph)".into()),
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
    // Field alias -> same as write chain, kind=update.
    let mut doc = explain_write(out_dir, spec, generation);
    doc.target = format!("update:{spec}");
    doc.kind = ExplainKind::Update;
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
            kind: ExplainKind::Update,
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
        kind: ExplainKind::Update,
        chunk_id: Some(unit.chunk_id.clone()),
        deployment_unit: None,
        program: Some(ExplainProgramRef {
            path: unit.path.display().to_string().replace('\\', "/"),
            edge_count: None,
            binding_id: Some(binding_id.to_string()),
        }),
        edge: Some(ExplainEdgeRef { selector: format!("binding:{binding_id}") }),
        session_generation: generation,
        contributions: vec![],
        chain,
        notes: Some("update BindingId <- field <- effect (Program Graph)".into()),
    }
}

fn allowed_stable_kind(kind: StableIdKind) -> bool {
    matches!(
        kind,
        StableIdKind::Binding
            | StableIdKind::Effect
            | StableIdKind::Field
            | StableIdKind::RouteId
            | StableIdKind::Capability
            | StableIdKind::Chunk
            | StableIdKind::Patch
    )
}

/// Validate / normalize an inbound trace JSON into `vmz.dx.trace.v0`.
pub fn ingest_runtime_trace(trace_json: &str) -> TraceDocument {
    // Prefer full document; fall back to bare TraceEvent[].
    if let Ok(doc) = serde_json::from_str::<TraceDocument>(trace_json) {
        let mut events = Vec::new();
        for (i, ev) in doc.events.into_iter().enumerate() {
            if !allowed_stable_kind(ev.stable_id.kind()) {
                return TraceDocument {
                    schema: TRACE_SCHEMA.into(),
                    events: vec![],
                    status: TraceStatus::Invalid,
                    notes: Some(format!(
                        "unsupported StableId.kind `{}` at {i}",
                        ev.stable_id.kind()
                    )),
                };
            }
            events.push(ev);
        }
        let status = if events.is_empty() { TraceStatus::Empty } else { TraceStatus::Ready };
        return TraceDocument { schema: TRACE_SCHEMA.into(), events, status, notes: doc.notes };
    }
    let Ok(arr) = serde_json::from_str::<Vec<TraceEvent>>(trace_json) else {
        return TraceDocument {
            schema: TRACE_SCHEMA.into(),
            events: vec![],
            status: TraceStatus::Invalid,
            notes: Some("expected TraceDocument or TraceEvent[]".into()),
        };
    };
    let mut events = Vec::new();
    for (i, ev) in arr.into_iter().enumerate() {
        if !allowed_stable_kind(ev.stable_id.kind()) {
            return TraceDocument {
                schema: TRACE_SCHEMA.into(),
                events: vec![],
                status: TraceStatus::Invalid,
                notes: Some(format!("unsupported StableId.kind `{}` at {i}", ev.stable_id.kind())),
            };
        }
        events.push(ev);
    }
    let status = if events.is_empty() { TraceStatus::Empty } else { TraceStatus::Ready };
    TraceDocument { schema: TRACE_SCHEMA.into(), events, status, notes: None }
}

fn chain_contains(chain: &[ExplainEdge], id: &StableId) -> bool {
    chain.iter().any(|e| e.from == *id || e.to == *id)
}

fn explain_for_event(out_dir: &Path, ev: &TraceEvent, generation: u64) -> ExplainDocument {
    // Match the StableId tagged union — do not branch on a separate `.kind` field.
    match &ev.stable_id {
        StableId::Binding(id) => {
            let chunk = ev.chunk_id.as_deref().unwrap_or("");
            let spec = if chunk.is_empty() {
                format!("binding:{id}")
            } else {
                format!("{chunk}#binding:{id}")
            };
            explain_update(out_dir, &spec, generation)
        }
        StableId::Field(id) => explain_write(out_dir, id, generation),
        StableId::Effect(id) => {
            // Resolve via field written by this effect.
            let units = load_program_units(out_dir);
            let node = format!("effect:{id}");
            if let Some(unit) = units.iter().find(|u| u.edges.iter().any(|e| e.from == node)) {
                if let Some(e) =
                    unit.edges.iter().find(|e| e.kind == ProgramEdgeKind::Writes && e.from == node)
                {
                    return explain_write(
                        out_dir,
                        &format!("{}:{}", unit.chunk_id, e.to),
                        generation,
                    );
                }
            }
            ExplainDocument {
                schema: EXPLAIN_SCHEMA.into(),
                target: format!("effect:{id}"),
                kind: ExplainKind::Update,
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
        other => ExplainDocument {
            schema: EXPLAIN_SCHEMA.into(),
            target: format!("{}:{}", other.kind(), other.id()),
            kind: ExplainKind::Update,
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
    if trace.status == TraceStatus::Invalid {
        return CausalReplayDocument {
            schema: CAUSAL_REPLAY_SCHEMA.into(),
            trace,
            matches: vec![],
            status: CausalReplayStatus::Failed,
            notes: Some("trace invalid".into()),
        };
    }
    if trace.events.is_empty() {
        return CausalReplayDocument {
            schema: CAUSAL_REPLAY_SCHEMA.into(),
            trace,
            matches: vec![],
            status: CausalReplayStatus::Empty,
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
        status: if all_ok { CausalReplayStatus::Ready } else { CausalReplayStatus::Failed },
        notes: None,
    }
}

/// Umbrella check over current deployment artifacts.
pub fn check_causal_replay(out_dir: &Path, generation: u64) -> CausalReplayCheckReport {
    let units = load_program_units(out_dir);
    let mut diagnostics = Vec::new();
    if units.is_empty() {
        diagnostics.push(ReportedDiagnostic::coded_advice(
            "",
            "no *.program.json - build workspace first",
            "dx.x5.program.empty",
        ));
        return CausalReplayCheckReport {
            schema: CAUSAL_REPLAY_CHECK_SCHEMA.into(),
            sample_explain: None,
            sample_replay: None,
            diagnostics,
            status: CausalReplayCheckStatus::Preview,
        };
    }

    // Prefer a unit that has both writes + reads on the same field.
    let mut sample_field: Option<(String, String)> = None;
    let mut sample_binding: Option<(String, String)> = None;
    for u in &units {
        for e in &u.edges {
            if e.kind == ProgramEdgeKind::Writes {
                sample_field = Some((u.chunk_id.clone(), e.to.clone()));
            }
            if e.kind == ProgramEdgeKind::Reads {
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
            kind: ExplainKind::Write,
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
            kind: TraceEventKind::Write,
            stable_id: sid(StableIdKind::Field, field.clone()),
            dep: Some(field.clone()),
            t: Some(1),
            chunk_id: Some(chunk.clone()),
        });
    }
    if let Some((chunk, id)) = &sample_binding {
        events.push(TraceEvent {
            kind: TraceEventKind::Patch,
            stable_id: sid(StableIdKind::Binding, id.clone()),
            dep: None,
            t: Some(2),
            chunk_id: Some(chunk.clone()),
        });
    }
    let trace = TraceDocument {
        schema: TRACE_SCHEMA.into(),
        events: events.clone(),
        status: if events.is_empty() { TraceStatus::Empty } else { TraceStatus::Ready },
        notes: Some("synthetic trace from Program Graph for causal_replay_check".into()),
    };
    let replay = replay_causal(out_dir, &trace.to_json(), generation);

    let status = if !explain.chain.is_empty() && replay.status == CausalReplayStatus::Ready {
        CausalReplayCheckStatus::Ready
    } else if explain.chain.is_empty() {
        diagnostics.push(ReportedDiagnostic::coded_warning(
            "",
            "sample write explain chain empty",
            "dx.x5.explain.empty",
        ));
        CausalReplayCheckStatus::Failed
    } else {
        diagnostics.push(ReportedDiagnostic::coded_warning(
            "",
            format!("causal replay status {}", replay.status.as_str()),
            "dx.x5.replay.failed",
        ));
        CausalReplayCheckStatus::Failed
    };

    CausalReplayCheckReport {
        schema: CAUSAL_REPLAY_CHECK_SCHEMA.into(),
        sample_explain: Some(explain),
        sample_replay: Some(replay),
        diagnostics,
        status,
    }
}
