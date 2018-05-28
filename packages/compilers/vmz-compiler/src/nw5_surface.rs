//! NW5: NativeSurface contract (doc 27 §2.3 / §10).
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
    severity: &str,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn validate_surface(surface: &NativeSurfaceManifest, out: &mut Vec<NativeHostDiagnostic>) {
    if surface.schema != vmz_protocol::NATIVE_SURFACE_SCHEMA {
        out.push(diag(
            "schema",
            "error",
            format!("native surface schema must be `{}`", vmz_protocol::NATIVE_SURFACE_SCHEMA),
            DIAG_INVALID_PROFILE,
        ));
    }

    if surface.surface_id.trim().is_empty() {
        out.push(diag("surfaceId", "error", "NativeSurfaceId required", DIAG_MISSING_SURFACE_ID));
    }

    if surface.kind.trim().is_empty()
        || !matches!(surface.kind.as_str(), "camera" | "map" | "video")
    {
        out.push(diag(
            "kind",
            "error",
            format!("NW5 high-value surface kind must be camera|map|video, got `{}`", surface.kind),
            DIAG_INVALID_PROFILE,
        ));
    }

    if surface.owner_region_id.trim().is_empty() {
        out.push(diag(
            "ownerRegionId",
            "error",
            "NativeSurface must declare owner RegionId",
            DIAG_MISSING_OWNER_REGION,
        ));
    }

    if surface.lifetime.trim().is_empty() {
        out.push(diag(
            "lifetime",
            "error",
            "NativeSurface lifetime required (e.g. bound_to_region)",
            DIAG_MISSING_SURFACE_LIFETIME,
        ));
    }

    if !surface.dispose_on_owner_destroy {
        out.push(diag(
            "disposeOnOwnerDestroy",
            "error",
            "NativeSurface must dispose when owner region destroys",
            DIAG_MISSING_SURFACE_LIFETIME,
        ));
    }

    if surface.shares_implicit_webview_state {
        out.push(diag(
            "sharesImplicitWebViewState",
            "error",
            "WebView and NativeSurface must not share implicit state objects",
            DIAG_IMPLICIT_STATE_SHARE,
        ));
    }

    if surface.confused_with_capability {
        out.push(diag(
            "confusedWithCapability",
            "error",
            "NativeSurface ≠ NativeBacked capability (e.g. camera.preview ≠ camera.capture)",
            DIAG_SURFACE_IS_CAPABILITY,
        ));
    }

    if surface.is_semantic_truth_source {
        out.push(diag(
            "isSemanticTruthSource",
            "error",
            "NativeSurface must not become semantic truth — VPG/Plan remain sole semantic IR",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    if surface.plan_schema != "vmz.plan.v0" {
        out.push(diag(
            "planSchema",
            "error",
            "NativeSurface must lower from same Execution Plan (vmz.plan.v0)",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    if !surface.reuses_view_operations {
        out.push(diag(
            "reusesViewOperations",
            "error",
            "NativeSurface driver must consume target-neutral View Operations only",
            DIAG_SURFACE_IS_SEMANTIC_TRUTH,
        ));
    }

    // Cross-boundary data must be serializable/versioned.
    if !surface.boundary.serializable || surface.boundary.schema_version.trim().is_empty() {
        out.push(diag(
            "boundary",
            "error",
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
                    "error",
                    format!("invalid NativeSurfaceManifest JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-surface.json",
                "error",
                format!("cannot read native-surface.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeSurfaceManifest::camera_preview_example()
}

/// NW5 check for a workspace root (optional `native-surface.json`).
pub fn check_nw5_native_surface_contract(root: &Path) -> NativeSurfaceCheckReport {
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
                    "error",
                    "forbidden NativeSurface assumptions in foul fixture",
                    DIAG_IMPLICIT_STATE_SHARE,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    NativeSurfaceCheckReport {
        schema: NATIVE_SURFACE_CHECK_SCHEMA.into(),
        catalog,
        surface,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_camera_preview_ready() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw5-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let report = check_nw5_native_surface_contract(&dir);
        assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
        assert_eq!(report.surface.kind, "camera");
        assert!(!report.surface.confused_with_capability);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_implicit_state_share() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw5-share-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut s = NativeSurfaceManifest::camera_preview_example();
        s.shares_implicit_webview_state = true;
        fs::write(dir.join("native-surface.json"), s.to_json()).unwrap();
        let report = check_nw5_native_surface_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_IMPLICIT_STATE_SHARE))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_surface_as_capability() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw5-cap-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut s = NativeSurfaceManifest::camera_preview_example();
        s.confused_with_capability = true;
        fs::write(dir.join("native-surface.json"), s.to_json()).unwrap();
        let report = check_nw5_native_surface_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_SURFACE_IS_CAPABILITY))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
