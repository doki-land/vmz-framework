//! X1 DX: RouteId/field rename TextEdits, atomic apply, graph→test edges.
//!
//! Design: `规划设计/vmz/21` §10 X1 收口.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

use vmz_protocol::{
    DxDiagnostic, ExplainEdge, REFERENCE_SCHEMA, Reference, RenameIntent, SYMBOL_SCHEMA,
    SourceSpan, StableId, Symbol, TestSelectionDocument, TextEdit, WORKSPACE_EDIT_SCHEMA,
    WorkspaceEditPlan,
};

/// Plan rename with proven Symbol/Reference-backed TextEdits when occurrences exist.
pub fn plan_rename_edits(root: &Path, intent: &RenameIntent, kind: &str) -> WorkspaceEditPlan {
    let from = intent.from.trim();
    let to = intent.to.trim();
    let scope = intent.scope.as_deref().filter(|s| !s.is_empty());

    let (symbols, references, edits) = match kind {
        "route_id" => collect_route_id_refs(root, from, to, scope),
        "field" => collect_field_refs(root, from, to, scope),
        "method" | "component" | "capability" => {
            return crate::dx_x2::plan_x2_rename(root, intent, kind);
        }
        _ => unreachable!("normalize_rename_kind already validated"),
    };

    let causal = causal_chain_id(kind, from, to);
    let mut plan = WorkspaceEditPlan {
        schema: WORKSPACE_EDIT_SCHEMA.into(),
        preconditions: vec![
            format!("rename.kind={kind}"),
            format!("rename.from={from}"),
            format!("rename.to={to}"),
            format!("causalChainId={causal}"),
            "x1.symbol_reference_proven".into(),
        ],
        edits,
        affected_program_ids: symbols
            .iter()
            .map(|s| s.stable_id.clone())
            .chain(std::iter::once(StableId { kind: kind.into(), id: from.into() }))
            .collect(),
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
            message: format!(
                "no proven references for {kind} `{from}` under workspace (Symbol/Reference index empty for this rename)"
            ),
            code: Some("dx.x1.rename.no_references".into()),
            span: None,
        });
        return plan;
    }

    plan.status = "ready".into();
    plan.diagnostics.push(DxDiagnostic {
        path: String::new(),
        severity: "info".into(),
        message: format!(
            "X1 rename ready: {kind} `{from}` -> `{to}` ({} edit(s), {} reference(s), causal={causal})",
            plan.edits.len(),
            references.len(),
            causal = causal
        ),
        code: Some("dx.x1.rename.ready".into()),
        span: None,
    });
    // Provenance breadcrumbs for gate / explain.
    for sym in &symbols {
        plan.diagnostics.push(DxDiagnostic {
            path: sym.span.as_ref().map(|s| s.path.clone()).unwrap_or_default(),
            severity: "info".into(),
            message: format!("symbol {}::{}", sym.stable_id.kind, sym.stable_id.id),
            code: Some(SYMBOL_SCHEMA.into()),
            span: sym.span.clone(),
        });
    }
    for r in &references {
        let path = r.span.as_ref().map(|s| s.path.clone()).unwrap_or_default();
        let (start, end) = r.span.as_ref().map(|s| (s.start, s.end)).unwrap_or((0, 0));
        plan.diagnostics.push(DxDiagnostic {
            path,
            severity: "info".into(),
            message: format!("reference {} @{}..{}", r.kind, start, end),
            code: Some(REFERENCE_SCHEMA.into()),
            span: r.span.clone(),
        });
    }
    let _ = symbols;
    plan
}

fn preview_unsupported(kind: &str, from: &str, to: &str, scope: Option<&str>) -> WorkspaceEditPlan {
    let mut plan = WorkspaceEditPlan::empty_preview();
    plan.preconditions = vec![
        format!("rename.kind={kind}"),
        format!("rename.from={from}"),
        format!("rename.to={to}"),
        "x1.kind_deferred_to_x2".into(),
    ];
    if let Some(scope) = scope {
        plan.preconditions.push(format!("rename.scope={scope}"));
    }
    plan.diagnostics.push(DxDiagnostic {
        path: String::new(),
        severity: "info".into(),
        message: format!(
            "X1 first version proves route_id/field; `{kind}` rename remains preview without TextEdit"
        ),
        code: Some("dx.x1.rename.kind_deferred".into()),
        span: None,
    });
    plan.affected_program_ids.push(StableId { kind: kind.into(), id: from.into() });
    plan
}

