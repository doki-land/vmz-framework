//! Style emitter: ordered style layers → discrete assets + `@import` entry.
//!
//! Plugins contribute CSS bodies; this module owns composition and disk layout.
//! No ad-hoc string fusion of stylesheet bodies into a mega-file.

use std::fs;
use std::path::{Path, PathBuf};

/// Stable emit order (lower first).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub enum StyleLayer {
    /// `/designs` tokens + themes → CSS custom properties.
    Designs = 0,
    /// `designs/styles` + SFC `<style>` (SCSS/CSS).
    Scss = 1,
    /// TW utilities from `style:tw` / `@tailwind`.
    Tw = 2,
}

#[derive(Debug, Clone)]
pub struct StyleContribution {
    pub layer: StyleLayer,
    pub asset_name: String,
    pub css: String,
}

#[derive(Debug, Default)]
pub struct StyleEmitReport {
    pub css_entry: Option<String>,
    pub written: Vec<PathBuf>,
}

/// Emit per-layer assets and a composition entry that `@import`s them in order.
pub fn emit_style_bundle(
    out_dir: &Path,
    contributions: &[StyleContribution],
) -> anyhow::Result<StyleEmitReport> {
    let mut report = StyleEmitReport::default();
    let mut imports: Vec<String> = Vec::new();

    let mut ordered = contributions.to_vec();
    ordered.sort_by_key(|c| c.layer as u8);

    for contrib in &ordered {
        let body = contrib.css.trim();
        if body.is_empty() {
            continue;
        }
        let out = out_dir.join(&contrib.asset_name);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent)?;
        }
        let mut file = String::new();
        file.push_str(&format!("/* vmz style layer: {:?} */\n", contrib.layer));
        file.push_str(body);
        if !body.ends_with('\n') {
            file.push('\n');
        }
        fs::write(&out, file)?;
        report.written.push(out);
        imports.push(contrib.asset_name.clone());
    }

    if imports.is_empty() {
        return Ok(report);
    }

    let entry_name = "vmz.css";
    let entry_path = out_dir.join(entry_name);
    let mut entry = String::from("/* vmz style entry: composed via @import */\n");
    for name in &imports {
        // Relative import from same directory as the entry.
        entry.push_str(&format!("@import \"./{name}\";\n"));
    }
    fs::write(&entry_path, entry)?;
    report.written.push(entry_path);
    report.css_entry = Some(entry_name.to_string());
    Ok(report)
}
