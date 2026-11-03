//! 链接层：模块图 + 入口需求 → 语句级活跃不动点（Living §Pack 第 4/5 条）。
//!
//! 入口需求拆成可组合的维度，不再压进单一 `used_exports` 字段：
//! - 执行（[`EntryExecution`]）：入口顶层语句是否整体活跃。`Full` = 求值根，
//!   蕴含全部静态 import 绑定与重导出按 ESM 实例化语义传播；`SideEffects` =
//!   入口仍求值（非纯语句恒活跃），纯语句只在导出需求命中时激活。
//! - 导出需求（[`EntryExports`]）：入口的哪些导出被消费者读取（`All` /
//!   `Named` / `Unconsumed`）。`execution: Full` 时导出维度不改变活跃结果
//!   （执行已蕴含实例化传播），合同仍要求显式声明，不做默认猜测。
//! - 求值保留不是入口声明字段，而是链接器对任何保留模块的固有规则：
//!   保留即求值，非纯语句恒活跃（[`Demand::Retain`] 的效应）。
//!
//! 传播需求同样按维度组合（[`Demand`]）：`Execute`（整体执行）/ `Retain`
//! （求值）/ `Export`（具名导出消费），沿 worklist 求不动点：具名使用
//! 命中导出 → 激活声明语句或沿 import 绑定传播；命中重导出 → 向来源模块
//! 继续传播。
//!
//! 保守升级（回退到全量执行 `Demand::Execute`）的条件，逐条可审计：
//! - `entry_uses` 缺失的入口声明。
//! - `SideEffects` + `All` 且模块含 `export *`：星号来源的导出名不可枚举。
//! - 命名空间使用：`import * as ns` 绑定被引用、`export * as ns` 被消费。
//! - 具名需求解析不到导出事实：`vmz::pack::link::unknown_export` 诊断后升级
//!   （Oak 事实缺口如多变量声明只记首名，会在此暴露）。
//! - 动态 import 边找不到包含语句：模块保留即执行，边界保守活。
//!
//! 模块保留（保守）：入口、被符号使用的模块、以及**可观察求值**的模块。
//! 可观察求值（[`effectful_modules`]）是图级不动点：模块自身含非纯顶层
//! 语句、事实为空无法证明纯、或经静态 import / re-export 边到达另一个
//! 可观察求值模块（ESM 求值一个模块必然先求值它的静态依赖），都算可观察。
//! 保留模块的静态边只在目标可观察求值时传播 [`Demand::Retain`]（求值维度），
//! 纯且无使用的模块消除。判定不了即可观察，宁保守勿误剪。
//!
//! 本层不做分包与产物生成；图可达不等于活跃，活跃只由入口需求、效果分类
//! 与保守规则驱动。[`LinkPlan::modules`] 的 `active_statements` 与
//! `dynamic_edges` 是链接后的唯一活跃事实来源：chunk、资源、CSS、动态边
//! 处理必须以此为共同输入，不得另起重算。

use std::collections::{BTreeSet, HashSet, VecDeque};

use crate::diag::PackDiagnostic;
use crate::graph::{EdgeKind, ModuleGraph, NodeKind};
use crate::module::{ExportFact, ImportKind, ImportedName, StatementEffect};

/// 请求的导出名在模块导出事实中不存在。
const UNKNOWN_EXPORT: &str = "vmz::pack::link::unknown_export";

/// 入口的执行维度。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryExecution {
    /// 整体执行：入口全部顶层语句活跃，所有静态 import 绑定与重导出按
    /// ESM 实例化语义传播。script 标签加载与宿主直接运行属于本形态。
    Full,
    /// 副作用保留：入口仍求值（非纯语句恒活跃），纯语句只在导出需求
    /// 命中时激活。
    SideEffects,
}

/// 入口的导出需求维度。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryExports {
    /// 消费全部非类型导出（命名空间式消费者或消费面不可静态确定）。
    /// 模块含 `export *` 时导出名不可枚举，链接器保守升级为整体执行。
    All,
    /// 只消费列出的导出名。空列表与 [`EntryExports::Unconsumed`] 语义
    /// 等价，由调用方显式选择，不互相折叠。
    Named(Vec<String>),
    /// 无消费者：入口导出不作为需求传播源（script 标签直接加载）。
    Unconsumed,
}

