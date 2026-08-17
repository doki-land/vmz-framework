//! JSON CodeGenerator — typed values only (serde).

/// Pretty-print a serde-serializable value (sole JSON printer).
pub fn to_pretty_json<T: serde::Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(value)
}

/// Compact JSON.
pub fn to_json<T: serde::Serialize>(value: &T) -> Result<String, serde_json::Error> {
    serde_json::to_string(value)
}
