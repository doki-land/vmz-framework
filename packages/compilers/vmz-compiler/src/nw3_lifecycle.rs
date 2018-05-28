//! NW3: NativeAppHost App Lifecycle contract (doc 27 §5.2 / §10).
//!
//! Algebraic first version: freeze lifecycle events (foreground/background,
//! crash/restore, destroy), persistence, update/rollback, and offline policy.
//! Background ≠ destroy; crash restore must not assume JS heap survives.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    DIAG_BACKGROUND_IS_DESTROY, DIAG_CRASH_ASSUMES_JS_HEAP, DIAG_INVALID_PROFILE,
    DIAG_MISSING_LIFECYCLE_EVENT, DIAG_MISSING_OFFLINE_POLICY, DIAG_MISSING_PERSISTENCE,
    DIAG_MISSING_UPDATE_POLICY, LIFECYCLE_CHECK_SCHEMA, NativeAppLifecyclePolicy,
    NativeHostDiagnostic, NativeHostProtocolCatalog, NativeLifecycleCheckReport,
    REQUIRED_LIFECYCLE_EVENTS,
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

fn validate_lifecycle(policy: &NativeAppLifecyclePolicy, out: &mut Vec<NativeHostDiagnostic>) {
    for ev in REQUIRED_LIFECYCLE_EVENTS {
        if !policy.events.iter().any(|e| e == *ev) {
            out.push(diag(
                "events",
                "error",
                format!("missing required lifecycle event `{ev}`"),
                DIAG_MISSING_LIFECYCLE_EVENT,
            ));
        }
    }

    if policy.background_equals_destroy {
        out.push(diag(
            "backgroundEqualsDestroy",
            "error",
            "background must not equal destroy — host must keep owned regions until destroy",
            DIAG_BACKGROUND_IS_DESTROY,
        ));
    }

    if policy.crash_restore_assumes_js_heap {
        out.push(diag(
            "crashRestoreAssumesJsHeap",
            "error",
            "crash restore must not assume JS heap survives — require explicit persistence/reauth",
            DIAG_CRASH_ASSUMES_JS_HEAP,
        ));
    }

    if !policy.persistence.enabled {
        out.push(diag(
            "persistence",
            "error",
            "NW3 requires explicit persistence policy (enabled)",
            DIAG_MISSING_PERSISTENCE,
        ));
    }
    if policy.persistence.mode.trim().is_empty() {
        out.push(diag(
            "persistence.mode",
            "error",
            "persistence.mode required (e.g. capability_backed)",
            DIAG_MISSING_PERSISTENCE,
        ));
    }
    if !policy.persistence.reauth_on_restore {
        out.push(diag(
            "persistence.reauthOnRestore",
            "error",
            "crash/restore path must declare reauthOnRestore=true when credentials may be lost",
            DIAG_MISSING_PERSISTENCE,
        ));
    }

    if policy.update.channel.trim().is_empty() {
        out.push(diag(
            "update.channel",
            "error",
            "update channel required",
            DIAG_MISSING_UPDATE_POLICY,
        ));
    }
    if policy.update.rollback.trim().is_empty() {
        out.push(diag(
            "update.rollback",
            "error",
            "update rollback policy required",
            DIAG_MISSING_UPDATE_POLICY,
        ));
    }

    if policy.offline.mode.trim().is_empty() {
        out.push(diag(
            "offline.mode",
            "error",
            "offline policy mode required",
            DIAG_MISSING_OFFLINE_POLICY,
        ));
    }
    if policy.offline.mode == "none" {
        out.push(diag(
            "offline.mode",
            "error",
            "offline.mode=none is not acceptable for NW3 local bundled host",
            DIAG_MISSING_OFFLINE_POLICY,
        ));
    }

    if !policy.dispose_regions_on_destroy {
        out.push(diag(
            "disposeRegionsOnDestroy",
            "error",
            "destroy must dispose all owned regions",
            DIAG_MISSING_LIFECYCLE_EVENT,
        ));
    }

    if policy.schema != vmz_protocol::LIFECYCLE_SCHEMA {
        out.push(diag(
            "schema",
            "error",
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
                    "error",
                    format!("invalid NativeAppLifecyclePolicy JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-lifecycle.json",
                "error",
                format!("cannot read native-lifecycle.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeAppLifecyclePolicy::example()
}

/// NW3 check for a workspace root (optional `native-lifecycle.json`).
pub fn check_nw3_native_lifecycle_contract(root: &Path) -> NativeLifecycleCheckReport {
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
                    "error",
                    "forbidden lifecycle assumptions in foul fixture",
                    DIAG_BACKGROUND_IS_DESTROY,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    NativeLifecycleCheckReport {
        schema: LIFECYCLE_CHECK_SCHEMA.into(),
        catalog,
        lifecycle: policy,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn example_lifecycle_ready() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw3-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let report = check_nw3_native_lifecycle_contract(&dir);
        assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
        assert!(!report.lifecycle.background_equals_destroy);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_background_equals_destroy() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw3-bg-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut p = NativeAppLifecyclePolicy::example();
        p.background_equals_destroy = true;
        fs::write(dir.join("native-lifecycle.json"), p.to_json()).unwrap();
        let report = check_nw3_native_lifecycle_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_BACKGROUND_IS_DESTROY))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_crash_assumes_js_heap() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-nw3-crash-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let mut p = NativeAppLifecyclePolicy::example();
        p.crash_restore_assumes_js_heap = true;
        fs::write(dir.join("native-lifecycle.json"), p.to_json()).unwrap();
        let report = check_nw3_native_lifecycle_contract(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_CRASH_ASSUMES_JS_HEAP))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
