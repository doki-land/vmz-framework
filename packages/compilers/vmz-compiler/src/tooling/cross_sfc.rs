//! DX: cross-SFC Symbol/Reference index, method/component/capability rename,
//! template–script source map, and first safe_fix CodeActions.
//!

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use vmz_protocol::{
    CODE_ACTION_SCHEMA, CodeAction, CodeActionKind, REFERENCE_SCHEMA, Reference, RenameIntent,
    ReportedDiagnostic, SYMBOL_SCHEMA, SourceSpan, StableId, StableIdKind, Symbol, TextEdit,
    WORKSPACE_EDIT_SCHEMA, WorkspaceEditPlan,
};

use crate::analyze::analyze_script;
use crate::sfc::{ScriptKind, parse_vmz};
use crate::template::parse_template_asts;
use crate::tooling::template_symbols::{
    semantic_component_tags, semantic_field_spans, semantic_handler_spans, semantic_tag_spans,
};

/// Schema id for template↔script source-map documents.
pub const SOURCE_MAP_SCHEMA: &str = "vmz.dx.source_map.v0";
/// Schema id for workspace symbol/reference index documents.
pub const SYMBOL_INDEX_SCHEMA: &str = "vmz.dx.symbol_index.v0";
/// Schema id for cross-SFC check reports.
pub const CROSS_SFC_CHECK_SCHEMA: &str = "vmz.dx.cross_sfc_check.v0";

/// Diagnostic code when a component class name does not match its `.vmz` file stem.
pub const DIAG_CLASS_NAME_MISMATCH: &str = "vmz::dx::class_name_mismatch";

/// One template↔script source-map edge (absolute file byte offsets).
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema, PartialEq, Eq,
)]
pub struct TemplateScriptMapEntry {
    /// Always [`SOURCE_MAP_SCHEMA`].
    pub schema: String,
    /// Workspace-relative `.vmz` path.
    pub path: String,
    /// Closed symbol surface (`field` / `method` / …).
    #[serde(rename = "symbolKind")]
    pub symbol_kind: StableIdKind,
    /// Author-facing symbol name.
    pub name: String,
    /// Use-site span inside `<template>`.
    #[serde(rename = "templateSpan")]
    pub template_span: SourceSpan,
    /// Definition span inside `<script>`.
    #[serde(rename = "scriptSpan")]
    pub script_span: SourceSpan,
}

/// Workspace-wide Symbol/Reference index plus template↔script source map.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema, PartialEq, Eq,
)]
pub struct SymbolIndexDocument {
    /// Always [`SYMBOL_INDEX_SCHEMA`].
    pub schema: String,
    /// Indexed symbols (component / field / method / capability).
    pub symbols: Vec<Symbol>,
    /// Reference edges (template→field, client→capability, …).
    pub references: Vec<Reference>,
    /// Template↔script map rows for DX hosts.
    #[serde(rename = "sourceMap")]
    pub source_map: Vec<TemplateScriptMapEntry>,
}

/// Cross-SFC check report: index + safe-fix CodeActions + diagnostics.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, schemars::JsonSchema, PartialEq, Eq,
)]
pub struct CrossSfcCheckReport {
    /// Always [`CROSS_SFC_CHECK_SCHEMA`].
    pub schema: String,
    /// Built symbol index for the workspace root.
    pub index: SymbolIndexDocument,
    /// Proposed safe fixes (class/stem mismatch, …).
    #[serde(rename = "codeActions")]
    pub code_actions: Vec<CodeAction>,
    /// Check diagnostics (warnings/errors).
    pub diagnostics: Vec<ReportedDiagnostic>,
}

impl CrossSfcCheckReport {
    /// Serialize this report as pretty-printed JSON (`"{}"` on serialize failure).
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }

    /// True when any diagnostic in the report is an error.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }
}

