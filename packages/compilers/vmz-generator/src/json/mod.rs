//! Data document CodeGenerator: JSON / JSON5 / YAML.
//!
//! Typed values only (serde). Hand-built JSON/JSON5/YAML strings are forbidden;
//! call these printers (or `emit_data`) for every data artifact.
//!
//! Format roles (design `05`):
//! - **JSON** -- machine wire / `*.program.json` / protocol docs (strict).
//! - **JSON5** -- author-facing config / `<router>` / `<meta>` / locales default.
//! - **YAML** -- optional `lang="yaml"` author surface (safe data subset).

use std::path::PathBuf;

use serde::Serialize;

use crate::core::{ContentType, EmittedArtifact, Provenance, Result};

/// Closed data document format for [`emit_data`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum DataFormat {
    /// Strict JSON (compact).
    Json,
    /// Strict JSON, pretty-printed.
    JsonPretty,
    /// JSON5 (unquoted keys where legal; indented).
    Json5,
    /// YAML 1.x via `yaml_serde`.
    Yaml,
}

impl DataFormat {
    /// File extension without dot (`json` / `json5` / `yaml`).
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Json | Self::JsonPretty => "json",
            Self::Json5 => "json5",
            Self::Yaml => "yaml",
        }
    }

    /// [`ContentType`] for this format.
    pub const fn content_type(self) -> ContentType {
        match self {
            Self::Json | Self::JsonPretty => ContentType::Json,
            Self::Json5 => ContentType::Json5,
            Self::Yaml => ContentType::Yaml,
        }
    }
}

/// Compact JSON (sole strict-JSON compact printer).
pub fn to_json<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string(value)?)
}

/// Pretty-print JSON (sole strict-JSON pretty printer).
pub fn to_pretty_json<T: Serialize>(value: &T) -> Result<String> {
    Ok(serde_json::to_string_pretty(value)?)
}

/// JSON5 text (unquoted keys when legal; indented by the `json5` crate).
pub fn to_json5<T: Serialize>(value: &T) -> Result<String> {
    Ok(json5::to_string(value)?)
}

/// YAML text (sole YAML printer).
pub fn to_yaml<T: Serialize>(value: &T) -> Result<String> {
    Ok(yaml_serde::to_string(value)?)
}

/// Emit a data document in the chosen [`DataFormat`].
pub fn emit_data<T: Serialize>(format: DataFormat, value: &T) -> Result<String> {
    match format {
        DataFormat::Json => to_json(value),
        DataFormat::JsonPretty => to_pretty_json(value),
        DataFormat::Json5 => to_json5(value),
        DataFormat::Yaml => to_yaml(value),
    }
}

/// Emit a data [`EmittedArtifact`] at `path` (extension should match `format`).
pub fn emit_data_artifact<T: Serialize>(
    path: impl Into<PathBuf>,
    format: DataFormat,
    value: &T,
    provenance: Provenance,
) -> Result<EmittedArtifact> {
    let text = emit_data(format, value)?;
    Ok(EmittedArtifact::new(path, text, format.content_type(), provenance))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::{Deserialize, Serialize};

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Sample {
        foo: u32,
        bar: String,
        nested: Nested,
    }

    #[derive(Serialize, Deserialize, PartialEq, Debug)]
    struct Nested {
        ok: bool,
    }

    fn sample() -> Sample {
        Sample { foo: 42, bar: "baz".into(), nested: Nested { ok: true } }
    }

    #[test]
    fn json_roundtrip_keys() {
        let s = to_pretty_json(&sample()).unwrap();
        assert!(s.contains("\"foo\""));
        assert!(s.contains("42"));
        let v: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(v["foo"], 42);
        assert_eq!(v["bar"], "baz");
    }

    #[test]
    fn json5_omits_quotes_on_simple_keys() {
        let s = to_json5(&sample()).unwrap();
        assert!(s.contains("foo:"), "{s}");
        let v: Sample = json5::from_str(&s).unwrap();
        assert_eq!(v, sample());
    }

    #[test]
    fn yaml_roundtrip() {
        let s = to_yaml(&sample()).unwrap();
        assert!(s.contains("foo:"), "{s}");
        let v: Sample = yaml_serde::from_str(&s).unwrap();
        assert_eq!(v, sample());
    }

    #[test]
    fn emit_data_dispatches() {
        let j = emit_data(DataFormat::Json, &sample()).unwrap();
        let p = emit_data(DataFormat::JsonPretty, &sample()).unwrap();
        let j5 = emit_data(DataFormat::Json5, &sample()).unwrap();
        let y = emit_data(DataFormat::Yaml, &sample()).unwrap();
        assert!(j.starts_with('{'));
        assert!(p.contains('\n'));
        assert!(j5.contains("foo:"));
        assert!(y.contains("foo:"));
        assert_eq!(DataFormat::Json5.extension(), "json5");
        assert_eq!(DataFormat::Yaml.content_type(), ContentType::Yaml);
    }

    #[test]
    fn artifact_digest_stable() {
        let a = emit_data_artifact("x.json5", DataFormat::Json5, &sample(), Provenance::default())
            .unwrap();
        assert_eq!(a.content_type, ContentType::Json5);
        assert!(!a.digest.is_empty());
        assert_eq!(a.digest, crate::core::sha256_hex(a.text.as_bytes()));
    }
}
