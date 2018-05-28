//! X3 DX: semantic transaction, cancel, affected preview, HMR plan, route/chunk budget.
//!
//! Design: `规划设计/vmz/21` §5 / §10 X3.
//! Algebraic first version — not live mid-oxc cancel or byte-budget enforcement.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use vmz_protocol::{
    AFFECTED_PREVIEW_SCHEMA, AffectedPreviewDocument, BUDGET_SCHEMA, BudgetChunkEntry,
    BudgetDocument, BudgetRouteEntry, CANCEL_SCHEMA, CancelDocument, DxDiagnostic, HMR_PLAN_SCHEMA,
    HmrPlanDocument, SEMANTIC_TRANSACTION_SCHEMA, SemanticTransactionDocument, TextEdit,
    X3_CHECK_SCHEMA, X3CheckReport,
};

use crate::affected::plan_affected;
use crate::dx_x1::select_tests_for_chunks;
use crate::session_graph::SessionGraph;

/// Apply a batch of TextEdits atomically (no X1 rename precondition).
pub fn apply_semantic_transaction(
    root: &Path,
    id: u64,
    edits: &[TextEdit],
) -> SemanticTransactionDocument {
    if edits.is_empty() {
        return SemanticTransactionDocument::rejected(
            id,
            "semantic transaction has no TextEdits",
            "dx.x3.transaction.empty",
        );
    }

    let mut by_path: BTreeMap<String, Vec<&TextEdit>> = BTreeMap::new();
    for e in edits {
        by_path.entry(e.path.clone()).or_default().push(e);
    }

    let mut staged: Vec<(PathBuf, String, String)> = Vec::new();
    for (rel, path_edits) in &by_path {
        let abs = root.join(rel);
        let Ok(original) = fs::read_to_string(&abs) else {
            return SemanticTransactionDocument::rejected(
                id,
                format!("cannot read `{rel}`"),
                "dx.x3.transaction.io",
            );
        };
        let bytes = original.as_bytes();
        let mut ordered = path_edits.clone();
        ordered.sort_by(|a, b| b.start.cmp(&a.start));
        let mut out = original.clone();
        for e in ordered {
            let start = e.start as usize;
            let end = e.end as usize;
            if end < start || end > bytes.len() {
                return SemanticTransactionDocument::rejected(
                    id,
                    format!("bad span {start}..{end} in `{rel}`"),
                    "dx.x3.transaction.span",
                );
            }
            if !out.is_char_boundary(start) || !out.is_char_boundary(end) {
                return SemanticTransactionDocument::rejected(
                    id,
                    format!("non-char boundary in `{rel}`"),
                    "dx.x3.transaction.span",
                );
            }
            out.replace_range(start..end, &e.new_text);
        }
        staged.push((abs, rel.clone(), out));
    }

    for (path, _, content) in &staged {
        if let Err(e) = fs::write(path, content) {
            return SemanticTransactionDocument::rejected(
                id,
                format!("write failed {}: {e}", path.display()),
                "dx.x3.transaction.io",
            );
        }
    }

    let dirty_paths: Vec<String> =
        staged.iter().map(|(_, rel, _)| rel.replace('\\', "/")).collect();
    SemanticTransactionDocument {
        schema: SEMANTIC_TRANSACTION_SCHEMA.into(),
        id,
        status: "committed".into(),
        edits: edits.to_vec(),
        diagnostics: vec![DxDiagnostic {
            path: String::new(),
            severity: "info".into(),
            message: format!("committed {} TextEdit(s) in semantic transaction", edits.len()),
            code: Some("dx.x3.transaction.committed".into()),
            span: None,
        }],
        dirty_paths,
    }
}

pub fn plan_affected_preview(
    root: &Path,
    dirty: &[PathBuf],
    session: &SessionGraph,
) -> AffectedPreviewDocument {
    let plan = plan_affected(root, dirty);
    let chunks: Vec<String> = plan.units.iter().map(|u| u.chunk_id.clone()).collect();
    let tests = select_tests_for_chunks(root, &chunks, plan.full);
    let mut route_ids: Vec<String> = plan
        .units
        .iter()
        .filter(|u| {
            u.chunk_id.starts_with("pages/")
                || matches!(u.kind, crate::project::VmzModuleKind::Page)
        })
        .map(|u| u.chunk_id.clone())
        .collect();
    route_ids.sort();
    route_ids.dedup();

    let mut region_ids = BTreeSet::new();
    for chunk in &chunks {
        if let Some(unit) = session.units.get(chunk) {
            for r in &unit.region_ids {
                region_ids.insert(*r);
            }
        }
    }

    AffectedPreviewDocument {
        schema: AFFECTED_PREVIEW_SCHEMA.into(),
        affected: plan.to_dx_document(),
        test_selection: tests,
        route_ids,
        region_ids: region_ids.into_iter().collect(),
        status: "preview".into(),
    }
}

