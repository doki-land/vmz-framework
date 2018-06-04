//! Aggregate status labels for profile / native-host / target / solver proof reports.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Aggregate status on profile / native-host / target / solver proof reports.
///
/// Closed world: gates only emit these labels. `incomplete` means the subject
/// was not fully materialised (e.g. no deployment artifacts yet) without a
/// hard diagnostic error.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CheckReportStatus {
    /// Structural checks passed for the available inputs.
    Ready,
    /// At least one error-severity diagnostic.
    Failed,
    /// Inputs missing / partial; not a hard failure.
    Incomplete,
}

impl CheckReportStatus {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Incomplete => "incomplete",
        }
    }

    /// Derive status from whether diagnostics include an error.
    pub fn from_failed(failed: bool) -> Self {
        if failed { Self::Failed } else { Self::Ready }
    }
}
