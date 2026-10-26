//! VMZ → Iris adapter.
//!
//! Thin Rust-level bridge that wraps `iris-generator`'s public API so the
//! VMZ workspace can invoke Iris TypeScript generation without shelling out.
//!
//! This crate intentionally exposes the narrowest possible surface: callers
//! hand over a raw VOS schema string and receive back a deterministic file
//! map plus a schema fingerprint. No CLI wiring, no server integration, no
//! filesystem I/O.

#![forbid(unsafe_code)]

use std::collections::BTreeMap;

/// One generated artifact file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedFile {
    /// Relative path inside the generate root (e.g. `browser.ts`,
    /// `_internal/synthesize.ts`).
    pub name: String,
    /// File content.
    pub content: String,
}

/// Result of [`generate_from_vos_schema`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GenerateResult {
    /// Deterministic schema fingerprint (lowercase hex SHA-256), stable across
    /// hosts when the canonical schema semantics are unchanged.
    pub fingerprint: String,
    /// Generated files keyed by relative path.
    pub files: BTreeMap<String, String>,
}

/// Generate TypeScript client bindings from a raw VOS schema document.
///
/// Returns a [`GenerateResult`] containing the schema fingerprint and a
/// deterministic file map. The caller owns any subsequent filesystem write or
/// N-API surface projection.
pub fn generate_from_vos_schema(source: &str) -> Result<GenerateResult, String> {
    let model = iris_generator::GenerationModel::from_vos_schema(source)
        .map_err(|error| error.to_string())?;
    let fingerprint = model.schema_fingerprint.clone();
    let files =
        iris_generator::emit_typescript_client(&model).map_err(|error| error.to_string())?;
    let files: BTreeMap<String, String> = files.into_iter().collect();
    Ok(GenerateResult { fingerprint, files })
}
