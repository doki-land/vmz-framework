//! 模块图组装：入口 → [`ModuleGraph`]，把 `module`（Oak 事实）与 `resolve`
//! （解析身份）粘成可达模块集合。本层不做活跃判定、不做链接与分包。
//!
//! 身份口径：节点以 canonical 文件路径为身份（`resolve` 已保证包实例区分）；
//! 同一文件被多个 importer 引用时只建一个节点。类型-only 导入不建立边——
//! 类型不进入运行时图。解析失败保留为边上的诊断，不静默丢边。
//!
//! `.css` 文件进图成为 [`NodeKind::Style`] 不透明节点：绝不按 JS 源码解析、
//! 绝不进 module collect、无出边；importer→style 的有序副作用边保留，
//! 可达性即宿主模块活跃性。产物聚合（执行序拼接、指纹、`url()` 搬迁）
//! 在 `emit` 层；内容指纹身份也在 emit 读取字节时派生。CSS 作为图入口
//! 显式拒绝（`vmz::pack::graph::style_entry_unsupported`）：样式必须挂在
//! JS 宿主模块的执行序上，没有宿主的 CSS 无法进入任何 chunk 的级联。
//!
//! `.json` 文件进图成为 [`NodeKind::Json`] 不透明值节点：绝不按 JS 源码解析、
//! 绝不进 module collect、无出边；importer→json 的静态值绑定边保留（JSON 是
//! 值导入不是副作用）。绑定文本合成（default 值内联）在 `emit` 层，原始
//! JSON 字节保真、不重新序列化。JSON 作为图入口显式拒绝
//! （`vmz::pack::graph::json_entry_unsupported`）：值节点只有被 JS 宿主模块
//! 消费才有意义，入口没有可绑定的宿主。

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

/// 节点类别：JS 模块、CJS 模块、不透明样式节点或不透明 JSON 值节点。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeKind {
    /// JS/TS 模块（ESM）：经 Oak 事实收集参与链接与分包。
    Js,
    /// CommonJS 模块：图边由 `require` 事实给出，发射时装填互操作壳
    /// （`module`/`exports`/`require` 材料 + default/具名导出合成），
    /// 绝不按 ESM 语句剪枝。
    Cjs,
    /// `.css` 样式节点：不透明，绝不按 JS 源码解析，只承载有序副作用边。
    Style,
    /// `.json` 值节点：不透明，绝不按 JS 源码解析，只承载 default 值绑定边。
    Json,
}

/// 一个可达模块节点。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleNode {
    /// 节点类别。
    pub kind: NodeKind,
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
    /// 节点身份 → 索引。`link` / `chunk` / `emit` 热路径按身份查节点，
    /// 线性扫描在全图打包时是 O(n²)；此表与 `nodes` 同建同序。
    pub node_index: HashMap<ModuleId, usize>,
    /// 图级诊断（入口解析失败、读文件失败等）。
    pub diagnostics: Vec<PackDiagnostic>,
}

impl ModuleGraph {
    /// 按身份查节点索引。
    pub fn index_of(&self, id: &ModuleId) -> Option<usize> {
        self.node_index.get(id).copied()
    }
}

/// 从入口文件集构建模块图。`root` 为项目根（node_modules 上溯兜底）。
///
/// 入口本身解析失败（读文件/parse）记入图级诊断并跳过该入口；
/// 依赖边解析失败保留为 `Err` 诊断边，遍历不因单点失败中断。
pub fn build_graph(entries: &[(String, PathBuf)], target: Target, root: &Path) -> ModuleGraph {
    build_graph_with_origins(entries, target, root, &HashMap::new())
}

