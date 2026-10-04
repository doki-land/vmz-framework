use std::path::Path;

use oak_typescript::formatter::FormatOptions;

use super::{FormatFileResult, oak};

/// Format JS/TS through Oak without a legacy fallback.
pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: FormatOptions,
) -> Result<FormatFileResult, String> {
    let output = oak::format_source(path, source, &options)?;
    Ok(FormatFileResult { changed: output != source, output })
}
