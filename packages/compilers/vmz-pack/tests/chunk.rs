//! 分包层测试：纯内存构造模块图与链接计划，验证确定性分组、执行序、
//! 动态边界与事实不完整诊断。不依赖文件系统。

use std::path::PathBuf;

use vmz_pack::PackDiagnostic;
use vmz_pack::chunk::{Chunk, ChunkOrigin, ChunkPlan, plan_chunks};
use vmz_pack::graph::{EdgeKind, GraphEntry, ModuleEdge, ModuleGraph, ModuleNode};
use vmz_pack::link::{LinkPlan, LinkedModule};
use vmz_pack::module::ModuleRecord;
use vmz_pack::resolve::{Resolved, Target};

fn node(path: &str) -> ModuleNode {
    ModuleNode {
        resolved: Resolved { path: PathBuf::from(path), package: None },
        record: ModuleRecord::empty(Some(path.to_string())),
        static_edges: Vec::new(),
        dynamic_edges: Vec::new(),
        diagnostics: Vec::new(),
    }
}

/// 从未展开的占位节点（record.path 为 None）。
fn node_without_facts(path: &str) -> ModuleNode {
    let mut built = node(path);
    built.record = ModuleRecord::empty(None);
    built
}

fn static_edge(specifier: &str, target: &str) -> ModuleEdge {
    ModuleEdge {
        specifier: specifier.to_string(),
        kind: EdgeKind::Static,
        target: Ok(PathBuf::from(target)),
    }
}

fn dynamic_edge(specifier: &str, target: &str) -> ModuleEdge {
    ModuleEdge {
        specifier: specifier.to_string(),
        kind: EdgeKind::Dynamic,
        target: Ok(PathBuf::from(target)),
    }
}

fn graph(entries: &[(&str, &str)], nodes: Vec<ModuleNode>) -> ModuleGraph {
    ModuleGraph {
        target: Target::Browser,
        entries: entries
            .iter()
            .map(|(logical, path)| GraphEntry {
                logical: (*logical).to_string(),
                id: PathBuf::from(path),
            })
            .collect(),
        nodes,
        diagnostics: Vec::new(),
    }
}

/// 构造链接计划：`retained` 为保留节点索引，`live_dynamic` 给出各节点的
/// 存活动态边下标（指向 `ModuleNode::dynamic_edges`）。
fn plan(retained: &[usize], live_dynamic: &[(usize, Vec<usize>)]) -> LinkPlan {
    let mut modules: Vec<LinkedModule> = retained
        .iter()
        .map(|&node| LinkedModule {
            node,
            active_statements: Vec::new(),
            used_reexports: Vec::new(),
            dynamic_edges: live_dynamic
                .iter()
                .find(|(source, _)| *source == node)
                .map(|(_, edges)| edges.clone())
                .unwrap_or_default(),
        })
        .collect();
    modules.sort_by_key(|module| module.node);
    LinkPlan { modules, diagnostics: Vec::new() }
}

fn chunk<'a>(plan: &'a ChunkPlan, id: &str) -> &'a Chunk {
    plan.chunks.iter().find(|chunk| chunk.id == id).unwrap_or_else(|| {
        panic!(
            "chunk `{id}` not found; got {:?}",
            plan.chunks.iter().map(|c| &c.id).collect::<Vec<_>>()
        )
    })
}

/// 双入口共享模块：shared 只一份，两个入口 chunk 各依赖它。
#[test]
fn two_entries_share_one_chunk() {
    let mut one = node("/virtual/one.js");
    one.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    let mut two = node("/virtual/two.js");
    two.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    let shared = node("/virtual/shared.js");
    let graph =
        graph(&[("one", "/virtual/one.js"), ("two", "/virtual/two.js")], vec![one, two, shared]);
    let link = plan(&[0, 1, 2], &[]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 3);
    // id 升序：entry/one < entry/two < shared/one+two。
    let entry_one = chunk(&out, "entry/one");
    let entry_two = chunk(&out, "entry/two");
    let shared_chunk = chunk(&out, "shared/one+two");
    assert_eq!(shared_chunk.modules, vec![2]);
    assert_eq!(shared_chunk.depends_on, Vec::<usize>::new());
    assert_eq!(entry_one.modules, vec![0]);
    assert_eq!(entry_two.modules, vec![1]);
    let shared_index = out.chunks.iter().position(|c| c.id == "shared/one+two").unwrap();
    assert_eq!(entry_one.depends_on, vec![shared_index]);
    assert_eq!(entry_two.depends_on, vec![shared_index]);
    assert_eq!(entry_one.origin, ChunkOrigin::Entry { logical: "one".to_string() });
    let one_index = out.chunks.iter().position(|c| c.id == "entry/one").unwrap();
    let two_index = out.chunks.iter().position(|c| c.id == "entry/two").unwrap();
    assert_eq!(
        out.entry_chunks,
        vec![("one".to_string(), one_index), ("two".to_string(), two_index)]
    );
    assert!(out.diagnostics.is_empty());
    assert!(out.dynamic_boundaries.is_empty());
}

