//! NW4: NativeAppHost Full-stack contract (doc 27 §6 / §10).
//!
//! Algebraic first version: freeze SSR first-paint + `#server` transport +
//! auth/session + push + network policy + remote/hybrid delivery integrity.
//! Native bridge must never bypass `#server` security. Bundled SSR and remote
//! SSR must not silently share cookie/origin assumptions.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_BRIDGE_BYPASSES_SERVER, DIAG_INVALID_PROFILE, DIAG_MISSING_AUTH_SESSION,
    DIAG_MISSING_NETWORK_POLICY, DIAG_MISSING_SERVER_TRANSPORT, DIAG_MISSING_SSR_FIRST_PAINT,
    DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS, DIAG_REMOTE_WITHOUT_INTEGRITY, FULLSTACK_CHECK_SCHEMA,
    NativeFullstackCheckReport, NativeFullstackProfile, NativeHostDiagnostic,
    NativeHostProtocolCatalog,
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

fn validate_fullstack(profile: &NativeFullstackProfile, out: &mut Vec<NativeHostDiagnostic>) {
    if profile.schema != vmz_protocol::FULLSTACK_SCHEMA {
        out.push(diag(
            "schema",
            "error",
            format!("fullstack schema must be `{}`", vmz_protocol::FULLSTACK_SCHEMA),
            DIAG_INVALID_PROFILE,
        ));
    }

    // SSR first paint
    if profile.ssr.enabled {
        if profile.ssr.mode.trim().is_empty() {
            out.push(diag(
                "ssr.mode",
                "error",
                "SSR first-paint mode required when enabled",
                DIAG_MISSING_SSR_FIRST_PAINT,
            ));
        }
        if !matches!(profile.ssr.mode.as_str(), "bundled" | "remote" | "hybrid") {
            out.push(diag(
                "ssr.mode",
                "error",
                format!("unknown ssr.mode `{}`", profile.ssr.mode),
                DIAG_MISSING_SSR_FIRST_PAINT,
            ));
        }
        if profile.ssr.plan_schema != "vmz.plan.v0" {
            out.push(diag(
                "ssr.planSchema",
                "error",
                "SSR first-paint must reference vmz.plan.v0 (same Execution Plan)",
                DIAG_MISSING_SSR_FIRST_PAINT,
            ));
        }
        if profile.ssr.mode == "remote" && profile.ssr.integrity.trim().is_empty() {
            out.push(diag(
                "ssr.integrity",
                "error",
                "remote SSR requires explicit integrity (not silent default)",
                DIAG_REMOTE_WITHOUT_INTEGRITY,
            ));
        }
        if profile.ssr.mode == "hybrid" && profile.ssr.allow_mixed_cookie_assumptions {
            out.push(diag(
                "ssr.allowMixedCookieAssumptions",
                "error",
                "bundled SSR and remote SSR must not share cookie/origin assumptions",
                DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS,
            ));
        }
    } else {
        out.push(diag(
            "ssr.enabled",
            "error",
            "NW4 requires SSR first-paint policy enabled for NativeAppHost WebSurface",
            DIAG_MISSING_SSR_FIRST_PAINT,
        ));
    }

    // #server transport
    if profile.server_transport.scheme != "#server" {
        out.push(diag(
            "serverTransport.scheme",
            "error",
            "server transport scheme must be `#server`",
            DIAG_MISSING_SERVER_TRANSPORT,
        ));
    }
    if profile.server_transport.endpoint.trim().is_empty() {
        out.push(diag(
            "serverTransport.endpoint",
            "error",
            "server transport endpoint required",
            DIAG_MISSING_SERVER_TRANSPORT,
        ));
    }
    if profile.server_transport.bridge_bypasses_server {
        out.push(diag(
            "serverTransport.bridgeBypassesServer",
            "error",
            "Native bridge must not bypass `#server` security boundary",
            DIAG_BRIDGE_BYPASSES_SERVER,
        ));
    }

    // auth / session
    if profile.auth.mode.trim().is_empty() {
        out.push(diag(
            "auth.mode",
            "error",
            "auth/session mode required",
            DIAG_MISSING_AUTH_SESSION,
        ));
    }
    if profile.auth.session_namespace.trim().is_empty() {
        out.push(diag(
            "auth.sessionNamespace",
            "error",
            "auth sessionNamespace required (isolate WebView storage)",
            DIAG_MISSING_AUTH_SESSION,
        ));
    }
    if !profile.auth.reauth_on_webview_crash {
        out.push(diag(
            "auth.reauthOnWebViewCrash",
            "error",
            "auth must require reauthOnWebViewCrash=true",
            DIAG_MISSING_AUTH_SESSION,
        ));
    }

    // push (declared, may be stub)
    if profile.push.capability_id.trim().is_empty() {
        out.push(diag(
            "push.capabilityId",
            "error",
            "push capability id required (stub ok)",
            DIAG_INVALID_PROFILE,
        ));
    }

    // network policy
    if profile.network.mode.trim().is_empty() {
        out.push(diag(
            "network.mode",
            "error",
            "network policy mode required",
            DIAG_MISSING_NETWORK_POLICY,
        ));
    }
    if profile.network.allow_cleartext {
        out.push(diag(
            "network.allowCleartext",
            "error",
            "cleartext network must not be enabled for NW4 default profile",
            DIAG_MISSING_NETWORK_POLICY,
        ));
    }

    // delivery asset mode for remote/hybrid
    if matches!(profile.delivery_asset_mode.as_str(), "remote" | "hybrid")
        && profile.delivery_integrity.trim().is_empty()
    {
        out.push(diag(
            "deliveryIntegrity",
            "error",
            "remote/hybrid delivery requires integrity/signing evidence",
            DIAG_REMOTE_WITHOUT_INTEGRITY,
        ));
    }
    if !matches!(profile.delivery_asset_mode.as_str(), "local" | "remote" | "hybrid") {
        out.push(diag(
            "deliveryAssetMode",
            "error",
            format!("unknown deliveryAssetMode `{}`", profile.delivery_asset_mode),
            DIAG_INVALID_PROFILE,
        ));
    }
}