/// 入口的链接需求声明：执行与导出需求两个可组合维度。
///
/// `execution` 为 [`EntryExecution::Full`] 时，执行已蕴含全部绑定与重导出
/// 的实例化传播，`exports` 不改变活跃结果；合同仍要求显式给出，链接器
/// 不为其猜测默认值。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryUse {
    /// 与 [`crate::graph::GraphEntry::logical`] 对应的入口逻辑名。
    pub entry_logical: String,
    /// 执行维度。
    pub execution: EntryExecution,
    /// 导出需求维度。
    pub exports: EntryExports,
}

/// 一条被实际使用的重导出事实。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsedReexport {
    /// `export { local as exported } from '…'` 被具名使用命中。
    Named {
        /// 在 [`crate::module::ModuleRecord::exports`] 中的下标。
        export_index: usize,
        /// 传播到的图节点。
        target_node: usize,
    },
    /// `export * from '…'` 为某个具名使用提供了来源。
    All {
        /// 星号重导出事实下标。
        export_index: usize,
        /// 提供名字的来源节点。
        target_node: usize,
    },
    /// `export * as ns from '…'` 的命名空间被使用。
    Namespace {
        /// 命名空间重导出事实下标。
        export_index: usize,
        /// 被全量使用的来源节点。
        target_node: usize,
    },
}

/// 保留模块的链接结果。
#[derive(Debug, Clone, PartialEq)]
pub struct LinkedModule {
    /// 图节点索引。
    pub node: usize,
    /// 活跃顶层语句在 [`crate::module::ModuleRecord::statements`] 中的下标，升序。
    pub active_statements: Vec<usize>,
    /// 被使用的重导出事实（按首次使用顺序）。
    pub used_reexports: Vec<UsedReexport>,
    /// 本模块活跃语句实际传播了符号需求的静态边目标（图节点索引，升序）。
    /// 与 [`Self::used_reexports`] 的 `target_node` 合并即本模块「符号使用」
    /// 的全部目标；分包层据此判定真实依赖，不把保留集合的每条静态边都当作
    /// 依赖（未消费的纯目标不产生依赖边）。
    pub used_targets: Vec<usize>,
    /// 存活的动态 import 边在 `ModuleNode::dynamic_edges` 中的下标，升序。
    pub dynamic_edges: Vec<usize>,
}

/// 链接产物：保留模块集合 + 诊断。
#[derive(Debug, Clone, PartialEq)]
pub struct LinkPlan {
    /// 保留模块，按图节点索引升序。
    pub modules: Vec<LinkedModule>,
    /// 链接诊断（未知导出、透传的模块与边诊断）。
    pub diagnostics: Vec<PackDiagnostic>,
}

/// 传播中的链接需求：与入口声明同口径的可组合维度。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Demand {
    /// 执行维度：模块整体求值（全部语句活跃 + 全部绑定与重导出实例化
    /// 传播）。命名空间使用、未知导出、缺失入口声明等保守升级的终点。
    Execute(usize),
    /// 具名导出消费维度：模块的某个导出名被使用。
    Export(usize, String),
    /// 求值维度：模块保留求值（非纯语句恒活跃），不指定导出消费。静态
    /// import / re-export / 副作用导入边在目标可观察求值时传播本需求。
    Retain(usize),
}

