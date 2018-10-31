//! Typecheck / analyze `.vmz` units and collect diagnostics before emit.

use std::fs;
use std::path::Path;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::analyze::{AnalyzedScript, analyze_script};
use crate::diagnostic::{ReportedDiagnostic, Severity};
use crate::parse::rust_dsl::analyze_rust_server_dsl;
use crate::project::discover_vmz_files;
use crate::reactive_build::build_program_module_with_server;
use crate::secrets::{collect_client_boundary_findings, collect_secret_requirements};
use crate::server_calls::collect_server_class_calls;
use crate::server_slice::ServerSliceProof;
use crate::sfc::{ScriptKind, ScriptLanguage, parse_vmz};
use crate::template::{
    AttrValue, TemplateIr, TemplateNode, parse_template, parse_template_concrete,
    template_parse_to_diagnostic, lower_concrete_to_ir,
};
use crate::virtual_server;
use vmz_protocol::SourceSpan;
use vmz_types::{ComponentDecl, ServerAttach};

/// Options for [`check_path`] / [`check_project`].
#[derive(Debug, Default, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckOptions {
    /// When true, warnings fail the check the same as errors.
    pub deny_warnings: bool,
    /// When true, units whose server slice is not browser-safe fail check
    /// (Delivery asked to place server capabilities into the browser sink).
    pub require_browser_safe_server_slices: bool,
}

/// Aggregated diagnostics from one check run.
#[derive(Debug, Default)]
pub struct CheckReport {
    /// Collected path-scoped diagnostics.
    pub diagnostics: Vec<ReportedDiagnostic>,
    /// Number of `.vmz` files visited.
    pub files_checked: usize,
}

impl CheckReport {
    /// True when any diagnostic is error severity.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity() == Severity::Error)
    }

    /// True when the run should fail under `options` (errors, or warnings if denied).
    pub fn failed(&self, options: &CheckOptions) -> bool {
        if self.has_errors() {
            return true;
        }
        options.deny_warnings && self.diagnostics.iter().any(|d| d.severity() == Severity::Warning)
    }
}

/// Check a single `.vmz` file or an entire project root.
pub fn check_path(path: impl AsRef<Path>, options: &CheckOptions) -> crate::Result<CheckReport> {
    let path = path.as_ref();
    if path.is_file() {
        let mut report = CheckReport::default();
        check_file(path, &mut report, options);
        return Ok(report);
    }
    check_project(path, options)
}

/// Discover and check every `.vmz` under `root`, plus cross-page `<Link>` validation.
pub fn check_project(root: impl AsRef<Path>, options: &CheckOptions) -> crate::Result<CheckReport> {
    let root = root.as_ref();
    let mut report = CheckReport::default();
    let mut page_units: Vec<(std::path::PathBuf, crate::sfc::ParsedVmz, String, String)> =
        Vec::new();
    let src_root = if root.join("src").is_dir() { root.join("src") } else { root.to_path_buf() };
    for (path, kind) in discover_vmz_files(root) {
        check_file(&path, &mut report, options);
        if kind == crate::project::VmzModuleKind::Page {
            if let Ok(source) = fs::read_to_string(&path) {
                if let Ok(parsed) = parse_vmz(&path, source) {
                    let client = analyze_script(ScriptKind::Client, &parsed.client.content);
                    let chunk_id = crate::affected::chunk_id_for(&src_root, &path);
                    page_units.push((path, parsed, client.decl.name, chunk_id));
                }
            }
        }
    }
    match crate::pipeline::link::collect_route_table(&page_units) {
        Ok(table) => {
            for (path, parsed, _, _) in &page_units {
                let ir = match parse_template(&parsed.template.content) {
                    Ok(ir) => ir,
                    Err(e) => {
                        report.diagnostics.push(template_parse_to_diagnostic(
                            path,
                            parsed.template.content_start,
                            &e,
                        ));
                        continue;
                    }
                };
                for err in crate::pipeline::link::check_template_links(&ir, &table) {
                    report
                        .diagnostics
                        .push(ReportedDiagnostic::error(path, format!("<Link>: {err}")));
                }
            }
        }
        Err(errs) => {
            for e in errs {
                report.diagnostics.push(ReportedDiagnostic::error(root, e));
            }
        }
    }
    let designs = crate::designs::load_designs(root);
    report.diagnostics.extend(designs.diagnostics.clone());
    report
        .diagnostics
        .extend(crate::style_token_diag::validate_project_design_token_refs(root, &designs));
    let _ = options;
    Ok(report)
}