impl SymbolIndexDocument {
    /// Serialize this index as pretty-printed JSON (`"{}"` on serialize failure).
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Build workspace-wide symbol index + source map + safe_fix actions.
pub fn check_cross_sfc(root: &Path) -> CrossSfcCheckReport {
    let index = build_symbol_index(root);
    let mut diagnostics = Vec::new();
    let code_actions = collect_safe_fixes(root, &mut diagnostics);
    CrossSfcCheckReport { schema: CROSS_SFC_CHECK_SCHEMA.into(), index, code_actions, diagnostics }
}

/// Walk `.vmz` files under `root` and build a symbol/reference/source-map index.
pub fn build_symbol_index(root: &Path) -> SymbolIndexDocument {
    let mut symbols = Vec::new();
    let mut references = Vec::new();
    let mut source_map = Vec::new();

    for (rel, abs) in list_vmz_files(root) {
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source.clone()) else {
            continue;
        };
        let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
        let class_name = analyzed.decl.name.clone();
        let file_stem = abs.file_stem().and_then(|s| s.to_str()).unwrap_or("Anonymous").to_string();

        // Component symbol (definition = class name in script).
        let class_span =
            span_of_class_name(&parsed.client.content, &class_name).map(|(s, e)| SourceSpan {
                path: rel.clone(),
                start: (parsed.client.content_start + s) as u32,
                end: (parsed.client.content_start + e) as u32,
            });
        symbols.push(Symbol {
            schema: SYMBOL_SCHEMA.into(),
            stable_id: StableId::new(StableIdKind::Component, class_name.clone()),
            name: class_name.clone(),
            span: class_span.clone(),
            owners: vec![StableId::new(StableIdKind::File, rel.clone())],
            tags: vec!["x2".into(), format!("stem:{file_stem}")],
        });

        // Fields
        for f in &analyzed.decl.fields {
            let name = f.name.clone();
            let script_local = span_of_ident(&parsed.client.content, &name);
            let script_span = script_local.map(|(s, e)| SourceSpan {
                path: rel.clone(),
                start: (parsed.client.content_start + s) as u32,
                end: (parsed.client.content_start + e) as u32,
            });
            symbols.push(Symbol {
                schema: SYMBOL_SCHEMA.into(),
                stable_id: StableId::new(StableIdKind::Field, format!("{class_name}.{name}")),
                name: name.clone(),
                span: script_span.clone(),
                owners: vec![StableId::new(StableIdKind::Component, class_name.clone())],
                tags: vec!["x2".into()],
            });
            let Ok((semantic, _)) = parse_template_asts(&parsed.template.content) else {
                continue;
            };
            for (ts, te) in semantic_field_spans(&semantic, &parsed.template.content, &name) {
                let tspan = SourceSpan {
                    path: rel.clone(),
                    start: (parsed.template.content_start + ts) as u32,
                    end: (parsed.template.content_start + te) as u32,
                };
                references.push(Reference {
                    schema: REFERENCE_SCHEMA.into(),
                    from: StableId::new(StableIdKind::Template, rel.clone()),
                    to: StableId::new(StableIdKind::Field, format!("{class_name}.{name}")),
                    span: Some(tspan.clone()),
                });
                if let Some(ss) = &script_span {
                    source_map.push(TemplateScriptMapEntry {
                        schema: SOURCE_MAP_SCHEMA.into(),
                        path: rel.clone(),
                        symbol_kind: StableIdKind::Field,
                        name: name.clone(),
                        template_span: tspan,
                        script_span: ss.clone(),
                    });
                }
            }
        }

        // Methods
        for m in &analyzed.decl.methods {
            let name = m.name.clone();
            let script_local = span_of_ident(&parsed.client.content, &name);
            let script_span = script_local.map(|(s, e)| SourceSpan {
                path: rel.clone(),
                start: (parsed.client.content_start + s) as u32,
                end: (parsed.client.content_start + e) as u32,
            });
            symbols.push(Symbol {
                schema: SYMBOL_SCHEMA.into(),
                stable_id: StableId::new(StableIdKind::Method, format!("{class_name}.{name}")),
                name: name.clone(),
                span: script_span.clone(),
                owners: vec![StableId::new(StableIdKind::Component, class_name.clone())],
                tags: vec!["x2".into()],
            });
            let Ok((semantic, _)) = parse_template_asts(&parsed.template.content) else {
                continue;
            };
            for (ts, te) in semantic_handler_spans(&semantic, &parsed.template.content, &name) {
                let tspan = SourceSpan {
                    path: rel.clone(),
                    start: (parsed.template.content_start + ts) as u32,
                    end: (parsed.template.content_start + te) as u32,
                };
                references.push(Reference {
                    schema: REFERENCE_SCHEMA.into(),
                    from: StableId::new(StableIdKind::Template, rel.clone()),
                    to: StableId::new(StableIdKind::Method, format!("{class_name}.{name}")),
                    span: Some(tspan.clone()),
                });
                if let Some(ss) = &script_span {
                    source_map.push(TemplateScriptMapEntry {
                        schema: SOURCE_MAP_SCHEMA.into(),
                        path: rel.clone(),
                        symbol_kind: StableIdKind::Method,
                        name: name.clone(),
                        template_span: tspan,
                        script_span: ss.clone(),
                    });
                }
            }
        }

        // Server capabilities
        if let Some(server) = &parsed.server {
            let server_id = crate::virtual_server::id_from_src_path(&root.join("src"), &abs);
            let s_analyzed = analyze_script(ScriptKind::Server, &server.content);
            for m in &s_analyzed.decl.methods {
                let name = m.name.clone();
                let cap_id = format!("{server_id}.{name}");
                let script_local = span_of_ident(&server.content, &name);
                let script_span = script_local.map(|(s, e)| SourceSpan {
                    path: rel.clone(),
                    start: (server.content_start + s) as u32,
                    end: (server.content_start + e) as u32,
                });
                symbols.push(Symbol {
                    schema: SYMBOL_SCHEMA.into(),
                    stable_id: StableId::new(StableIdKind::Capability, cap_id.clone()),
                    name: name.clone(),
                    span: script_span,
                    owners: vec![StableId::new(StableIdKind::Server, server_id.clone())],
                    tags: vec!["x2".into()],
                });
                // Client references: ClassName.method(
                let client_class = s_analyzed.decl.name.clone();
                let call = format!("{client_class}.{name}(");
                let mut from = 0;
                while let Some(i) = parsed.client.content[from..].find(&call) {
                    let abs_i = from + i + client_class.len() + 1;
                    let end = abs_i + name.len();
                    references.push(Reference {
                        schema: REFERENCE_SCHEMA.into(),
                        from: StableId::new(StableIdKind::Client, rel.clone()),
                        to: StableId::new(StableIdKind::Capability, cap_id.clone()),
                        span: Some(SourceSpan {
                            path: rel.clone(),
                            start: (parsed.client.content_start + abs_i) as u32,
                            end: (parsed.client.content_start + end) as u32,
                        }),
                    });
                    from = abs_i + name.len();
                }
            }
        }
    }