/// Atomically apply a ready WorkspaceEditPlan. Returns applied plan JSON status.
pub fn apply_workspace_edits(root: &Path, plan: &WorkspaceEditPlan) -> WorkspaceEditPlan {
    if plan.status == "rejected" {
        return WorkspaceEditPlan::rejected(
            "cannot apply rejected WorkspaceEditPlan",
            "dx.x1.rename.apply_rejected",
        );
    }
    if plan.edits.is_empty() {
        return WorkspaceEditPlan::rejected(
            "WorkspaceEditPlan has no TextEdits to apply",
            "dx.x1.rename.apply_empty",
        );
    }
    if !plan.preconditions.iter().any(|p| p == "x1.symbol_reference_proven") {
        return WorkspaceEditPlan::rejected(
            "apply requires x1.symbol_reference_proven precondition",
            "dx.x1.rename.apply_unproven",
        );
    }

    // Group by path; apply high-to-low offsets so earlier edits stay valid.
    let mut by_path: BTreeMap<String, Vec<&TextEdit>> = BTreeMap::new();
    for e in &plan.edits {
        by_path.entry(e.path.clone()).or_default().push(e);
    }

    let mut staged: Vec<(PathBuf, String)> = Vec::new();
    for (rel, edits) in &by_path {
        let abs = root.join(rel);
        let Ok(original) = fs::read_to_string(&abs) else {
            return WorkspaceEditPlan::rejected(
                format!("apply failed: cannot read `{rel}`"),
                "dx.x1.rename.apply_io",
            );
        };
        let bytes = original.as_bytes();
        let mut ordered = edits.clone();
        ordered.sort_by(|a, b| b.start.cmp(&a.start));
        let mut out = original.clone();
        for e in ordered {
            let start = e.start as usize;
            let end = e.end as usize;
            if end < start || end > bytes.len() {
                return WorkspaceEditPlan::rejected(
                    format!("apply failed: bad span {start}..{end} in `{rel}`"),
                    "dx.x1.rename.apply_span",
                );
            }
            // Validate UTF-8 boundaries.
            if !out.is_char_boundary(start) || !out.is_char_boundary(end) {
                return WorkspaceEditPlan::rejected(
                    format!("apply failed: non-char boundary in `{rel}`"),
                    "dx.x1.rename.apply_span",
                );
            }
            out.replace_range(start..end, &e.new_text);
        }
        staged.push((abs, out));
    }

    for (path, content) in &staged {
        if let Err(e) = fs::write(path, content) {
            return WorkspaceEditPlan::rejected(
                format!("apply failed writing {}: {e}", path.display()),
                "dx.x1.rename.apply_io",
            );
        }
    }

    let mut applied = plan.clone();
    applied.status = "applied".into();
    applied.diagnostics.push(DxDiagnostic {
        path: String::new(),
        severity: "info".into(),
        message: format!("applied {} TextEdit(s) atomically", plan.edits.len()),
        code: Some("dx.x1.rename.applied".into()),
        span: None,
    });
    applied
}

/// Index `*.vmz.test.json` edges: chunkId → test id (graph→test).
pub fn index_test_chunk_edges(root: &Path) -> Vec<(String, String, String)> {
    // (chunkId, testId, manifestRel)
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !name.ends_with(".vmz.test.json") && !name.ends_with(".test.json") {
            continue;
        }
        let Ok(text) = fs::read_to_string(path) else {
            continue;
        };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) else {
            continue;
        };
        let test_id = v.get("id").and_then(|x| x.as_str()).unwrap_or(name).to_string();
        let chunk =
            v.pointer("/program/chunkId").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if chunk.is_empty() {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        out.push((chunk, test_id, rel));
    }
    out.sort();
    out
}

