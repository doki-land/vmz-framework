//! Format `.vmz` files: keep SFC structure; pretty-print scripts via oxc codegen.

use std::fs;
use std::path::Path;

use crate::diagnostic::ReportedDiagnostic;
use crate::project::discover_vmz_files;
use crate::sfc::parse_vmz;

#[derive(Debug, Clone, Default)]
pub struct FormatOptions {
    pub check: bool,
}

#[derive(Debug, Default)]
pub struct FormatReport {
    pub diagnostics: Vec<ReportedDiagnostic>,
    pub files_checked: usize,
    pub files_written: usize,
    pub files_need_write: usize,
}

impl FormatReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }
}

pub fn format_path(path: impl AsRef<Path>, options: &FormatOptions) -> crate::Result<FormatReport> {
    let path = path.as_ref();
    let mut report = FormatReport::default();
    if path.is_file() {
        format_file(path, options, &mut report)?;
        return Ok(report);
    }
    for (file, _) in discover_vmz_files(path) {
        format_file(&file, options, &mut report)?;
    }
    Ok(report)
}

fn format_file(
    path: &Path,
    options: &FormatOptions,
    report: &mut FormatReport,
) -> crate::Result<()> {
    report.files_checked += 1;
    let source = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, format!("read failed: {e}")));
            return Ok(());
        }
    };
    let parsed = match parse_vmz(path, source.clone()) {
        Ok(p) => p,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, e.to_string()));
            return Ok(());
        }
    };

    let client_fmt = match format_script(&parsed.client.content) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, format!("format client: {e}")));
            return Ok(());
        }
    };
    let server_fmt = if let Some(server) = &parsed.server {
        match format_script(&server.content) {
            Ok(s) => Some(s),
            Err(e) => {
                report
                    .diagnostics
                    .push(ReportedDiagnostic::error(path, format!("format server: {e}")));
                return Ok(());
            }
        }
    } else {
        None
    };

    let formatted = assemble_vmz(
        &parsed.template.content,
        parsed.style.as_ref().map(|s| s.content.as_str()),
        &client_fmt,
        server_fmt.as_deref(),
    );

    if formatted == source {
        return Ok(());
    }
    report.files_need_write += 1;
    if options.check {
        report
            .diagnostics
            .push(ReportedDiagnostic::error(path, "would reformat (run without --check)"));
        return Ok(());
    }
    fs::write(path, formatted)?;
    report.files_written += 1;
    Ok(())
}

pub fn format_script(source: &str) -> Result<String, String> {
    // Pretty-print via oxc subcrates (parser + codegen). Prefer these over the `oxc` umbrella
    // so new surfaces (formatter/codegen options) can be adopted crate-by-crate.
    use oxc_allocator::Allocator;
    use oxc_codegen::{Codegen, CodegenOptions};
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    if parsed.panicked {
        let msgs: Vec<_> = parsed.diagnostics.iter().map(|d| d.to_string()).collect();
        return Err(msgs.join("; "));
    }
    let code = Codegen::new()
        .with_options(CodegenOptions { single_quote: false, ..CodegenOptions::default() })
        .build(&parsed.program)
        .code;
    Ok(trim_trailing_ws(&code))
}

fn trim_trailing_ws(s: &str) -> String {
    let mut lines: Vec<String> = s.lines().map(|l| l.trim_end().to_string()).collect();
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    let mut out = lines.join("\n");
    out.push('\n');
    out
}

fn assemble_vmz(template: &str, style: Option<&str>, client: &str, server: Option<&str>) -> String {
    let mut out = String::new();
    out.push_str("<template>\n");
    out.push_str(&indent_block(template.trim()));
    out.push_str("</template>\n\n");
    if let Some(style) = style {
        out.push_str("<style>\n");
        out.push_str(&indent_block(style.trim()));
        out.push_str("</style>\n\n");
    }
    out.push_str("<script client>\n");
    out.push_str(client.trim_start());
    if !client.ends_with('\n') {
        out.push('\n');
    }
    out.push_str("</script>\n");
    if let Some(server) = server {
        out.push('\n');
        out.push_str("<script server>\n");
        out.push_str(server.trim_start());
        if !server.ends_with('\n') {
            out.push('\n');
        }
        out.push_str("</script>\n");
    }
    out
}

fn indent_block(content: &str) -> String {
    let mut out = String::new();
    for line in content.lines() {
        if line.trim().is_empty() {
            out.push('\n');
        } else {
            out.push_str("  ");
            out.push_str(line.trim_end());
            out.push('\n');
        }
    }
    out
}
