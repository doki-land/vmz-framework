//! Host path + [`OxcDiagnostic`] - the only diagnostic row type.
//!
//! No parallel DX DTO: `vmz.dx.*` JSON is the serde projection of this type
//! (`path` / `severity` / `message` / `code` / `span`).

use std::borrow::Cow;
use std::fmt;
use std::path::{Path, PathBuf};

use oxc_diagnostics::OxcDiagnostic;
use oxc_span::Span;
use schemars::JsonSchema;
use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::dx::SourceSpan;
use crate::severity::{Severity, severity_wire};

/// Path + [`OxcDiagnostic`]. Not a second diagnostic algebra.
///
/// Wire shape for `vmz.dx.*` documents:
/// `{ "path", "severity", "message", "code"?, "span"? }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportedDiagnostic {
    /// Workspace or absolute source path (empty = workspace-global).
    pub path: PathBuf,
    /// Underlying oxc diagnostic (severity, message, labels, code).
    pub diagnostic: OxcDiagnostic,
}

#[derive(Serialize, Deserialize, JsonSchema)]
struct ReportedDiagnosticWire {
    path: String,
    #[serde(with = "severity_wire")]
    #[schemars(with = "String")]
    severity: Severity,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    span: Option<SourceSpan>,
}

impl ReportedDiagnostic {
    /// Error without a source span.
    pub fn error(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into()).with_error_code_scope("vmz"),
        }
    }

    /// Warning without a source span.
    pub fn warning(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::warn(message.into()).with_error_code_scope("vmz"),
        }
    }

    /// Advice without a source span.
    pub fn advice(path: impl Into<PathBuf>, message: impl Into<String>) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into())
                .with_error_code_scope("vmz")
                .with_severity(Severity::Advice),
        }
    }

    /// Build from an explicit oxc [`Severity`].
    pub fn with_severity(
        path: impl Into<PathBuf>,
        severity: Severity,
        message: impl Into<String>,
    ) -> Self {
        match severity {
            Severity::Error => Self::error(path, message),
            Severity::Warning => Self::warning(path, message),
            Severity::Advice => Self::advice(path, message),
        }
    }

    /// Error with an oxc byte [`Span`] label.
    pub fn error_at(path: impl Into<PathBuf>, message: impl Into<String>, span: Span) -> Self {
        Self {
            path: path.into(),
            diagnostic: OxcDiagnostic::error(message.into())
                .with_error_code_scope("vmz")
                .with_label(span),
        }
    }

    /// Replace the diagnostic code (DX stable ids are free-form scope strings).
    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.diagnostic.code.scope = Some(Cow::Owned(code.into()));
        self.diagnostic.code.number = None;
        self
    }

    /// Attach a DX [`SourceSpan`] (sets path when empty; primary label from offsets).
    pub fn with_source_span(mut self, span: SourceSpan) -> Self {
        if self.path.as_os_str().is_empty() {
            self.path = PathBuf::from(&span.path);
        }
        self.diagnostic = self.diagnostic.with_label(Span::new(span.start, span.end));
        self
    }

    /// True when severity is [`Severity::Error`].
    pub fn is_error(&self) -> bool {
        self.diagnostic.severity == Severity::Error
    }

    /// oxc severity of this diagnostic.
    pub fn severity(&self) -> Severity {
        self.diagnostic.severity
    }

    /// Human message text.
    pub fn message(&self) -> &str {
        self.diagnostic.message.as_ref()
    }

    /// Source path carried on this diagnostic.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Stable code string for wire / LSP (`scope` or `scope(number)`).
    pub fn code_string(&self) -> Option<String> {
        self.diagnostic.code.is_some().then(|| self.diagnostic.code.to_string())
    }

    /// First label as a DX [`SourceSpan`], when present.
    pub fn source_span(&self) -> Option<SourceSpan> {
        let label = self.diagnostic.labels.first()?;
        let start = label.offset();
        let end = start.saturating_add(label.len());
        Some(SourceSpan { path: self.path.to_string_lossy().into_owned(), start, end })
    }

    fn to_wire(&self) -> ReportedDiagnosticWire {
        ReportedDiagnosticWire {
            path: self.path.to_string_lossy().into_owned(),
            severity: self.diagnostic.severity,
            message: self.diagnostic.message.to_string(),
            code: self.code_string(),
            span: self.source_span(),
        }
    }

    fn from_wire(wire: ReportedDiagnosticWire) -> Self {
        let mut diagnostic = match wire.severity {
            Severity::Error => OxcDiagnostic::error(wire.message),
            Severity::Warning => OxcDiagnostic::warn(wire.message),
            Severity::Advice => OxcDiagnostic::error(wire.message).with_severity(Severity::Advice),
        };
        if let Some(code) = wire.code {
            diagnostic.code.scope = Some(Cow::Owned(code));
            diagnostic.code.number = None;
        }
        let mut path = PathBuf::from(wire.path);
        if let Some(span) = wire.span {
            if path.as_os_str().is_empty() {
                path = PathBuf::from(&span.path);
            }
            diagnostic = diagnostic.with_label(Span::new(span.start, span.end));
        }
        Self { path, diagnostic }
    }
}

impl Serialize for ReportedDiagnostic {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_wire().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ReportedDiagnostic {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = ReportedDiagnosticWire::deserialize(deserializer)?;
        Ok(Self::from_wire(wire))
    }
}

impl JsonSchema for ReportedDiagnostic {
    fn schema_name() -> Cow<'static, str> {
        Cow::Borrowed("ReportedDiagnostic")
    }

    fn json_schema(generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        <ReportedDiagnosticWire as JsonSchema>::json_schema(generator)
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

/// Infallible constructor used when a typed build path must not fail serde.
impl ReportedDiagnostic {
    /// Error row with an explicit code (empty path = workspace-global).
    pub fn coded_error(
        path: impl Into<PathBuf>,
        message: impl Into<String>,
        code: impl Into<String>,
    ) -> Self {
        Self::error(path, message).with_code(code)
    }

    /// Warning row with an explicit code.
    pub fn coded_warning(
        path: impl Into<PathBuf>,
        message: impl Into<String>,
        code: impl Into<String>,
    ) -> Self {
        Self::warning(path, message).with_code(code)
    }

    /// Advice row with an explicit code.
    pub fn coded_advice(
        path: impl Into<PathBuf>,
        message: impl Into<String>,
        code: impl Into<String>,
    ) -> Self {
        Self::advice(path, message).with_code(code)
    }
}

/// Helper for fallible paths that need a custom deserializer error type.
#[allow(dead_code)]
fn _assert_de_error<E: DeError>() {}
