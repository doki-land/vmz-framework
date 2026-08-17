//! BindingId minimal patch + event table (TemplateSurface).
//!
//! Extends the static template slice: wire `@click`/`on*` to stable handler ids,
//! publish `event_table` + `data_patch_table` from Reactive effect writes →
//! affected BindingIds. Adapter applies `setData({ "b.B_<id>": … })` only —
//! never re-derives affected bindings from field names.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, MiniProgramArtifact, MINI_PROGRAM_ARTIFACT_SCHEMA,
    PLAN_SCHEMA, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{
    BindingKind, IrDepPath, ProgramModule, ProgramUnit, ReactiveComponent, ViewStatus, ViewView,
};
use vmz_generator::MiniTemplateProfile;

use super::static_slice::{MINI_LOGIC_SCHEMA, MINI_TEMPLATE_DIALECT};

/// Report schema for binding/event lowering.
pub const MINI_BINDING_EVENT_REPORT_SCHEMA: &str = "vmz.target.mini_binding_event.v0";

/// Event table fragment schema inside [`MiniProgramArtifact::event_table`].
pub const MINI_EVENT_TABLE_SCHEMA: &str = "vmz.mini.event_table.v0";

/// Data-patch table fragment schema inside [`MiniProgramArtifact::data_patch_table`].
pub const MINI_DATA_PATCH_TABLE_SCHEMA: &str = "vmz.mini.data_patch_table.v0";

