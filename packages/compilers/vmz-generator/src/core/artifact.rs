//! Emitted artifact envelope + digest helpers.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Logical content kind for an emitted file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentType {
    /// JavaScript module.
    JavaScript,
    /// CSS stylesheet.
    Css,
    /// HTML document.
    Html,
    /// XML / sitemap / Mini template dialect.
    Xml,
    /// JSON document.
    Json,
    /// Other / Rust glue / plain text.
    Text,
}

/// Provenance hint for debugging (source map path, IR ids, etc.).
#[derive(Debug, Clone, Default)]
pub struct Provenance {
    /// Author or virtual source path (e.g. `Foo.client.ts`).
    pub source_path: Option<PathBuf>,
    /// Optional source map path written alongside the artifact.
    pub source_map_path: Option<PathBuf>,
    /// Free-form notes (schema id, unit name).
    pub notes: Vec<String>,
}

/// One generated artifact ready to write or assemble.
#[derive(Debug, Clone)]
pub struct EmittedArtifact {
    /// Relative or absolute output path.
    pub path: PathBuf,
    /// UTF-8 text body.
    pub text: String,
    /// Content classification.
    pub content_type: ContentType,
    /// SHA-256 hex of `text` bytes.
    pub digest: String,
    /// Debug / map provenance.
    pub provenance: Provenance,
}

impl EmittedArtifact {
    /// Build an artifact from text; digest is computed automatically.
    pub fn new(
        path: impl Into<PathBuf>,
        text: impl Into<String>,
        content_type: ContentType,
        provenance: Provenance,
    ) -> Self {
        let text = text.into();
        let digest = sha256_hex(text.as_bytes());
        Self { path: path.into(), text, content_type, digest, provenance }
    }

    /// Write `text` to `path`, creating parent directories.
    pub fn write_to(&self, root: &Path) -> std::io::Result<PathBuf> {
        let out = if self.path.is_absolute() { self.path.clone() } else { root.join(&self.path) };
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&out, &self.text)?;
        if let Some(map_path) = &self.provenance.source_map_path {
            // Caller may have already embedded map text elsewhere; path is recorded only.
            let _ = map_path;
        }
        Ok(out)
    }
}

/// SHA-256 hex digest of raw bytes.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let dig = h.finalize();
    dig.iter().map(|b| format!("{b:02x}")).collect()
}
