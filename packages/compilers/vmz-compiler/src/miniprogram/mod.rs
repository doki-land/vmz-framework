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

/// Compact JSON text for Mini artifact fields (logic / event / patch / manifest).
pub(crate) fn compact_json<T: serde::Serialize>(value: &T) -> String {
    vmz_generator::to_json(value).unwrap_or_else(|_| "{}".into())
}
