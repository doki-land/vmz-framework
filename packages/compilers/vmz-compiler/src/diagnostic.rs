//! Diagnostics: oxc only ? no parallel Span/Diagnostic types.
//!
//! Span / Diagnostic come from oxc；禁止平行造轮子。
//! [`ReportedDiagnostic`] only pairs a source path with [`OxcDiagnostic`] for CLI aggregation.

use std::fmt;
use std::path::{Path, PathBuf};

use oxc_diagnostics::OxcDiagnostic;
use oxc_span::Span;

pub use oxc_diagnostics::Severity;

/// Path + [`OxcDiagnostic`]. Not a parallel diagnostic model.
#[derive(Debug, Clone)]
pub struct ReportedDiagnostic {
    pub path: PathBuf,
    pub diagnostic: OxcDiagnostic,
}

impl ReportedDiagnostic {
    pub fn error(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into()).with_error_code_scope("vmz"),
        }
    }

    pub fn warning(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::warn(message.into()).with_error_code_scope("vmz"),
        }
    }

    /// Non-failing diagnostic for Program IR Unknown widenings / provenance notes.
    pub fn advice(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into())
                .with_error_code_scope("vmz")
                .with_severity(Severity::Advice),
        }
    }

    pub fn error_at(path: impl Into<PathBuf>, message: impl Into<String>, span: Span) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into())
                .with_error_code_scope("vmz")
                .with_label(span),
        }
    }

    pub fn is_error(&self) -> bool {
        self.diagnostic.severity == Severity::Error
    }

    pub fn severity(&self) -> Severity {
        self.diagnostic.severity
    }

    pub fn message(&self) -> &str {
        self.diagnostic.message.as_ref()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl fmt::Display for ReportedDiagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let level = match self.diagnostic.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Advice => "advice",
        };
        write!(f, "{level}: {}: {}", self.path.display(), self.diagnostic.message)
    }
}
