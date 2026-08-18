//! Mini-program target-neutral contracts (design 07 / formerly 24).
//!
//! Crate-root `miniprogram_target` alias remains for Workspace / napi.

pub mod binding_event;
pub mod multi_adapter;
pub mod route_server_style;
pub mod static_slice;
pub mod structure;
pub mod target;
pub mod tooling_deploy;
pub mod wechat_pack;

use vmz_generator::{MiniEmitError, MiniEmitErrorKind};
use vmz_protocol::{DIAG_ARTIFACT_INVALID, DIAG_PLATFORM_UNSUPPORTED, Severity, TargetDiagnostic};

/// Compact JSON text for Mini artifact fields (logic / event / patch / manifest).
pub(crate) fn compact_json<T: serde::Serialize>(value: &T) -> String {
    vmz_generator::to_json(value).unwrap_or_else(|_| "{}".into())
}

pub(crate) fn map_mini_emit_errors(path: &str, errs: Vec<MiniEmitError>) -> Vec<TargetDiagnostic> {
    errs.into_iter()
        .map(|e| {
            let code = match e.kind {
                MiniEmitErrorKind::ArtifactInvalid => DIAG_ARTIFACT_INVALID,
                MiniEmitErrorKind::Unsupported => DIAG_PLATFORM_UNSUPPORTED,
            };
            TargetDiagnostic::with_severity(path, Severity::Error, e.message).with_code(code)
        })
        .collect()
}