    // Cross-SFC component tag references.
    let by_stem: BTreeMap<String, String> = list_vmz_files(root)
        .into_iter()
        .filter_map(|(rel, abs)| {
            let stem = abs.file_stem()?.to_str()?.to_string();
            Some((stem, rel))
        })
        .collect();

    for (rel, abs) in list_vmz_files(root) {
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source) else {
            continue;
        };
        let Ok((semantic, _)) = parse_template_asts(&parsed.template.content) else {
            continue;
        };
        for tag in semantic_component_tags(&semantic) {
            if let Some(def_rel) = by_stem.get(&tag) {
                if def_rel == &rel {
                    continue;
                }
                for (ts, te) in semantic_tag_spans(&semantic, &parsed.template.content, &tag) {
                    references.push(Reference {
                        schema: REFERENCE_SCHEMA.into(),
                        from: StableId::new(StableIdKind::File, rel.clone()),
                        to: StableId::new(StableIdKind::Component, tag.clone()),
                        span: Some(SourceSpan {
                            path: rel.clone(),
                            start: (parsed.template.content_start + ts) as u32,
                            end: (parsed.template.content_start + te) as u32,
                        }),
                    });
                }
            }
        }
    }

    symbols.sort_by(|a, b| {
        (a.stable_id.kind().as_str(), a.stable_id.id())
            .cmp(&(b.stable_id.kind().as_str(), b.stable_id.id()))
    });
    SymbolIndexDocument { schema: SYMBOL_INDEX_SCHEMA.into(), symbols, references, source_map }
}

