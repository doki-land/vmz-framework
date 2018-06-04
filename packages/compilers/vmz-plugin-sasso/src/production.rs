//! Production [`ScssCompiler`] backed by [`sasso`].

use std::path::{Path, PathBuf};
use std::sync::Arc;

use sasso::{FsImporter, Options, OutputStyle, compile};
use vmz_compiler::{
    ReportedDiagnostic, ScssCompiler, ScssCompilerHandle, ScssEmitRequest, ScssEmitResult,
    StyleLanguage, parse_vmz,
};

/// Default SCSS style plugin for `vmz build`.
#[derive(Debug, Default, Clone, Copy)]
pub struct ProductionScssCompiler;

impl ScssCompiler for ProductionScssCompiler {
    fn emit_project(&self, req: &ScssEmitRequest) -> ScssEmitResult {
        emit_project_impl(req)
    }
}

/// Default SCSS compiler handle for linking into the `vmz` binary.
pub fn default_scss_compiler() -> ScssCompilerHandle {
    Arc::new(ProductionScssCompiler)
}

fn emit_project_impl(req: &ScssEmitRequest) -> ScssEmitResult {
    let mut diagnostics = Vec::new();
    let mut parts: Vec<String> = Vec::new();

    // Global designs/styles before SFC blocks (entry wins when present).
    let designs_styles = req.project_root.join("designs").join("styles");
    let style_paths: Vec<PathBuf> = if let Some(entry) = &req.designs_style_entry {
        vec![entry.clone()]
    } else if !req.designs_style_files.is_empty() {
        req.designs_style_files.clone()
    } else if designs_styles.is_dir() {
        let mut files = list_style_files(&designs_styles);
        files.sort();
        files
    } else {
        Vec::new()
    };
    for path in style_paths {
        match compile_file(&path, &req.project_root, &designs_styles) {
            Ok(css) if !css.trim().is_empty() => {
                parts.push(format!("/* {} */\n{}", path.display(), css.trim_end()));
            }
            Ok(_) => {}
            Err(msg) => diagnostics.push(ReportedDiagnostic::error(&path, msg)),
        }
    }

    for source in &req.sources {
        let Ok(text) = std::fs::read_to_string(source) else {
            diagnostics.push(ReportedDiagnostic::warning(
                source,
                format!("scss: cannot read {}", source.display()),
            ));
            continue;
        };
        let parsed = match parse_vmz(source, text) {
            Ok(p) => p,
            Err(e) => {
                diagnostics
                    .push(ReportedDiagnostic::warning(source, format!("scss: parse failed: {e}")));
                continue;
            }
        };
        let Some(style) = &parsed.style else {
            continue;
        };
        let stripped = strip_at_tailwind(&style.content);
        if stripped.trim().is_empty() {
            continue;
        }
        match compile_source(stripped, style.lang, source, &req.project_root) {
            Ok(css) if !css.trim().is_empty() => {
                parts.push(format!("/* {} */\n{}", source.display(), css.trim_end()));
            }
            Ok(_) => {}
            Err(msg) => diagnostics.push(ReportedDiagnostic::error(source, msg)),
        }
    }

    ScssEmitResult { css: parts.join("\n\n"), css_relative: "vmz-style.css".into(), diagnostics }
}

fn compile_file(path: &Path, project_root: &Path, designs_styles: &Path) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("read: {e}"))?;
    let lang = match path.extension().and_then(|e| e.to_str()) {
        Some("css") => StyleLanguage::Css,
        Some("sass") => StyleLanguage::Sass,
        _ => StyleLanguage::Scss,
    };
    if lang == StyleLanguage::Css {
        return Ok(text);
    }
    let load_paths = vec![designs_styles.to_path_buf(), project_root.to_path_buf()];
    let importer = FsImporter::new(load_paths);
    let opts = Options::default().with_style(OutputStyle::Expanded).with_importer(&importer);
    // sasso treats path-less compile as SCSS; indented sass needs path hint if API supports it.
    // Current public API is compile(source, options) — SCSS syntax.
    if lang == StyleLanguage::Sass {
        return Err("indented `.sass` in designs/styles is not supported yet; use `.scss`".into());
    }
    compile(&text, &opts).map_err(|e| e.to_string())
}

fn compile_source(
    source: String,
    lang: StyleLanguage,
    path: &Path,
    project_root: &Path,
) -> Result<String, String> {
    match lang {
        StyleLanguage::Css => Ok(source),
        StyleLanguage::Sass => Err(format!(
            "{}: indented `lang=\"sass\"` is not supported yet; use default SCSS or lang=\"css\"",
            path.display()
        )),
        StyleLanguage::Scss => {
            let designs_styles = project_root.join("designs").join("styles");
            let load_paths = vec![designs_styles, project_root.to_path_buf()];
            let importer = FsImporter::new(load_paths);
            let opts =
                Options::default().with_style(OutputStyle::Expanded).with_importer(&importer);
            compile(&source, &opts).map_err(|e| e.to_string())
        }
    }
}

/// Remove `@tailwind { … }` / bare `@tailwind` so SCSS does not see TW directives.
fn strip_at_tailwind(style: &str) -> String {
    let mut out = String::with_capacity(style.len());
    let mut i = 0;
    while i < style.len() {
        if style[i..].starts_with("@tailwind") {
            let after = i + "@tailwind".len();
            let rest = &style[after..];
            let trimmed = rest.trim_start();
            let ws = rest.len() - trimmed.len();
            let body_start = after + ws;
            if trimmed.starts_with('{') {
                if let Some(end) = find_matching_brace(style, body_start) {
                    i = end + 1;
                    continue;
                }
            }
            // Bare `@tailwind` marker - skip the keyword and following spaces.
            i = body_start;
            while i < style.len() {
                let ch = style[i..].chars().next().unwrap();
                if ch == '\n' || !ch.is_whitespace() {
                    break;
                }
                i += ch.len_utf8();
            }
            continue;
        }
        let ch = style[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn find_matching_brace(src: &str, open_idx: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    if open_idx >= bytes.len() || bytes[open_idx] != b'{' {
        return None;
    }
    let mut depth = 0usize;
    for (i, &b) in bytes.iter().enumerate().skip(open_idx) {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn list_style_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else {
        return out;
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if !p.is_file() {
            continue;
        }
        match p.extension().and_then(|e| e.to_str()) {
            Some("scss" | "css" | "sass") => out.push(p),
            _ => {}
        }
    }
    out
}