/// 动态 import 独立成 async chunk，入口 chunk 不含懒模块，边界显式输出。
#[test]
fn dynamic_import_becomes_async_chunk() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./util.js", "/virtual/util.js"));
    entry.dynamic_edges.push(dynamic_edge("./lazy.js", "/virtual/lazy.js"));
    let util = node("/virtual/util.js");
    let lazy = node("/virtual/lazy.js");
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, util, lazy]);
    let link = plan(&[0, 1, 2], &[(0, vec![0])]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 2);
    let entry_chunk = chunk(&out, "entry/app");
    let async_chunk = chunk(&out, "async//virtual/lazy.js");
    assert_eq!(entry_chunk.modules, vec![1, 0]);
    assert!(!entry_chunk.modules.contains(&2));
    assert_eq!(async_chunk.modules, vec![2]);
    assert_eq!(async_chunk.origin, ChunkOrigin::Async { root_node: 2 });
    let async_index = out.chunks.iter().position(|c| c.id == "async//virtual/lazy.js").unwrap();
    assert_eq!(out.dynamic_boundaries, vec![(0, async_index)]);
    assert_eq!(
        out.entry_chunks,
        vec![("app".to_string(), out.chunks.iter().position(|c| c.id == "entry/app").unwrap())]
    );
}

/// 循环模块收缩为同一单元，落在同一 chunk 且整体先于导入者。
#[test]
fn cycle_shares_one_chunk_ordered_before_importer() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./a.js", "/virtual/a.js"));
    let mut a = node("/virtual/a.js");
    a.static_edges.push(static_edge("./b.js", "/virtual/b.js"));
    let mut b = node("/virtual/b.js");
    b.static_edges.push(static_edge("./a.js", "/virtual/a.js"));
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, a, b]);
    let link = plan(&[0, 1, 2], &[]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 1);
    // 循环单元 {1,2} 先于入口 0；单元内成员升序。
    assert_eq!(out.chunks[0].modules, vec![1, 2, 0]);
    assert_eq!(out.chunks[0].depends_on, Vec::<usize>::new());
}

/// 未保留节点不进入任何 chunk。
#[test]
fn dropped_modules_absent_from_all_chunks() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./dep.js", "/virtual/dep.js"));
    let mut dep = node("/virtual/dep.js");
    dep.static_edges.push(static_edge("./gone.js", "/virtual/gone.js"));
    let gone = node("/virtual/gone.js");
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, dep, gone]);
    let link = plan(&[0, 1], &[]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 1);
    assert_eq!(out.chunks[0].modules, vec![1, 0]);
    assert!(out.chunks.iter().all(|c| !c.modules.contains(&2)));
}

/// 同输入两次计划结果完全一致（确定性）。
#[test]
fn same_input_same_plan() {
    let mut one = node("/virtual/one.js");
    one.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    one.dynamic_edges.push(dynamic_edge("./lazy.js", "/virtual/lazy.js"));
    let mut two = node("/virtual/two.js");
    two.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    let mut shared = node("/virtual/shared.js");
    shared.static_edges.push(static_edge("./lazy.js", "/virtual/lazy.js"));
    let lazy = node("/virtual/lazy.js");
    let graph = graph(
        &[("one", "/virtual/one.js"), ("two", "/virtual/two.js")],
        vec![one, two, shared, lazy],
    );
    let link = plan(&[0, 1, 2, 3], &[(0, vec![0])]);

    let first = plan_chunks(&graph, &link);
    let second = plan_chunks(&graph, &link);
    assert_eq!(first, second);
    // 结构非平凡：两个入口 chunk、双入口 shared、入口与异步根共同可达的
    // lazy 独立成第三个 shared（lazy 被入口静态可达，不并入 async 分区）。
    let ids: Vec<&str> = first.chunks.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(
        ids,
        vec!["entry/one", "entry/two", "shared/one+two", "shared/one+two+/virtual/lazy.js"]
    );
    assert_eq!(first.dynamic_boundaries.len(), 1);
}

