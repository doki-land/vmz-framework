//! Parse, validate, and query VMZ build artifacts (`vmz-deployment.json`, …).
//!
//! Semantic types live in `vmz-compiler` / `vmz-protocol` today; this crate owns
//! **deterministic query** logic shared by CLI, N-API, and conformance gates.

#![deny(missing_docs)]

mod deployment;
mod error;
mod server_artifact;
mod static_delivery;

pub use deployment::{
    ComponentEntry, collect_depends_on_closure, component_entries, parse_deployment_json,
    validate_deployment,
};
pub use error::ArtifactError;
pub use server_artifact::{
    HTTP_CONTRACT_SCHEMA, PublicRouteWire, SERVER_ARTIFACT_SCHEMA, SERVER_RUNTIME_ADAPTER_SCHEMA,
    SERVER_RUNTIMES, ServerArtifactOpts, canonical_json, normalize_server_artifact,
    normalize_server_artifact_json, project_server_runtime_adapter,
    project_server_runtime_adapter_json, sort_keys,
};
pub use static_delivery::{
    parse_asset_plan, parse_content_addressed_assets, parse_static_delivery_manifest,
    parse_static_emit_plan, validate_asset_plan, validate_content_addressed_assets,
    validate_static_delivery_manifest, validate_static_emit_plan,
};
pub use vmz_compiler::{DEPLOYMENT_SCHEMA, DeploymentDocument};
pub use vmz_protocol::{
    ASSET_PLAN_SCHEMA, CONTENT_ADDRESSED_ASSETS_SCHEMA, STATIC_DELIVERY_MANIFEST_SCHEMA,
    STATIC_EMIT_PLAN_SCHEMA,
};