/// 图级可观察求值不动点：模块求值时是否可能产生可观察效果。
///
/// 判定为可观察的任一条件：
/// - 模块含非纯顶层语句（[`StatementEffect`] 非 `Pure`）；
/// - 顶层语句事实为空（空记录既可能是真正的空模块，也可能是读取/解析失败
///   的占位，无法据此证明纯，按保守口径视为可观察）；
/// - 存在未解析的静态边（无法证明目标无害）；
/// - 经静态 import / re-export 边到达任一可观察求值的模块。
///
/// 最后一条是 ESM 语义要求：求值一个模块必然先求值它的全部静态依赖，所以
/// 「静态导入了一个有副作用的模块」本身就可观察——即便本模块自己的语句
/// 全部为纯，也不能整条链剪掉，否则依赖的副作用会消失。
///
/// 返回按图节点索引的布尔表。link、chunk 与 emit 共享这一条规则，不各自
/// 重判副作用，也不在产物层用另一套启发式补齐。
pub fn effectful_modules(graph: &ModuleGraph) -> Vec<bool> {
    let count = graph.nodes.len();
    let mut effectful = vec![false; count];
    let mut reverse: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut queue: Vec<usize> = Vec::new();
    for (index, node) in graph.nodes.iter().enumerate() {
        let record = &node.record;
        let own = record.statements.is_empty()
            || record.statements.iter().any(|statement| statement.effect != StatementEffect::Pure);
        if own {
            effectful[index] = true;
            queue.push(index);
        }
        for edge in &node.static_edges {
            match edge.target.as_ref() {
                Ok(id) => match graph.index_of(id) {
                    Some(target) => reverse[target].push(index),
                    None => {
                        // 目标身份不在图中：无法证明无害，保守视为可观察。
                        effectful[index] = true;
                        queue.push(index);
                    }
                },
                Err(_) => {
                    effectful[index] = true;
                    queue.push(index);
                }
            }
        }
    }
    // 沿反向静态边传播：被可观察模块静态依赖的模块，其求值同样可观察。
    while let Some(node) = queue.pop() {
        for &importer in &reverse[node] {
            if !effectful[importer] {
                effectful[importer] = true;
                queue.push(importer);
            }
        }
    }
    effectful
}

/// 链接器内部状态。
struct Linker<'g> {
    graph: &'g ModuleGraph,
    effectful: Vec<bool>,
    retained: Vec<bool>,
    full: Vec<bool>,
    active: Vec<HashSet<usize>>,
    used_reexports: Vec<Vec<UsedReexport>>,
    seen_reexports: Vec<HashSet<(usize, usize)>>,
    used_targets: Vec<BTreeSet<usize>>,
    live_dynamic: Vec<HashSet<usize>>,
    /// 已传播过引用需求的活跃语句：每条语句只扫描一次，避免重复扫描同一
    /// 模块的全部活跃集（旧实现在每个需求上全图重扫，复杂度会到
    /// 需求数 × 节点数 × 活跃语句数）。
    propagated: Vec<HashSet<usize>>,
    /// 活跃集新增语句、等待传播引用的模块。
    dirty: VecDeque<usize>,
    dirty_flag: Vec<bool>,
    worklist: VecDeque<Demand>,
    seen_demands: HashSet<Demand>,
    unknown_reported: HashSet<(usize, String)>,
    diagnostics: Vec<PackDiagnostic>,
}

impl<'g> Linker<'g> {
    fn new(graph: &'g ModuleGraph, effectful: Vec<bool>) -> Self {
        let count = graph.nodes.len();
        Self {
            graph,
            effectful,
            retained: vec![false; count],
            full: vec![false; count],
            active: (0..count).map(|_| HashSet::new()).collect(),
            used_reexports: (0..count).map(|_| Vec::new()).collect(),
            seen_reexports: (0..count).map(|_| HashSet::new()).collect(),
            used_targets: (0..count).map(|_| BTreeSet::new()).collect(),
            live_dynamic: (0..count).map(|_| HashSet::new()).collect(),
            propagated: (0..count).map(|_| HashSet::new()).collect(),
            dirty: VecDeque::new(),
            dirty_flag: vec![false; count],
            worklist: VecDeque::new(),
            seen_demands: HashSet::new(),
            unknown_reported: HashSet::new(),
            diagnostics: Vec::new(),
        }
    }

    fn demand(&mut self, demand: Demand) {
        if self.seen_demands.insert(demand.clone()) {
            self.worklist.push_back(demand);
        }
    }

    fn mark_dirty(&mut self, node: usize) {
        if !self.dirty_flag[node] {
            self.dirty_flag[node] = true;
            self.dirty.push_back(node);
        }
    }

    /// 激活语句：首次进入活跃集时把模块标脏，等待引用传播。
    fn activate(&mut self, node: usize, index: usize) {
        if self.active[node].insert(index) {
            self.mark_dirty(node);
        }
    }