pub fn plan_hmr(root: &Path, dirty: &[PathBuf], session: &SessionGraph) -> HmrPlanDocument {
    let plan = plan_affected(root, dirty);
    let affected_chunks: Vec<String> = plan.units.iter().map(|u| u.chunk_id.clone()).collect();
    let island_only = plan.island_only();
    let mode = if plan.full {
        "full"
    } else if island_only {
        "island"
    } else {
        "partial"
    };

    let affected_set: BTreeSet<String> = affected_chunks.iter().cloned().collect();
    let mut disposed = BTreeSet::new();
    let mut preserved = BTreeSet::new();
    let mut rerun = Vec::new();

    for (chunk_id, unit) in &session.units {
        if affected_set.contains(chunk_id) {
            for r in &unit.region_ids {
                disposed.insert(*r);
            }
            if unit.kind == "page" || chunk_id.starts_with("pages/") {
                rerun.push(chunk_id.clone());
            }
        } else {
            for r in &unit.region_ids {
                preserved.insert(*r);
            }
        }
    }

    // Without session regions, still surface page chunks as loader reruns from affected plan.
    if rerun.is_empty() {
        for u in &plan.units {
            if u.chunk_id.starts_with("pages/")
                || matches!(u.kind, crate::project::VmzModuleKind::Page)
            {
                rerun.push(u.chunk_id.clone());
            }
        }
    }
    rerun.sort();
    rerun.dedup();

    HmrPlanDocument {
        schema: HMR_PLAN_SCHEMA.into(),
        mode: mode.into(),
        island_only,
        seed_chunks: plan.seed_chunks.clone(),
        affected_chunks,
        preserved_regions: preserved.into_iter().collect(),
        disposed_regions: disposed.into_iter().collect(),
        rerun_loaders: rerun,
        status: "preview".into(),
    }
}

pub fn plan_budget(out_dir: &Path) -> BudgetDocument {
    let path = out_dir.join("vmz-deployment.json");
    let Ok(text) = fs::read_to_string(&path) else {
        return BudgetDocument::empty();
    };
    let Ok(root) = serde_json::from_str::<Value>(&text) else {
        return BudgetDocument::empty();
    };
    let Some(units) = root.get("units").and_then(|v| v.as_array()) else {
        return BudgetDocument::empty();
    };

    let mut chunks = Vec::new();
    let mut routes = Vec::new();
    let mut by_id: HashMap<String, Vec<String>> = HashMap::new();

    for item in units {
        let Some(obj) = item.as_object() else { continue };
        let Some(chunk_id) = obj.get("chunkId").and_then(|v| v.as_str()).map(str::to_string) else {
            continue;
        };
        let kind = obj.get("kind").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let depends_on: Vec<String> = obj
            .get("dependsOn")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
            .unwrap_or_default();
        let unit_cost = 1 + depends_on.len() as u32;
        by_id.insert(chunk_id.clone(), depends_on.clone());
        if kind == "page" || chunk_id.starts_with("pages/") {
            let mut ids = vec![chunk_id.clone()];
            ids.extend(depends_on.iter().cloned());
            ids.sort();
            ids.dedup();
            routes.push(BudgetRouteEntry { route_id: chunk_id.clone(), chunk_ids: ids, unit_cost });
        }
        chunks.push(BudgetChunkEntry { chunk_id, kind, depends_on, unit_cost });
    }

    chunks.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));
    routes.sort_by(|a, b| a.route_id.cmp(&b.route_id));

    let status = if chunks.is_empty() { "empty" } else { "ready" };
    let _ = by_id;
    BudgetDocument { schema: BUDGET_SCHEMA.into(), routes, chunks, status: status.into() }
}

pub fn check_dx_x3(
    root: &Path,
    out_dir: &Path,
    dirty: &[PathBuf],
    session: &SessionGraph,
) -> X3CheckReport {
    let preview = plan_affected_preview(root, dirty, session);
    let hmr = plan_hmr(root, dirty, session);
    let budget = plan_budget(out_dir);
    let mut diagnostics = Vec::new();
    if budget.status == "empty" {
        diagnostics.push(DxDiagnostic {
            path: String::new(),
            severity: "info".into(),
            message: "budget empty — build workspace to materialize deployment units".into(),
            code: Some("dx.x3.budget.empty".into()),
            span: None,
        });
    }
    let status = if budget.status == "ready" { "ready" } else { "preview" };
    X3CheckReport {
        schema: X3_CHECK_SCHEMA.into(),
        affected_preview: Some(preview),
        hmr_plan: Some(hmr),
        budget: Some(budget),
        diagnostics,
        status: status.into(),
    }
}

pub fn cancel_document(
    ticket_id: u64,
    status: &str,
    generation: u64,
    notes: impl Into<String>,
) -> CancelDocument {
    CancelDocument {
        schema: CANCEL_SCHEMA.into(),
        ticket_id,
        status: status.into(),
        session_generation: generation,
        notes: Some(notes.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("vmz-x3-{nanos}"));
        fs::create_dir_all(dir.join("src/components")).unwrap();
        fs::create_dir_all(dir.join("src/pages")).unwrap();
        dir
    }

    #[test]
    fn transaction_rejects_bad_span_without_write() {
        let root = tmp();
        let rel = "src/components/A.vmz";
        let path = root.join(rel);
        fs::write(&path, "<template><p>x</p></template>\n").unwrap();
        let before = fs::read_to_string(&path).unwrap();
        let edits =
            vec![TextEdit { path: rel.into(), start: 0, end: 9999, new_text: "nope".into() }];
        let doc = apply_semantic_transaction(&root, 1, &edits);
        assert_eq!(doc.status, "rejected");
        assert_eq!(fs::read_to_string(&path).unwrap(), before);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn transaction_commits_two_files() {
        let root = tmp();
        let a = "src/components/A.vmz";
        let b = "src/pages/index.vmz";
        fs::write(root.join(a), "AAAA").unwrap();
        fs::write(root.join(b), "BBBB").unwrap();
        let edits = vec![
            TextEdit { path: a.into(), start: 0, end: 4, new_text: "aaaa".into() },
            TextEdit { path: b.into(), start: 0, end: 4, new_text: "bbbb".into() },
        ];
        let doc = apply_semantic_transaction(&root, 2, &edits);
        assert_eq!(doc.status, "committed");
        assert_eq!(fs::read_to_string(root.join(a)).unwrap(), "aaaa");
        assert_eq!(fs::read_to_string(root.join(b)).unwrap(), "bbbb");
        let _ = fs::remove_dir_all(&root);
    }
}