/// [`build_graph`] 的 provenance 变体：`origins` 把 canonical 产物路径映射回
/// 其源文件（编译投影关系，如 `dist/components/Icon.client.js` →
/// `node_modules/@vmz/ui/src/components/Icon.vmz`）。裸说明符与 `#imports`
/// 的包发现以来源位置为上溯起点，使产物图表现得像模块仍住在源包里。
pub fn build_graph_with_origins(
    entries: &[(String, PathBuf)],
    target: Target,
    root: &Path,
    origins: &HashMap<PathBuf, PathBuf>,
) -> ModuleGraph {
    let mut graph = ModuleGraph {
        target,
        // 与节点路径同口径 canonicalize，否则 `\\?\` 前缀差异使相对标签退化为绝对路径。
        root: root.canonicalize().unwrap_or_else(|_| root.to_path_buf()),
        entries: Vec::new(),
        nodes: Vec::new(),
        node_index: HashMap::new(),
        diagnostics: Vec::new(),
    };
    let mut by_id: HashMap<ModuleId, usize> = HashMap::new();
    // 队列携带完整 Resolved：stub（browser 别名 `false` 目标）等身份
    // 不能从路径重建（合成路径不落盘、canonicalize 会失败）。
    let mut queue: VecDeque<Resolved> = VecDeque::new();
    // 边目标的完整解析结果侧表：expand 逐边登记，BFS 优先取用。
    let mut edge_resolved: HashMap<ModuleId, Resolved> = HashMap::new();

    for (logical, entry_path) in entries {
        let canonical = match entry_canonical(entry_path) {
            Ok(path) => path,
            Err(diagnostic) => {
                graph.diagnostics.push(diagnostic);
                continue;
            }
        };
        if canonical.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("css")) {
            graph.diagnostics.push(
                PackDiagnostic::new(
                    "vmz::pack::graph::style_entry_unsupported",
                    "CSS cannot be a graph entry; styles attach to JS host modules",
                )
                .with_path(canonical.display().to_string()),
            );
            continue;
        }
        if canonical.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
            graph.diagnostics.push(
                PackDiagnostic::new(
                    "vmz::pack::graph::json_entry_unsupported",
                    "JSON cannot be a graph entry; JSON values bind to JS host modules",
                )
                .with_path(canonical.display().to_string()),
            );
            continue;
        }
        let resolved = Resolved {
            path: canonical.clone(),
            package: crate::resolve::package_of_path(&canonical),
            stub: false,
        };
        graph.entries.push(GraphEntry { logical: logical.clone(), id: canonical.clone() });
        if by_id.contains_key(&canonical) {
            continue;
        }
        let index = graph.nodes.len();
        by_id.insert(canonical.clone(), index);
        graph.nodes.push(placeholders::pending(resolved.clone()));
        queue.push_back(resolved);
    }

    while let Some(resolved) = queue.pop_front() {
        let id = resolved.path.clone();
        let index = by_id[&id];
        let node =
            expand(&resolved, target, root, origins, &mut edge_resolved, &mut graph.diagnostics);
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
            let Some(resolved) =
                edge_resolved.get(target_id).cloned().or_else(|| resolved_from_id(target_id))
            else {
                continue;
            };
            let index = graph.nodes.len();
            by_id.insert(target_id.clone(), index);
            graph.nodes.push(placeholders::pending(resolved.clone()));
            queue.push_back(resolved);
        }
    }

    graph.node_index = by_id;
    graph
}

