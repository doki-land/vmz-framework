//! 模块图组装：入口 → [`ModuleGraph`]，把 `module`（Oak 事实）与 `resolve`
//! （解析身份）粘成可达模块集合。本层不做活跃判定、不做链接与分包。
//!
//! 身份口径：节点以 canonical 文件路径为身份（`resolve` 已保证包实例区分）；
//! 同一文件被多个 importer 引用时只建一个节点。类型-only 导入不建立边——
//! 类型不进入运行时图。解析失败保留为边上的诊断，不静默丢边。

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};

use crate::diag::PackDiagnostic;
use crate::module::{ModuleRecord, parse_module};
use crate::resolve::{ResolveRequest, Resolved, Target, resolve};

/// 模块节点身份：canonical 后的真实文件路径。
pub type ModuleId = PathBuf;

/// 一条模块边：来源事实 → 目标身份（或未解析诊断）。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleEdge {
    /// 说明符原文。
    pub specifier: String,
    /// 边形态。
    pub kind: EdgeKind,
    /// 目标。`Err` 表示解析失败或动态不可静态解析，诊断保留在图中。
    pub target: Result<ModuleId, PackDiagnostic>,
}

/// 边的结构形态，与 `module` 层事实分类对齐。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdgeKind {
    /// 静态绑定导入。
    Static,
    /// 副作用导入（含与 `import {}` 同形）。
    SideEffect,
    /// 具名重导出来源。
    ReexportNamed,
    /// 星号重导出来源。
    ReexportAll,
    /// 命名空间重导出来源。
    ReexportNamespace,
    /// 动态 import（可静态确定说明符）。
    Dynamic,
}

/// 一个可达模块节点。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleNode {
    /// 解析身份（含包实例）。
    pub resolved: Resolved,
    /// Oak 模块事实。
    pub record: ModuleRecord,
    /// 参与活跃图的静态边（import/re-export），按源码顺序。
    pub static_edges: Vec<ModuleEdge>,
    /// 动态 import 边（chunk 边界候选）。
    pub dynamic_edges: Vec<ModuleEdge>,
    /// 本模块自身的非致命事实诊断（含解析失败边说明）。
    pub diagnostics: Vec<PackDiagnostic>,
}

/// 入口声明：逻辑名 + 物理文件。逻辑身份不等于物理 chunk（Living §Pack 第 1 条）。
#[derive(Debug, Clone, PartialEq)]
pub struct GraphEntry {
    /// 调用方给定的逻辑入口名（如 deployment unit id）。
    pub logical: String,
    /// 入口文件（解析后成为图节点）。
    pub id: ModuleId,
}

/// 从入口集可达的完整模块图。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleGraph {
    /// 解析目标条件（browser / node）。
    pub target: Target,
    /// 项目根：chunk id 的相对命名基准，保证同内容跨机器产出稳定 id。
    pub root: PathBuf,
    /// 入口映射（保序）。
    pub entries: Vec<GraphEntry>,
    /// 节点表，索引即节点号。
    pub nodes: Vec<ModuleNode>,
    /// 图级诊断（入口解析失败、读文件失败等）。
    pub diagnostics: Vec<PackDiagnostic>,
}

impl ModuleGraph {
    /// 按身份查节点索引。
    pub fn index_of(&self, id: &ModuleId) -> Option<usize> {
        self.nodes.iter().position(|node| &node.resolved.path == id)
    }
}

/// 从入口文件集构建模块图。`root` 为项目根（node_modules 上溯兜底）。
///
/// 入口本身解析失败（读文件/parse）记入图级诊断并跳过该入口；
/// 依赖边解析失败保留为 `Err` 诊断边，遍历不因单点失败中断。
pub fn build_graph(entries: &[(String, PathBuf)], target: Target, root: &Path) -> ModuleGraph {
    let mut graph = ModuleGraph {
        target,
        // 与节点路径同口径 canonicalize，否则 `\\?\` 前缀差异使相对标签退化为绝对路径。
        root: root.canonicalize().unwrap_or_else(|_| root.to_path_buf()),
        entries: Vec::new(),
        nodes: Vec::new(),
        diagnostics: Vec::new(),
    };
    let mut by_id: HashMap<ModuleId, usize> = HashMap::new();
    let mut queue: VecDeque<ModuleId> = VecDeque::new();

    for (logical, entry_path) in entries {
        let canonical = match entry_canonical(entry_path) {
            Ok(path) => path,
            Err(diagnostic) => {
                graph.diagnostics.push(diagnostic);
                continue;
            }
        };
        let resolved = Resolved {
            path: canonical.clone(),
            package: crate::resolve::package_of_path(&canonical),
        };
        graph.entries.push(GraphEntry { logical: logical.clone(), id: canonical.clone() });
        if by_id.contains_key(&canonical) {
            continue;
        }
        let index = graph.nodes.len();
        by_id.insert(canonical.clone(), index);
        graph.nodes.push(placeholders::pending(resolved));
        queue.push_back(canonical.clone());
    }

    while let Some(id) = queue.pop_front() {
        let index = by_id[&id];
        let node = expand(&graph.nodes[index].resolved, target, root, &mut graph.diagnostics);
        let edges_static = node.static_edges.clone();
        let edges_dynamic = node.dynamic_edges.clone();
        graph.nodes[index] = node;

        for edge in edges_static.iter().chain(edges_dynamic.iter()) {
            let Ok(target_id) = edge.target.as_ref() else {
                continue;
            };
            if by_id.contains_key(target_id) {
                continue;
            }
            let Some(resolved) = resolved_from_id(target_id) else {
                continue;
            };
            let index = graph.nodes.len();
            by_id.insert(target_id.clone(), index);
            graph.nodes.push(placeholders::pending(resolved));
            queue.push_back(target_id.clone());
        }
    }

    graph
}

