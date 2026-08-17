//! MP1 Static Slice — TemplateSurface lowering from Native View.
//!
//! Consumes Program IR `view` (+ binding ids from the same unit). Emits
//! [`MiniProgramArtifact`] fragments: vendor-neutral template text + logic
//! initialData. Not a WeChat WXML emitter; not a second IR.
//!
//! Supported (static): `text` / `interp` / `element` (non-event attrs).
//! Unsupported here (→ diagnostic, deferred): `if` / `each` / `component` /
//! `slot` / event wiring (MP2+) / lifecycle (MP3+).

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{Value, json};
use walkdir::WalkDir;

use vmz_generator::MiniTemplateProfile;
use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, MINI_PROGRAM_ARTIFACT_SCHEMA, MiniProgramArtifact,
    Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{ProgramModule, ViewStatus, ViewView};

/// Report schema for MP1 static-slice lowering.
pub const MINI_STATIC_SLICE_REPORT_SCHEMA: &str = "vmz.target.mini_static_slice.v0";

/// Logic fragment schema embedded inside [`MiniProgramArtifact::logic`].
pub const MINI_LOGIC_SCHEMA: &str = "vmz.mini.logic.v0";

/// Template dialect marker (vendor-neutral; not `wxml`).
pub use vmz_generator::MINI_TEMPLATE_DIALECT;

/// One successfully lowered page unit.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStaticSliceUnitResult {
    /// Deployment chunk id (posix-style).
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Artifact path relative to workspace root.
    pub artifact_path: String,
    /// Lowered Mini Program artifact envelope.
    pub artifact: MiniProgramArtifact,
}

/// Aggregated static-slice lowering report for gates / N-API.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniStaticSliceReport {
    /// Always [`MINI_STATIC_SLICE_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id ([`MINI_TEMPLATE_DIALECT`]).
    pub dialect: String,
    /// Successfully written page artifacts.
    pub artifacts: Vec<MiniStaticSliceUnitResult>,
    /// Diagnostics collected during lowering.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniStaticSliceReport {
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

/// Lower a Native View into a static MiniProgramArtifact (template + logic data).
pub fn lower_view_static_slice(
    platform_id: &str,
    view: &ViewView,
    path_for_diag: &str,
) -> Result<(MiniProgramArtifact, Vec<TargetDiagnostic>), Vec<TargetDiagnostic>> {
    let mut diagnostics = Vec::new();
    if view.status != ViewStatus::Native {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "static slice requires Native View (structural tree)",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }
    if view.roots.is_empty() {
        diagnostics.push(diag(
            path_for_diag,
            Severity::Error,
            "static slice: empty view roots",
            DIAG_ARTIFACT_INVALID,
        ));
        return Err(diagnostics);
    }

    let emit = match vmz_generator::emit_mini_template_profile(
        &view.roots,
        MiniTemplateProfile::Static,
        None,
    ) {
        Ok(e) => e,
        Err(errs) => return Err(crate::miniprogram::map_mini_emit_errors(path_for_diag, errs)),
    };

    if diagnostics.iter().any(|d| d.is_error()) {
        return Err(diagnostics);
    }

    let mut b_obj = serde_json::Map::new();
    for id in emit.patch_bindings.keys() {
        b_obj.insert(format!("B_{id}"), Value::String(String::new()));
    }
    let logic = json!({
        "schema": MINI_LOGIC_SCHEMA,
        "initialData": { "b": b_obj },
    });

    let artifact = MiniProgramArtifact {
        schema: MINI_PROGRAM_ARTIFACT_SCHEMA.into(),
        platform_id: platform_id.into(),
        template: Some(emit.template),
        style: None,
        logic: Some(crate::miniprogram::compact_json(&logic)),
        event_table: None,
        data_patch_table: None,
        manifest: None,
        plan_schema: vmz_protocol::PLAN_SCHEMA.into(),
    };
    Ok((artifact, diagnostics))
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

/// Lower all **page** units under a workspace root; write `_vmz/mini/*.mini.json`.
pub fn lower_miniprogram_static_slices(root: &Path) -> MiniStaticSliceReport {
    let mut diagnostics = Vec::new();
    let mut artifacts = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before mini static slice",
            "vmz::target::mini_static_slice_catalog_only",
        ));
        return MiniStaticSliceReport {
            schema: MINI_STATIC_SLICE_REPORT_SCHEMA.into(),
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
                || unit
                    .deployment
                    .chunk_id
                    .as_deref()
                    .is_some_and(|c| c == "pages/index" || c.starts_with("pages/"));
            if !is_page {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            match lower_view_static_slice("mini-program", &unit.view, &rel) {
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
                    artifacts.push(MiniStaticSliceUnitResult {
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

    MiniStaticSliceReport {
        schema: MINI_STATIC_SLICE_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        artifacts,
        diagnostics,
    }
}