/// Select tests whose program.chunkId intersects affected chunks.
pub fn select_tests_for_chunks(
    root: &Path,
    affected_chunks: &[String],
    full: bool,
) -> TestSelectionDocument {
    let edges = index_test_chunk_edges(root);
    if affected_chunks.is_empty() && !full {
        return TestSelectionDocument::empty(
            "no dirty units — update files or rebuild with a dirty set before --affected",
        );
    }

    let chunk_set: BTreeSet<String> = affected_chunks.iter().cloned().collect();
    let mut test_ids = Vec::new();
    let mut manifests = Vec::new();
    for (chunk, test_id, rel) in &edges {
        let hit = full
            || chunk_set.contains(chunk)
            || chunk_set.iter().any(|c| chunk.contains(c) || c.contains(chunk));
        if hit {
            test_ids.push(test_id.clone());
            manifests.push(rel.clone());
        }
    }
    test_ids.sort();
    test_ids.dedup();
    manifests.sort();
    manifests.dedup();

    let mut doc = TestSelectionDocument {
        schema: vmz_protocol::TEST_SELECTION_SCHEMA.into(),
        reason: if test_ids.is_empty() {
            "graph→test edges indexed; no manifests matched affected chunks".into()
        } else {
            format!(
                "graph→test edges: {} test(s) selected from {} edge(s) for {} affected chunk(s)",
                test_ids.len(),
                edges.len(),
                affected_chunks.len()
            )
        },
        test_ids,
        affected_chunk_ids: affected_chunks.to_vec(),
        manifest_files: manifests,
        status: "ready".into(),
    };
    if doc.test_ids.is_empty() && !full {
        doc.status = "preview".into();
    }
    if affected_chunks.is_empty() && full {
        doc.status = "ready".into();
        doc.reason = "full rebuild — all graph→test edges selected".into();
        // Re-select all
        let edges = index_test_chunk_edges(root);
        doc.test_ids = edges.iter().map(|(_, id, _)| id.clone()).collect();
        doc.test_ids.sort();
        doc.test_ids.dedup();
        doc.manifest_files = edges.iter().map(|(_, _, r)| r.clone()).collect();
        doc.manifest_files.sort();
        doc.manifest_files.dedup();
    }
    doc
}

/// Build explain chain linking rename → edits → chunks → tests.
pub fn rename_explain_chain(
    kind: &str,
    from: &str,
    to: &str,
    edits: &[TextEdit],
    chunks: &[String],
    test_ids: &[String],
) -> Vec<ExplainEdge> {
    let causal = causal_chain_id(kind, from, to);
    let mut chain = Vec::new();
    let rename_id = StableId { kind: "rename".into(), id: causal.clone() };
    let symbol_id = StableId { kind: kind.into(), id: from.into() };
    chain.push(ExplainEdge {
        from: symbol_id.clone(),
        to: rename_id.clone(),
        reason: format!("rename {kind} `{from}` -> `{to}`"),
        precision: Some("exact".into()),
        span: None,
    });
    for e in edits {
        chain.push(ExplainEdge {
            from: rename_id.clone(),
            to: StableId {
                kind: "text_edit".into(),
                id: format!("{}@{}..{}", e.path, e.start, e.end),
            },
            reason: "workspace_edit".into(),
            precision: Some("exact".into()),
            span: Some(SourceSpan { path: e.path.clone(), start: e.start, end: e.end }),
        });
    }
    for c in chunks {
        chain.push(ExplainEdge {
            from: rename_id.clone(),
            to: StableId { kind: "chunk".into(), id: c.clone() },
            reason: "affected_chunk".into(),
            precision: Some("exact".into()),
            span: None,
        });
    }
    for t in test_ids {
        chain.push(ExplainEdge {
            from: rename_id.clone(),
            to: StableId { kind: "test".into(), id: t.clone() },
            reason: "graph_selected_test".into(),
            precision: Some("exact".into()),
            span: None,
        });
    }
    let _ = symbol_id;
    chain
}

pub fn causal_chain_id(kind: &str, from: &str, to: &str) -> String {
    format!("rename:{kind}:{from}->{to}")
}

/// Map workspace-relative edit paths to approximate chunk ids (`src/pages/x.vmz` → `pages/x`).
pub fn chunks_from_edits(edits: &[TextEdit]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for e in edits {
        if let Some(c) = rel_path_to_chunk(&e.path) {
            set.insert(c);
        }
    }
    set.into_iter().collect()
}

fn rel_path_to_chunk(rel: &str) -> Option<String> {
    let rel = rel.replace('\\', "/");
    let trimmed = rel.strip_prefix("./").unwrap_or(rel.as_str());
    let trimmed = trimmed.strip_prefix("src/").unwrap_or(trimmed);
    if let Some(stem) = trimmed.strip_suffix(".vmz") {
        if !stem.is_empty() && !stem.contains("..") {
            return Some(stem.to_string());
        }
    }
    None
}