/// Plan method/component/capability rename with proven TextEdits.
pub fn plan_x2_rename(root: &Path, intent: &RenameIntent, kind: StableIdKind) -> WorkspaceEditPlan {
    let from = intent.from.trim();
    let to = intent.to.trim();
    let scope = intent.scope.as_deref().filter(|s| !s.is_empty());
    let (edits, refs_n) = match kind {
        StableIdKind::Method => collect_method_edits(root, from, to, scope),
        StableIdKind::Component => collect_component_edits(root, from, to, scope),
        StableIdKind::Capability => collect_capability_edits(root, from, to, scope),
        _ => (Vec::new(), 0),
    };
    let causal = format!("rename:{kind}:{from}->{to}");
    let mut plan = WorkspaceEditPlan {
        schema: WORKSPACE_EDIT_SCHEMA.into(),
        preconditions: vec![
            format!("rename.kind={kind}"),
            format!("rename.from={from}"),
            format!("rename.to={to}"),
            format!("causalChainId={causal}"),
            "x1.symbol_reference_proven".into(),
            "x2.cross_sfc_index".into(),
        ],
        edits,
        affected_program_ids: vec![StableId::new(kind, from)],
        diagnostics: Vec::new(),
        status: vmz_protocol::WorkspaceEditStatus::Preview,
    };
    if let Some(scope) = scope {
        plan.preconditions.push(format!("rename.scope={scope}"));
    }
    if plan.edits.is_empty() {
        plan.status = vmz_protocol::WorkspaceEditStatus::Rejected;
        plan.diagnostics.push(ReportedDiagnostic::coded_error("", "dx.x2.rename.no_references").with_arg("detail", format!("no proven references for {kind} `{from}`")));
        return plan;
    }
    plan.status = vmz_protocol::WorkspaceEditStatus::Ready;
    plan.diagnostics.push(ReportedDiagnostic::coded_advice("", "dx.x2.rename.ready").with_arg("detail", format!(
            "rename ready: {kind} `{from}` -> `{to}` ({} edit(s), {refs_n} ref(s))",
            plan.edits.len()
        )));
    plan
}

fn collect_safe_fixes(root: &Path, diagnostics: &mut Vec<ReportedDiagnostic>) -> Vec<CodeAction> {
    let mut actions = Vec::new();
    for (rel, abs) in list_vmz_files(root) {
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source.clone()) else {
            continue;
        };
        let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
        let stem = abs.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
        if stem.is_empty() || analyzed.decl.name == stem || analyzed.decl.name == "Anonymous" {
            continue;
        }
        // Safe fix: align export default class name with file stem.
        let Some((s, e)) = span_of_class_name(&parsed.client.content, &analyzed.decl.name) else {
            continue;
        };
        let start = (parsed.client.content_start + s) as u32;
        let end = (parsed.client.content_start + e) as u32;
        diagnostics.push(
            ReportedDiagnostic::coded_warning(rel.clone(), DIAG_CLASS_NAME_MISMATCH).with_arg("detail", format!(
                    "export default class `{}` does not match file stem `{stem}`",
                    analyzed.decl.name
                ))
            .with_source_span(SourceSpan { path: rel.clone(), start, end }),
        );
        let mut edit = WorkspaceEditPlan::empty_preview();
        edit.status = vmz_protocol::WorkspaceEditStatus::Ready;
        edit.preconditions =
            vec!["x1.symbol_reference_proven".into(), "x2.safe_fix.class_name_mismatch".into()];
        edit.edits.push(TextEdit { path: rel.clone(), start, end, new_text: stem.clone() });
        edit.affected_program_ids
            .push(StableId::new(StableIdKind::Component, analyzed.decl.name.clone()));
        actions.push(CodeAction {
            schema: CODE_ACTION_SCHEMA.into(),
            title: format!("Rename class to `{stem}` (match file stem)"),
            kind: CodeActionKind::SafeFix,
            diagnostic_code: Some(DIAG_CLASS_NAME_MISMATCH.into()),
            edit: Some(edit),
        });
    }
    actions
}

