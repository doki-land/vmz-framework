use std::fs;
use std::path::Path;

use crate::analyze::analyze_script;
use crate::diagnostic::{ReportedDiagnostic, Severity};
use crate::project::discover_vmz_files;
use crate::reactive_build::build_program_module_with_server;
use crate::server_calls::collect_server_class_calls;
use crate::sfc::{ScriptKind, parse_vmz};
use crate::template::{AttrValue, TemplateIr, TemplateNode, parse_template};
use crate::virtual_server;
use vmz_types::ServerAttach;

#[derive(Debug, Default, Clone)]
pub struct CheckOptions {
    pub deny_warnings: bool,
}

#[derive(Debug, Default)]
pub struct CheckReport {
    pub diagnostics: Vec<ReportedDiagnostic>,
    pub files_checked: usize,
}

impl CheckReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity() == Severity::Error)
    }

    pub fn failed(&self, options: &CheckOptions) -> bool {
        if self.has_errors() {
            return true;
        }
        options.deny_warnings && self.diagnostics.iter().any(|d| d.severity() == Severity::Warning)
    }
}

pub fn check_path(path: impl AsRef<Path>, options: &CheckOptions) -> anyhow::Result<CheckReport> {
    let path = path.as_ref();
    if path.is_file() {
        let mut report = CheckReport::default();
        check_file(path, &mut report);
        let _ = options;
        return Ok(report);
    }
    check_project(path, options)
}

pub fn check_project(
    root: impl AsRef<Path>,
    options: &CheckOptions,
) -> anyhow::Result<CheckReport> {
    let root = root.as_ref();
    let mut report = CheckReport::default();
    for (path, _) in discover_vmz_files(root) {
        check_file(&path, &mut report);
    }
    let designs = crate::designs::load_designs(root);
    report.diagnostics.extend(designs.diagnostics.clone());
    report
        .diagnostics
        .extend(crate::style_token_diag::validate_project_design_token_refs(root, &designs));
    let _ = options;
    Ok(report)
}

fn check_file(path: &Path, report: &mut CheckReport) {
    report.files_checked += 1;
    let source = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, format!("read failed: {e}")));
            return;
        }
    };

    let parsed = match parse_vmz(path, source) {
        Ok(p) => p,
        Err(e) => {
            report.diagnostics.push(ReportedDiagnostic::error(path, e.to_string()));
            return;
        }
    };

    let client = analyze_script(ScriptKind::Client, &parsed.client.content);
    for err in &client.parse_errors {
        report.diagnostics.push(ReportedDiagnostic::error(path, format!("client script: {err}")));
    }
    if client.decl.name == "Anonymous" && client.parse_errors.is_empty() {
        report
            .diagnostics
            .push(ReportedDiagnostic::error(path, "`<script client>` must `export default class`"));
    }
    for factory in &client.forbidden_factories {
        report.diagnostics.push(ReportedDiagnostic::error(
            path,
            format!("forbidden state factory `{}()` ?use class fields", factory.name),
        ));
    }

    if let Some(server) = &parsed.server {
        let analyzed = analyze_script(ScriptKind::Server, &server.content);
        for err in &analyzed.parse_errors {
            report
                .diagnostics
                .push(ReportedDiagnostic::error(path, format!("server script: {err}")));
        }
        if analyzed.decl.name == "Anonymous" && analyzed.parse_errors.is_empty() {
            report.diagnostics.push(ReportedDiagnostic::error(
                path,
                "`<script server>` must `export default class`",
            ));
        }
    }

    let ir = parse_template(&parsed.template.content);
    check_each_keys(path, &ir, report);

    // Program IR A: surface Unknown widenings as advice (never silent).
    let src_root = path
        .ancestors()
        .find(|p| p.join("src").is_dir() || p.ends_with("src"))
        .map(|p| if p.ends_with("src") { p.to_path_buf() } else { p.join("src") })
        .unwrap_or_else(|| {
            path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| path.to_path_buf())
        });
    let server_attach = parsed.server.as_ref().map(|server_block| {
        let server = analyze_script(ScriptKind::Server, &server_block.content);
        let module_id = virtual_server::id_from_src_path(&src_root, path);
        let client_calls = collect_server_class_calls(&parsed.client.content, &server.decl.name);
        ServerAttach {
            module_id,
            class_name: server.decl.name.clone(),
            methods: server.decl.methods.clone(),
            client_calls,
        }
    });
    let program = build_program_module_with_server(
        &path.display().to_string(),
        &client.decl,
        &ir,
        server_attach.as_ref(),
    );
    for unit in &program.units {
        for u in &unit.graph.unknowns {
            report.diagnostics.push(ReportedDiagnostic::advice(
                path,
                format!(
                    "Program IR Unknown widen: field `{}` via {} ({}) — conservative field-root deps",
                    u.field, u.via, u.reason
                ),
            ));
        }
    }
}

