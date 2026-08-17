//! Shared CodeGenerator primitives: artifacts, escape, digest, provenance.

mod artifact;
mod escape;

pub use artifact::{ContentType, EmittedArtifact, Provenance, sha256_hex};
pub use escape::{
    escape_css_string, escape_html_attr, escape_html_text, escape_xml_attr, escape_xml_text,
};

use thiserror::Error;

/// Fallible CodeGenerator API.
pub type Result<T> = std::result::Result<T, GeneratorError>;

/// Errors from CodeGenerators (IO / parse / print).
#[derive(Debug, Error)]
pub enum GeneratorError {
    /// Filesystem write/read.
    #[error(transparent)]
    Io(#[from] std::io::Error),

    /// Strict JSON encode/decode.
    #[error(transparent)]
    Json(#[from] serde_json::Error),

    /// JSON5 encode/decode.
    #[error(transparent)]
    Json5(#[from] json5::Error),

    /// YAML encode/decode.
    #[error(transparent)]
    Yaml(#[from] yaml_serde::Error),

    /// Language / CSS parse or print failure.
    #[error("{0}")]
    Msg(String),
}

impl GeneratorError {
    /// Ad-hoc message.
    pub fn msg(s: impl Into<String>) -> Self {
        Self::Msg(s.into())
    }
}
