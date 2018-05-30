//! Typed fallible API for VMZ libraries and the native CLI.
//!
//! **Forbidden:** `anyhow` (or other erased error bags) as the public `Result` error type.
//! Prefer this module's [`Error`] / [`Result`], or a domain-local `thiserror` enum.

use std::io;
use std::path::PathBuf;

use thiserror::Error;

use crate::sfc::SfcError;

/// Fallible API alias used across `vmz-compiler` (and CLI via re-export).
pub type Result<T> = std::result::Result<T, Error>;

/// Structured error for IO / JSON / SFC / CLI messaging.
#[derive(Debug, Error)]
pub enum Error {
    /// Filesystem or process IO.
    #[error(transparent)]
    Io(#[from] io::Error),

    /// JSON encode/decode.
    #[error(transparent)]
    Json(#[from] serde_json::Error),

    /// `.vmz` SFC split / structure.
    #[error(transparent)]
    Sfc(#[from] SfcError),

    /// Ad-hoc message (CLI / guardrails). Prefer a typed variant when a case stabilizes.
    #[error("{0}")]
    Msg(String),

    /// Path-associated message.
    #[error("{path}: {message}")]
    Path {
        /// Path the error refers to.
        path: PathBuf,
        /// Human-readable detail.
        message: String,
    },

    /// Wrap with caller context (replacement for `anyhow::Context`).
    #[error("{context}: {source}")]
    Context {
        /// Outer context label.
        context: String,
        /// Inner error.
        #[source]
        source: Box<Error>,
    },
}

impl Error {
    /// Build a message error.
    pub fn msg(message: impl Into<String>) -> Self {
        Self::Msg(message.into())
    }

    /// Attach context around `self`.
    pub fn with_context(self, context: impl Into<String>) -> Self {
        Self::Context { context: context.into(), source: Box::new(self) }
    }
}

impl From<String> for Error {
    fn from(value: String) -> Self {
        Self::Msg(value)
    }
}

impl From<&str> for Error {
    fn from(value: &str) -> Self {
        Self::Msg(value.into())
    }
}

impl From<std::num::ParseIntError> for Error {
    fn from(value: std::num::ParseIntError) -> Self {
        Self::Msg(value.to_string())
    }
}

/// Extension for `Result` / IO-style `?` chains without `anyhow`.
pub trait ResultExt<T> {
    /// Attach context on `Err`.
    fn context(self, context: impl Into<String>) -> Result<T>;

    /// Attach lazily-formatted context on `Err`.
    fn with_context<F, S>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> S,
        S: Into<String>;
}

impl<T, E> ResultExt<T> for std::result::Result<T, E>
where
    E: Into<Error>,
{
    fn context(self, context: impl Into<String>) -> Result<T> {
        self.map_err(|e| e.into().with_context(context))
    }

    fn with_context<F, S>(self, f: F) -> Result<T>
    where
        F: FnOnce() -> S,
        S: Into<String>,
    {
        self.map_err(|e| e.into().with_context(f()))
    }
}

/// Early-return an [`Error::Msg`] (replacement for `anyhow::bail!`).
#[macro_export]
macro_rules! bail {
    ($($arg:tt)*) => {
        return Err($crate::error::Error::msg(format!($($arg)*)))
    };
}
