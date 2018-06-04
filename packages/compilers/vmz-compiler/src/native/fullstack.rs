//! native: NativeAppHost Full-stack contract .
//!
//! Algebraic first version: freeze SSR first-paint + `#server` transport +
//! auth/session + push + network policy + remote/hybrid delivery integrity.
//! Native bridge must never bypass `#server` security. Bundled SSR and remote
//! SSR must not silently share cookie/origin assumptions.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    AssetMode, ContentDeliveryMode, DIAG_BRIDGE_BYPASSES_SERVER, DIAG_INVALID_PROFILE,
    DIAG_MISSING_AUTH_SESSION, DIAG_MISSING_NETWORK_POLICY, DIAG_MISSING_SERVER_TRANSPORT,
    DIAG_MISSING_SSR_FIRST_PAINT, DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS, DIAG_REMOTE_WITHOUT_INTEGRITY,
    FULLSTACK_CHECK_SCHEMA, NativeFullstackCheckReport, NativeFullstackProfile,
    NativeHostDiagnostic, NativeHostProtocolCatalog,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_fullstack(profile: &NativeFullstackProfile, out: &mut Vec<NativeHostDiagnostic>) {
    if profile.schema != vmz_protocol::FULLSTACK_SCHEMA {
        out.push(diag(
            "schema",
            vmz_protocol::Severity::Error,
            format!("fullstack schema must be `{}`", vmz_protocol::FULLSTACK_SCHEMA),
            DIAG_INVALID_PROFILE,
        ));
    }

    // SSR first paint
    if profile.ssr.enabled {
        // Closed [`ContentDeliveryMode`] validates at deserialize.
        if profile.ssr.plan_schema != "vmz.plan.v0" {
            out.push(diag(
                "ssr.planSchema",
                vmz_protocol::Severity::Error,
                "SSR first-paint must reference vmz.plan.v0 (same Execution Plan)",
                DIAG_MISSING_SSR_FIRST_PAINT,
            ));
        }
        if profile.ssr.mode == ContentDeliveryMode::Remote
            && profile.ssr.integrity.trim().is_empty()
        {
            out.push(diag(
                "ssr.integrity",
                vmz_protocol::Severity::Error,
                "remote SSR requires explicit integrity (not silent default)",
                DIAG_REMOTE_WITHOUT_INTEGRITY,
            ));
        }
        if profile.ssr.mode == ContentDeliveryMode::Hybrid
            && profile.ssr.allow_mixed_cookie_assumptions
        {
            out.push(diag(
                "ssr.allowMixedCookieAssumptions",
                vmz_protocol::Severity::Error,
                "bundled SSR and remote SSR must not share cookie/origin assumptions",
                DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS,
            ));
        }
    } else {
        out.push(diag(
            "ssr.enabled",
            vmz_protocol::Severity::Error,
            "native requires SSR first-paint policy enabled for NativeAppHost WebSurface",
            DIAG_MISSING_SSR_FIRST_PAINT,
        ));
    }

    // #server transport
    if profile.server_transport.scheme != "#server" {
        out.push(diag(
            "serverTransport.scheme",
            vmz_protocol::Severity::Error,
            "server transport scheme must be `#server`",
            DIAG_MISSING_SERVER_TRANSPORT,
        ));
    }
    if profile.server_transport.endpoint.trim().is_empty() {
        out.push(diag(
            "serverTransport.endpoint",
            vmz_protocol::Severity::Error,
            "server transport endpoint required",
            DIAG_MISSING_SERVER_TRANSPORT,
        ));
    }
    if profile.server_transport.bridge_bypasses_server {
        out.push(diag(
            "serverTransport.bridgeBypassesServer",
            vmz_protocol::Severity::Error,
            "Native bridge must not bypass `#server` security boundary",
            DIAG_BRIDGE_BYPASSES_SERVER,
        ));
    }

    // auth / session — closed [`AuthSessionMode`] validates at deserialize.
    if profile.auth.session_namespace.trim().is_empty() {
        out.push(diag(
            "auth.sessionNamespace",
            vmz_protocol::Severity::Error,
            "auth sessionNamespace required (isolate WebView storage)",
            DIAG_MISSING_AUTH_SESSION,
        ));
    }
    if !profile.auth.reauth_on_webview_crash {
        out.push(diag(
            "auth.reauthOnWebViewCrash",
            vmz_protocol::Severity::Error,
            "auth must require reauthOnWebViewCrash=true",
            DIAG_MISSING_AUTH_SESSION,
        ));
    }

    // push (declared, may be stub)
    if profile.push.capability_id.trim().is_empty() {
        out.push(diag(
            "push.capabilityId",
            vmz_protocol::Severity::Error,
            "push capability id required (stub ok)",
            DIAG_INVALID_PROFILE,
        ));
    }

    // network policy — closed [`NetworkMode`] validates at deserialize.
    if profile.network.allow_cleartext {
        out.push(diag(
            "network.allowCleartext",
            vmz_protocol::Severity::Error,
            "cleartext network must not be enabled for native default profile",
            DIAG_MISSING_NETWORK_POLICY,
        ));
    }

    // delivery asset mode for remote/hybrid
    if matches!(profile.delivery_asset_mode, AssetMode::Remote | AssetMode::Hybrid)
        && profile.delivery_integrity.trim().is_empty()
    {
        out.push(diag(
            "deliveryIntegrity",
            vmz_protocol::Severity::Error,
            "remote/hybrid delivery requires integrity/signing evidence",
            DIAG_REMOTE_WITHOUT_INTEGRITY,
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
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeFullstackProfile JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-fullstack.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-fullstack.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeFullstackProfile::example()
}

/// native check for a workspace root (optional `native-fullstack.json`).
pub fn check_native_fullstack_contract(root: &Path) -> NativeFullstackCheckReport {
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
                    vmz_protocol::Severity::Error,
                    "forbidden fullstack assumptions in foul fixture",
                    DIAG_BRIDGE_BYPASSES_SERVER,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeFullstackCheckReport {
        schema: FULLSTACK_CHECK_SCHEMA.into(),
        catalog,
        fullstack: profile,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
