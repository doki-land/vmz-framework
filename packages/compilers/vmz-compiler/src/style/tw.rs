//! Compiler-side TW style plugin hook (`vmz-plugin-tailwind`).
//!
//! Tokens are registered during compile from already-parsed SFC -- not by
//! re-scanning the project tree.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::diagnostic::ReportedDiagnostic;
use crate::sfc::ParsedVmz;
use crate::template::{AttrValue, TemplateNode, parse_template};

/// How a TW utility token was discovered in source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TwRegKind {
    /// From a static `style:tw="..."` attribute on a template element.
    StyleTw,
    /// From `@apply` inside an `@tailwind { ... }` style block.
    AtTailwind,
}

/// One registered utility token plus the `.vmz` path that contributed it.
#[derive(Debug, Clone)]
pub struct TwRegistration {
    /// Utility class token (e.g. `bg-action`, `px-4`).
    pub token: String,
    /// Source file that registered this token.
    pub path: PathBuf,
    /// Discovery site (`style:tw` vs `@tailwind` / `@apply`).
    pub kind: TwRegKind,
}

/// Inputs handed to a [`TwCompiler`] for one project emit.
#[derive(Debug, Clone)]
pub struct TwEmitRequest {
    /// Project root used to resolve plugin config / content roots.
    pub project_root: PathBuf,
    /// Directory where the plugin should write CSS assets.
    pub out_dir: PathBuf,
    /// Tokens collected from parsed units this round.
    pub registrations: Vec<TwRegistration>,
    /// Unified Style Theme from compiler core; plugin projects to engine theme.
    pub style_theme: crate::designs::StyleTheme,
}

/// CSS body and diagnostics returned by a [`TwCompiler`].
#[derive(Debug, Default)]
pub struct TwEmitResult {
    /// Generated utility CSS body (may be empty).
    pub css: String,
    /// Path relative to `out_dir` for the written asset (when emitted).
    pub css_relative: String,
    /// Plugin diagnostics to fold into the compile report.
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Static tokens the engine actually emitted (for fingerprints / explain).
    pub static_tokens: Vec<String>,
}

/// Trait implemented by the Tailwind style plugin production compiler.
pub trait TwCompiler: Send + Sync {
    /// Compile registered tokens into a CSS contribution for this project.
    fn emit_project(&self, req: &TwEmitRequest) -> TwEmitResult;
}

/// Shared handle to a [`TwCompiler`] installed on the compile session.
pub type TwCompilerHandle = Arc<dyn TwCompiler>;

/// Register TW tokens from an already-parsed `.vmz`.
pub fn register_tw_from_parsed(parsed: &ParsedVmz, out: &mut Vec<TwRegistration>) {
    let Ok(ir) = parse_template(&parsed.template.content) else {
        return;
    };
    register_style_tw_nodes(&ir.roots, &parsed.path, out);
    if let Some(style) = &parsed.style {
        register_at_tailwind(&parsed.path, &style.content, out);
    }
}

fn register_style_tw_nodes(nodes: &[TemplateNode], path: &Path, out: &mut Vec<TwRegistration>) {
    for node in nodes {
        match node {
            TemplateNode::Element { attrs, children, .. } => {
                for a in attrs {
                    if a.name == "style:tw" {
                        if let AttrValue::Static(s) = &a.value {
                            for t in s.split_whitespace() {
                                if !t.is_empty() {
                                    out.push(TwRegistration {
                                        token: t.to_string(),
                                        path: path.to_path_buf(),
                                        kind: TwRegKind::StyleTw,
                                    });
                                }
                            }
                        }
                    }
                }
                register_style_tw_nodes(children, path, out);
            }
            TemplateNode::Text(_) | TemplateNode::Interp(_) => {}
        }
    }
}

fn register_at_tailwind(path: &Path, style: &str, out: &mut Vec<TwRegistration>) {
    let mut search_from = 0usize;
    while let Some(rel) = style[search_from..].find("@tailwind") {
        let abs = search_from + rel;
        let after = abs + "@tailwind".len();
        let rest = style[after..].trim_start();
        let (body, end_in_style) = if rest.starts_with('{') {
            let open = after + (style[after..].len() - rest.len());
            match find_matching_brace(style, open) {
                Some(close) => (style[open + 1..close].trim().to_string(), close + 1),
                None => return,
            }
        } else {
            (String::new(), after)
        };
        for tok in apply_tokens_in_block(&body) {
            out.push(TwRegistration {
                token: tok,
                path: path.to_path_buf(),
                kind: TwRegKind::AtTailwind,
            });
        }
        search_from = end_in_style;
    }
}

fn apply_tokens_in_block(block: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut search = 0usize;
    while let Some(rel) = block[search..].find("@apply") {
        let abs = search + rel;
        let after = abs + "@apply".len();
        let end = block[after..].find(';').map(|i| after + i).unwrap_or(block.len());
        for tok in block[after..end].split_whitespace() {
            if !tok.is_empty() {
                out.push(tok.to_string());
            }
        }
        search = end.min(block.len().saturating_sub(1)) + 1;
        if search >= block.len() {
            break;
        }
    }
    out
}

fn find_matching_brace(s: &str, open_idx: usize) -> Option<usize> {
    let bytes = s.as_bytes();
    if open_idx >= bytes.len() || bytes[open_idx] != b'{' {
        return None;
    }
    let mut depth = 0i32;
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
