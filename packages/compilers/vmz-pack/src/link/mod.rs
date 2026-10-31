//! 链接层：模块图 + 入口需求 → 语句级活跃不动点（Living §Pack 第 4/5 条）。
//!
//! 入口需求拆成可组合的维度，不再压进单一 `used_exports` 字段：
//! - 执行（[`EntryExecution`]）：入口顶层语句是否整体活跃。`Full` = 求值根，
//!   蕴含全部静态 import 绑定与重导出按 ESM 实例化语义传播；`SideEffects` =
//!   入口仍求值（非纯语句恒活跃），纯语句只在导出需求命中时激活。
//! - 导出需求（[`EntryExports`]）：入口的哪些导出被消费者读取（`All` /
//!   `Named` / `Unconsumed`）。`execution: Full` 时导出维度不改变活跃结果
//!   （执行已蕴含实例化传播），合同仍要求显式声明，不做默认猜测。
//! - 副作用保留不是入口声明字段，而是链接器对任何保留模块的固有规则：
//!   保留即执行，非纯语句恒活跃（[`Demand::Retain`] 的效应）。
//!
//! 传播需求同样按维度组合（[`Demand`]）：`Execute`（执行）/ `Retain`
//! （副作用保留）/ `Export`（具名导出消费），沿 worklist 求不动点：具名使用
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
//! 模块保留（保守）：入口、显式副作用导入边目标、被符号使用的模块、
//! 含非纯顶层语句（或事实不完整无法证明纯）且从保留模块可达的模块。
//! 纯且无使用的模块消除。判定不了即非纯，宁保守勿误剪。
//!
//! 本层不做分包与产物生成；图可达不等于活跃，活跃只由入口需求、效果分类
//! 与保守规则驱动。[`LinkPlan::modules`] 的 `active_statements` 与
//! `dynamic_edges` 是链接后的唯一活跃事实来源：chunk、资源、CSS、动态边
//! 处理必须以此为共同输入，不得另起重算。

use std::collections::{HashSet, VecDeque};

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
    /// 副作用保留维度：模块保留求值（非纯语句恒活跃），不指定导出消费。
    Retain(usize),
}

/// 链接器内部状态。
struct Linker<'g> {
    graph: &'g ModuleGraph,
    retained: Vec<bool>,
    full: Vec<bool>,
    active: Vec<HashSet<usize>>,
    used_reexports: Vec<Vec<UsedReexport>>,
    seen_reexports: Vec<HashSet<(usize, usize)>>,
    live_dynamic: Vec<HashSet<usize>>,
    worklist: VecDeque<Demand>,
    seen_demands: HashSet<Demand>,
    unknown_reported: HashSet<(usize, String)>,
    diagnostics: Vec<PackDiagnostic>,
}

impl<'g> Linker<'g> {
    fn new(graph: &'g ModuleGraph) -> Self {
        let count = graph.nodes.len();
        Self {
            graph,
            retained: vec![false; count],
            full: vec![false; count],
            active: (0..count).map(|_| HashSet::new()).collect(),
            used_reexports: (0..count).map(|_| Vec::new()).collect(),
            seen_reexports: (0..count).map(|_| HashSet::new()).collect(),
            live_dynamic: (0..count).map(|_| HashSet::new()).collect(),
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

    /// 保守保留判定：无法证明模块顶层全纯即不可消除（事实为空同样不可证明）。
    fn non_pure(&self, node: usize) -> bool {
        let record = &self.graph.nodes[node].record;
        record.statements.is_empty()
            || record.statements.iter().any(|s| s.effect != StatementEffect::Pure)
    }

    /// 保留模块：激活 Init/SideEffect 语句，并沿静态边传播请求。
    /// 显式副作用导入边目标全量执行；其余可达非纯模块保留。
    fn retain(&mut self, node: usize) {
        if self.retained[node] {
            return;
        }
        self.retained[node] = true;
        for (index, statement) in self.graph.nodes[node].record.statements.iter().enumerate() {
            if statement.effect != StatementEffect::Pure {
                self.active[node].insert(index);
            }
        }
        for edge in &self.graph.nodes[node].static_edges {
            let Ok(target_id) = edge.target.as_ref() else { continue };
            let Some(target) = self.graph.index_of(target_id) else { continue };
            if edge.kind == EdgeKind::SideEffect {
                self.demand(Demand::Execute(target));
            } else if self.non_pure(target) {
                self.demand(Demand::Retain(target));
            }
        }
    }

    fn activate_all(&mut self, node: usize) {
        let count = self.graph.nodes[node].record.statements.len();
        self.active[node].extend(0..count);
    }

    /// 具名使用命中本模块声明：激活对应语句。
    fn activate_declared(&mut self, node: usize, local: &str) -> bool {
        let mut found = false;
        for (index, statement) in self.graph.nodes[node].record.statements.iter().enumerate() {
            if statement.declared_names.iter().any(|name| name == local) {
                self.active[node].insert(index);
                found = true;
            }
        }
        found
    }

    /// `export default <表达式>`：按 export 语句 span 匹配表达式事实。
    fn activate_span(&mut self, node: usize, span: (usize, usize)) -> bool {
        let mut found = false;
        for (index, statement) in self.graph.nodes[node].record.statements.iter().enumerate() {
            if statement.span == span {
                self.active[node].insert(index);
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
        }
    }

    /// 探测名字能否由目标模块（含其星号链）提供；星号循环视为可提供。
    fn provides(&self, node: usize, name: &str, visiting: &mut HashSet<usize>) -> bool {
        if !visiting.insert(node) {
            return true;
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

    /// 活跃语句的引用名命中 import 绑定 → 传播。
    ///
    /// 绑定事实现状（缺口 3 调查结论）：Oak TypeScript AST 的标识符是裸
    /// `Identifier(String)`，上游没有 scope 解析与 reference 绑定事实，
    /// `referenced_names` 只能按语法名字与 import 绑定匹配。方向是保守
    /// 超集：同名误命中只会多传播需求（多保留），不会误剪；漏引用风险
    /// 由事实完整性门兜底（语句事实不完整 → 判非纯 → emit 前置拒绝）。
    /// 收紧到绑定级精确传播需要先在 `oak-typescript` 上游补 scope/reference
    /// 分析，属大改上游；VMZ 侧不堆名字匹配特例。
    fn propagate_statement_refs(&mut self, node: usize) {
        let mut indexes: Vec<usize> = self.active[node].iter().copied().collect();
        indexes.sort_unstable();
        for index in indexes {
            let refs = self.graph.nodes[node].record.statements[index].referenced_names.clone();
            for name in refs {
                self.propagate_import_binding(node, &name);
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
        while let Some(demand) = self.worklist.pop_front() {
            match demand {
                Demand::Execute(node) => {
                    self.retain(node);
                    if std::mem::replace(&mut self.full[node], true) {
                        continue;
                    }
                    self.activate_all(node);
                    // 全量：所有非类型导出与 import 绑定都被消费。
                    for (index, export) in self.graph.nodes[node].record.exports.iter().enumerate()
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
                                source, namespace, type_only, ..
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
            // 保留模块的活跃引用与动态边可能新增需求，扫一遍直到不动点。
            for index in 0..self.graph.nodes.len() {
                if self.retained[index] {
                    self.propagate_statement_refs(index);
                    self.resolve_dynamic(index);
                }
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
    let mut linker = Linker::new(graph);
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