fn load_or_example(root: &Path, diags: &mut Vec<NativeHostDiagnostic>) -> NativeFullstackProfile {
    let path = root.join("native-fullstack.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<NativeFullstackProfile>(&text) {
                Ok(p) => return p,
                Err(e) => diags.push(diag(
                    "native-fullstack.json",
                    "error",
                    format!("invalid NativeFullstackProfile JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-fullstack.json",
                "error",
                format!("cannot read native-fullstack.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeFullstackProfile::example()
}

/// NW4 check for a workspace root (optional `native-fullstack.json`).
pub fn check_nw4_native_fullstack_contract(root: &Path) -> NativeFullstackCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let profile = load_or_example(root, &mut diagnostics);
    validate_fullstack(&profile, &mut diagnostics);

    let foul = root.join("native-fullstack.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            if let Ok(bad) = serde_json::from_str::<NativeFullstackProfile>(&text) {
                validate_fullstack(&bad, &mut diagnostics);
            } else if text.contains("bridgeBypassesServer") || text.contains("allowCleartext") {
                diagnostics.push(diag(
                    "native-fullstack.foul.json",
                    "error",
                    "forbidden fullstack assumptions in foul fixture",
                    DIAG_BRIDGE_BYPASSES_SERVER,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    NativeFullstackCheckReport {
        schema: FULLSTACK_CHECK_SCHEMA.into(),
        catalog,
        fullstack: profile,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_fullstack_ready() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw4-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let report = check_nw4_native_fullstack_contract(&dir);
        assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
        assert_eq!(report.fullstack.server_transport.scheme, "#server");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_bridge_bypasses_server() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw4-bypass-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut p = NativeFullstackProfile::example();
        p.server_transport.bridge_bypasses_server = true;
        fs::write(dir.join("native-fullstack.json"), p.to_json()).unwrap();
        let report = check_nw4_native_fullstack_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_BRIDGE_BYPASSES_SERVER))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_remote_ssr_without_integrity() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw4-remote-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut p = NativeFullstackProfile::example();
        p.ssr.mode = "remote".into();
        p.ssr.integrity.clear();
        fs::write(dir.join("native-fullstack.json"), p.to_json()).unwrap();
        let report = check_nw4_native_fullstack_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_REMOTE_WITHOUT_INTEGRITY))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
