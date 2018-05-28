//! NW0: NativeAppHost / WebView deployment contract (doc 27 §4 / §14).
//!
//! Algebraic first version: freeze WebViewDeploymentProfile + NativeCapability +
//! typed bridge protocol + application identity; reject arbitrary JS bridges.
//! WebView reuses Browser lowering — no second View IR.

use std::fs;
use std::path::Path;

use serde_json::Value;

use vmz_protocol::{
    DIAG_ARBITRARY_BRIDGE, DIAG_INVALID_PROFILE, DIAG_MISSING_ALLOWLIST, DIAG_MISSING_IDENTITY,
    DIAG_REMOTE_URL_DEFAULT, DIAG_UNSUPPORTED_CAPABILITY, FORBIDDEN_BRIDGE_PATTERNS,
    NATIVE_HOST_CHECK_SCHEMA, NativeCapability, NativeHostCheckReport, NativeHostDiagnostic,
    NativeHostProtocolCatalog, WebViewDeploymentProfile,
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

/// Scan bridge / profile JSON text for forbidden arbitrary-injection patterns.
pub fn scan_bridge_text_for_arbitrary(path: &str, text: &str, out: &mut Vec<NativeHostDiagnostic>) {
    for pat in FORBIDDEN_BRIDGE_PATTERNS {
        if text.contains(pat) {
            out.push(diag(
                path,
                "error",
                format!(
                    "forbidden arbitrary bridge pattern `{pat}` — use versioned NativeCapability calls only"
                ),
                DIAG_ARBITRARY_BRIDGE,
            ));
        }
    }
}

fn validate_profile(profile: &WebViewDeploymentProfile, out: &mut Vec<NativeHostDiagnostic>) {
    if profile.identity.application_id.trim().is_empty()
        || profile.identity.origin.trim().is_empty()
    {
        out.push(diag(
            "identity",
            "error",
            "WebViewDeploymentProfile requires applicationId + origin",
            DIAG_MISSING_IDENTITY,
        ));
    }
    if !profile.reuses_browser_lowering {
        out.push(diag(
            "reusesBrowserLowering",
            "error",
            "WebView must reuse Browser lowering (no second View IR)",
            DIAG_INVALID_PROFILE,
        ));
    }
    if profile.asset_mode == "remote" {
        out.push(diag(
            "assetMode",
            "error",
            "assetMode=remote must not be the silent default for NW0; use local/hybrid with integrity",
            DIAG_REMOTE_URL_DEFAULT,
        ));
    }
    if !matches!(profile.asset_mode.as_str(), "local" | "hybrid" | "remote") {
        out.push(diag(
            "assetMode",
            "error",
            format!("unknown assetMode `{}`", profile.asset_mode),
            DIAG_INVALID_PROFILE,
        ));
    }
    if !profile.bridge.require_allowlist || profile.bridge.capability_ids.is_empty() {
        out.push(diag(
            "bridge",
            "error",
            "typed bridge requires non-empty capability allowlist",
            DIAG_MISSING_ALLOWLIST,
        ));
    }
    if profile.bridge.mode != "typed_capability" {
        out.push(diag(
            "bridge.mode",
            "error",
            "bridge.mode must be typed_capability",
            DIAG_ARBITRARY_BRIDGE,
        ));
    }
    for cap in &profile.capabilities {
        if !matches!(
            cap.capability_class.as_str(),
            "PureWeb" | "NativeBacked" | "NativeSurface" | "ServerBacked" | "Unsupported"
        ) {
            out.push(diag(
                &cap.id,
                "error",
                format!("unknown capabilityClass `{}`", cap.capability_class),
                DIAG_UNSUPPORTED_CAPABILITY,
            ));
        }
        if cap.capability_class == "Unsupported" {
            out.push(diag(
                &cap.id,
                "error",
                format!("capability `{}` is Unsupported on this profile", cap.id),
                DIAG_UNSUPPORTED_CAPABILITY,
            ));
        }
        if !profile.bridge.capability_ids.iter().any(|id| id == &cap.id) {
            out.push(diag(
                &cap.id,
                "error",
                format!("capability `{}` not in bridge allowlist", cap.id),
                DIAG_MISSING_ALLOWLIST,
            ));
        }
    }
    // Serialize profile and scan for forbidden patterns.
    scan_bridge_text_for_arbitrary("webviewDeployment", &profile.to_json(), out);
}

/// NW0 check for a workspace root.
///
/// Optional `native-host.json` under root overrides the example profile.
pub fn check_nw0_native_host_contract(root: &Path) -> NativeHostCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();

    let profile = load_or_example_profile(root, &mut diagnostics);
    validate_profile(&profile, &mut diagnostics);

    // Optional foul fixture: native-host.bridge.foul.json must fail.
    let foul = root.join("native-host.bridge.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            scan_bridge_text_for_arbitrary("native-host.bridge.foul.json", &text, &mut diagnostics);
        }
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    let status = if failed { "failed" } else { "ready" };

    NativeHostCheckReport {
        schema: NATIVE_HOST_CHECK_SCHEMA.into(),
        catalog,
        webview_deployment: profile,
        diagnostics,
        status: status.into(),
    }
}

fn load_or_example_profile(
    root: &Path,
    diags: &mut Vec<NativeHostDiagnostic>,
) -> WebViewDeploymentProfile {
    let path = root.join("native-host.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<WebViewDeploymentProfile>(&text) {
                Ok(p) => return p,
                Err(e) => diags.push(diag(
                    "native-host.json",
                    "error",
                    format!("invalid WebViewDeploymentProfile JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-host.json",
                "error",
                format!("cannot read native-host.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    WebViewDeploymentProfile::local_bundled_example(
        vec![NativeCapability::camera_capture_example()],
    )
}

/// Validate an arbitrary JSON bridge candidate (gate foul injection).
pub fn check_bridge_candidate_json(text: &str) -> Vec<NativeHostDiagnostic> {
    let mut out = Vec::new();
    scan_bridge_text_for_arbitrary("bridge_candidate", text, &mut out);
    if let Ok(v) = serde_json::from_str::<Value>(text) {
        if v.get("window.native").is_some()
            || v.get("mode").and_then(|m| m.as_str()) == Some("arbitrary")
        {
            out.push(diag(
                "bridge_candidate",
                "error",
                "bridge candidate uses arbitrary injection mode",
                DIAG_ARBITRARY_BRIDGE,
            ));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_window_native_pattern() {
        let mut diags = Vec::new();
        scan_bridge_text_for_arbitrary("x", "window.native = {}", &mut diags);
        assert!(diags.iter().any(|d| d.code.as_deref() == Some(DIAG_ARBITRARY_BRIDGE)));
    }

    #[test]
    fn example_profile_is_ready() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw0-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let report = check_nw0_native_host_contract(&dir);
        assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
        assert!(report.webview_deployment.reuses_browser_lowering);
        let _ = fs::remove_dir_all(&dir);
    }
}
