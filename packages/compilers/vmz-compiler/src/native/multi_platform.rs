//! native: Multi-platform Host Profile freeze .
//!
//! Algebraic first version: iOS + Android packaging adapters must share one
//! bridge / surface / shell / deployment / fullstack / test contract set.
//! No platform semantic fork; no real Xcode/Gradle as semantic core.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    BRIDGE_PROTOCOL_SCHEMA, CAPABILITY_CALL_SCHEMA, DIAG_ADAPTER_IS_SEMANTIC_CORE,
    DIAG_INVALID_PROFILE, DIAG_MISSING_PLATFORM_ADAPTER, DIAG_PLATFORM_PRIVATE_SCHEMA,
    DIAG_PLATFORM_SEMANTIC_FORK, FULLSTACK_SCHEMA, MULTI_PLATFORM_CHECK_SCHEMA,
    MULTI_PLATFORM_SCHEMA, MULTI_PLATFORM_SHARED_SCHEMA, MULTI_PLATFORM_TEST_SCHEMA,
    MultiPlatformAdapterKind, MultiPlatformSharedContracts, NATIVE_SURFACE_SCHEMA,
    NativeHostDiagnostic, NativeHostProtocolCatalog, NativeMultiPlatformCheckReport,
    NativeMultiPlatformManifest, NativePlatformId, SHELL_SCHEMA, WEBVIEW_DEPLOYMENT_SCHEMA,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn looks_platform_private(schema: &str) -> bool {
    let s = schema.to_ascii_lowercase();
    s.contains("com.apple.")
        || s.contains("com.android.")
        || s.contains(".ios.private")
        || s.contains(".android.private")
        || s.contains("uikit.")
        || s.contains("gradle.")
        || s.starts_with("xcode.")
}

fn validate_shared(shared: &MultiPlatformSharedContracts, out: &mut Vec<NativeHostDiagnostic>) {
    if shared.schema != MULTI_PLATFORM_SHARED_SCHEMA {
        out.push(diag(
            "shared.schema",
            vmz_protocol::Severity::Error,
            format!("shared schema must be `{MULTI_PLATFORM_SHARED_SCHEMA}`"),
            DIAG_INVALID_PROFILE,
        ));
    }
    let expected = MultiPlatformSharedContracts::canonical();
    let pairs = [
        ("bridgeSchema", shared.bridge_schema.as_str(), expected.bridge_schema.as_str()),
        (
            "capabilityCallSchema",
            shared.capability_call_schema.as_str(),
            expected.capability_call_schema.as_str(),
        ),
        ("surfaceSchema", shared.surface_schema.as_str(), expected.surface_schema.as_str()),
        ("shellSchema", shared.shell_schema.as_str(), expected.shell_schema.as_str()),
        (
            "deploymentSchema",
            shared.deployment_schema.as_str(),
            expected.deployment_schema.as_str(),
        ),
        ("fullstackSchema", shared.fullstack_schema.as_str(), expected.fullstack_schema.as_str()),
        (
            "testContractSchema",
            shared.test_contract_schema.as_str(),
            expected.test_contract_schema.as_str(),
        ),
    ];
    for (field, got, want) in pairs {
        if got != want {
            out.push(diag(
                &format!("shared.{field}"),
                vmz_protocol::Severity::Error,
                format!("shared {field} must be `{want}`, got `{got}`"),
                DIAG_PLATFORM_SEMANTIC_FORK,
            ));
        }
        if looks_platform_private(got) {
            out.push(diag(
                &format!("shared.{field}"),
                vmz_protocol::Severity::Error,
                format!("platform-private schema forbidden: `{got}`"),
                DIAG_PLATFORM_PRIVATE_SCHEMA,
            ));
        }
    }
}