fn check_file(path: &Path, report: &mut CheckReport, options: &CheckOptions) {
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
        let analyzed = match server.lang {
            ScriptLanguage::Ts => analyze_script(ScriptKind::Server, &server.content),
            ScriptLanguage::Rust => analyze_rust_server_dsl(&server.content),
            other => AnalyzedScript {
                kind: ScriptKind::Server,
                decl: ComponentDecl::new("Anonymous", oxc_span::Span::default()),
                parse_errors: vec![format!(
                    "`<script server lang=\"{}\">` is registered but not implemented yet",
                    other.as_str()
                )],
                forbidden_factories: Vec::new(),
            },
        };
        for err in &analyzed.parse_errors {
            report
                .diagnostics
                .push(ReportedDiagnostic::error(path, format!("server script: {err}")));
        }
        if analyzed.decl.name == "Anonymous" && analyzed.parse_errors.is_empty() {
            let msg = match server.lang {
                ScriptLanguage::Rust => {
                    "rust `<script server>` must declare `pub struct TypeName;`"
                }
                _ => "`<script server>` must `export default class`",
            };
            report.diagnostics.push(ReportedDiagnostic::error(path, msg));
        }
    }

    for finding in collect_client_boundary_findings(&parsed.client.content) {
        report.diagnostics.push(ReportedDiagnostic::error_at(
            path,
            format!("{}: {}", finding.code, finding.message),
            finding.span,
        ));
    }

    let concrete = match parse_template_concrete(&parsed.template.content) {
        Ok(c) => c,
        Err(e) => {
            report.diagnostics.push(template_parse_to_diagnostic(
                path,
                parsed.template.content_start,
                &e,
            ));
            return;
        }
    };
    let ir = match lower_concrete_to_ir(&concrete) {
        Ok(ir) => ir,
        Err(e) => {
            report.diagnostics.push(template_parse_to_diagnostic(
                path,
                parsed.template.content_start,
                &e,
            ));
            return;
        }
    };
    let content_start = parsed.template.content_start as u32;
    for err in crate::reactive_build::collect_concrete_expr_errors(&concrete) {
        let (start, end) = err.body_span.to_absolute(content_start);
        let path_s = path.to_string_lossy().into_owned();
        report.diagnostics.push(
            ReportedDiagnostic::error(path, err.message)
                .with_code("vmz::template/invalid-expr")
                .with_source_span(SourceSpan {
                    path: path_s,
                    start,
                    end,
                }),
        );
    }
    if report
        .diagnostics
        .iter()
        .any(|d| d.is_error() && d.message().starts_with("invalid template expression"))
    {
        return;
    }
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
        let mut secret_requirements = collect_secret_requirements(&server_block.content);
        for s in &mut secret_requirements {
            s.module_id = Some(module_id.clone());
        }
        ServerAttach {
            module_id,
            class_name: server.decl.name.clone(),
            methods: server.decl.methods.clone(),
            client_calls,
            secret_requirements,
        }
    });
    let program = build_program_module_with_server(
        &path.display().to_string(),
        &client.decl,
        &ir,
        server_attach.as_ref(),
        None,
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
        if options.require_browser_safe_server_slices {
            let proof = ServerSliceProof::prove(&unit.server);
            if let Some(msg) = proof.sink_refusal_message(unit.server.class_name.as_deref()) {
                report.diagnostics.push(ReportedDiagnostic::error(path, msg));
            }
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