    /// 保留模块：激活非纯语句，并沿静态边传播求值需求。
    ///
    /// 保留即求值：模块的可观察求值由 [`effectful_modules`] 决定，静态边只在
    /// 目标可观察求值时传播 [`Demand::Retain`]。副作用导入（`import '…'`）
    /// 与静态绑定导入走同一条规则：求值目标，而不是把「求值」混同成「全部
    /// 导出被消费」的全量执行。
    fn retain(&mut self, node: usize) {
        if self.retained[node] {
            return;
        }
        self.retained[node] = true;
        // 已被保留的模块至少要跑一次动态边判定。
        self.mark_dirty(node);
        let graph = self.graph;
        for (index, statement) in graph.nodes[node].record.statements.iter().enumerate() {
            if statement.effect != StatementEffect::Pure {
                self.activate(node, index);
            }
        }
        for edge in &self.graph.nodes[node].static_edges {
            let Ok(target_id) = edge.target.as_ref() else { continue };
            let Some(target) = self.graph.index_of(target_id) else { continue };
            if self.effectful[target] {
                self.demand(Demand::Retain(target));
            }
        }
        // opaque 模块（scope 事实不完整）在 emit 层整文件独立发射，剪枝只到
        // 模块级：文件内全部语句、import 绑定、重导出与动态边文本都会进入产物。
        // 若仍按符号需求剪枝，目标 chunk 会把「未被消费」的导出剪除，而本模块
        // 保留的引用文本随之断链（死代码里的名字也必须解析成立）。升级为
        // Execute 全量需求语义，与整文件存活口径一致。CJS 模块同为整文件发射
        // （互操作壳引用全部语句与 require 边），同一升级。
        if self.graph.nodes[node].record.is_scope_incomplete()
            || self.graph.nodes[node].kind == NodeKind::Cjs
        {
            self.demand(Demand::Execute(node));
        }
    }

    fn activate_all(&mut self, node: usize) {
        let count = self.graph.nodes[node].record.statements.len();
        for index in 0..count {
            self.activate(node, index);
        }
    }

    /// 具名使用命中本模块声明：激活对应语句。
    fn activate_declared(&mut self, node: usize, local: &str) -> bool {
        let mut found = false;
        let graph = self.graph;
        for (index, statement) in graph.nodes[node].record.statements.iter().enumerate() {
            if statement.declared_names.iter().any(|name| name == local) {
                self.activate(node, index);
                found = true;
            }
        }
        found
    }

    /// `export default <表达式>`：按 export 语句 span 匹配表达式事实。
    fn activate_span(&mut self, node: usize, span: (usize, usize)) -> bool {
        let mut found = false;
        let graph = self.graph;
        for (index, statement) in graph.nodes[node].record.statements.iter().enumerate() {
            if statement.span == span {
                self.activate(node, index);
                found = true;
            }
        }
        found
    }

    /// 说明符 + 形态 → 静态边目标节点。
    fn edge_node(&self, node: usize, kind: EdgeKind, specifier: &str) -> Option<usize> {
        self.graph.nodes[node]
            .static_edges
            .iter()
            .find(|edge| edge.kind == kind && edge.specifier == specifier)
            .and_then(|edge| edge.target.as_ref().ok())
            .and_then(|id| self.graph.index_of(id))
    }

    fn record_reexport(&mut self, node: usize, used: UsedReexport, key: (usize, usize)) {
        if self.seen_reexports[node].insert(key) {
            self.used_reexports[node].push(used);
            self.used_targets[node].insert(key.1);
        }
    }

    /// 探测名字能否由目标模块（含其星号链）提供；星号循环视为可提供。
    fn provides(&self, node: usize, name: &str, visiting: &mut HashSet<usize>) -> bool {
        if !visiting.insert(node) {
            return true;
        }
        // CJS 互操作壳的导出面：`default`（module.exports）+ 检测到的具名导出，
        // 与 emit 层包装合成的导出语句同一份事实。
        if self.graph.nodes[node].kind == NodeKind::Cjs {
            let provided = name == "default"
                || self.graph.nodes[node].record.cjs_named_exports.iter().any(|n| n == name);
            visiting.remove(&node);
            return provided;
        }
        let provided = self.graph.nodes[node].record.exports.iter().any(|export| match export {
            ExportFact::Local { exported, type_only, .. } => !type_only && exported == name,
            ExportFact::Default { .. } => name == "default",
            ExportFact::ReexportNamed { exported, type_only, .. } => !type_only && exported == name,
            ExportFact::ReexportNamespace { namespace, type_only, .. } => {
                !type_only && namespace == name
            }
            ExportFact::ReexportAll { source, .. } => self
                .edge_node(node, EdgeKind::ReexportAll, source)
                .is_some_and(|target| self.provides(target, name, visiting)),
        });
        visiting.remove(&node);
        provided
    }