fn collect_route_id_refs(
    root: &Path,
    from: &str,
    to: &str,
    scope: Option<&str>,
) -> (Vec<Symbol>, Vec<Reference>, Vec<TextEdit>) {
    let mut symbols = Vec::new();
    let mut references = Vec::new();
    let mut edits = Vec::new();

    symbols.push(Symbol {
        schema: SYMBOL_SCHEMA.into(),
        stable_id: StableId { kind: "route_id".into(), id: from.into() },
        kind: "route_id".into(),
        name: from.into(),
        span: None,
        owners: Vec::new(),
        tags: vec!["x1".into()],
    });

    for (rel, text) in iter_source_files(root, scope) {
        for (start, end, _matched) in find_route_id_spans(&text, from) {
            references.push(Reference {
                schema: REFERENCE_SCHEMA.into(),
                from: StableId { kind: "file".into(), id: rel.clone() },
                to: StableId { kind: "route_id".into(), id: from.into() },
                kind: "route_id".into(),
                span: Some(SourceSpan { path: rel.clone(), start: start as u32, end: end as u32 }),
            });
            edits.push(TextEdit {
                path: rel.clone(),
                start: start as u32,
                end: end as u32,
                new_text: to.into(),
            });
        }
    }
    edits.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
    (symbols, references, edits)
}

fn collect_field_refs(
    root: &Path,
    from: &str,
    to: &str,
    scope: Option<&str>,
) -> (Vec<Symbol>, Vec<Reference>, Vec<TextEdit>) {
    let mut symbols = Vec::new();
    let mut references = Vec::new();
    let mut edits = Vec::new();

    symbols.push(Symbol {
        schema: SYMBOL_SCHEMA.into(),
        stable_id: StableId { kind: "field".into(), id: from.into() },
        kind: "field".into(),
        name: from.into(),
        span: None,
        owners: Vec::new(),
        tags: vec!["x1".into()],
    });

    for (rel, text) in iter_source_files(root, scope) {
        if !rel.ends_with(".vmz") {
            continue;
        }
        for (start, end) in find_field_spans(&text, from) {
            references.push(Reference {
                schema: REFERENCE_SCHEMA.into(),
                from: StableId { kind: "file".into(), id: rel.clone() },
                to: StableId { kind: "field".into(), id: from.into() },
                kind: "field".into(),
                span: Some(SourceSpan { path: rel.clone(), start: start as u32, end: end as u32 }),
            });
            edits.push(TextEdit {
                path: rel.clone(),
                start: start as u32,
                end: end as u32,
                new_text: to.into(),
            });
        }
    }
    edits.sort_by(|a, b| (&a.path, a.start).cmp(&(&b.path, b.start)));
    (symbols, references, edits)
}

fn iter_source_files(root: &Path, scope: Option<&str>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        // Skip build outputs / node_modules.
        let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
        if rel.contains("/dist/")
            || rel.starts_with("dist/")
            || rel.contains("node_modules/")
            || rel.contains("/target/")
        {
            continue;
        }
        if let Some(scope) = scope {
            let scope_n = scope.replace('\\', "/");
            if !rel.contains(&scope_n) && !rel.starts_with(&scope_n) {
                continue;
            }
        }
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let ok = matches!(ext, "vmz" | "json" | "json5" | "md" | "ts" | "js")
            || name == "package.json"
            || name.ends_with(".vmz.test.json");
        if !ok {
            continue;
        }
        if let Ok(text) = fs::read_to_string(path) {
            out.push((rel, text));
        }
    }
    out
}

/// Spans covering the RouteId token itself (not surrounding quotes).
fn find_route_id_spans(text: &str, id: &str) -> Vec<(usize, usize, String)> {
    let mut out = Vec::new();
    let patterns = [
        format!("to=\"{id}\""),
        format!("to='{id}'"),
        format!("id: \"{id}\""),
        format!("id: '{id}'"),
        format!("\"id\": \"{id}\""),
        format!("'id': '{id}'"),
        format!("entryRoute\": \"{id}\""),
        format!("entryRoute\": \"{id}\""),
        format!("\"entryRoute\": \"{id}\""),
        format!("routeId\": \"{id}\""),
        format!("\"routeId\": \"{id}\""),
        format!("to: \"{id}\""),
        format!("to: '{id}'"),
    ];
    for pat in &patterns {
        let mut search_from = 0;
        while let Some(i) = text[search_from..].find(pat) {
            let abs = search_from + i;
            // Locate id token inside pattern.
            if let Some(off) = pat.find(id) {
                let start = abs + off;
                let end = start + id.len();
                out.push((start, end, id.to_string()));
            }
            search_from = abs + pat.len();
        }
    }
    // Also bare `id: home` without quotes (json5).
    let bare = format!("id: {id}");
    let mut search_from = 0;
    while let Some(i) = text[search_from..].find(&bare) {
        let abs = search_from + i;
        let after = abs + bare.len();
        let next = text.as_bytes().get(after).copied().unwrap_or(b' ');
        if next.is_ascii_alphanumeric() || next == b'_' || next == b'-' || next == b'.' {
            search_from = abs + 1;
            continue;
        }
        let start = abs + "id: ".len();
        let end = start + id.len();
        out.push((start, end, id.to_string()));
        search_from = after;
    }
    out.sort_by_key(|(s, _, _)| *s);
    out.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    out
}