/// 全量入口保留懒模块并产出 async chunk；具名使用不保留则两者皆无。
#[test]
fn live_vs_dead_dynamic_edge_changes_chunks() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./util.js", "/virtual/util.js"));
    entry.dynamic_edges.push(dynamic_edge("./lazy.js", "/virtual/lazy.js"));
    let util = node("/virtual/util.js");
    let lazy = node("/virtual/lazy.js");
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, util, lazy]);

    let full = plan_chunks(&graph, &plan(&[0, 1, 2], &[(0, vec![0])]));
    assert_eq!(full.chunks.len(), 2);
    assert_eq!(full.dynamic_boundaries, vec![(0, 0)]);

    let named = plan_chunks(&graph, &plan(&[0, 1], &[]));
    assert_eq!(named.chunks.len(), 1);
    assert!(named.dynamic_boundaries.is_empty());
    assert_eq!(named.chunks[0].modules, vec![1, 0]);
}

/// 事实不完整的保留节点：显式 incomplete_facts 诊断，保守留在入口 chunk。
#[test]
fn incomplete_facts_diagnosed_and_conservatively_kept() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./pending.js", "/virtual/pending.js"));
    entry.static_edges.push(static_edge("./broken.js", "/virtual/broken.js"));
    let pending = node_without_facts("/virtual/pending.js");
    let mut broken = node("/virtual/broken.js");
    broken.diagnostics.push(PackDiagnostic::new("vmz::pack::module::parse_failed", "parse failed"));
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, pending, broken]);
    let link = plan(&[0, 1, 2], &[]);

    let out = plan_chunks(&graph, &link);
    let entry_chunk = chunk(&out, "entry/app");
    assert!(entry_chunk.modules.contains(&1));
    assert!(entry_chunk.modules.contains(&2));
    assert_eq!(out.diagnostics.len(), 2);
    for diagnostic in &out.diagnostics {
        assert_eq!(diagnostic.code, "vmz::pack::chunk::incomplete_facts");
        assert!(diagnostic.message.contains("entry/app"));
        assert!(diagnostic.path.is_some());
    }
    let paths: Vec<&str> = out.diagnostics.iter().map(|d| d.path.as_deref().unwrap()).collect();
    assert!(paths.contains(&"/virtual/pending.js"));
    assert!(paths.contains(&"/virtual/broken.js"));
}

/// 入口与异步根共同可达的模块进 shared chunk，不并入入口或异步 chunk。
#[test]
fn entry_and_async_reachable_goes_to_shared() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    entry.dynamic_edges.push(dynamic_edge("./lazy.js", "/virtual/lazy.js"));
    let mut lazy = node("/virtual/lazy.js");
    lazy.static_edges.push(static_edge("./shared.js", "/virtual/shared.js"));
    let shared = node("/virtual/shared.js");
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, lazy, shared]);
    let link = plan(&[0, 1, 2], &[(0, vec![0])]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 3);
    let shared_chunk = chunk(&out, "shared/app+/virtual/lazy.js");
    assert_eq!(shared_chunk.modules, vec![2]);
    assert_eq!(
        shared_chunk.origin,
        ChunkOrigin::Shared { roots: vec!["app".to_string(), "/virtual/lazy.js".to_string()] }
    );
    let shared_index = out.chunks.iter().position(|c| c.id == shared_chunk.id).unwrap();
    let async_chunk = chunk(&out, "async//virtual/lazy.js");
    assert_eq!(async_chunk.depends_on, vec![shared_index]);
    let entry_chunk = chunk(&out, "entry/app");
    assert_eq!(entry_chunk.depends_on, vec![shared_index]);
    assert_eq!(
        out.dynamic_boundaries,
        vec![(0, out.chunks.iter().position(|c| c.id == async_chunk.id).unwrap())]
    );
}

/// 链式依赖 0→1→2（0 也直接→2）：执行序为被依赖者先于导入者。
#[test]
fn chain_orders_dependencies_first() {
    let mut entry = node("/virtual/app.js");
    entry.static_edges.push(static_edge("./mid.js", "/virtual/mid.js"));
    entry.static_edges.push(static_edge("./leaf.js", "/virtual/leaf.js"));
    let mut mid = node("/virtual/mid.js");
    mid.static_edges.push(static_edge("./leaf.js", "/virtual/leaf.js"));
    let leaf = node("/virtual/leaf.js");
    let graph = graph(&[("app", "/virtual/app.js")], vec![entry, mid, leaf]);
    let link = plan(&[0, 1, 2], &[]);

    let out = plan_chunks(&graph, &link);
    assert_eq!(out.chunks.len(), 1);
    assert_eq!(out.chunks[0].modules, vec![2, 1, 0]);
}
