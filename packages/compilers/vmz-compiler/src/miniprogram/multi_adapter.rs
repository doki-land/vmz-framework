//! Mini multi-adapter conformance (second platform).
//!
//! Proves ≥2 packaging adapters (`wechat-miniprogram` + `alipay-miniprogram`)
//! share one neutral deploy package / Mini Host / artifact schema. Adapters are
//! transport + packaging stubs only — no VPG fork, no Mini IR, no WXML emitter.

use std::fs;
use std::path::Path;

use serde::Serialize;
use serde_json::{Value, json};

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, PLAN_SCHEMA, Severity, TargetDiagnostic,
};

use super::static_slice::MINI_TEMPLATE_DIALECT;
use super::tooling_deploy::{
    MINI_DEPLOY_PACKAGE_SCHEMA, MINI_DEV_SESSION_SCHEMA, MINI_HOST_SCHEMA,
    MINI_VENDOR_TOOLING_SCHEMA, lower_miniprogram_tooling_deploy,
};

/// Report schema for multi-adapter check/lower.
pub const MINI_MULTI_ADAPTER_REPORT_SCHEMA: &str = "vmz.target.mini_multi_adapter.v0";

/// Multi-adapter manifest schema.
pub const MINI_MULTI_ADAPTER_MANIFEST_SCHEMA: &str = "vmz.mini.multi_adapter.v0";

/// Shared contract pointers every Mini adapter must honor.
pub const MINI_MULTI_ADAPTER_SHARED_SCHEMA: &str = "vmz.mini.multi_adapter_shared.v0";

/// One platform adapter contribution schema.
pub const MINI_ADAPTER_CONTRIBUTION_SCHEMA: &str = "vmz.mini.adapter_contribution.v0";

/// Diagnostic: required Mini adapter missing.
pub const DIAG_MINI_MISSING_ADAPTER: &str = "vmz::target::mini_missing_adapter";
/// Diagnostic: adapter invents a semantic core / Mini IR.
pub const DIAG_MINI_ADAPTER_SEMANTIC_CORE: &str = "vmz::target::mini_adapter_semantic_core";
/// Diagnostic: platform-private schema fork.
pub const DIAG_MINI_PLATFORM_PRIVATE_SCHEMA: &str = "vmz::target::mini_platform_private_schema";
/// Diagnostic: adapters diverge on shared neutral schemas.
pub const DIAG_MINI_SHARED_FORK: &str = "vmz::target::mini_shared_fork";

/// Required Mini adapters for MP6 thin gate (≥2).
pub const REQUIRED_MINI_ADAPTERS: &[&str] = &["wechat-miniprogram", "alipay-miniprogram"];

/// Aggregated multi-adapter report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniMultiAdapterReport {
    /// Always [`MINI_MULTI_ADAPTER_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Relative path of the multi-adapter manifest.
    pub manifest_path: String,
    /// Multi-adapter manifest document.
    pub manifest: Value,
    /// Neutral deploy package (shared by all adapters).
    pub package: Value,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniMultiAdapterReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
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

fn looks_platform_private(schema: &str) -> bool {
    let s = schema.to_ascii_lowercase();
    s.contains("wx.")
        || s.contains("wxml")
        || s.contains("wxss")
        || s.contains("my.")
        || s.contains("tt.")
        || s.contains("swan.")
        || s.contains("com.tencent.")
        || s.contains("com.alipay.")
}

/// Canonical shared Mini contracts (must be identical for every adapter).
pub fn shared_mini_contracts() -> Value {
    json!({
        "schema": MINI_MULTI_ADAPTER_SHARED_SCHEMA,
        "family": "mini-program",
        "artifactSchema": "vmz.target.mini_program_artifact.v0",
        "deployPackageSchema": MINI_DEPLOY_PACKAGE_SCHEMA,
        "hostSchema": MINI_HOST_SCHEMA,
        "dialect": MINI_TEMPLATE_DIALECT,
        "planSchema": PLAN_SCHEMA,
        "allowsPlatformSemanticFork": false,
        "forbids": [
            "wxmlEmitter",
            "wxssEmitter",
            "miniIr",
            "vpgMutation",
            "sourceRescan",
            "secondRuntime",
            "serverImplInMiniPackage",
            "independentBackend"
        ]
    })
}