/// One successfully lowered page with binding/event tables.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniBindingEventUnitResult {
    /// Deployment chunk id (posix-style).
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered Mini Program artifact envelope.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated binding/event lowering report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniBindingEventReport {
    /// Always [`MINI_BINDING_EVENT_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id.
    pub dialect: String,
    /// Successfully written page artifacts.
    pub artifacts: Vec<MiniBindingEventUnitResult>,
    /// Diagnostics collected during lowering.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniBindingEventReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

fn diag(
    path: &str,
    severity: Severity,
    message: impl Into<String>,
    code: &str,
) -> TargetDiagnostic {
    TargetDiagnostic::with_severity(path, severity, message).with_code(code)
}

/// Lower Native View + Reactive into template/logic/event/data-patch tables.
pub fn lower_unit_binding_event(
    platform_id: &str,
    unit: &ProgramUnit,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    lower_view_binding_event(platform_id, &unit.view, &unit.reactive, path_for_diag)
}

/// Lower view + reactive (unit-test / gate entry).
pub fn lower_view_binding_event(
    platform_id: &str,
    view: &ViewView,
    reactive: &ReactiveComponent,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let mut diagnostics = Vec::new();
    if view.status != ViewStatus::Native {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "binding/event slice requires Native View",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }
    if view.roots.is_empty() {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "binding/event slice: empty view roots",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    let emit = match vmz_generator::emit_mini_template_profile(
        &view.roots,
        MiniTemplateProfile::BindingEvent,
        Some(reactive),
    ) {
        Ok(e) => e,
        Err(errs) => return Err(crate::miniprogram::map_mini_emit_errors(path_for_diag, errs)),
    };

    let mut b_obj = serde_json::Map::new();
    for id in emit.patch_bindings.keys() {
        b_obj.insert(format!("B_{id}"), Value::String(String::new()));
    }
    let logic = json!({
        "schema": MINI_LOGIC_SCHEMA,
        "initialData": { "b": b_obj },
    });

    let data_patch = build_data_patch_table(reactive, &emit.patch_bindings);
    let event_table = json!({
        "schema": MINI_EVENT_TABLE_SCHEMA,
        "handlers": emit.handlers,
    });

    let artifact = MiniProgramArtifact {
        schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
        platform_id: platform_id.into(),
        template: Some(emit.template),
        style: None,
        logic: Some(crate::miniprogram::compact_json(&logic)),
        event_table: Some(crate::miniprogram::compact_json(&event_table)),
        data_patch_table: Some(crate::miniprogram::compact_json(&data_patch)),
        manifest: None,
        plan_schema: PLAN_SCHEMA.into(),
    };
    Ok((artifact, diagnostics))
}

fn build_data_patch_table(
    reactive: &ReactiveComponent,
    patch_bindings: &BTreeMap<u32, ()>,
) -> Value {
    let mut bindings_out = Vec::new();
    let mut field_affects: BTreeMap<u32, BTreeSet<u32>> = BTreeMap::new();

    for b in &reactive.bindings {
        if !patch_bindings.contains_key(&b.id().0) {
            continue;
        }
        if b.kind() == BindingKind::Event {
            continue;
        }
        let reads: Vec<u32> = b.reads().iter().filter_map(field_root_id).collect();
        for f in &reads {
            field_affects.entry(*f).or_default().insert(b.id().0);
        }
        bindings_out.push(json!({
            "bindingId": b.id().0,
            "kind": b.kind().as_str(),
            "dataPath": format!("b.B_{}", b.id().0),
            "reads": reads,
        }));
    }

    let fields: Vec<Value> = field_affects
        .into_iter()
        .map(|(field_id, affects)| {
            let name = reactive
                .state_slots
                .iter()
                .find(|s| s.id.0 == field_id)
                .map(|s| s.name.clone())
                .unwrap_or_default();
            json!({
                "fieldId": field_id,
                "name": name,
                "affects": affects.into_iter().collect::<Vec<_>>(),
            })
        })
        .collect();

    json!({
        "schema": MINI_DATA_PATCH_TABLE_SCHEMA,
        "bindings": bindings_out,
        "fields": fields,
    })
}

fn field_root_id(path: &IrDepPath) -> Option<u32> {
    match path {
        IrDepPath::Field(f) | IrDepPath::Unknown(f) => Some(f.0),
        IrDepPath::StaticPath { root, .. } | IrDepPath::DynamicPath { root, .. } => Some(root.0),
        IrDepPath::ListItem { list, .. } => Some(list.0),
    }
}

fn collect_program_json(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let candidates = [root.join("dist"), root.to_path_buf()];
    for search in &candidates {
        if !search.exists() {
            continue;
        }
        for entry in WalkDir::new(search).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if p.is_file() && name.ends_with(".program.json") {
                out.push(p.to_path_buf());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Lower all **page** units with binding/event tables; write `_vmz/mini/*.mini.json`.
pub fn lower_miniprogram_binding_event_slices(root: &Path) -> MiniBindingEventReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini binding/event slice",
            "vmz::target::mini_binding_event_catalog_only",
        ));
        return MiniBindingEventReport {
            schema: MINI_BINDING_EVENT_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Incomplete,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            artifacts,
            diagnostics,
        };
    }

    let out_mini = root.join("dist").join("_vmz").join("mini");
    let _ = fs::create_dir_all(&out_mini);

    for prog_path in &programs {
        let rel =
            prog_path.strip_prefix(root).unwrap_or(prog_path).to_string_lossy().replace('\\', "/");
        let text = match fs::read_to_string(prog_path) {
            Ok(t) => t,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("read program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        let module: ProgramModule = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("parse program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        for unit in &module.units {
            let is_page = matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
                || unit.deployment.chunk_id.as_deref().is_some_and(|c| c.starts_with("pages/"));
            if !is_page {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            match lower_unit_binding_event("mini-program", unit, &rel) {
                Ok((artifact, mut unit_diags)) => {
                    diagnostics.append(&mut unit_diags);
                    let file_name = format!("{}.mini.json", chunk.replace('/', "__"));
                    let abs = out_mini.join(&file_name);
                    let body =
                        vmz_generator::to_pretty_json(&artifact).unwrap_or_else(|_| "{}".into());
                    if let Err(e) = fs::write(&abs, format!("{body}\n")) {
                        diagnostics.push(diag(
                            &rel,
                            Severity::Error,
                            format!("write mini artifact failed: {e}"),
                            DIAG_ARTIFACT_INVALID,
                        ));
                        continue;
                    }
                    let artifact_rel =
                        abs.strip_prefix(root).unwrap_or(&abs).to_string_lossy().replace('\\', "/");
                    artifacts.push(MiniBindingEventUnitResult {
                        chunk_id: chunk,
                        unit_name: unit.name.clone(),
                        artifact_path: artifact_rel,
                        artifact,
                    });
                }
                Err(mut unit_diags) => diagnostics.append(&mut unit_diags),
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    let status = if failed {
        CheckReportStatus::Failed
    } else if artifacts.is_empty() {
        CheckReportStatus::Incomplete
    } else {
        CheckReportStatus::Ready
    };

    MiniBindingEventReport {
        schema: MINI_BINDING_EVENT_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        diagnostics,
    }
}
