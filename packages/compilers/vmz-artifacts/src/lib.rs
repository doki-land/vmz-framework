//! Parse, validate, and query VMZ build artifacts (`vmz-deployment.json`, …).
//!
//! Semantic types live in `vmz-compiler` / `vmz-protocol` today; this crate owns
//! **deterministic query** logic shared by CLI, N-API, and conformance gates.

#![deny(missing_docs)]

mod deployment;
mod error;
mod server_artifact;

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
pub use vmz_compiler::{DEPLOYMENT_SCHEMA, DeploymentDocument};