/// `each` key rules
fn check_each_keys(path: &Path, ir: &TemplateIr, report: &mut CheckReport) {
    walk_each_keys(path, &ir.roots, report);
}

fn walk_each_keys(path: &Path, nodes: &[TemplateNode], report: &mut CheckReport) {
    for node in nodes {
        let TemplateNode::Element { tag, attrs, children } = node else {
            continue;
        };
        let each = attrs.iter().find(|a| a.name == "each");
        if each.is_some() {
            let as_name = attrs.iter().find(|a| a.name == "as").and_then(|a| match &a.value {
                AttrValue::Static(s) if !s.is_empty() => Some(s.as_str()),
                AttrValue::Interp(s) => Some(s.trim().trim_matches(|c| c == '"' || c == '\'')),
                _ => None,
            });
            let key = attrs.iter().find(|a| a.name == "key");
            match key {
                None => {
                    report.diagnostics.push(ReportedDiagnostic::warning(
                        path,
                        format!(
                            "<{tag} each={{}}> has no `key` ?index identity is unstable on insert/reorder"
                        ),
                    ));
                }
                Some(k) => match &k.value {
                    AttrValue::Static(s) => {
                        report.diagnostics.push(ReportedDiagnostic::error(
                            path,
                            format!(
                                "<{tag} each> `key=\"{s}\"` is identical for every item ?use a per-item expression like `key={{item.id}}`"
                            ),
                        ));
                    }
                    AttrValue::Interp(expr) => {
                        let e = expr.trim();
                        if is_literal_key(e) {
                            report.diagnostics.push(ReportedDiagnostic::error(
                                path,
                                format!(
                                    "<{tag} each> `key={{{e}}}` is a constant ?duplicate keys for every item"
                                ),
                            ));
                        } else if let Some(as_name) = as_name {
                            if e == as_name {
                                report.diagnostics.push(ReportedDiagnostic::warning(
                                    path,
                                    format!(
                                        "<{tag} each> `key={{{as_name}}}` uses the item itself ?prefer a primitive field (e.g. `{as_name}.id`); object keys are unstable"
                                    ),
                                ));
                            }
                        }
                    }
                },
            }
        }
        walk_each_keys(path, children, report);
    }
}

fn is_literal_key(expr: &str) -> bool {
    let e = expr.trim();
    if e.is_empty() {
        return false;
    }
    if (e.starts_with('"') && e.ends_with('"')) || (e.starts_with('\'') && e.ends_with('\'')) {
        return true;
    }
    if e.parse::<f64>().is_ok() {
        return true;
    }
    matches!(e, "true" | "false" | "null" | "undefined" | "NaN")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_template_snippet(template: &str) -> CheckReport {
        let dir = std::env::temp_dir().join(format!(
            "vmz-check-each-{}-{}",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("T.vmz");
        let src = format!(
            "<template>\n{template}\n</template>\n\n<script client>\nexport default class T {{}}\n</script>\n"
        );
        fs::write(&path, &src).unwrap();
        let mut report = CheckReport::default();
        check_file(&path, &mut report);
        let _ = fs::remove_dir_all(&dir);
        report
    }

    #[test]
    fn warns_each_without_key() {
        let report = check_template_snippet(r#"<li each={tags} as="tag">{tag}</li>"#);
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.severity() == Severity::Warning && d.message().contains("no `key`")),
            "{:?}",
            report.diagnostics
        );
    }

    #[test]
    fn errors_constant_key() {
        let report = check_template_snippet(r#"<li each={tags} as="tag" key={"x"}>{tag}</li>"#);
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.severity() == Severity::Error && d.message().contains("constant")),
            "{:?}",
            report.diagnostics
        );
    }

    #[test]
    fn ok_property_key() {
        let report =
            check_template_snippet(r#"<li each={tags} as="tag" key={tag.id}>{tag.label}</li>"#);
        assert!(
            !report.diagnostics.iter().any(|d| d.message().contains("each")),
            "{:?}",
            report.diagnostics
        );
    }
}
