//! native: NativeAppHost App Lifecycle contract .
//!
//! Algebraic first version: freeze lifecycle events (foreground/background,
//! crash/restore, destroy), persistence, update/rollback, and offline policy.
//! Background ≠ destroy; crash restore must not assume JS heap survives.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_BACKGROUND_IS_DESTROY, DIAG_CRASH_ASSUMES_JS_HEAP, DIAG_INVALID_PROFILE,
    DIAG_MISSING_LIFECYCLE_EVENT, DIAG_MISSING_PERSISTENCE, LIFECYCLE_CHECK_SCHEMA,
    NativeAppLifecyclePolicy, NativeHostDiagnostic, NativeHostProtocolCatalog,
    NativeLifecycleCheckReport, NativeLifecycleEvent,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_lifecycle(policy: &NativeAppLifecyclePolicy, out: &mut Vec<NativeHostDiagnostic>) {
    for ev in NativeLifecycleEvent::ALL {
        if !policy.events.iter().any(|e| e == ev) {
            out.push(diag(
                "events",
                vmz_protocol::Severity::Error,
                format!("missing required lifecycle event `{ev}`"),
                DIAG_MISSING_LIFECYCLE_EVENT,
            ));
        }
    }

    if policy.background_equals_destroy {
        out.push(diag(
            "backgroundEqualsDestroy",
            vmz_protocol::Severity::Error,
            "background must not equal destroy — host must keep owned regions until destroy",
            DIAG_BACKGROUND_IS_DESTROY,
        ));
    }

    if policy.crash_restore_assumes_js_heap {
        out.push(diag(
            "crashRestoreAssumesJsHeap",
            vmz_protocol::Severity::Error,
            "crash restore must not assume JS heap survives — require explicit persistence/reauth",
            DIAG_CRASH_ASSUMES_JS_HEAP,
        ));
    }

    // Closed [`PersistenceMode`] / [`OfflineMode`] validate at deserialize.
    if !policy.persistence.enabled {
        out.push(diag(
            "persistence",
            vmz_protocol::Severity::Error,
            "native requires explicit persistence policy (enabled)",
            DIAG_MISSING_PERSISTENCE,
        ));
    }
    if !policy.persistence.reauth_on_restore {
        out.push(diag(
            "persistence.reauthOnRestore",
            vmz_protocol::Severity::Error,
            "crash/restore path must declare reauthOnRestore=true when credentials may be lost",
            DIAG_MISSING_PERSISTENCE,
        ));
    }

    // Closed [`UpdateChannel`] / [`UpdateRollback`] validate at deserialize.

    if !policy.dispose_regions_on_destroy {
        out.push(diag(
            "disposeRegionsOnDestroy",
            vmz_protocol::Severity::Error,
            "destroy must dispose all owned regions",
            DIAG_MISSING_LIFECYCLE_EVENT,
        ));
    }

    if policy.schema != vmz_protocol::LIFECYCLE_SCHEMA {
        out.push(diag(
            "schema",
            vmz_protocol::Severity::Error,
            format!("lifecycle schema must be `{}`", vmz_protocol::LIFECYCLE_SCHEMA),
            DIAG_INVALID_PROFILE,
        ));
    }
}

fn load_or_example(root: &Path, diags: &mut Vec<NativeHostDiagnostic>) -> NativeAppLifecyclePolicy {
    let path = root.join("native-lifecycle.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<NativeAppLifecyclePolicy>(&text) {
                Ok(p) => return p,
                Err(e) => diags.push(diag(
                    "native-lifecycle.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeAppLifecyclePolicy JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-lifecycle.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-lifecycle.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeAppLifecyclePolicy::example()
}

/// native check for a workspace root (optional `native-lifecycle.json`).
pub fn check_native_lifecycle_contract(root: &Path) -> NativeLifecycleCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let policy = load_or_example(root, &mut diagnostics);
    validate_lifecycle(&policy, &mut diagnostics);

    let foul = root.join("native-lifecycle.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            if let Ok(bad) = serde_json::from_str::<NativeAppLifecyclePolicy>(&text) {
                validate_lifecycle(&bad, &mut diagnostics);
            } else if text.contains("backgroundEqualsDestroy")
                || text.contains("crashRestoreAssumesJsHeap")
            {
                diagnostics.push(diag(
                    "native-lifecycle.foul.json",
                    vmz_protocol::Severity::Error,
                    "forbidden lifecycle assumptions in foul fixture",
                    DIAG_BACKGROUND_IS_DESTROY,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeLifecycleCheckReport {
        schema: LIFECYCLE_CHECK_SCHEMA.into(),
        catalog,
        lifecycle: policy,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