fn find_field_spans(text: &str, name: &str) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    // Declaration: `name =` at line start-ish inside script.
    let decl = format!("{name} =");
    let mut search_from = 0;
    while let Some(i) = text[search_from..].find(&decl) {
        let abs = search_from + i;
        if is_ident_boundary(text, abs, abs + name.len()) {
            out.push((abs, abs + name.len()));
        }
        search_from = abs + name.len();
    }
    // Template `{name}`
    let brace = format!("{{{name}}}");
    search_from = 0;
    while let Some(i) = text[search_from..].find(&brace) {
        let abs = search_from + i + 1; // skip `{`
        out.push((abs, abs + name.len()));
        search_from = abs + name.len();
    }
    // `if={name}` / `each={name}` etc.
    for prefix in ["if={", "each={", "show={", "hide={"] {
        let pat = format!("{prefix}{name}");
        search_from = 0;
        while let Some(i) = text[search_from..].find(&pat) {
            let abs = search_from + i + prefix.len();
            let end = abs + name.len();
            let next = text.as_bytes().get(end).copied().unwrap_or(b'}');
            if next == b'}' || next == b' ' || next == b'.' {
                out.push((abs, end));
            }
            search_from = abs + name.len();
        }
    }
    out.sort();
    out.dedup();
    out
}

fn is_ident_boundary(text: &str, start: usize, end: usize) -> bool {
    let bytes = text.as_bytes();
    let before_ok = start == 0
        || !bytes[start - 1].is_ascii_alphanumeric()
            && bytes[start - 1] != b'_'
            && bytes[start - 1] != b'$';
    let after_ok = end >= bytes.len()
        || !bytes[end].is_ascii_alphanumeric() && bytes[end] != b'_' && bytes[end] != b'$';
    before_ok && after_ok
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(label: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("vmz-x1-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn route_id_rename_emits_edits_and_applies() {
        let root = tmp("route");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(
            root.join("src/Index.vmz"),
            r#"<router>
{ id: "home", path: "/" }
</router>
<template>
  <Link to="home" />
</template>
"#,
        )
        .unwrap();
        let intent = RenameIntent::new("route_id", "home", "landing");
        let plan = plan_rename_edits(&root, &intent, "route_id");
        assert_eq!(plan.status, "ready", "{:?}", plan.diagnostics);
        assert!(plan.edits.len() >= 2, "{:?}", plan.edits);
        let applied = apply_workspace_edits(&root, &plan);
        assert_eq!(applied.status, "applied", "{:?}", applied.diagnostics);
        let text = fs::read_to_string(root.join("src/Index.vmz")).unwrap();
        assert!(text.contains("landing"), "{text}");
        assert!(!text.contains("to=\"home\""), "{text}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn test_edges_select_by_chunk() {
        let root = tmp("tests");
        fs::create_dir_all(root.join("tests")).unwrap();
        fs::write(
            root.join("tests/a.vmz.test.json"),
            r#"{"schema":"vmz.test.manifest.v0","id":"a.test","program":{"chunkId":"pages/index"}}"#,
        )
        .unwrap();
        fs::write(
            root.join("tests/b.vmz.test.json"),
            r#"{"schema":"vmz.test.manifest.v0","id":"b.test","program":{"chunkId":"components/Card"}}"#,
        )
        .unwrap();
        let sel = select_tests_for_chunks(&root, &["pages/index".into()], false);
        assert_eq!(sel.test_ids, vec!["a.test".to_string()]);
        assert_eq!(sel.status, "ready");
        let _ = fs::remove_dir_all(&root);
    }
}