fn collect_method_edits(
    root: &Path,
    from: &str,
    to: &str,
    scope: Option<&str>,
) -> (Vec<TextEdit>, usize) {
    let mut edits = Vec::new();
    let mut refs = 0;
    for (rel, abs) in list_vmz_files(root) {
        if let Some(scope) = scope {
            if !rel.contains(scope) {
                continue;
            }
        }
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source) else {
            continue;
        };
        let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
        if !analyzed.decl.methods.iter().any(|m| m.name == from) {
            continue;
        }
        // Script method name
        if let Some((s, e)) = span_of_method_decl(&parsed.client.content, from) {
            edits.push(TextEdit {
                path: rel.clone(),
                start: (parsed.client.content_start + s) as u32,
                end: (parsed.client.content_start + e) as u32,
                new_text: to.into(),
            });
            refs += 1;
        }
        let Ok((semantic, _)) = parse_template_asts(&parsed.template.content) else {
            continue;
        };
        for (ts, te) in semantic_handler_spans(&semantic, &parsed.template.content, from) {
            edits.push(TextEdit {
                path: rel.clone(),
                start: (parsed.template.content_start + ts) as u32,
                end: (parsed.template.content_start + te) as u32,
                new_text: to.into(),
            });
            refs += 1;
        }
    }
    edits.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
    (edits, refs)
}

fn collect_component_edits(
    root: &Path,
    from: &str,
    to: &str,
    scope: Option<&str>,
) -> (Vec<TextEdit>, usize) {
    let mut edits = Vec::new();
    let mut refs = 0;
    // Definition file: class name + opening tags in defining file.
    for (rel, abs) in list_vmz_files(root) {
        if let Some(scope) = scope {
            if !rel.contains(scope) {
                continue;
            }
        }
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source) else {
            continue;
        };
        let analyzed = analyze_script(ScriptKind::Client, &parsed.client.content);
        let is_def =
            analyzed.decl.name == from || abs.file_stem().and_then(|s| s.to_str()) == Some(from);
        if is_def {
            if let Some((s, e)) = span_of_class_name(&parsed.client.content, &analyzed.decl.name) {
                if analyzed.decl.name == from {
                    edits.push(TextEdit {
                        path: rel.clone(),
                        start: (parsed.client.content_start + s) as u32,
                        end: (parsed.client.content_start + e) as u32,
                        new_text: to.into(),
                    });
                    refs += 1;
                }
            }
        }
        // Usages: <From ...> via Semantic AST (not whole-template string scan).
        let Ok((semantic, _)) = parse_template_asts(&parsed.template.content) else {
            continue;
        };
        let tags = semantic_component_tags(&semantic);
        if tags.iter().any(|t| t == from) {
            for (ts, te) in semantic_tag_spans(&semantic, &parsed.template.content, from) {
                edits.push(TextEdit {
                    path: rel.clone(),
                    start: (parsed.template.content_start + ts) as u32,
                    end: (parsed.template.content_start + te) as u32,
                    new_text: to.into(),
                });
                refs += 1;
            }
        }
    }
    edits.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
    edits.dedup_by(|a, b| a.path == b.path && a.start == b.start && a.end == b.end);
    (edits, refs)
}