fn adapter_contribution(
    adapter_id: &str,
    vendor: &str,
    dev_target: &str,
    request_api: &str,
    patch_api: &str,
) -> Value {
    json!({
        "schema": MINI_ADAPTER_CONTRIBUTION_SCHEMA,
        "adapterId": adapter_id,
        "kind": "packaging-stub",
        "packagingOnly": true,
        "isSemanticTruthSource": false,
        "consumesNeutralPackage": true,
        "sharedSchema": MINI_MULTI_ADAPTER_SHARED_SCHEMA,
        "capabilityProfile": {
            "family": "mini-program",
            "platformId": "mini-program",
            "adapterId": adapter_id
        },
        "elementMapping": {
            "markers": ["data-vmz-on", "data-vmz-route", "data-vmz-if", "data-vmz-each", "vmz-component"],
            "vendorTemplateEmitter": false
        },
        "lifecycleMapping": {
            "onLoad": "activate",
            "onShow": "visible",
            "onHide": "hidden",
            "onUnload": "dispose"
        },
        "transport": {
            "server": request_api,
            "viewPatches": patch_api,
            "scheme": "#server"
        },
        "vendorTooling": {
            "schema": MINI_VENDOR_TOOLING_SCHEMA,
            "adapter": vendor,
            "role": "transport-conformance",
            "invokedInCi": false,
            "requiredForSupportClaim": true
        },
        "devSession": {
            "schema": MINI_DEV_SESSION_SCHEMA,
            "target": dev_target,
            "orchestrationHost": "node",
            "incrementalBasis": "program-graph-affected",
            "previewDelegatesToVendor": true
        }
    })
}

