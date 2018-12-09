//! Structure / lifecycle lowering (TemplateSurface).
//!
//! Extends binding/event: `if` / keyed `each` / `component` / `slot` become
//! vendor-neutral template markers; LifetimeRegion + Plan `dispose-region`
//! become lifecycle/dispose tables in `manifest`. Not a WXML emitter.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use walkdir::WalkDir;

use vmz_generator::MiniTemplateProfile;
use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, MINI_PROGRAM_ARTIFACT_SCHEMA, MiniProgramArtifact,
    PLAN_SCHEMA, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{
    BindingKind, IrDepPath, PlanNode, ProgramModule, ProgramUnit, ReactiveComponent, ViewStatus,
};

use super::binding_event::{MINI_DATA_PATCH_TABLE_SCHEMA, MINI_EVENT_TABLE_SCHEMA};
use super::static_slice::{MINI_LOGIC_SCHEMA, MINI_TEMPLATE_DIALECT};

/// Report schema for structure/lifecycle lowering.
pub const MINI_STRUCTURE_REPORT_SCHEMA: &str = "vmz.target.mini_structure.v0";

/// Lifecycle + dispose table schema (stored in [`MiniProgramArtifact::manifest`]).
pub const MINI_LIFECYCLE_TABLE_SCHEMA: &str = "vmz.mini.lifecycle_table.v0";

/// One successfully lowered unit (page or app shell).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStructureUnitResult {
    /// Deployment chunk id.
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered artifact envelope.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated structure/lifecycle report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStructureReport {
    /// Always [`MINI_STRUCTURE_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id.
    pub dialect: String,
    /// Written artifacts.
    pub artifacts: Vec<MiniStructureUnitResult>,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniStructureReport {
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

/// Lower one ProgramUnit (page or app) with structure + lifecycle.
pub fn lower_unit_structure(
    platform_id: &str,
    unit: &ProgramUnit,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let mut diagnostics = Vec::new();
    if unit.view.status != ViewStatus::Native {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "structure slice requires Native View",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }
    if unit.view.roots.is_empty() {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "structure slice: empty view roots",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    let emit = match vmz_generator::emit_mini_template_profile(
        &unit.view.roots,
        MiniTemplateProfile::Structure,
        Some(&unit.reactive),
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

    let data_patch = build_data_patch_table(&unit.reactive, &emit.patch_bindings);
    let event_table = if emit.handlers.is_empty() {
        None
    } else {
        Some(crate::miniprogram::compact_json(&json!({
            "schema": MINI_EVENT_TABLE_SCHEMA,
            "handlers": emit.handlers,
        })))
    };

    let lifecycle = build_lifecycle_table(unit);

    let artifact = MiniProgramArtifact {
        schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
        platform_id: platform_id.into(),
        template: Some(emit.template),
        style: None,
        logic: Some(crate::miniprogram::compact_json(&logic)),
        event_table,
        data_patch_table: Some(crate::miniprogram::compact_json(&data_patch)),
        manifest: Some(crate::miniprogram::compact_json(&lifecycle)),
        plan_schema: PLAN_SCHEMA.into(),
    };
    Ok((artifact, diagnostics))
}

fn build_lifecycle_table(unit: &ProgramUnit) -> Value {
    let is_page = matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
        || unit.deployment.chunk_id.as_deref().is_some_and(|c| c.starts_with("pages/"));

    let page_hooks = if is_page {
        json!({
            "onLoad": "activate",
            "onShow": "visible",
            "onHide": "hidden",
            "onUnload": "dispose",
        })
    } else {
        Value::Null
    };

    let regions: Vec<Value> = unit
        .lifetime
        .regions
        .iter()
        .map(|r| {
            json!({
                "regionId": r.id,
                "kind": r.kind.as_str(),
                "ownerUnit": r.owner_unit,
            })
        })
        .collect();

    let dispose: Vec<Value> = unit
        .plan
        .nodes
        .iter()
        .filter_map(|n| match n {
            PlanNode::DisposeRegion { id, region, source } => Some(json!({
                "planNodeId": id,
                "regionId": region,
                "source": source.map(|s| s.as_str()),
            })),
            _ => None,
        })
        .collect();

    json!({
        "schema": MINI_LIFECYCLE_TABLE_SCHEMA,
        "chunkId": unit.deployment.chunk_id,
        "unitKind": unit.deployment.unit_kind.map(|k| k.as_str()),
        "pageHooks": page_hooks,
        "regions": regions,
        "dispose": dispose,
    })
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

fn is_page_or_app(unit: &ProgramUnit) -> bool {
    matches!(
        unit.deployment.unit_kind,
        Some(VmzModuleKind::Page) | Some(VmzModuleKind::Application)
    ) || unit
        .deployment
        .chunk_id
        .as_deref()
        .is_some_and(|c| c.starts_with("pages/") || c == "Application")
}

/// Lower page + app units with structure/lifecycle; write `_vmz/mini/*.mini.json`.
pub fn lower_miniprogram_structure_slices(root: &Path) -> MiniStructureReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini structure slice",
            "vmz::target::mini_structure_catalog_only",
        ));
        return MiniStructureReport {
            schema: MINI_STRUCTURE_REPORT_SCHEMA.into(),
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
            if !is_page_or_app(unit) {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            match lower_unit_structure("mini-program", unit, &rel) {
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
                    artifacts.push(MiniStructureUnitResult {
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

    MiniStructureReport {
        schema: MINI_STRUCTURE_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        diagnostics,
    }
}
