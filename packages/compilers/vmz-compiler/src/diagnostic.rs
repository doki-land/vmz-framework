//! Diagnostics: oxc only — no parallel Span/Diagnostic types.
//!
//! [`ReportedDiagnostic`] is the single path + [`oxc_diagnostics::OxcDiagnostic`]
//! row used by CLI aggregation and `vmz.dx.*` JSON (serde projection).

pub use vmz_protocol::{ReportedDiagnostic, Severity, parse_severity, severity_wire};