    /// 本地名命中 import 绑定 → 向来源模块传播需求。
    fn propagate_import_binding(&mut self, node: usize, local: &str) -> bool {
        let mut propagated = false;
        let imports: Vec<_> = self.graph.nodes[node]
            .record
            .imports
            .iter()
            .filter(|import| !import.type_only && import.kind != ImportKind::Dynamic)
            .cloned()
            .collect();
        for import in imports {
            let kind = if import.kind == ImportKind::SideEffect {
                EdgeKind::SideEffect
            } else {
                EdgeKind::Static
            };
            let Some(target) = self.edge_node(node, kind, &import.specifier) else {
                continue;
            };
            for binding in import.bindings {
                if binding.local != local || binding.inline_type_only {
                    continue;
                }
                propagated = true;
                self.used_targets[node].insert(target);
                match binding.imported {
                    ImportedName::Default => {
                        self.demand(Demand::Export(target, "default".to_string()));
                    }
                    ImportedName::Name(imported) => {
                        self.demand(Demand::Export(target, imported));
                    }
                    ImportedName::Namespace => {
                        self.demand(Demand::Execute(target));
                    }
                }
            }
        }
        propagated
    }

    fn unknown_export(&mut self, node: usize, name: &str) {
        if self.unknown_reported.insert((node, name.to_string())) {
            let mut diagnostic = PackDiagnostic::new(
                UNKNOWN_EXPORT,
                format!("导出名 `{name}` 不在模块导出事实中，保守全量激活"),
            );
            if let Some(path) = &self.graph.nodes[node].record.path {
                diagnostic = diagnostic.with_path(path.clone());
            }
            self.diagnostics.push(diagnostic);
        }
        self.demand(Demand::Execute(node));
    }

    /// 解析 `Export(node, name)`。
    fn resolve_symbol(&mut self, node: usize, name: &str) {
        if self.graph.nodes[node].kind == NodeKind::Json {
            // JSON 值节点无导出事实：`default` 即值本身，具名/命名空间与
            // 重导出形态由 `emit` 层显式拒绝；这里只保留节点（demand 已 retain）。
            return;
        }
        // CJS 互操作壳：导出面 = default + 检测到的具名集合（与 provides 同一份
        // 事实）。命中即整模块执行保留（无语句级剪枝）；未检测到的具名是
        // 结构化 unknown_export，不静默放行到运行时 SyntaxError。
        if self.graph.nodes[node].kind == NodeKind::Cjs {
            let provided = name == "default"
                || self.graph.nodes[node].record.cjs_named_exports.iter().any(|n| n == name);
            if provided {
                self.demand(Demand::Execute(node));
            } else {
                self.unknown_export(node, name);
            }
            return;
        }
        let exports: Vec<_> = self.graph.nodes[node].record.exports.iter().cloned().collect();
        let mut matched = false;
        for (index, export) in exports.into_iter().enumerate() {
            match export {
                ExportFact::Local { local, exported, type_only, .. } => {
                    if exported != name {
                        continue;
                    }
                    matched = true;
                    if type_only {
                        continue;
                    }
                    if !self.activate_declared(node, &local)
                        && !self.propagate_import_binding(node, &local)
                    {
                        // scope 事实不完整时导出面仍是语法事实：名字确实导出，
                        // 只是语句级激活定位不到；整模块保留兜底，不报假未知导出。
                        if self.graph.nodes[node].record.is_scope_incomplete() {
                            self.demand(Demand::Execute(node));
                            return;
                        }
                        self.unknown_export(node, name);
                        return;
                    }
                }
                ExportFact::Default { local, span } => {
                    if name != "default" {
                        continue;
                    }
                    matched = true;
                    let resolved = match &local {
                        Some(local) => {
                            self.activate_declared(node, local)
                                || self.propagate_import_binding(node, local)
                        }
                        None => self.activate_span(node, span),
                    };
                    if !resolved {
                        if self.graph.nodes[node].record.is_scope_incomplete() {
                            self.demand(Demand::Execute(node));
                            return;
                        }
                        self.unknown_export(node, name);
                        return;
                    }
                }
                ExportFact::ReexportNamed { source, local, exported, type_only, .. } => {
                    if exported != name {
                        continue;
                    }
                    matched = true;
                    if type_only {
                        continue;
                    }
                    if let Some(target) = self.edge_node(node, EdgeKind::ReexportNamed, &source) {
                        self.record_reexport(
                            node,
                            UsedReexport::Named { export_index: index, target_node: target },
                            (index, target),
                        );
                        self.demand(Demand::Export(target, local));
                    }
                }
                ExportFact::ReexportNamespace { source, namespace, type_only, .. } => {
                    if namespace != name {
                        continue;
                    }
                    matched = true;
                    if type_only {
                        continue;
                    }
                    if let Some(target) = self.edge_node(node, EdgeKind::ReexportNamespace, &source)
                    {
                        self.record_reexport(
                            node,
                            UsedReexport::Namespace { export_index: index, target_node: target },
                            (index, target),
                        );
                        self.demand(Demand::Execute(target));
                    }
                }
                ExportFact::ReexportAll { .. } => {}
            }
        }
        // 星号重导出：名字可能藏在来源模块里；提供不了则不产生需求。
        for (index, export) in self.graph.nodes[node].record.exports.iter().enumerate() {
            let ExportFact::ReexportAll { source, .. } = export else { continue };
            let Some(target) = self.edge_node(node, EdgeKind::ReexportAll, source) else {
                continue;
            };
            if self.provides(target, name, &mut HashSet::new()) {
                matched = true;
                self.record_reexport(
                    node,
                    UsedReexport::All { export_index: index, target_node: target },
                    (index, target),
                );
                self.demand(Demand::Export(target, name.to_string()));
            }
        }
        if !matched {
            self.unknown_export(node, name);
        }
    }