/// 展开单个文件为节点：读源码 → Oak 事实 → 逐说明符解析身份。
fn expand(
    resolved: &Resolved,
    target: Target,
    root: &Path,
    graph_diags: &mut Vec<PackDiagnostic>,
) -> ModuleNode {
    let path = &resolved.path;
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(err) => {
            graph_diags.push(
                PackDiagnostic::new(
                    "vmz::pack::graph::read_failed",
                    format!("cannot read module file: {err}"),
                )
                .with_path(path.display().to_string()),
            );
            return ModuleNode {
                resolved: resolved.clone(),
                record: ModuleRecord::empty(Some(path.display().to_string())),
                static_edges: Vec::new(),
                dynamic_edges: Vec::new(),
                diagnostics: Vec::new(),
            };
        }
    };
    let record = match parse_module(Some(&path.display().to_string()), &source) {
        Ok(record) => record,
        Err(diagnostics) => {
            return ModuleNode {
                resolved: resolved.clone(),
                record: ModuleRecord::empty(Some(path.display().to_string())),
                static_edges: Vec::new(),
                dynamic_edges: Vec::new(),
                diagnostics,
            };
        }
    };

    let mut static_edges = Vec::new();
    let mut dynamic_edges = Vec::new();

    for import in &record.imports {
        let bindings_all_type =
            !import.bindings.is_empty() && import.bindings.iter().all(|b| b.inline_type_only);
        if import.type_only
            || (matches!(import.kind, crate::module::ImportKind::Static) && bindings_all_type)
        {
            // 类型导入不进入运行时图。
            continue;
        }
        let kind = match import.kind {
            crate::module::ImportKind::Static => EdgeKind::Static,
            crate::module::ImportKind::SideEffect => EdgeKind::SideEffect,
            crate::module::ImportKind::Dynamic => EdgeKind::Dynamic,
        };
        let edge = ModuleEdge {
            specifier: import.specifier.clone(),
            kind,
            target: edge_target(
                import.specifier.as_str(),
                import.kind == crate::module::ImportKind::Dynamic,
                path,
                target,
                root,
                &record,
            ),
        };
        if kind == EdgeKind::Dynamic {
            dynamic_edges.push(edge);
        } else {
            static_edges.push(edge);
        }
    }

    for export in &record.exports {
        let (specifier, kind) = match export {
            crate::module::ExportFact::ReexportNamed { source, type_only, .. } => {
                if *type_only {
                    continue;
                }
                (source.as_str(), EdgeKind::ReexportNamed)
            }
            crate::module::ExportFact::ReexportAll { source, .. } => {
                (source.as_str(), EdgeKind::ReexportAll)
            }
            crate::module::ExportFact::ReexportNamespace { source, type_only, .. } => {
                if *type_only {
                    continue;
                }
                (source.as_str(), EdgeKind::ReexportNamespace)
            }
            _ => continue,
        };
        static_edges.push(ModuleEdge {
            specifier: specifier.to_string(),
            kind,
            target: edge_target(specifier, false, path, target, root, &record),
        });
    }

    ModuleNode {
        resolved: resolved.clone(),
        record,
        static_edges,
        dynamic_edges,
        diagnostics: Vec::new(),
    }
}

/// 说明符 → 目标身份。动态空说明符（非字面量）直接产诊断，不猜。
fn edge_target(
    specifier: &str,
    dynamic: bool,
    importer: &Path,
    target: Target,
    root: &Path,
    record: &ModuleRecord,
) -> Result<ModuleId, PackDiagnostic> {
    if specifier.is_empty() {
        let diagnostic = record
            .diagnostics
            .iter()
            .find(|d| d.code == "vmz::pack::module::dynamic_import_unresolved")
            .cloned()
            .unwrap_or_else(|| {
                PackDiagnostic::new(
                    "vmz::pack::module::dynamic_import_unresolved",
                    "dynamic import specifier is not a static string literal",
                )
                .with_path(importer.display().to_string())
            });
        return Err(diagnostic);
    }
    let request = ResolveRequest {
        specifier: specifier.to_string(),
        importer: importer.to_path_buf(),
        target,
        root: root.to_path_buf(),
    };
    match resolve(&request) {
        Ok(resolved) => Ok(resolved.path),
        Err(mut diagnostic) => {
            if dynamic {
                diagnostic.message = format!("dynamic import: {}", diagnostic.message);
            }
            Err(diagnostic)
        }
    }
}

fn entry_canonical(path: &Path) -> Result<ModuleId, PackDiagnostic> {
    std::fs::canonicalize(path).map_err(|err| {
        PackDiagnostic::new(
            "vmz::pack::graph::entry_unresolved",
            format!("cannot resolve entry: {err}"),
        )
        .with_path(path.display().to_string())
    })
}

fn resolved_from_id(id: &ModuleId) -> Option<Resolved> {
    Some(Resolved { path: id.clone(), package: crate::resolve::package_of_path(id) })
}

mod placeholders {
    use super::*;

    /// 入队但未展开的节点占位。
    pub fn pending(resolved: Resolved) -> ModuleNode {
        ModuleNode {
            resolved,
            record: ModuleRecord::empty(None),
            static_edges: Vec::new(),
            dynamic_edges: Vec::new(),
            diagnostics: Vec::new(),
        }
    }
}
