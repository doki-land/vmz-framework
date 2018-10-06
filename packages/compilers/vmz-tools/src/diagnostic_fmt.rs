//! CLI diagnostic rendering: byte offsets → `path:line:col` at display time.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use vmz_compiler::{OffsetIndex, ReportedDiagnostic};

/// Print diagnostics to stderr, converting spans via [`OffsetIndex`] when source is readable.
pub fn eprint_diagnostics(diagnostics: &[ReportedDiagnostic]) {
    let mut cache: HashMap<PathBuf, Option<(String, OffsetIndex)>> = HashMap::new();
    for d in diagnostics {
        eprintln!("{}", format_diagnostic(d, &mut cache));
    }
}

fn format_diagnostic(
    d: &ReportedDiagnostic,
    cache: &mut HashMap<PathBuf, Option<(String, OffsetIndex)>>,
) -> String {
    let level = match d.severity() {
        vmz_compiler::Severity::Error => "error",
        vmz_compiler::Severity::Warning => "warning",
        vmz_compiler::Severity::Advice => "advice",
    };
    let path = d.path();
    if let Some(span) = d.source_span() {
        let entry = cache.entry(path.to_path_buf()).or_insert_with(|| load_index(path));
        if let Some((source, index)) = entry.as_ref() {
            let (line, col) = index.line_col(source, span.start);
            return format!(
                "{level}: {}:{}:{}: {}",
                path.display(),
                line,
                col,
                d.message()
            );
        }
    }
    format!("{level}: {}: {}", path.display(), d.message())
}

fn load_index(path: &Path) -> Option<(String, OffsetIndex)> {
    let source = fs::read_to_string(path).ok()?;
    let index = OffsetIndex::new(&source);
    Some((source, index))
}

#[cfg(test)]
mod tests {
    use super::*;
    use vmz_compiler::{ReportedDiagnostic, SourceSpan};

    #[test]
    fn formats_line_col_from_span() {
        let dir = std::env::temp_dir().join(format!(
            "vmz-diag-fmt-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("x.vmz");
        // offset 4 = start of line 2 'b'
        fs::write(&path, "aa\nbb\n").unwrap();
        let d = ReportedDiagnostic::error(&path, "boom").with_source_span(SourceSpan {
            path: path.to_string_lossy().into_owned(),
            start: 3,
            end: 4,
        });
        let mut cache = HashMap::new();
        let s = format_diagnostic(&d, &mut cache);
        assert!(s.contains(":2:1:"), "{s}");
        assert!(s.contains("boom"), "{s}");
        let _ = fs::remove_dir_all(&dir);
    }
}