    /// 活跃语句的引用名：命中 import 绑定 → 向来源模块传播需求；命中本模块
    /// 本地声明 → 激活声明语句（Pure 声明的可剪除条件是「未被引用」，同模块
    /// 活跃语句的引用同样是使用，不激活会产出悬空引用）。级联在新语句激活后
    /// 继续：其引用可能再命中本地声明或 import 绑定，扫到本模块活跃集与
    /// 新需求都不再增长为止。
    ///
    /// 绑定事实现状（缺口 3 调查结论）：链接层 `referenced_names` 按语法名字
    /// 匹配，方向是保守超集：同名误命中只会多激活（多保留），不会误剪；
    /// 漏引用风险由事实完整性门兜底（语句事实不完整 → 判非纯 → emit 前置
    /// 拒绝）。绑定级精确使用判定由 `emit` 层沿上游 `module_scope_facts`
    /// 引用 span 消费，链接层保持超集口径（激活单调、需求去重保证终止）。
    fn propagate_statement_refs(&mut self, node: usize) {
        let graph = self.graph;
        loop {
            let mut pending: Vec<usize> = self.active[node]
                .iter()
                .copied()
                .filter(|index| !self.propagated[node].contains(index))
                .collect();
            if pending.is_empty() {
                return;
            }
            pending.sort_unstable();
            for index in pending {
                self.propagated[node].insert(index);
                let refs = graph.nodes[node].record.statements[index].referenced_names.clone();
                for name in refs {
                    if !self.propagate_import_binding(node, &name) {
                        self.activate_declared(node, &name);
                    }
                }
            }
        }
    }

    /// 动态边存活判定：全量模块全活；否则按语句包含，找不到包含语句保守活。
    fn resolve_dynamic(&mut self, node: usize) {
        let full = self.full[node];
        let dynamic_count = self.graph.nodes[node].dynamic_edges.len();
        for edge_index in 0..dynamic_count {
            if self.live_dynamic[node].contains(&edge_index) {
                continue;
            }
            let alive = if full {
                true
            } else {
                let edge = &self.graph.nodes[node].dynamic_edges[edge_index];
                let containing_import =
                    self.graph.nodes[node].record.imports.iter().find(|import| {
                        import.kind == ImportKind::Dynamic && import.specifier == edge.specifier
                    });
                match containing_import {
                    Some(import) => {
                        let contained: Vec<usize> = self.graph.nodes[node]
                            .record
                            .statements
                            .iter()
                            .enumerate()
                            .filter(|(_, statement)| {
                                statement.span.0 <= import.span.0
                                    && import.span.1 <= statement.span.1
                            })
                            .map(|(index, _)| index)
                            .collect();
                        // 找不到包含语句：保守活（模块保留即执行）。
                        contained.is_empty()
                            || contained.iter().any(|index| self.active[node].contains(index))
                    }
                    None => true,
                }
            };
            if !alive {
                continue;
            }
            self.live_dynamic[node].insert(edge_index);
            let edge = &self.graph.nodes[node].dynamic_edges[edge_index];
            if let Ok(target_id) = edge.target.as_ref() {
                if let Some(target) = self.graph.index_of(target_id) {
                    self.demand(Demand::Execute(target));
                }
            }
        }
    }