fn collect_capability_edits(
    root: &Path,
    from: &str,
    to: &str,
    scope: Option<&str>,
) -> (Vec<TextEdit>, usize) {
    // `from` may be bare method name or `#server/....method`.
    let method = from.rsplit('.').next().unwrap_or(from);
    let mut edits = Vec::new();
    let mut refs = 0;
    for (rel, abs) in list_vmz_files(root) {
        if let Some(scope) = scope {
            if !rel.contains(scope) {
                continue;
            }
        }
        let Ok(source) = fs::read_to_string(&abs) else {
            continue;
        };
        let Ok(parsed) = parse_vmz(&abs, source) else {
            continue;
        };
        if let Some(server) = &parsed.server {
            let s_analyzed = analyze_script(ScriptKind::Server, &server.content);
            if s_analyzed.decl.methods.iter().any(|m| m.name == method) {
                if let Some((s, e)) = span_of_method_decl(&server.content, method) {
                    edits.push(TextEdit {
                        path: rel.clone(),
                        start: (server.content_start + s) as u32,
                        end: (server.content_start + e) as u32,
                        new_text: to.into(),
                    });
                    refs += 1;
                }
                let client_class = s_analyzed.decl.name.clone();
                let call = format!("{client_class}.{method}(");
                let mut from_i = 0;
                while let Some(i) = parsed.client.content[from_i..].find(&call) {
                    let abs_i = from_i + i + client_class.len() + 1;
                    let end = abs_i + method.len();
                    edits.push(TextEdit {
                        path: rel.clone(),
                        start: (parsed.client.content_start + abs_i) as u32,
                        end: (parsed.client.content_start + end) as u32,
                        new_text: to.into(),
                    });
                    refs += 1;
                    from_i = end;
                }
            }
        }
    }
    edits.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
    (edits, refs)
}

fn list_vmz_files(root: &Path) -> Vec<(String, PathBuf)> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("vmz") {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        if rel.contains("/dist/") || rel.starts_with("dist/") || rel.contains("node_modules/") {
            continue;
        }
        out.push((rel, path.to_path_buf()));
    }
    out
}

fn span_of_ident(script: &str, name: &str) -> Option<(usize, usize)> {
    let mut from = 0;
    while let Some(i) = script[from..].find(name) {
        let abs = from + i;
        let end = abs + name.len();
        if is_ident_boundary(script, abs, end) {
            return Some((abs, end));
        }
        from = abs + 1;
    }
    None
}

fn span_of_class_name(script: &str, name: &str) -> Option<(usize, usize)> {
    let pat = format!("class {name}");
    if let Some(i) = script.find(&pat) {
        let start = i + "class ".len();
        return Some((start, start + name.len()));
    }
    None
}

fn span_of_method_decl(script: &str, name: &str) -> Option<(usize, usize)> {
    // Prefer `name(` method declaration form.
    let pat = format!("{name}(");
    let mut from = 0;
    while let Some(i) = script[from..].find(&pat) {
        let abs = from + i;
        if is_ident_boundary(script, abs, abs + name.len()) {
            // Skip call sites that are `this.name(` --still ok for rename.
            return Some((abs, abs + name.len()));
        }
        from = abs + 1;
    }
    None
}

fn is_ident_boundary(text: &str, start: usize, end: usize) -> bool {
    let bytes = text.as_bytes();
    let before_ok = start == 0
        || (!bytes[start - 1].is_ascii_alphanumeric()
            && bytes[start - 1] != b'_'
            && bytes[start - 1] != b'$');
    let after_ok = end >= bytes.len()
        || (!bytes[end].is_ascii_alphanumeric() && bytes[end] != b'_' && bytes[end] != b'$');
    before_ok && after_ok
}
