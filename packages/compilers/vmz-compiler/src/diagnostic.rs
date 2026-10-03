//! Language-neutral diagnostics shared through `vmz-protocol`.
//!
//! [`ReportedDiagnostic`] is the single path + diagnostic
//! row used by CLI aggregation and `vmz.dx.*` JSON (serde projection).

pub use vmz_protocol::{ReportedDiagnostic, Severity, parse_severity, severity_wire};
