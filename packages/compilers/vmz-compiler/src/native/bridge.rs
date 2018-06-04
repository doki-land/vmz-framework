//! native: typed Native Capability Bridge contract .
//!
//! Algebraic first version: freeze capability-call envelope (origin/nonce/
//! permission/timeout/cancel/trace) + first-batch stubs
//! (camera/file/share/storage). No real-device adapters yet.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    BRIDGE_CHECK_SCHEMA, BridgeStubCatalog, CapabilityClass, DIAG_ARBITRARY_BRIDGE,
    DIAG_CALL_NOT_ALLOWLISTED, DIAG_INVALID_PROFILE, DIAG_MISSING_CANCEL, DIAG_MISSING_NONCE,
    DIAG_MISSING_ORIGIN, DIAG_MISSING_PERMISSION, DIAG_MISSING_TIMEOUT, DIAG_MISSING_TRACE,
    DIAG_UNKNOWN_STUB, FIRST_BATCH_STUB_IDS, FORBIDDEN_BRIDGE_PATTERNS, NativeBridgeCheckReport,
    NativeCapabilityCall, NativeHostDiagnostic, NativeHostProtocolCatalog,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn scan_forbidden(path: &str, text: &str, out: &mut Vec<NativeHostDiagnostic>) {
    for pat in FORBIDDEN_BRIDGE_PATTERNS {
        if text.contains(pat) {
            out.push(diag(
                path,
                vmz_protocol::Severity::Error,
                format!(
                    "forbidden arbitrary bridge pattern `{pat}` — use typed NativeCapabilityCall only"
                ),
                DIAG_ARBITRARY_BRIDGE,
            ));
        }
    }
}

fn validate_stub_catalog(catalog: &BridgeStubCatalog, out: &mut Vec<NativeHostDiagnostic>) {
    for id in FIRST_BATCH_STUB_IDS {
        if !catalog.stubs.iter().any(|s| s.id == *id) {
            out.push(diag(
                "stubCatalog",
                vmz_protocol::Severity::Error,
                format!("missing first-batch stub `{id}`"),
                DIAG_UNKNOWN_STUB,
            ));
        }
        if !catalog.allowlist.iter().any(|a| a == id) {
            out.push(diag(
                "stubCatalog.allowlist",
                vmz_protocol::Severity::Error,
                format!("first-batch stub `{id}` not allowlisted"),
                DIAG_CALL_NOT_ALLOWLISTED,
            ));
        }
    }
    for stub in &catalog.stubs {
        if stub.capability_class != CapabilityClass::NativeBacked {
            out.push(diag(
                &stub.id,
                vmz_protocol::Severity::Error,
                format!(
                    "native first-batch stub `{}` must be NativeBacked, got `{}`",
                    stub.id, stub.capability_class
                ),
                DIAG_UNKNOWN_STUB,
            ));
        }
        if stub.async_ && !stub.cancellation {
            out.push(diag(
                &stub.id,
                vmz_protocol::Severity::Error,
                format!("async stub `{}` requires cancellation=true", stub.id),
                DIAG_MISSING_CANCEL,
            ));
        }
        if !stub.trace {
            out.push(diag(
                &stub.id,
                vmz_protocol::Severity::Error,
                format!("stub `{}` requires trace=true", stub.id),
                DIAG_MISSING_TRACE,
            ));
        }
        if stub.permissions.is_empty() {
            out.push(diag(
                &stub.id,
                vmz_protocol::Severity::Error,
                format!("stub `{}` requires declared permissions", stub.id),
                DIAG_MISSING_PERMISSION,
            ));
        }
    }
}

fn validate_call(
    call: &NativeCapabilityCall,
    allowlist: &[String],
    out: &mut Vec<NativeHostDiagnostic>,
) {
    let path = format!("call:{}", call.call_id);
    if call.origin.trim().is_empty() {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires origin",
            DIAG_MISSING_ORIGIN,
        ));
    }
    if call.nonce.trim().is_empty() {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires nonce",
            DIAG_MISSING_NONCE,
        ));
    }
    if call.timeout_ms == 0 {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires timeoutMs > 0",
            DIAG_MISSING_TIMEOUT,
        ));
    }
    if !call.cancellation {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires cancellation=true",
            DIAG_MISSING_CANCEL,
        ));
    }
    if call.trace.correlation_id.trim().is_empty() || !call.trace.redact_sensitive {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires trace.correlationId + redactSensitive=true",
            DIAG_MISSING_TRACE,
        ));
    }
    if call.permissions.is_empty() {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            "capability call requires permissions",
            DIAG_MISSING_PERMISSION,
        ));
    }
    if !allowlist.iter().any(|id| id == &call.capability_id) {
        out.push(diag(
            &path,
            vmz_protocol::Severity::Error,
            format!("capability `{}` is not in bridge allowlist", call.capability_id),
            DIAG_CALL_NOT_ALLOWLISTED,
        ));
    }
    scan_forbidden(&path, &call.to_json(), out);
}

fn load_calls(root: &Path, diags: &mut Vec<NativeHostDiagnostic>) -> Vec<NativeCapabilityCall> {
    let path = root.join("native-bridge.calls.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<Vec<NativeCapabilityCall>>(&text) {
                Ok(calls) => return calls,
                Err(e) => diags.push(diag(
                    "native-bridge.calls.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeCapabilityCall[] JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-bridge.calls.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-bridge.calls.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    vec![NativeCapabilityCall::camera_capture_example()]
}

fn load_stub_catalog(root: &Path, diags: &mut Vec<NativeHostDiagnostic>) -> BridgeStubCatalog {
    let path = root.join("native-bridge.stubs.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<BridgeStubCatalog>(&text) {
                Ok(c) => return c,
                Err(e) => diags.push(diag(
                    "native-bridge.stubs.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid BridgeStubCatalog JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-bridge.stubs.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-bridge.stubs.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    BridgeStubCatalog::first_batch()
}

/// native check for a workspace root.
pub fn check_native_bridge_contract(root: &Path) -> NativeBridgeCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let stub_catalog = load_stub_catalog(root, &mut diagnostics);
    validate_stub_catalog(&stub_catalog, &mut diagnostics);

    let sample_calls = load_calls(root, &mut diagnostics);
    for call in &sample_calls {
        validate_call(call, &stub_catalog.allowlist, &mut diagnostics);
    }

    // Optional foul fixture for arbitrary injection.
    let foul = root.join("native-bridge.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            scan_forbidden("native-bridge.foul.json", &text, &mut diagnostics);
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeBridgeCheckReport {
        schema: BRIDGE_CHECK_SCHEMA.into(),
        catalog,
        stub_catalog,
        sample_calls,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
