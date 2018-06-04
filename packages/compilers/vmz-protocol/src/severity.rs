//! oxc diagnostic severity on the wire — no parallel VMZ severity enum.
//!
//! [`Severity`] is [`oxc_diagnostics::Severity`] (`Error` | `Warning` | `Advice`).
//! Wire labels are kebab-case (`error` | `warning` | `advice`); miette's default
//! PascalCase serde is not used.

use serde::{Deserialize, Deserializer, Serializer};

pub use oxc_diagnostics::Severity;

/// Parse host / wire severity labels into oxc [`Severity`].
///
/// Accepts `error` | `warning` | `warn` | `advice`. Host alias `info` → [`Severity::Advice`].
pub fn parse_severity(s: &str) -> Option<Severity> {
    match s.trim().to_ascii_lowercase().as_str() {
        "error" => Some(Severity::Error),
        "warning" | "warn" => Some(Severity::Warning),
        "advice" | "info" => Some(Severity::Advice),
        _ => None,
    }
}

/// kebab-case wire encoding for oxc [`Severity`].
pub mod severity_wire {
    use super::*;

    /// Serialize as `error` | `warning` | `advice`.
    pub fn serialize<S: Serializer>(value: &Severity, serializer: S) -> Result<S::Ok, S::Error> {
        let label = match value {
            Severity::Error => "error",
            Severity::Warning => "warning",
            Severity::Advice => "advice",
        };
        serializer.serialize_str(label)
    }

    /// Deserialize from kebab-case (plus host aliases).
    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Severity, D::Error> {
        let s = String::deserialize(deserializer)?;
        parse_severity(&s).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "unknown severity `{s}` (expected error|warning|advice)"
            ))
        })
    }
}
