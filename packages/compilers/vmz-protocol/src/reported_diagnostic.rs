//! Language-neutral path and diagnostic rows for VMZ DX protocols.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::dx::SourceSpan;
use crate::severity::{Severity, severity_wire};

/// Internal protocol diagnostic payload with no parser-library types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    /// Severity.
    pub severity: Severity,
    /// Stable catalog code.
    pub code: String,
    /// Legacy prose retained for round-trip compatibility.
    pub message: String,
    /// Primary byte span as `(start, end)`.
    pub span: Option<(u32, u32)>,
}

/// Path plus a language-neutral diagnostic payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportedDiagnostic {
    /// Workspace or absolute source path.
    pub path: PathBuf,
    /// Diagnostic payload.
    pub diagnostic: Diagnostic,
    /// Structured message arguments.
    pub args: Option<BTreeMap<String, String>>,
}

#[derive(Serialize, Deserialize, JsonSchema)]
struct ReportedDiagnosticWire {
    path: String,
    #[serde(with = "severity_wire")]
    #[schemars(with = "String")]
    severity: Severity,
    code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    span: Option<SourceSpan>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    message: String,
}

impl ReportedDiagnostic {
    fn bare(path: PathBuf, severity: Severity, code: String) -> Self {
        Self {
            path,
            diagnostic: Diagnostic { severity, code, message: String::new(), span: None },
            args: None,
        }
    }

    /// Error without a source span.
    pub fn error(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::bare(path.into(), Severity::Error, code.into())
    }

    /// Warning without a source span.
    pub fn warning(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::bare(path.into(), Severity::Warning, code.into())
    }

    /// Advice without a source span.
    pub fn advice(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::bare(path.into(), Severity::Advice, code.into())
    }

    /// Build with an explicit protocol severity.
    pub fn with_severity(
        path: impl Into<PathBuf>,
        severity: Severity,
        code: impl Into<String>,
    ) -> Self {
        Self::bare(path.into(), severity, code.into())
    }

    /// Error with a primary byte span.
    pub fn error_at(
        path: impl Into<PathBuf>,
        code: impl Into<String>,
        span: (u32, u32),
    ) -> Self {
        let mut row = Self::error(path, code);
        row.diagnostic.span = Some(span);
        row
    }

    /// Replace the diagnostic code.
    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.diagnostic.code = code.into();
        self
    }

    /// Attach structured catalog arguments.
    pub fn with_args(mut self, args: BTreeMap<String, String>) -> Self {
        self.args = if args.is_empty() { None } else { Some(args) };
        self
    }

    /// Add one catalog argument.
    pub fn with_arg(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let mut args = self.args.take().unwrap_or_default();
        args.insert(key.into(), value.into());
        self.args = Some(args);
        self
    }

    /// Attach a source span and infer an empty path.
    pub fn with_source_span(mut self, span: SourceSpan) -> Self {
        if self.path.as_os_str().is_empty() {
            self.path = PathBuf::from(&span.path);
        }
        self.diagnostic.span = Some((span.start, span.end));
        self
    }

    /// Whether this row is an error.
    pub fn is_error(&self) -> bool {
        self.diagnostic.severity == Severity::Error
    }

    /// Severity of this row.
    pub fn severity(&self) -> Severity {
        self.diagnostic.severity
    }

    /// Legacy prose message.
    pub fn message(&self) -> &str {
        &self.diagnostic.message
    }

    /// Source path.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Structured arguments.
    pub fn args(&self) -> Option<&BTreeMap<String, String>> {
        self.args.as_ref()
    }

    /// Stable code string.
    pub fn code_string(&self) -> Option<String> {
        (!self.diagnostic.code.is_empty()).then(|| self.diagnostic.code.clone())
    }

    /// Stable code, or an empty string for legacy rows.
    pub fn code(&self) -> String {
        self.diagnostic.code.clone()
    }

    /// First source span, when present.
    pub fn source_span(&self) -> Option<SourceSpan> {
        let (start, end) = self.diagnostic.span?;
        Some(SourceSpan { path: self.path.to_string_lossy().into_owned(), start, end })
    }

    fn to_wire(&self) -> ReportedDiagnosticWire {
        ReportedDiagnosticWire {
            path: self.path.to_string_lossy().into_owned(),
            severity: self.diagnostic.severity,
            code: self.code(),
            args: self.args.clone(),
            span: self.source_span(),
            message: self.diagnostic.message.clone(),
        }
    }

    fn from_wire(wire: ReportedDiagnosticWire) -> Self {
        let code = if wire.code.is_empty() { "vmz::unknown".into() } else { wire.code };
        let mut row = Self::bare(PathBuf::from(wire.path), wire.severity, code);
        row.diagnostic.message = wire.message;
        if let Some(span) = wire.span {
            if row.path.as_os_str().is_empty() {
                row.path = PathBuf::from(&span.path);
            }
            row.diagnostic.span = Some((span.start, span.end));
        }
        row.args = wire.args.filter(|args| !args.is_empty());
        row
    }
}

impl Serialize for ReportedDiagnostic {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_wire().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for ReportedDiagnostic {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(Self::from_wire(ReportedDiagnosticWire::deserialize(deserializer)?))
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
        write!(f, "{level}[{}]: {}", self.code(), self.path.display())
    }
}

/// Compatibility aliases for existing call sites.
impl ReportedDiagnostic {
    /// Error row with an explicit code.
    pub fn coded_error(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::error(path, code)
    }

    /// Warning row with an explicit code.
    pub fn coded_warning(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::warning(path, code)
    }

    /// Advice row with an explicit code.
    pub fn coded_advice(path: impl Into<PathBuf>, code: impl Into<String>) -> Self {
        Self::advice(path, code)
    }
}

#[allow(dead_code)]
fn _assert_de_error<E: DeError>() {}