fn validate_manifest(mp: &NativeMultiPlatformManifest, out: &mut Vec<NativeHostDiagnostic>) {
    if mp.schema != MULTI_PLATFORM_SCHEMA {
        out.push(diag(
            "schema",
            vmz_protocol::Severity::Error,
            format!("multi_platform schema must be `{MULTI_PLATFORM_SCHEMA}`"),
            DIAG_INVALID_PROFILE,
        ));
    }

    if mp.allows_platform_semantic_fork {
        out.push(diag(
            "allowsPlatformSemanticFork",
            vmz_protocol::Severity::Error,
            "platform semantic fork is forbidden — iOS/Android must share one Host Profile contract",
            DIAG_PLATFORM_SEMANTIC_FORK,
        ));
    }

    validate_shared(&mp.shared, out);

    for plat in NativePlatformId::ALL {
        if !mp.platforms.iter().any(|p| p == plat) {
            out.push(diag(
                "platforms",
                vmz_protocol::Severity::Error,
                format!("required platform `{plat}` missing from platforms list"),
                DIAG_MISSING_PLATFORM_ADAPTER,
            ));
        }
        let Some(adapter) = mp.adapters.iter().find(|a| a.platform == *plat) else {
            out.push(diag(
                "adapters",
                vmz_protocol::Severity::Error,
                format!("missing `{plat}` packaging adapter"),
                DIAG_MISSING_PLATFORM_ADAPTER,
            ));
            continue;
        };

        if adapter.kind != MultiPlatformAdapterKind::PackagingStub {
            out.push(diag(
                &format!("adapters.{plat}.kind"),
                vmz_protocol::Severity::Error,
                format!(
                    "native adapter kind must be `{}` (real Xcode/Gradle later); got `{}`",
                    MultiPlatformAdapterKind::PackagingStub,
                    adapter.kind
                ),
                DIAG_ADAPTER_IS_SEMANTIC_CORE,
            ));
        }

        if !adapter.packaging_only {
            out.push(diag(
                &format!("adapters.{plat}.packagingOnly"),
                vmz_protocol::Severity::Error,
                "platform adapter must be packaging-only — Host Profile semantics stay shared",
                DIAG_ADAPTER_IS_SEMANTIC_CORE,
            ));
        }

        if adapter.is_semantic_truth_source {
            out.push(diag(
                &format!("adapters.{plat}.isSemanticTruthSource"),
                vmz_protocol::Severity::Error,
                "platform adapter must not become semantic truth — VPG/Plan remain sole semantic IR",
                DIAG_ADAPTER_IS_SEMANTIC_CORE,
            ));
        }

        let shared = &mp.shared;
        let checks = [
            ("bridgeSchema", adapter.bridge_schema.as_str(), shared.bridge_schema.as_str()),
            (
                "capabilityCallSchema",
                adapter.capability_call_schema.as_str(),
                shared.capability_call_schema.as_str(),
            ),
            ("surfaceSchema", adapter.surface_schema.as_str(), shared.surface_schema.as_str()),
            ("shellSchema", adapter.shell_schema.as_str(), shared.shell_schema.as_str()),
            (
                "deploymentSchema",
                adapter.deployment_schema.as_str(),
                shared.deployment_schema.as_str(),
            ),
            (
                "fullstackSchema",
                adapter.fullstack_schema.as_str(),
                shared.fullstack_schema.as_str(),
            ),
            (
                "testContractSchema",
                adapter.test_contract_schema.as_str(),
                shared.test_contract_schema.as_str(),
            ),
        ];
        for (field, got, want) in checks {
            if got != want {
                out.push(diag(
                    &format!("adapters.{plat}.{field}"),
                    vmz_protocol::Severity::Error,
                    format!("platform semantic fork: {field} `{got}` ≠ shared `{want}`"),
                    DIAG_PLATFORM_SEMANTIC_FORK,
                ));
            }
            if looks_platform_private(got) {
                out.push(diag(
                    &format!("adapters.{plat}.{field}"),
                    vmz_protocol::Severity::Error,
                    format!("platform-private schema forbidden: `{got}`"),
                    DIAG_PLATFORM_PRIVATE_SCHEMA,
                ));
            }
        }
    }

    for adapter in &mp.adapters {
        if !NativePlatformId::ALL.contains(&adapter.platform) {
            out.push(diag(
                &format!("adapters.{}", adapter.platform),
                vmz_protocol::Severity::Error,
                format!(
                    "unknown platform `{}` — native first version is ios|android only",
                    adapter.platform
                ),
                DIAG_INVALID_PROFILE,
            ));
        }
    }

    let _ = (
        BRIDGE_PROTOCOL_SCHEMA,
        CAPABILITY_CALL_SCHEMA,
        NATIVE_SURFACE_SCHEMA,
        SHELL_SCHEMA,
        WEBVIEW_DEPLOYMENT_SCHEMA,
        FULLSTACK_SCHEMA,
        MULTI_PLATFORM_TEST_SCHEMA,
    );
}

fn load_or_example(
    root: &Path,
    diags: &mut Vec<NativeHostDiagnostic>,
) -> NativeMultiPlatformManifest {
    let path = root.join("native-multi-platform.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<NativeMultiPlatformManifest>(&text) {
                Ok(m) => return m,
                Err(e) => diags.push(diag(
                    "native-multi-platform.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeMultiPlatformManifest JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-multi-platform.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-multi-platform.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeMultiPlatformManifest::ios_android_example()
}

/// native check for a workspace root (optional `native-multi-platform.json`).
pub fn check_multi_platform_contract(root: &Path) -> NativeMultiPlatformCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let multi_platform = load_or_example(root, &mut diagnostics);
    validate_manifest(&multi_platform, &mut diagnostics);

    let foul = root.join("native-multi-platform.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            if let Ok(bad) = serde_json::from_str::<NativeMultiPlatformManifest>(&text) {
                validate_manifest(&bad, &mut diagnostics);
            } else if text.contains("allowsPlatformSemanticFork")
                || text.contains("com.android.private")
                || text.contains("com.apple.")
            {
                diagnostics.push(diag(
                    "native-multi-platform.foul.json",
                    vmz_protocol::Severity::Error,
                    "forbidden multi-platform fork assumptions in foul fixture",
                    DIAG_PLATFORM_SEMANTIC_FORK,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeMultiPlatformCheckReport {
        schema: MULTI_PLATFORM_CHECK_SCHEMA.into(),
        catalog,
        multi_platform,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
