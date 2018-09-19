use thiserror::Error;

/// Artifact parse / validate failures (stable for N-API → JS mapping).
#[derive(Debug, Error)]
pub enum ArtifactError {
    /// JSON could not be deserialized.
    #[error("invalid deployment JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// `schema` field is not [`vmz_compiler::DEPLOYMENT_SCHEMA`].
    #[error("unsupported deployment schema {0}")]
    Schema(String),
}