    fn run(&mut self) {
        loop {
            while let Some(demand) = self.worklist.pop_front() {
                match demand {
                    Demand::Execute(node) => {
                        self.retain(node);
                        if std::mem::replace(&mut self.full[node], true) {
                            continue;
                        }
                        // 全量执行从关闭翻到打开：动态边判定必须重跑。
                        self.mark_dirty(node);
                        self.activate_all(node);
                        // 全量：所有非类型导出与 import 绑定都被消费。
                        for (index, export) in
                            self.graph.nodes[node].record.exports.iter().enumerate()
                        {
                            match export.clone() {
                                ExportFact::Local { local, type_only, .. } => {
                                    if !type_only {
                                        self.activate_declared(node, &local);
                                    }
                                }
                                ExportFact::ReexportNamed {
                                    source,
                                    local,
                                    exported,
                                    type_only,
                                    ..
                                } => {
                                    let _ = exported;
                                    if type_only {
                                        continue;
                                    }
                                    if let Some(target) =
                                        self.edge_node(node, EdgeKind::ReexportNamed, &source)
                                    {
                                        self.record_reexport(
                                            node,
                                            UsedReexport::Named {
                                                export_index: index,
                                                target_node: target,
                                            },
                                            (index, target),
                                        );
                                        self.demand(Demand::Export(target, local));
                                    }
                                }
                                ExportFact::Default { local, .. } => {
                                    if let Some(local) = &local {
                                        if !self.activate_declared(node, local) {
                                            self.propagate_import_binding(node, local);
                                        }
                                    }
                                }
                                ExportFact::ReexportAll { source, .. } => {
                                    if let Some(target) =
                                        self.edge_node(node, EdgeKind::ReexportAll, &source)
                                    {
                                        self.record_reexport(
                                            node,
                                            UsedReexport::All {
                                                export_index: index,
                                                target_node: target,
                                            },
                                            (index, target),
                                        );
                                        self.demand(Demand::Execute(target));
                                    }
                                }
                                ExportFact::ReexportNamespace {
                                    source,
                                    namespace,
                                    type_only,
                                    ..
                                } => {
                                    let _ = namespace;
                                    if type_only {
                                        continue;
                                    }
                                    if let Some(target) =
                                        self.edge_node(node, EdgeKind::ReexportNamespace, &source)
                                    {
                                        self.record_reexport(
                                            node,
                                            UsedReexport::Namespace {
                                                export_index: index,
                                                target_node: target,
                                            },
                                            (index, target),
                                        );
                                        self.demand(Demand::Execute(target));
                                    }
                                }
                            }
                        }
                        let imports = self.graph.nodes[node].record.imports.clone();
                        for import in imports {
                            if import.type_only || import.kind == ImportKind::Dynamic {
                                continue;
                            }
                            for binding in import.bindings {
                                if !binding.inline_type_only {
                                    self.propagate_import_binding(node, &binding.local);
                                }
                            }
                        }
                    }
                    Demand::Export(node, name) => {
                        self.retain(node);
                        self.resolve_symbol(node, &name);
                    }
                    Demand::Retain(node) => {
                        self.retain(node);
                    }
                }
            }
            // 活跃语句与动态边只处理被标脏的模块：新增需求会回到 worklist，
            // 不再对全图重扫。
            while let Some(node) = self.dirty.pop_front() {
                self.dirty_flag[node] = false;
                self.propagate_statement_refs(node);
                self.resolve_dynamic(node);
            }
            if self.worklist.is_empty() && self.dirty.is_empty() {
                break;
            }
        }
    }

