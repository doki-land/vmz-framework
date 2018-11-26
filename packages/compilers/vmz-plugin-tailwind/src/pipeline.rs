//! End-to-end pipeline (also used by production TwCompiler).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tailwind::ThemeInput;
use vmz_compiler::ReportedDiagnostic;

use crate::collect::{TwCollection, collect_from_vmz};
use crate::designs::{DesignsStub, load_theme_from_designs, scan_designs_dir};
use crate::engine_bridge::{EngineLowering, compile_collection, map_engine_diagnostics};

/// Options for [`run_pipeline`].
#[derive(Clone, Debug, Default)]
pub struct PipelineOptions {
    /// Project root used to locate `/designs`. When `None`, theme stays empty (engine builtins).
    pub project_root: Option<PathBuf>,
}

/// Full experimental result: collection + designs + engine module/CSS + oxc diagnostics.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PipelineResult {
    /// Static TW sites collected from the `.vmz` source.
    pub collection: TwCollection,
    /// Designs directory scan used for ThemeInput.
    pub designs: DesignsStub,
    /// Number of theme entries fed into the engine.
    pub theme_entry_count: usize,
    /// Engine compile response + reference CSS.
    pub lowering: EngineLowering,
    /// Collect advice/errors + mapped engine diagnostics (oxc).
    #[serde(skip)]
    pub diagnostics: Vec<ReportedDiagnostic>,
}

/// Run collect → designs ThemeInput → Engine → reference CSS for a parsed `.vmz`.
pub fn run_pipeline(parsed: &vmz_compiler::ParsedVmz, options: &PipelineOptions) -> PipelineResult {
    let (collection, mut diagnostics) = collect_from_vmz(parsed);
    let designs = match &options.project_root {
        Some(root) => scan_designs_dir(root),
        None => DesignsStub { missing: true, ..Default::default() },
    };
    let theme = match load_theme_from_designs(&designs) {
        Ok(t) => t,
        Err(e) => {
            diagnostics.push(
                ReportedDiagnostic::warning(&collection.path, "vmz::tw::theme_load_failed")
                    .with_arg("detail", e.to_string()),
            );
            ThemeInput::default()
        }
    };
    let theme_entry_count = theme.entries.len();
    let lowering = compile_collection(&collection, theme);
    diagnostics.extend(map_engine_diagnostics(&collection, &lowering));
    PipelineResult { collection, designs, theme_entry_count, lowering, diagnostics }
}

/// Parse source then run the pipeline.
pub fn run_pipeline_source(
    path: impl AsRef<Path>,
    source: impl Into<String>,
    options: &PipelineOptions,
) -> Result<PipelineResult, vmz_compiler::SfcError> {
    let parsed = vmz_compiler::parse_vmz(path, source)?;
    Ok(run_pipeline(&parsed, options))
}
