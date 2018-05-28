//! NW2: typed Native Capability Bridge contract (doc 27 §4 / §10).
//!
//! Algebraic first version: freeze capability-call envelope (origin/nonce/
//! permission/timeout/cancel/trace) + first-batch stubs
//! (camera/file/share/storage). No real-device adapters yet.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    BRIDGE_CHECK_SCHEMA, BridgeStubCatalog, DIAG_ARBITRARY_BRIDGE, DIAG_CALL_NOT_ALLOWLISTED,
    DIAG_INVALID_PROFILE, DIAG_MISSING_CANCEL, DIAG_MISSING_NONCE, DIAG_MISSING_ORIGIN,
    DIAG_MISSING_PERMISSION, DIAG_MISSING_TIMEOUT, DIAG_MISSING_TRACE, DIAG_UNKNOWN_STUB,
    FIRST_BATCH_STUB_IDS, FORBIDDEN_BRIDGE_PATTERNS, NativeBridgeCheckReport, NativeCapabilityCall,
    NativeHostDiagnostic, NativeHostProtocolCatalog,
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

fn scan_forbidden(path: &str, text: &str, out: &mut Vec<NativeHostDiagnostic>) {
    for pat in FORBIDDEN_BRIDGE_PATTERNS {
        if text.contains(pat) {
            out.push(diag(
                path,
                "error",
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
                "error",
                format!("missing first-batch stub `{id}`"),
                DIAG_UNKNOWN_STUB,
            ));
        }
        if !catalog.allowlist.iter().any(|a| a == id) {
            out.push(diag(
                "stubCatalog.allowlist",
                "error",
                format!("first-batch stub `{id}` not allowlisted"),
                DIAG_CALL_NOT_ALLOWLISTED,
            ));
        }
    }
    for stub in &catalog.stubs {
        if stub.capability_class != "NativeBacked" {
            out.push(diag(
                &stub.id,
                "error",
                format!(
                    "NW2 first-batch stub `{}` must be NativeBacked, got `{}`",
                    stub.id, stub.capability_class
                ),
                DIAG_UNKNOWN_STUB,
            ));
        }
        if stub.async_ && !stub.cancellation {
            out.push(diag(
                &stub.id,
                "error",
                format!("async stub `{}` requires cancellation=true", stub.id),
                DIAG_MISSING_CANCEL,
            ));
        }
        if !stub.trace {
            out.push(diag(
                &stub.id,
                "error",
                format!("stub `{}` requires trace=true", stub.id),
                DIAG_MISSING_TRACE,
            ));
        }
        if stub.permissions.is_empty() {
            out.push(diag(
                &stub.id,
                "error",
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
        out.push(diag(&path, "error", "capability call requires origin", DIAG_MISSING_ORIGIN));
    }
    if call.nonce.trim().is_empty() {
        out.push(diag(&path, "error", "capability call requires nonce", DIAG_MISSING_NONCE));
    }
    if call.timeout_ms == 0 {
        out.push(diag(
            &path,
            "error",
            "capability call requires timeoutMs > 0",
            DIAG_MISSING_TIMEOUT,
        ));
    }
    if !call.cancellation {
        out.push(diag(
            &path,
            "error",
            "capability call requires cancellation=true",
            DIAG_MISSING_CANCEL,
        ));
    }
    if call.trace.correlation_id.trim().is_empty() || !call.trace.redact_sensitive {
        out.push(diag(
            &path,
            "error",
            "capability call requires trace.correlationId + redactSensitive=true",
            DIAG_MISSING_TRACE,
        ));
    }
    if call.permissions.is_empty() {
        out.push(diag(
            &path,
            "error",
            "capability call requires permissions",
            DIAG_MISSING_PERMISSION,
        ));
    }
    if !allowlist.iter().any(|id| id == &call.capability_id) {
        out.push(diag(
            &path,
            "error",
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
                    "error",
                    format!("invalid NativeCapabilityCall[] JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-bridge.calls.json",
                "error",
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
                    "error",
                    format!("invalid BridgeStubCatalog JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-bridge.stubs.json",
                "error",
                format!("cannot read native-bridge.stubs.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    BridgeStubCatalog::first_batch()
}

/// NW2 check for a workspace root.
pub fn check_nw2_native_bridge_contract(root: &Path) -> NativeBridgeCheckReport {
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

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    NativeBridgeCheckReport {
        schema: BRIDGE_CHECK_SCHEMA.into(),
        catalog,
        stub_catalog,
        sample_calls,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_bridge_ready() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw2-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let report = check_nw2_native_bridge_contract(&dir);
        assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
        assert_eq!(report.stub_catalog.allowlist.len(), 5);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_missing_nonce() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw2-nonce-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut call = NativeCapabilityCall::camera_capture_example();
        call.nonce.clear();
        fs::write(dir.join("native-bridge.calls.json"), serde_json::to_string(&[call]).unwrap())
            .unwrap();
        let report = check_nw2_native_bridge_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_MISSING_NONCE)));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_not_allowlisted() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw2-allow-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut call = NativeCapabilityCall::camera_capture_example();
        call.capability_id = "payment.charge".into();
        fs::write(dir.join("native-bridge.calls.json"), serde_json::to_string(&[call]).unwrap())
            .unwrap();
        let report = check_nw2_native_bridge_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_CALL_NOT_ALLOWLISTED))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