    fn finish(mut self) -> LinkPlan {
        // 保留模块的边解析失败诊断透传。
        let mut seen_edge = HashSet::new();
        let mut seen_record = HashSet::new();
        for node in 0..self.graph.nodes.len() {
            if !self.retained[node] {
                continue;
            }
            for edge in self.graph.nodes[node]
                .static_edges
                .iter()
                .chain(self.graph.nodes[node].dynamic_edges.iter())
            {
                if let Err(diagnostic) = &edge.target {
                    if seen_edge.insert((diagnostic.code.clone(), diagnostic.span)) {
                        self.diagnostics.push(diagnostic.clone());
                    }
                }
            }
            for diagnostic in self.graph.nodes[node]
                .diagnostics
                .iter()
                .chain(self.graph.nodes[node].record.diagnostics.iter())
            {
                if seen_record.insert((diagnostic.code.clone(), diagnostic.span)) {
                    self.diagnostics.push(diagnostic.clone());
                }
            }
        }
        let mut modules = Vec::new();
        for node in 0..self.graph.nodes.len() {
            if !self.retained[node] {
                continue;
            }
            let mut active: Vec<usize> = self.active[node].iter().copied().collect();
            active.sort_unstable();
            let mut dynamic: Vec<usize> = self.live_dynamic[node].iter().copied().collect();
            dynamic.sort_unstable();
            modules.push(LinkedModule {
                node,
                active_statements: active,
                used_reexports: std::mem::take(&mut self.used_reexports[node]),
                used_targets: std::mem::take(&mut self.used_targets[node]).into_iter().collect(),
                dynamic_edges: dynamic,
            });
        }
        LinkPlan { modules, diagnostics: self.diagnostics }
    }
}

/// 从模块图与入口需求声明计算链接计划。
///
/// 入口需求按 [`EntryUse`] 的两个可组合维度映射为链接器需求：
/// - `entry_uses` 中缺失的入口 → [`Demand::Execute`]（保守，不猜测）。
/// - [`EntryExecution::Full`] → [`Demand::Execute`]；执行蕴含全部绑定与
///   重导出实例化，`exports` 维度不改变活跃结果。
/// - [`EntryExecution::SideEffects`] → [`Demand::Retain`]，再按导出维度：
///   [`EntryExports::Named`] 逐名 [`Demand::Export`]；
///   [`EntryExports::All`] 枚举非类型导出名逐个 [`Demand::Export`]，但模块
///   含 `export *`（名字不可枚举）时升级为 [`Demand::Execute`]；
///   [`EntryExports::Unconsumed`] 不发出导出需求。
pub fn link(graph: &ModuleGraph, entry_uses: &[EntryUse]) -> LinkPlan {
    let effectful = effectful_modules(graph);
    let mut linker = Linker::new(graph, effectful);
    for entry in &graph.entries {
        let Some(index) = graph.index_of(&entry.id) else { continue };
        let Some(declaration) =
            entry_uses.iter().find(|candidate| candidate.entry_logical == entry.logical)
        else {
            linker.demand(Demand::Execute(index));
            continue;
        };
        match declaration.execution {
            EntryExecution::Full => linker.demand(Demand::Execute(index)),
            EntryExecution::SideEffects => {
                linker.demand(Demand::Retain(index));
                match &declaration.exports {
                    EntryExports::Unconsumed => {}
                    EntryExports::Named(names) => {
                        for name in names {
                            linker.demand(Demand::Export(index, name.clone()));
                        }
                    }
                    EntryExports::All => {
                        let record = &graph.nodes[index].record;
                        let enumerable = !record
                            .exports
                            .iter()
                            .any(|export| matches!(export, ExportFact::ReexportAll { .. }));
                        if enumerable {
                            let names: Vec<String> = record
                                .exports
                                .iter()
                                .filter_map(|export| match export {
                                    ExportFact::Local { exported, type_only, .. }
                                    | ExportFact::ReexportNamed { exported, type_only, .. } => {
                                        (!*type_only).then(|| exported.clone())
                                    }
                                    ExportFact::ReexportNamespace {
                                        namespace, type_only, ..
                                    } => (!*type_only).then(|| namespace.clone()),
                                    ExportFact::Default { .. } => Some("default".to_string()),
                                    ExportFact::ReexportAll { .. } => None,
                                })
                                .collect();
                            for name in names {
                                linker.demand(Demand::Export(index, name));
                            }
                        } else {
                            linker.demand(Demand::Execute(index));
                        }
                    }
                }
            }
        }
    }
    linker.run();
    linker.finish()
}