/// Validate a multi-adapter manifest value; append diagnostics.
pub fn validate_multi_adapter_manifest(manifest: &Value, out: &mut Vec<TargetDiagnostic>) {
    let schema = manifest.get("schema").and_then(|v| v.as_str()).unwrap_or("");
    if schema != MINI_MULTI_ADAPTER_MANIFEST_SCHEMA {
        out.push(diag(
            "schema",
            Severity::Error,
            format!("multi_adapter schema must be `{MINI_MULTI_ADAPTER_MANIFEST_SCHEMA}`"),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    if manifest.get("allowsPlatformSemanticFork").and_then(|v| v.as_bool()) == Some(true) {
        out.push(diag(
            "allowsPlatformSemanticFork",
            Severity::Error,
            "platform semantic fork is forbidden — adapters share one Mini family contract",
            DIAG_MINI_SHARED_FORK,
        ));
    }

    let expected_shared = shared_mini_contracts();
    let shared = manifest.get("shared").cloned().unwrap_or(json!({}));
    for key in ["artifactSchema", "deployPackageSchema", "hostSchema", "dialect", "planSchema"] {
        let got = shared.get(key).and_then(|v| v.as_str()).unwrap_or("");
        let want = expected_shared.get(key).and_then(|v| v.as_str()).unwrap_or("");
        if got != want {
            out.push(diag(
                &format!("shared.{key}"),
                Severity::Error,
                format!("shared {key} must be `{want}`, got `{got}`"),
                DIAG_MINI_SHARED_FORK,
            ));
        }
        if looks_platform_private(got) {
            out.push(diag(
                &format!("shared.{key}"),
                Severity::Error,
                format!("platform-private schema forbidden in shared: `{got}`"),
                DIAG_MINI_PLATFORM_PRIVATE_SCHEMA,
            ));
        }
    }

    let adapters = manifest.get("adapters").and_then(|v| v.as_array()).cloned().unwrap_or_default();

    for want_id in REQUIRED_MINI_ADAPTERS {
        if !adapters.iter().any(|a| a.get("adapterId").and_then(|v| v.as_str()) == Some(*want_id)) {
            out.push(diag(
                "adapters",
                Severity::Error,
                format!("missing required Mini adapter `{want_id}`"),
                DIAG_MINI_MISSING_ADAPTER,
            ));
        }
    }

    if adapters.len() < 2 {
        out.push(diag(
            "adapters",
            Severity::Error,
            "MP6 requires ≥2 Mini adapters sharing one neutral package",
            DIAG_MINI_MISSING_ADAPTER,
        ));
    }

    for adapter in &adapters {
        let id = adapter.get("adapterId").and_then(|v| v.as_str()).unwrap_or("?");
        let path = format!("adapters.{id}");

        if adapter.get("schema").and_then(|v| v.as_str()) != Some(MINI_ADAPTER_CONTRIBUTION_SCHEMA)
        {
            out.push(diag(
                &path,
                Severity::Error,
                format!("adapter schema must be `{MINI_ADAPTER_CONTRIBUTION_SCHEMA}`"),
                DIAG_ARTIFACT_INVALID,
            ));
        }
        if adapter.get("kind").and_then(|v| v.as_str()) != Some("packaging-stub") {
            out.push(diag(
                &format!("{path}.kind"),
                Severity::Error,
                "Mini adapter kind must be `packaging-stub` (vendor packaging later)",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
        if adapter.get("packagingOnly").and_then(|v| v.as_bool()) != Some(true) {
            out.push(diag(
                &format!("{path}.packagingOnly"),
                Severity::Error,
                "Mini adapter must be packaging-only",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
        if adapter.get("isSemanticTruthSource").and_then(|v| v.as_bool()) == Some(true) {
            out.push(diag(
                &format!("{path}.isSemanticTruthSource"),
                Severity::Error,
                "adapter must not become semantic truth — VPG/Plan remain sole IR",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
        if adapter.get("consumesNeutralPackage").and_then(|v| v.as_bool()) != Some(true) {
            out.push(diag(
                &format!("{path}.consumesNeutralPackage"),
                Severity::Error,
                "adapter must consume the shared neutral deploy package",
                DIAG_MINI_SHARED_FORK,
            ));
        }
        if adapter.pointer("/elementMapping/vendorTemplateEmitter").and_then(|v| v.as_bool())
            == Some(true)
        {
            out.push(diag(
                &format!("{path}.elementMapping"),
                Severity::Error,
                "vendor template emitter forbidden (no WXML/AXML as truth)",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
        let vendor_role =
            adapter.pointer("/vendorTooling/role").and_then(|v| v.as_str()).unwrap_or("");
        if vendor_role != "transport-conformance" {
            out.push(diag(
                &format!("{path}.vendorTooling.role"),
                Severity::Error,
                "vendor tooling must stay transport-conformance",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
        if adapter.pointer("/vendorTooling/invokedInCi").and_then(|v| v.as_bool()) != Some(false) {
            out.push(diag(
                &format!("{path}.vendorTooling.invokedInCi"),
                Severity::Error,
                "vendor tooling must not be invoked in CI gate",
                DIAG_MINI_ADAPTER_SEMANTIC_CORE,
            ));
        }
    }
}

fn build_manifest(package_path: &str) -> Value {
    json!({
        "schema": MINI_MULTI_ADAPTER_MANIFEST_SCHEMA,
        "family": "mini-program",
        "allowsPlatformSemanticFork": false,
        "packagePath": package_path,
        "shared": shared_mini_contracts(),
        "adapters": [
            adapter_contribution(
                "wechat-miniprogram",
                "wechat-devtools",
                "mini-program-wechat",
                "wx.request",
                "setData",
            ),
            adapter_contribution(
                "alipay-miniprogram",
                "alipay-devtools",
                "mini-program-alipay",
                "my.request",
                "setData",
            ),
        ],
        "claim": {
            "supportsMiniProgramsAlgebraic": true,
            "supportsVendorRuntime": false,
            "note": "≥2 adapters share neutral package; vendor tools still required for production claims"
        }
    })
}

/// Lower tooling deploy + emit dual-adapter packaging contributions.
pub fn lower_miniprogram_multi_adapter(root: &Path) -> MiniMultiAdapterReport {
    let mut diagnostics = Vec::new();
    let deploy = lower_miniprogram_tooling_deploy(root);
    diagnostics.extend(deploy.diagnostics.clone());

    let manifest_rel = "dist/_vmz/mini-deploy/multi-adapter.json";
    let manifest_abs =
        root.join("dist").join("_vmz").join("mini-deploy").join("multi-adapter.json");

    if deploy.status == CheckReportStatus::Failed {
        return MiniMultiAdapterReport {
            schema: MINI_MULTI_ADAPTER_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Failed,
            manifest_path: manifest_rel.into(),
            manifest: json!({ "schema": MINI_MULTI_ADAPTER_MANIFEST_SCHEMA }),
            package: deploy.package,
            diagnostics,
        };
    }

    let mut package = deploy.package.clone();
    if let Some(obj) = package.as_object_mut() {
        obj.insert(
            "adapters".into(),
            json!([
                { "adapterId": "wechat-miniprogram" },
                { "adapterId": "alipay-miniprogram" }
            ]),
        );
        // Keep family id neutral; concrete adapters live in multi-adapter manifest.
        obj.insert("platformId".into(), json!("mini-program"));
        obj.insert("adapterId".into(), json!("mini-program"));
        obj.insert("primaryAdapterId".into(), json!("wechat-miniprogram"));
    }

    // Rewrite deploy package with multi-adapter pointers.
    let package_abs = root.join(&deploy.package_path);
    if let Some(parent) = package_abs.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let pkg_body = serde_json::to_string_pretty(&package).unwrap_or_else(|_| "{}".into());
    if let Err(e) = fs::write(&package_abs, format!("{pkg_body}\n")) {
        diagnostics.push(diag(
            &deploy.package_path,
            Severity::Error,
            format!("rewrite deploy package failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    let manifest = build_manifest(&deploy.package_path);
    validate_multi_adapter_manifest(&manifest, &mut diagnostics);

    if let Some(parent) = manifest_abs.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let man_body = serde_json::to_string_pretty(&manifest).unwrap_or_else(|_| "{}".into());
    if let Err(e) = fs::write(&manifest_abs, format!("{man_body}\n")) {
        diagnostics.push(diag(
            manifest_rel,
            Severity::Error,
            format!("write multi-adapter manifest failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    let status = if failed {
        CheckReportStatus::Failed
    } else if deploy.status == CheckReportStatus::Incomplete {
        CheckReportStatus::Incomplete
    } else {
        CheckReportStatus::Ready
    };

    MiniMultiAdapterReport {
        schema: MINI_MULTI_ADAPTER_REPORT_SCHEMA.into(),
        status,
        manifest_path: manifest_rel.into(),
        manifest,
        package,
        diagnostics,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_single_adapter() {
        let mut diags = Vec::new();
        let bad = json!({
            "schema": MINI_MULTI_ADAPTER_MANIFEST_SCHEMA,
            "allowsPlatformSemanticFork": false,
            "shared": shared_mini_contracts(),
            "adapters": [
                adapter_contribution(
                    "wechat-miniprogram",
                    "wechat-devtools",
                    "mini-program-wechat",
                    "wx.request",
                    "setData",
                )
            ]
        });
        validate_multi_adapter_manifest(&bad, &mut diags);
        assert!(
            diags.iter().any(|d| d.code_string().as_deref() == Some(DIAG_MINI_MISSING_ADAPTER))
        );
    }

    #[test]
    fn accepts_canonical_dual_adapters() {
        let mut diags = Vec::new();
        validate_multi_adapter_manifest(
            &build_manifest("dist/_vmz/mini-deploy/package.json"),
            &mut diags,
        );
        assert!(diags.iter().all(|d| !d.is_error()), "{diags:?}");
    }
}
