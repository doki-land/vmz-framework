//! DX: cross-SFC Symbol/Reference index, method/component/capability rename,
//! template–script source map, and first safe_fix CodeActions.
//!

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use vmz_protocol::{
    CODE_ACTION_SCHEMA, CodeAction, DxDiagnostic, REFERENCE_SCHEMA, Reference, RenameIntent,
    SYMBOL_SCHEMA, SourceSpan, StableId, Symbol, TextEdit, WORKSPACE_EDIT_SCHEMA,
    WorkspaceEditPlan,
};

use crate::analyze::analyze_script;
use crate::sfc::{ScriptKind, parse_vmz};
use crate::template::{AttrValue, TemplateNode, parse_template};

pub const SOURCE_MAP_SCHEMA: &str = "vmz.dx.source_map.v0";
pub const SYMBOL_INDEX_SCHEMA: &str = "vmz.dx.symbol_index.v0";
pub const CROSS_SFC_CHECK_SCHEMA: &str = "vmz.dx.cross_sfc_check.v0";

pub const DIAG_CLASS_NAME_MISMATCH: &str = "vmz::dx::class_name_mismatch";

/// One template↔script source-map edge (absolute file byte offsets).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct TemplateScriptMapEntry {
    pub schema: String,
    pub path: String,
    #[serde(rename = "symbolKind")]
    pub symbol_kind: String,
    pub name: String,
    #[serde(rename = "templateSpan")]
    pub template_span: SourceSpan,
    #[serde(rename = "scriptSpan")]
    pub script_span: SourceSpan,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct SymbolIndexDocument {
    pub schema: String,
    pub symbols: Vec<Symbol>,
    pub references: Vec<Reference>,
    #[serde(rename = "sourceMap")]
    pub source_map: Vec<TemplateScriptMapEntry>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct CrossSfcCheckReport {
    pub schema: String,
    pub index: SymbolIndexDocument,
    #[serde(rename = "codeActions")]
    pub code_actions: Vec<CodeAction>,
    pub diagnostics: Vec<DxDiagnostic>,
}

impl CrossSfcCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }
}

