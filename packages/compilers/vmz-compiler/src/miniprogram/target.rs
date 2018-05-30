//! miniprogram: target-neutral Execution Plan contract .
//!
//! Algebraic first version: freeze View Operations + profiles + artifact schema,
//! diagnose DOM leaks inside Execution Plan JSON.
//! Browser Direct remains the conformance baseline (proven by gate via workspace build).
//! No WXML emitter / no Mini Program IR.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;
use walkdir::WalkDir;

use vmz_protocol::{
    DIAG_DOM_LEAK_IN_PLAN, DIAG_UNKNOWN_VIEW_OP, MiniProgramArtifact, PlatformCapabilityProfile,
    TARGET_CHECK_SCHEMA, TargetCheckReport, TargetDiagnostic, ViewOpsDocument,
};

/// Thin PlanNode kinds allowed in target-neutral Execution Plan (map to View Ops).
pub const ALLOWED_PLAN_KINDS: &[&str] =
    &["text", "interp", "element", "if", "each", "component", "slot", "dispose_region"];

/// Substrings that must never appear in Execution Plan JSON .
pub const FORBIDDEN_PLAN_TOKENS: &[&str] = &[
    "document.createElement",
    "document.",
    "createElement(",
    "setAttribute(",
    "querySelector(",
    "getElementById(",
    "innerHTML",
    "bindText",
    "bindAttr",
    "wx.",
    "my.",
    "tt.",
    "window.",
];

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> TargetDiagnostic {
    TargetDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

/// Scan a JSON value (Execution Plan or program.plan) for DOM / platform leaks.
pub fn scan_plan_value_for_dom_leaks(path: &str, value: &Value, out: &mut Vec<TargetDiagnostic>) {
    // Only Execution Plan documents — never semantic/reactive `kind` fields.
    let mut plans: Vec<&Value> = Vec::new();
    if let Some(units) = value.get("units").and_then(|v| v.as_array()) {
        for u in units {
            if let Some(plan) = u.get("plan") {
                plans.push(plan);
            }
        }
    } else if let Some(plan) = value.get("plan") {
        plans.push(plan);
    } else if value.get("nodes").is_some() {
        // Bare plan object (unit tests / vmz.plan.v0 document).
        plans.push(value);
    }

    for plan in plans {
        let text = plan.to_string();
        for tok in FORBIDDEN_PLAN_TOKENS {
            if text.contains(tok) {
                out.push(diag(
                    path,
                    "error",
                    format!(
                        "Execution Plan must not contain `{tok}` (target-neutral View Ops only; DOM belongs in Browser lowering)"
                    ),
                    DIAG_DOM_LEAK_IN_PLAN,
                ));
            }
        }
        if let Some(nodes) = plan.get("nodes").and_then(|v| v.as_array()) {
            for (i, n) in nodes.iter().enumerate() {
                let kind = n.get("kind").and_then(|k| k.as_str()).unwrap_or("");
                if kind.is_empty() || kind == "pending" {
                    continue;
                }
                if !ALLOWED_PLAN_KINDS.contains(&kind) {
                    out.push(diag(
                        path,
                        "error",
                        format!(
                            "unknown PlanNode kind `{kind}` at nodes[{i}] (not in View Op mapping)"
                        ),
                        DIAG_UNKNOWN_VIEW_OP,
                    ));
                }
            }
        }
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

/// miniprogram umbrella check for a workspace root (scans `*.program.json` under dist/).
pub fn check_miniprogram_target_contract(root: &Path) -> TargetCheckReport {
    let mut diagnostics = Vec::new();
    let browser_profile = PlatformCapabilityProfile::browser_v0();
    let mini_program_profile = PlatformCapabilityProfile::mini_program_neutral_v0();
    let mini_program_artifact = MiniProgramArtifact::empty_skeleton("mini-program");

    if mini_program_profile.platform_id.to_ascii_lowercase().contains("wechat")
        || mini_program_profile.family.to_ascii_lowercase().contains("wechat")
    {
        diagnostics.push(diag(
            "",
            "error",
            "mini-program profile must stay vendor-neutral (wechat belongs in adapter only)",
            DIAG_DOM_LEAK_IN_PLAN,
        ));
    }

    let programs = collect_program_json(root);
    for p in &programs {
        if let Ok(text) = fs::read_to_string(p) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                let rel = p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/");
                scan_plan_value_for_dom_leaks(&rel, &v, &mut diagnostics);
            }
        }
    }

    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            "info",
            "no *.program.json scanned — build workspace first for plan leak proof; View Ops + profiles still frozen",
            "vmz::target::miniprogram_catalog_only",
        ));
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    let status = if failed {
        "failed"
    } else if !programs.is_empty() {
        "ready"
    } else {
        "incomplete"
    };

    TargetCheckReport {
        schema: TARGET_CHECK_SCHEMA.into(),
        view_ops: ViewOpsDocument::v0(),
        browser_profile,
        mini_program_profile,
        mini_program_artifact,
        allowed_plan_kinds: ALLOWED_PLAN_KINDS.iter().map(|s| (*s).into()).collect(),
        diagnostics,
        status: status.into(),
    }
}
