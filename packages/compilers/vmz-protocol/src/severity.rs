//! Language-neutral diagnostic severity.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Diagnostic severity carried by VMZ wire protocols.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Severity {
    /// A compilation or validation error.
    Error,
    /// A non-fatal warning.
    Warning,
    /// Informational guidance.
    Advice,
}

/// Parse host and wire severity labels.
pub fn parse_severity(value: &str) -> Option<Severity> {
    match value.trim().to_ascii_lowercase().as_str() {
        "error" => Some(Severity::Error),
        "warning" | "warn" => Some(Severity::Warning),
        "advice" | "info" => Some(Severity::Advice),
        _ => None,
    }
}

/// Encode severity as the stable kebab-case wire label.
pub mod severity_wire {
    use super::*;

    /// Serialize `Severity` as `error`, `warning`, or `advice`.
    pub fn serialize<S: Serializer>(value: &Severity, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(match value {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Advice => "advice",
        })
    }

    /// Deserialize a stable wire label.
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Severity, D::Error> {
        let value = String::deserialize(deserializer)?;
        parse_severity(&value).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "unknown severity `{value}` (expected error|warning|advice)"
            ))
        })
    }
}
