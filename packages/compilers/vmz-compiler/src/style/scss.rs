//! Compiler-side SCSS style plugin hook (`vmz-plugin-sasso`).

use std::path::PathBuf;
use std::sync::Arc;

use crate::diagnostic::ReportedDiagnostic;

/// Inputs handed to a [`ScssCompiler`] for one project emit.
#[derive(Debug, Clone)]
pub struct ScssEmitRequest {
    /// Project root used to resolve include paths and plugin config.
    pub project_root: PathBuf,
    /// Directory where the plugin should write CSS assets.
    pub out_dir: PathBuf,
    /// Per-unit SFC `<style>` sources to compile this round.
    pub sources: Vec<PathBuf>,
    /// When set, compile only this entry under `designs/styles`; else all style files.
    pub designs_style_entry: Option<PathBuf>,
    /// All discovered files under `designs/styles` (for inventory / diagnostics).
    pub designs_style_files: Vec<PathBuf>,
}

/// CSS body and diagnostics returned by a [`ScssCompiler`].
#[derive(Debug, Default)]
pub struct ScssEmitResult {
    /// Compiled CSS body (may be empty).
    pub css: String,
    /// Path relative to `out_dir` for the written asset (when emitted).
    pub css_relative: String,
    /// Plugin diagnostics to fold into the compile report.
    pub diagnostics: Vec<ReportedDiagnostic>,
}

/// Trait implemented by the SCSS style plugin production compiler.
pub trait ScssCompiler: Send + Sync {
    /// Compile SFC styles and optional `designs/styles` entry into one CSS body.
    fn emit_project(&self, req: &ScssEmitRequest) -> ScssEmitResult;
}

/// Shared handle to a [`ScssCompiler`] installed on the compile session.
pub type ScssCompilerHandle = Arc<dyn ScssCompiler>;