/// 展开单个文件为节点：读源码 → Oak 事实 → 逐说明符解析身份。
/// `edge_resolved` 逐边登记完整解析结果（stub 等身份不能只按路径重建）。
fn expand(
    resolved: &Resolved,
    target: Target,
    root: &Path,
    origins: &HashMap<PathBuf, PathBuf>,
    edge_resolved: &mut HashMap<ModuleId, Resolved>,
    graph_diags: &mut Vec<PackDiagnostic>,
) -> ModuleNode {
    let path = &resolved.path;
    // CSS 进图成为不透明 Style 节点：不读源码、不收集 JS 事实、无出边；
    // importer→style 的有序副作用边由宿主模块承载，产物聚合在 emit 层。
    if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("css")) {
        return ModuleNode {
            kind: NodeKind::Style,
            resolved: resolved.clone(),
            record: ModuleRecord::empty(Some(path.display().to_string())),
            static_edges: Vec::new(),
            dynamic_edges: Vec::new(),
            diagnostics: Vec::new(),
        };
    }
    // JSON 进图成为不透明值节点：不读源码、不收集 JS 事实、无出边；
    // importer→json 的静态值绑定边由宿主模块承载，文本合成在 emit 层。
    if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("json")) {
        return ModuleNode {
            kind: NodeKind::Json,
            resolved: resolved.clone(),
            record: ModuleRecord::empty(Some(path.display().to_string())),
            static_edges: Vec::new(),
            dynamic_edges: Vec::new(),
            diagnostics: Vec::new(),
        };
    }
    // browser 别名 `false` 的合成 stub：不落盘、不读源，等价
    // `module.exports = {}` 的 CJS 空模块（emit 层装填壳后即此语义）。
    if resolved.stub {
        return ModuleNode {
            kind: NodeKind::Cjs,
            resolved: resolved.clone(),
            record: ModuleRecord::empty(Some(path.display().to_string())),
            static_edges: Vec::new(),
            dynamic_edges: Vec::new(),
            diagnostics: Vec::new(),
        };
    }
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
                kind: NodeKind::Js,
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
                kind: NodeKind::Js,
                resolved: resolved.clone(),
                record: ModuleRecord::empty(Some(path.display().to_string())),
                static_edges: Vec::new(),
                dynamic_edges: Vec::new(),
                diagnostics,
            };
        }
    };

    let origin = origins.get(path).cloned();
    let format = crate::resolve::module_format(path);
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
                origin.as_deref(),
                target,
                root,
                &record,
                edge_resolved,
            ),
        };
        if kind == EdgeKind::Dynamic {
            dynamic_edges.push(edge);
        } else {
            static_edges.push(edge);
        }
    }

    // CJS 模块的依赖边来自 `require` 事实（同步执行，与静态边同序）。
    // ESM import 语法在 CJS 模块里属于混合写法，import 边照常建立。
    if format == crate::resolve::ModuleFormat::Cjs {
        for require in &record.requires {
            static_edges.push(ModuleEdge {
                specifier: require.specifier.clone(),
                kind: EdgeKind::Static,
                target: edge_target(
                    require.specifier.as_str(),
                    false,
                    path,
                    origin.as_deref(),
                    target,
                    root,
                    &record,
                    edge_resolved,
                ),
            });
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
            target: edge_target(
                specifier,
                false,
                path,
                origin.as_deref(),
                target,
                root,
                &record,
                edge_resolved,
            ),
        });
    }

    ModuleNode {
        kind: if format == crate::resolve::ModuleFormat::Cjs {
            NodeKind::Cjs
        } else {
            NodeKind::Js
        },
        resolved: resolved.clone(),
        record,
        static_edges,
        dynamic_edges,
        diagnostics: Vec::new(),
    }
}

/// 说明符 → 目标身份。动态空说明符（非字面量）直接产诊断，不猜。
/// `origin` 为产物文件的投影来源（canonical 源文件路径），裸说明符包发现以其为起点。
/// 命中的完整解析结果登记进 `edge_resolved`（stub 等身份不能只按路径重建）。
#[allow(clippy::too_many_arguments)]
fn edge_target(
    specifier: &str,
    dynamic: bool,
    importer: &Path,
    origin: Option<&Path>,
    target: Target,
    root: &Path,
    record: &ModuleRecord,
    edge_resolved: &mut HashMap<ModuleId, Resolved>,
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
        origin: origin.map(Path::to_path_buf),
    };
    // `node:` 内建说明符不进入文件解析：身份是运行时外部模块，统一诊断码
    // 供 emit 层按「原样保留」处置（动态 import 合法，静态见 emit 合同）。
    // Node target 上裸名内建（CJS 包常见的 `require('fs')` 形态）同为外部模块。
    if crate::resolve::is_node_builtin_specifier(specifier)
        || (target == Target::Node && crate::resolve::is_node_builtin_name(specifier))
    {
        return Err(crate::resolve::node_builtin_diagnostic(specifier, importer));
    }
    match resolve(&request) {
        Ok(resolved) => {
            // 相对解析不附带包身份（见 resolve 层口径）；图节点身份需要包归属，
            // 按落点路径回溯补齐，与旧 `resolved_from_id` 行为一致。
            let resolved = if resolved.package.is_some() || resolved.stub {
                resolved
            } else {
                Resolved { package: crate::resolve::package_of_path(&resolved.path), ..resolved }
            };
            edge_resolved.insert(resolved.path.clone(), resolved.clone());
            Ok(resolved.path)
        }
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
    Some(Resolved { path: id.clone(), package: crate::resolve::package_of_path(id), stub: false })
}

mod placeholders {
    use super::*;

    /// 入队但未展开的节点占位。
    pub fn pending(resolved: Resolved) -> ModuleNode {
        ModuleNode {
            kind: NodeKind::Js,
            resolved,
            record: ModuleRecord::empty(None),
            static_edges: Vec::new(),
            dynamic_edges: Vec::new(),
            diagnostics: Vec::new(),
        }
    }
}
