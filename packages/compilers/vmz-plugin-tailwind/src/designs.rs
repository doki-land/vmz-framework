//! `/designs` scan + experimental ThemeInput loading.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tailwind::{ColorValue, LengthValue, ThemeEntry, ThemeInput, ThemeKey, ThemeValue};

/// What the experimental adapter saw under a project's `designs/` directory.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesignsStub {
    /// Absolute `designs/` directory path.
    pub root: PathBuf,
    /// Files under `designs/tokens/`.
    pub token_files: Vec<PathBuf>,
    /// Files under `designs/themes/`.
    pub theme_files: Vec<PathBuf>,
    /// Files under `designs/styles/`.
    pub style_files: Vec<PathBuf>,
    /// Markdown files directly under `designs/`.
    pub markdown_files: Vec<PathBuf>,
    /// True when `designs/` is absent.
    pub missing: bool,
}

/// Errors while loading ThemeInput from designs JSON.
#[derive(Debug, thiserror::Error)]
pub enum ThemeLoadError {
    /// Filesystem read failed.
    #[error("read {path}: {source}")]
    Io {
        /// Path that failed to read.
        path: PathBuf,
        /// Underlying IO error.
        source: std::io::Error,
    },
    /// JSON parse failed.
    #[error("parse {path}: {source}")]
    Json {
        /// Path that failed to parse.
        path: PathBuf,
        /// Underlying JSON error.
        source: serde_json::Error,
    },
    /// JSON shape is present but not a supported ThemeInput fragment.
    #[error("{path}: {message}")]
    Invalid {
        /// Path with the invalid document.
        path: PathBuf,
        /// Human-readable reason.
        message: String,
    },
}

/// Scan `<project>/designs/{tokens,themes,styles}` if present.
pub fn scan_designs_dir(project_root: impl AsRef<Path>) -> DesignsStub {
    let root = project_root.as_ref().join("designs");
    if !root.is_dir() {
        return DesignsStub { root, missing: true, ..Default::default() };
    }
    DesignsStub {
        token_files: list_files(&root.join("tokens")),
        theme_files: list_files(&root.join("themes")),
        style_files: list_files(&root.join("styles")),
        markdown_files: list_md(&root),
        root,
        missing: false,
    }
}

/// Load neutral [`ThemeInput`] from `designs/tokens/*.json` (+ optional `themes/*.json`).
///
/// Experimental JSON shapes (either):
/// 1. Engine-native: `{ "entries": [ { "key": { "path": ["spacing","4"] }, "value": { "kind":"Length", "data": { "css":"2rem" } } } ] }`
/// 2. Flat namespaces: `{ "spacing": { "4": "2rem" }, "colors": { "action": "#3366ff" } }`
pub fn load_theme_from_designs(stub: &DesignsStub) -> Result<ThemeInput, ThemeLoadError> {
    let mut entries = Vec::new();
    for path in stub.token_files.iter().chain(stub.theme_files.iter()) {
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(path)
            .map_err(|source| ThemeLoadError::Io { path: path.clone(), source })?;
        let value: Value = serde_json::from_str(&text)
            .map_err(|source| ThemeLoadError::Json { path: path.clone(), source })?;
        merge_theme_json(path, &value, &mut entries)?;
    }
    Ok(ThemeInput { entries })
}

fn merge_theme_json(
    path: &Path,
    value: &Value,
    out: &mut Vec<ThemeEntry>,
) -> Result<(), ThemeLoadError> {
    if value.get("entries").and_then(|v| v.as_array()).is_some() {
        // Native ThemeInput fragment.
        let fragment: ThemeInput = serde_json::from_value(value.clone())
            .map_err(|source| ThemeLoadError::Json { path: path.to_path_buf(), source })?;
        out.extend(fragment.entries);
        return Ok(());
    }

    let obj = value.as_object().ok_or_else(|| ThemeLoadError::Invalid {
        path: path.to_path_buf(),
        message: "expected object root".into(),
    })?;

    for (ns, ns_val) in obj {
        let Some(map) = ns_val.as_object() else {
            continue;
        };
        for (token, raw) in map {
            let key = ThemeKey::from_path([ns.as_str(), token.as_str()]);
            let tv = infer_theme_value(raw).ok_or_else(|| ThemeLoadError::Invalid {
                path: path.to_path_buf(),
                message: format!("unsupported value for `{ns}.{token}`"),
            })?;
            out.push(ThemeEntry { key, value: tv });
        }
    }
    Ok(())
}

fn infer_theme_value(v: &Value) -> Option<ThemeValue> {
    match v {
        Value::String(s) => {
            if s.starts_with('#') || s.starts_with("rgb") || s.starts_with("hsl") {
                Some(ThemeValue::Color(ColorValue { css: s.clone() }))
            } else if s.chars().next().is_some_and(|c| c.is_ascii_digit() || c == '.' || c == '-')
                || s.ends_with("rem")
                || s.ends_with("px")
                || s.ends_with('%')
                || s.ends_with("em")
            {
                Some(ThemeValue::Length(LengthValue { css: s.clone() }))
            } else {
                Some(ThemeValue::Keyword(s.clone()))
            }
        }
        Value::Number(n) => Some(ThemeValue::Number(n.to_string())),
        _ => None,
    }
}

fn list_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_file() {
            out.push(p);
        }
    }
    out.sort();
    out
}

fn list_md(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.extension().and_then(|e| e.to_str()) == Some("md") {
            out.push(p);
        }
    }
    out.sort();
    out
}
