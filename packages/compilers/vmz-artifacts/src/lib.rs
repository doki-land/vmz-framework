//! Parse, validate, and query VMZ build artifacts (`vmz-deployment.json`, …).
//!
//! Semantic types live in `vmz-compiler` / `vmz-protocol` today; this crate owns
//! **deterministic query** logic shared by CLI, N-API, and conformance gates.

#![deny(missing_docs)]

mod deployment;
mod error;

pub use deployment::{
    ComponentEntry, collect_depends_on_closure, component_entries, parse_deployment_json,
    validate_deployment,
};
pub use error::ArtifactError;
pub use vmz_compiler::{DEPLOYMENT_SCHEMA, DeploymentDocument};
