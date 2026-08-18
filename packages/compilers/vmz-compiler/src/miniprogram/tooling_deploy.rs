//! Mini tooling / deploy package + host handoff (TemplateSurface).
//!
//! Composes on route/server/style artifacts into a VMZ-owned deploy package and
//! deterministic Mini Host descriptor. Vendor developer-tools CLI is recorded as
//! transport/conformance only — never invoked here, never becomes test semantics.
//! WeChat `pages/**/*.wxml|wxss` are written via [`super::wechat_pack`]
//! (`vmz-generator` printers). Adapters still do not own a WXML emitter.
//! Does not ship `#server` implementation bodies.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Value, json};

use vmz_protocol::{CheckReportStatus, DIAG_ARTIFACT_INVALID, Severity, TargetDiagnostic};

use super::route_server_style::{
    MiniRouteServerStyleReport, lower_miniprogram_route_server_style_slices,
};
use super::static_slice::MINI_TEMPLATE_DIALECT;
use super::wechat_pack::{MiniWechatPackReport, lower_miniprogram_wechat_packaging};

/// Report schema for tooling/deploy lowering.
pub const MINI_TOOLING_DEPLOY_REPORT_SCHEMA: &str = "vmz.target.mini_tooling_deploy.v0";

/// Deploy package schema written under `dist/_vmz/mini-deploy/`.
pub const MINI_DEPLOY_PACKAGE_SCHEMA: &str = "vmz.mini.deploy_package.v0";

/// Deterministic Mini Host descriptor schema.
pub const MINI_HOST_SCHEMA: &str = "vmz.mini.host.v0";

/// Vendor tooling handoff schema (transport layer only).
pub const MINI_VENDOR_TOOLING_SCHEMA: &str = "vmz.mini.vendor_tooling.v0";

/// Dev-session orchestration descriptor schema.
pub const MINI_DEV_SESSION_SCHEMA: &str = "vmz.mini.dev_session.v0";

