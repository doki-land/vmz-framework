//! Compiler-side SCSS style plugin hook (`vmz-plugin-sasso`).

use std::path::PathBuf;
use std::sync::Arc;

use crate::diagnostic::ReportedDiagnostic;

#[derive(Debug, Clone)]
pub struct ScssEmitRequest {
    pub project_root: PathBuf,
    pub out_dir: PathBuf,
    pub sources: Vec<PathBuf>,
    /// When set, compile only this entry under `designs/styles`; else all style files.
    pub designs_style_entry: Option<PathBuf>,
    pub designs_style_files: Vec<PathBuf>,
}

#[derive(Debug, Default)]
pub struct ScssEmitResult {
    pub css: String,
    pub css_relative: String,
    pub diagnostics: Vec<ReportedDiagnostic>,
}

pub trait ScssCompiler: Send + Sync {
    fn emit_project(&self, req: &ScssEmitRequest) -> ScssEmitResult;
}

pub type ScssCompilerHandle = Arc<dyn ScssCompiler>;