impl SymbolIndexDocument {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Build workspace-wide symbol index + source map + safe_fix actions.
pub fn check_cross_sfc(root: &Path) -> CrossSfcCheckReport {
    let index = build_symbol_index(root);
    let mut diagnostics = Vec::new();
    let code_actions = collect_safe_fixes(root, &mut diagnostics);
    CrossSfcCheckReport { schema: CROSS_SFC_CHECK_SCHEMA.into(), index, code_actions, diagnostics }
}

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
            stable_id: StableId { kind: "component".into(), id: class_name.clone() },
            name: class_name.clone(),
            kind: "component".into(),
            span: class_span.clone(),
            owners: vec![StableId { kind: "file".into(), id: rel.clone() }],
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
                stable_id: StableId { kind: "field".into(), id: format!("{class_name}.{name}") },
                name: name.clone(),
                kind: "field".into(),
                span: script_span.clone(),
                owners: vec![StableId { kind: "component".into(), id: class_name.clone() }],
                tags: vec!["x2".into()],
            });
            let ir = parse_template(&parsed.template.content);
            if true {
                for (ts, te) in template_name_spans(&ir, &parsed.template.content, &name) {
                    let tspan = SourceSpan {
                        path: rel.clone(),
                        start: (parsed.template.content_start + ts) as u32,
                        end: (parsed.template.content_start + te) as u32,
                    };
                    references.push(Reference {
                        schema: REFERENCE_SCHEMA.into(),
                        from: StableId { kind: "template".into(), id: rel.clone() },
                        to: StableId { kind: "field".into(), id: format!("{class_name}.{name}") },
                        kind: "field".into(),
                        span: Some(tspan.clone()),
                    });
                    if let Some(ss) = &script_span {
                        source_map.push(TemplateScriptMapEntry {
                            schema: SOURCE_MAP_SCHEMA.into(),
                            path: rel.clone(),
                            symbol_kind: "field".into(),
                            name: name.clone(),
                            template_span: tspan,
                            script_span: ss.clone(),
                        });
                    }
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
                stable_id: StableId { kind: "method".into(), id: format!("{class_name}.{name}") },
                name: name.clone(),
                kind: "method".into(),
                span: script_span.clone(),
                owners: vec![StableId { kind: "component".into(), id: class_name.clone() }],
                tags: vec!["x2".into()],
            });
            let ir = parse_template(&parsed.template.content);
            if true {
                for (ts, te) in template_handler_spans(&ir, &parsed.template.content, &name) {
                    let tspan = SourceSpan {
                        path: rel.clone(),
                        start: (parsed.template.content_start + ts) as u32,
                        end: (parsed.template.content_start + te) as u32,
                    };
                    references.push(Reference {
                        schema: REFERENCE_SCHEMA.into(),
                        from: StableId { kind: "template".into(), id: rel.clone() },
                        to: StableId { kind: "method".into(), id: format!("{class_name}.{name}") },
                        kind: "method".into(),
                        span: Some(tspan.clone()),
                    });
                    if let Some(ss) = &script_span {
                        source_map.push(TemplateScriptMapEntry {
                            schema: SOURCE_MAP_SCHEMA.into(),
                            path: rel.clone(),
                            symbol_kind: "method".into(),
                            name: name.clone(),
                            template_span: tspan,
                            script_span: ss.clone(),
                        });
                    }
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
                    stable_id: StableId { kind: "capability".into(), id: cap_id.clone() },
                    name: name.clone(),
                    kind: "capability".into(),
                    span: script_span,
                    owners: vec![StableId { kind: "server".into(), id: server_id.clone() }],
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
                        from: StableId { kind: "client".into(), id: rel.clone() },
                        to: StableId { kind: "capability".into(), id: cap_id.clone() },
                        kind: "capability".into(),
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
        let ir = parse_template(&parsed.template.content);
        for tag in collect_component_tags(&ir) {
            if let Some(def_rel) = by_stem.get(&tag) {
                if def_rel == &rel {
                    continue;
                }
                for (ts, te) in tag_spans_in_template(&parsed.template.content, &tag) {
                    references.push(Reference {
                        schema: REFERENCE_SCHEMA.into(),
                        from: StableId { kind: "file".into(), id: rel.clone() },
                        to: StableId { kind: "component".into(), id: tag.clone() },
                        kind: "component".into(),
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
        (a.stable_id.kind.as_str(), a.stable_id.id.as_str())
            .cmp(&(b.stable_id.kind.as_str(), b.stable_id.id.as_str()))
    });
    SymbolIndexDocument { schema: SYMBOL_INDEX_SCHEMA.into(), symbols, references, source_map }
}

/// Plan method/component/capability rename with proven TextEdits.
pub fn plan_x2_rename(root: &Path, intent: &RenameIntent, kind: &str) -> WorkspaceEditPlan {
    let from = intent.from.trim();
    let to = intent.to.trim();
    let scope = intent.scope.as_deref().filter(|s| !s.is_empty());
    let (edits, refs_n) = match kind {
        "method" => collect_method_edits(root, from, to, scope),
        "component" => collect_component_edits(root, from, to, scope),
        "capability" => collect_capability_edits(root, from, to, scope),
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
        affected_program_ids: vec![StableId { kind: kind.into(), id: from.into() }],
        diagnostics: Vec::new(),
        status: "preview".into(),
    };
    if let Some(scope) = scope {
        plan.preconditions.push(format!("rename.scope={scope}"));
    }
    if plan.edits.is_empty() {
        plan.status = "rejected".into();
        plan.diagnostics.push(DxDiagnostic {
            path: String::new(),
            severity: "error".into(),
            message: format!("no proven references for {kind} `{from}`"),
            code: Some("dx.x2.rename.no_references".into()),
            span: None,
        });
        return plan;
    }
    plan.status = "ready".into();
    plan.diagnostics.push(DxDiagnostic {
        path: String::new(),
        severity: "info".into(),
        message: format!(
            "rename ready: {kind} `{from}` -> `{to}` ({} edit(s), {refs_n} ref(s))",
            plan.edits.len()
        ),
        code: Some("dx.x2.rename.ready".into()),
        span: None,
    });
    plan
}

fn collect_safe_fixes(root: &Path, diagnostics: &mut Vec<DxDiagnostic>) -> Vec<CodeAction> {
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
        diagnostics.push(DxDiagnostic {
            path: rel.clone(),
            severity: "warning".into(),
            message: format!(
                "export default class `{}` does not match file stem `{stem}`",
                analyzed.decl.name
            ),
            code: Some(DIAG_CLASS_NAME_MISMATCH.into()),
            span: Some(SourceSpan { path: rel.clone(), start, end }),
        });
        let mut edit = WorkspaceEditPlan::empty_preview();
        edit.status = "ready".into();
        edit.preconditions =
            vec!["x1.symbol_reference_proven".into(), "x2.safe_fix.class_name_mismatch".into()];
        edit.edits.push(TextEdit { path: rel.clone(), start, end, new_text: stem.clone() });
        edit.affected_program_ids
            .push(StableId { kind: "component".into(), id: analyzed.decl.name.clone() });
        actions.push(CodeAction {
            schema: CODE_ACTION_SCHEMA.into(),
            title: format!("Rename class to `{stem}` (match file stem)"),
            kind: "safe_fix".into(),
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
        let ir = parse_template(&parsed.template.content);
        if true {
            for (ts, te) in template_handler_spans(&ir, &parsed.template.content, from) {
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
        // Usages: <From ...>
        let ir = parse_template(&parsed.template.content);
        if true {
            let tags = collect_component_tags(&ir);
            if tags.iter().any(|t| t == from) {
                for (ts, te) in tag_spans_in_template(&parsed.template.content, from) {
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

fn collect_component_tags(ir: &crate::template::TemplateIr) -> Vec<String> {
    let mut out = Vec::new();
    fn walk(nodes: &[TemplateNode], out: &mut Vec<String>) {
        for n in nodes {
            if let TemplateNode::Element { tag, children, .. } = n {
                if tag.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
                    out.push(tag.clone());
                }
                walk(children, out);
            }
        }
    }
    walk(&ir.roots, &mut out);
    out.sort();
    out.dedup();
    out
}

fn tag_spans_in_template(template: &str, tag: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for prefix in ["<", "</"] {
        let pat = format!("{prefix}{tag}");
        let mut from = 0;
        while let Some(i) = template[from..].find(&pat) {
            let abs = from + i + prefix.len();
            let end = abs + tag.len();
            let next = template.as_bytes().get(end).copied().unwrap_or(b' ');
            if next == b'>' || next == b'/' || next == b' ' || next == b'\n' || next == b'\r' {
                out.push((abs, end));
            }
            from = end;
        }
    }
    out
}

fn template_name_spans(
    ir: &crate::template::TemplateIr,
    template: &str,
    name: &str,
) -> Vec<(usize, usize)> {
    let _ = ir;
    let mut out = Vec::new();
    let brace = format!("{{{name}}}");
    let mut from = 0;
    while let Some(i) = template[from..].find(&brace) {
        let abs = from + i + 1;
        out.push((abs, abs + name.len()));
        from = abs + name.len();
    }
    for prefix in ["if={", "each={", "show={", "hide={"] {
        let pat = format!("{prefix}{name}");
        from = 0;
        while let Some(i) = template[from..].find(&pat) {
            let abs = from + i + prefix.len();
            let end = abs + name.len();
            out.push((abs, end));
            from = end;
        }
    }
    out
}

fn template_handler_spans(
    ir: &crate::template::TemplateIr,
    template: &str,
    name: &str,
) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    fn walk(nodes: &[TemplateNode], name: &str, template: &str, out: &mut Vec<(usize, usize)>) {
        for n in nodes {
            if let TemplateNode::Element { attrs, children, .. } = n {
                for a in attrs {
                    let is_event = a.name.starts_with('@') || a.name.starts_with("on");
                    if !is_event {
                        continue;
                    }
                    match &a.value {
                        AttrValue::Interp(expr)
                            if expr.trim() == name || expr.trim() == format!("this.{name}") =>
                        {
                            // Find in template text near attribute.
                            let needle = if expr.contains("this.") {
                                format!("this.{name}")
                            } else {
                                name.to_string()
                            };
                            if let Some(i) = template.find(&needle) {
                                // Prefer occurrence after attr name --take all for rename accuracy with dedup.
                                let mut from = 0;
                                while let Some(j) = template[from..].find(&needle) {
                                    let abs = from + j;
                                    if needle.starts_with("this.") {
                                        let start = abs + "this.".len();
                                        out.push((start, start + name.len()));
                                    } else if is_ident_boundary(template, abs, abs + name.len()) {
                                        out.push((abs, abs + name.len()));
                                    }
                                    from = abs + needle.len();
                                }
                            }
                        }
                        AttrValue::Static(s) if s.trim() == name => {
                            if let Some(i) = template.find(name) {
                                out.push((i, i + name.len()));
                            }
                        }
                        _ => {}
                    }
                }
                walk(children, name, template, out);
            }
        }
    }
    walk(&ir.roots, name, template, &mut out);
    // Also `@click={name}` string scan fallback.
    for prefix in ["={", "=\"", "='"] {
        for event in ["@click", "@input", "@change", "onclick", "oninput"] {
            let pat = format!("{event}{prefix}{name}");
            let mut from = 0;
            while let Some(i) = template[from..].find(&pat) {
                let abs = from + i + event.len() + prefix.len();
                out.push((abs, abs + name.len()));
                from = abs + name.len();
            }
        }
    }
    out.sort();
    out.dedup();
    out
}