/// Aggregated tooling/deploy report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniToolingDeployReport {
    /// Always [`MINI_TOOLING_DEPLOY_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Template dialect id.
    pub dialect: String,
    /// Relative path of the deploy package JSON.
    pub package_path: String,
    /// Deploy package document.
    pub package: Value,
    /// Nested route/server/style report status (for diagnostics).
    pub route_server_style_status: CheckReportStatus,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniToolingDeployReport {
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

fn build_deploy_package(rss: &MiniRouteServerStyleReport, wechat: &MiniWechatPackReport) -> Value {
    let pages = rss.route_table.get("pages").cloned().unwrap_or_else(|| json!([]));
    let artifacts: Vec<Value> = rss
        .artifacts
        .iter()
        .map(|a| {
            json!({
                "chunkId": a.chunk_id,
                "unitName": a.unit_name,
                "artifactPath": a.artifact_path,
                "platformId": a.artifact.platform_id,
            })
        })
        .collect();

    let mut server_caps = Vec::new();
    let mut route_links = Vec::new();
    for a in &rss.artifacts {
        if let Some(man_raw) = &a.artifact.manifest {
            if let Ok(man) = serde_json::from_str::<Value>(man_raw) {
                if let Some(caps) =
                    man.pointer("/serverTransport/capabilities").and_then(|v| v.as_array())
                {
                    for c in caps {
                        let mut row = c.clone();
                        if let Some(obj) = row.as_object_mut() {
                            obj.insert("chunkId".into(), json!(a.chunk_id));
                        }
                        server_caps.push(row);
                    }
                }
                if let Some(links) = man.pointer("/routes/links").and_then(|v| v.as_array()) {
                    for l in links {
                        let mut row = l.clone();
                        if let Some(obj) = row.as_object_mut() {
                            obj.insert("fromChunkId".into(), json!(a.chunk_id));
                        }
                        route_links.push(row);
                    }
                }
            }
        }
    }

    json!({
        "schema": MINI_DEPLOY_PACKAGE_SCHEMA,
        "platformId": "mini-program",
        "adapterId": "wechat-miniprogram",
        "dialect": MINI_TEMPLATE_DIALECT,
        "pages": pages,
        "artifacts": artifacts,
        "routeLinks": route_links,
        "serverCapabilities": server_caps,
        "host": {
            "schema": MINI_HOST_SCHEMA,
            "kind": "deterministic-interpreter",
            "owner": "vmz",
            "modes": [
                "data-patch",
                "event",
                "lifecycle",
                "navigation",
                "network-stub"
            ],
            "consumes": [
                "template",
                "logic",
                "eventTable",
                "dataPatchTable",
                "manifest"
            ],
            "notVendorRuntime": true
        },
        "vendorTooling": {
            "schema": MINI_VENDOR_TOOLING_SCHEMA,
            "adapter": "wechat-devtools",
            "role": "transport-conformance",
            "invokedInCi": false,
            "requiredForSupportClaim": true,
            "cliHints": ["open", "preview", "upload"],
            "note": "Vendor CLI is not VMZ test semantics; call outside this gate."
        },
        "devSession": {
            "schema": MINI_DEV_SESSION_SCHEMA,
            "target": "mini-program-wechat",
            "orchestrationHost": "node",
            "incrementalBasis": "program-graph-affected",
            "previewDelegatesToVendor": true
        },
        "constraints": {
            "wxmlEmitter": false,
            "wxssEmitter": false,
            "serverImplInMiniPackage": false,
            "independentBackend": false,
            "miniIr": false
        },
        "wechatPack": {
            "schema": wechat.schema,
            "status": wechat.status,
            "root": wechat.pack_root,
            "printer": wechat.printer,
            "pages": wechat.pages
        }
    })
}

/// Compose route/server/style artifacts into a deploy package + Mini Host handoff.
pub fn lower_miniprogram_tooling_deploy(root: &Path) -> MiniToolingDeployReport {
    let mut diagnostics = Vec::new();
    let rss = lower_miniprogram_route_server_style_slices(root);
    diagnostics.extend(rss.diagnostics.clone());

    let package_rel = "dist/_vmz/mini-deploy/package.json";
    let package_abs = root.join("dist").join("_vmz").join("mini-deploy").join("package.json");

    if rss.status == CheckReportStatus::Failed
        || rss.artifacts.is_empty() && diagnostics.iter().any(|d| d.is_error())
    {
        return MiniToolingDeployReport {
            schema: MINI_TOOLING_DEPLOY_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Failed,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            package_path: package_rel.into(),
            package: json!({ "schema": MINI_DEPLOY_PACKAGE_SCHEMA }),
            route_server_style_status: rss.status,
            diagnostics,
        };
    }

    if rss.artifacts.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Error,
            "tooling/deploy requires at least one MiniProgramArtifact — build + route/server/style first",
            DIAG_ARTIFACT_INVALID,
        ));
        return MiniToolingDeployReport {
            schema: MINI_TOOLING_DEPLOY_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Failed,
            dialect: MINI_TEMPLATE_DIALECT.into(),
            package_path: package_rel.into(),
            package: json!({ "schema": MINI_DEPLOY_PACKAGE_SCHEMA }),
            route_server_style_status: rss.status,
            diagnostics,
        };
    }

    let wechat = lower_miniprogram_wechat_packaging(root);
    diagnostics.extend(wechat.diagnostics.clone());
    let package = build_deploy_package(&rss, &wechat);
    if let Some(parent) = package_abs.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let body = vmz_generator::to_pretty_json(&package).unwrap_or_else(|_| "{}".into());
    if let Err(e) = fs::write(&package_abs, format!("{body}\n")) {
        diagnostics.push(diag(
            package_rel,
            Severity::Error,
            format!("write deploy package failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    // Host harness sidecar for Node test / dev discovery (same constraints as package.host).
    let harness_abs = root.join("dist").join("_vmz").join("mini-deploy").join("host-harness.json");
    let harness = json!({
        "schema": MINI_HOST_SCHEMA,
        "packagePath": package_rel,
        "kind": "deterministic-interpreter",
        "entry": "@vmz/vmz#createMiniHost",
    });
    let _ = fs::write(
        &harness_abs,
        format!("{}\n", vmz_generator::to_pretty_json(&harness).unwrap_or_else(|_| "{}".into())),
    );

    let failed = diagnostics.iter().any(|d| d.is_error());
    let status = if failed {
        CheckReportStatus::Failed
    } else if rss.status == CheckReportStatus::Incomplete {
        CheckReportStatus::Incomplete
    } else {
        CheckReportStatus::Ready
    };

    MiniToolingDeployReport {
        schema: MINI_TOOLING_DEPLOY_REPORT_SCHEMA.into(),
        status,
        dialect: MINI_TEMPLATE_DIALECT.into(),
        package_path: package_rel.into(),
        package,
        route_server_style_status: rss.status,
        diagnostics,
    }
}
