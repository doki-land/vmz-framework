//! native: NativeSurface contract .
//!
//! Algebraic first version: freeze NativeSurfaceId + owner RegionId + lifetime,
//! prove one high-value surface (camera.preview). NativeSurface ≠ NativeBacked
//! capability; no implicit WebView state sharing; surface is not semantic truth.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_IMPLICIT_STATE_SHARE, DIAG_INVALID_PROFILE, DIAG_MISSING_OWNER_REGION,
    DIAG_MISSING_SURFACE_ID, DIAG_MISSING_SURFACE_LIFETIME, DIAG_SURFACE_IS_CAPABILITY,
    DIAG_SURFACE_IS_SEMANTIC_TRUTH, NATIVE_SURFACE_CHECK_SCHEMA, NativeHostDiagnostic,
    NativeHostProtocolCatalog, NativeSurfaceCheckReport, NativeSurfaceManifest,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_surface(surface: &NativeSurfaceManifest, out: &mut Vec<NativeHostDiagnostic>) {
    if surface.schema != vmz_protocol::NATIVE_SURFACE_SCHEMA {
        out.push(diag(
            "schema",
            vmz_protocol::Severity::Error,
            format!("native surface schema must be `{}`", vmz_protocol::NATIVE_SURFACE_SCHEMA),
            DIAG_INVALID_PROFILE,
        ));
    }

    if surface.surface_id.trim().is_empty() {
        out.push(diag(
            "surfaceId",
            vmz_protocol::Severity::Error,
            "NativeSurfaceId required",
            DIAG_MISSING_SURFACE_ID,
        ));
    }

    // Closed [`NativeSurfaceKind`] validates at deserialize; no open-string kind check.

    if surface.owner_region_id.trim().is_empty() {
        out.push(diag(
            "ownerRegionId",
            vmz_protocol::Severity::Error,
            "NativeSurface must declare owner RegionId",
            DIAG_MISSING_OWNER_REGION,
        ));
    }

    if surface.lifetime.trim().is_empty() {
        out.push(diag(
            "lifetime",
            vmz_protocol::Severity::Error,
            "NativeSurface lifetime required (e.g. bound_to_region)",
            DIAG_MISSING_SURFACE_LIFETIME,
        ));
    }

    if !surface.dispose_on_owner_destroy {
        out.push(diag(
            "disposeOnOwnerDestroy",
            vmz_protocol::Severity::Error,
            "NativeSurface must dispose when owner region destroys",
            DIAG_MISSING_SURFACE_LIFETIME,
        ));
    }

    if surface.shares_implicit_webview_state {
        out.push(diag(
            "sharesImplicitWebViewState",
            vmz_protocol::Severity::Error,
            "WebView and NativeSurface must not share implicit state objects",
            DIAG_IMPLICIT_STATE_SHARE,
        ));
    }

    if surface.confused_with_capability {
        out.push(diag(
            "confusedWithCapability",
            vmz_protocol::Severity::Error,
            "NativeSurface ≠ NativeBacked capability (e.g. camera.preview ≠ camera.capture)",
            DIAG_SURFACE_IS_CAPABILITY,
        ));
    }

    if surface.is_semantic_truth_source {
        out.push(diag(
            "isSemanticTruthSource",
            vmz_protocol::Severity::Error,
            "NativeSurface must not become semantic truth — VPG/Plan remain sole semantic IR",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    if surface.plan_schema != "vmz.plan.v0" {
        out.push(diag(
            "planSchema",
            vmz_protocol::Severity::Error,
            "NativeSurface must lower from same Execution Plan (vmz.plan.v0)",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    if !surface.reuses_view_operations {
        out.push(diag(
            "reusesViewOperations",
            vmz_protocol::Severity::Error,
            "NativeSurface driver must consume target-neutral View Operations only",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    // Cross-boundary data must be serializable/versioned.
    if !surface.boundary.serializable || surface.boundary.schema_version.trim().is_empty() {
        out.push(diag(
            "boundary",
            vmz_protocol::Severity::Error,
            "cross-boundary data must be serializable + versioned",
            DIAG_IMPLICIT_STATE_SHARE,
        ));
    }
}

fn load_or_example(root: &Path, diags: &mut Vec<NativeHostDiagnostic>) -> NativeSurfaceManifest {
    let path = root.join("native-surface.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<NativeSurfaceManifest>(&text) {
                Ok(s) => return s,
                Err(e) => diags.push(diag(
                    "native-surface.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeSurfaceManifest JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-surface.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-surface.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeSurfaceManifest::camera_preview_example()
}

/// native check for a workspace root (optional `native-surface.json`).
pub fn check_native_surface_contract(root: &Path) -> NativeSurfaceCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let surface = load_or_example(root, &mut diagnostics);
    validate_surface(&surface, &mut diagnostics);

    let foul = root.join("native-surface.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            if let Ok(bad) = serde_json::from_str::<NativeSurfaceManifest>(&text) {
                validate_surface(&bad, &mut diagnostics);
            } else if text.contains("sharesImplicitWebViewState")
                || text.contains("isSemanticTruthSource")
            {
                diagnostics.push(diag(
                    "native-surface.foul.json",
                    vmz_protocol::Severity::Error,
                    "forbidden NativeSurface assumptions in foul fixture",
                    DIAG_IMPLICIT_STATE_SHARE,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeSurfaceCheckReport {
        schema: NATIVE_SURFACE_CHECK_SCHEMA.into(),
        catalog,
        surface,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
