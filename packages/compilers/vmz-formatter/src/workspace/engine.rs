use std::path::Path;

use data_text_typescript::formatter::FormatOptions;

use super::{FormatFileResult, text};

/// Format JS/TS through `data.text` without a legacy fallback.
pub fn format_source_with_options(
    path: &Path,
    source: &str,
    options: FormatOptions,
) -> Result<FormatFileResult, String> {
    let output = text::format_source(path, source, &options)?;
    Ok(FormatFileResult { changed: output != source, output })
}
