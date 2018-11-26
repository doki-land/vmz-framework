//! Host path + [`OxcDiagnostic`] — the only diagnostic row type.
//!
//! No parallel DX DTO: `vmz.dx.*` JSON is the serde projection of this type
//! (`path` / `severity` / `code` / `args` / `span`; optional empty `message`).
//!
//! `0.1.21`: wire truth is `code + args + span`. Natural-language copy lives in
//! TypeScript catalogs (`@vmz/vmz` locales). Rust must not emit user-facing prose
//! as protocol identity — oxc's internal message field stays empty.

use std::borrow::Cow;
use std::collections::BTreeMap;
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
/// `{ "path", "severity", "code", "args"?, "span"?, "message"? }`.
/// `message` is omitted when empty (legacy deserializers may still send it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportedDiagnostic {
    /// Workspace or absolute source path (empty = workspace-global).
    pub path: PathBuf,
    /// Underlying oxc diagnostic (severity, labels, code). Message text is empty.
    pub diagnostic: OxcDiagnostic,
    /// Structured message arguments (`code` + `args` + `span` contract).
    ///
    /// Keys are catalog argument names; values are already-stringified payloads.
    /// Empty map is omitted on the wire (`None`).
    pub args: Option<BTreeMap<String, String>>,
}

#[derive(Serialize, Deserialize, JsonSchema)]
struct ReportedDiagnosticWire {
    path: String,
    #[serde(with = "severity_wire")]
    #[schemars(with = "String")]
    severity: Severity,
    /// Stable diagnostic id (catalog key). Required on new rows.
    code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    args: Option<BTreeMap<String, String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    span: Option<SourceSpan>,
    /// Legacy / transitional prose. Omitted when empty; not catalog truth.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    message: String,
}

impl ReportedDiagnostic {
    fn bare(path: PathBuf, severity: Severity, code: String) -> Self {
        let mut diagnostic = match severity {
            Severity::Error => OxcDiagnostic::error(""),
            Severity::Warning => OxcDiagnostic::warn(""),
            Severity::Advice => OxcDiagnostic::error("").with_severity(Severity::Advice),
        };
        diagnostic.code.scope = Some(Cow::Owned(code));
        diagnostic.code.number = None;
        Self { path, diagnostic, args: None }
    }

    /// Error without a source span. `code` is the stable identity.
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

    /// Build from an explicit oxc [`Severity`].
    pub fn with_severity(
        path: impl Into<PathBuf>,
        severity: Severity,
        code: impl Into<String>,
    ) -> Self {
        Self::bare(path.into(), severity, code.into())
    }

    /// Error with an oxc byte [`Span`] label.
    pub fn error_at(path: impl Into<PathBuf>, code: impl Into<String>, span: Span) -> Self {
        let mut row = Self::error(path, code);
        row.diagnostic = row.diagnostic.with_label(span);
        row
    }

    /// Replace the diagnostic code (DX stable ids are free-form scope strings).
    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.diagnostic.code.scope = Some(Cow::Owned(code.into()));
        self.diagnostic.code.number = None;
        self
    }

    /// Attach structured catalog arguments (empty map clears to `None` on the wire).
    pub fn with_args(mut self, args: BTreeMap<String, String>) -> Self {
        self.args = if args.is_empty() { None } else { Some(args) };
        self
    }

    /// Convenience: one catalog argument.
    pub fn with_arg(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        let mut map = self.args.take().unwrap_or_default();
        map.insert(key.into(), value.into());
        self.args = Some(map);
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

    /// Oxc internal message (empty under the `0.1.21` contract).
    pub fn message(&self) -> &str {
        self.diagnostic.message.as_ref()
    }

    /// Source path carried on this diagnostic.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Structured args (catalog placeholders), when present.
    pub fn args(&self) -> Option<&BTreeMap<String, String>> {
        self.args.as_ref()
    }

    /// Stable code string for wire / LSP (`scope` or `scope(number)`).
    pub fn code_string(&self) -> Option<String> {
        self.diagnostic.code.is_some().then(|| self.diagnostic.code.to_string())
    }

    /// Required code for the language-neutral contract (`""` only if unset).
    pub fn code(&self) -> String {
        self.code_string().unwrap_or_default()
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
            code: self.code(),
            args: self.args.clone(),
            span: self.source_span(),
            message: String::new(),
        }
    }

    fn from_wire(wire: ReportedDiagnosticWire) -> Self {
        let code = if wire.code.is_empty() {
            // Legacy rows that only carried prose: keep a sentinel so hosts still see a code.
            "vmz::unknown".into()
        } else {
            wire.code
        };
        let mut row = Self::bare(PathBuf::from(wire.path), wire.severity, code);
        // Preserve legacy message only inside oxc for round-trip of old fixtures;
        // new emitters leave it empty.
        if !wire.message.is_empty() {
            row.diagnostic.message = Cow::Owned(wire.message);
        }
        if let Some(span) = wire.span {
            if row.path.as_os_str().is_empty() {
                row.path = PathBuf::from(&span.path);
            }
            row.diagnostic = row.diagnostic.with_label(Span::new(span.start, span.end));
        }
        row.args = wire.args.filter(|m| !m.is_empty());
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
        let code = self.code();
        write!(f, "{level}[{code}]: {}", self.path.display())
    }
}

/// Aliases kept for call sites that already say `coded_*`.
impl ReportedDiagnostic {
    /// Error row with an explicit code (empty path = workspace-global).
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

/// Helper for fallible paths that need a custom deserializer error type.
#[allow(dead_code)]
fn _assert_de_error<E: DeError>() {}
