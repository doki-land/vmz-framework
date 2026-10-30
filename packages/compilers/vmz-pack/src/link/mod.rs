//! 链接层：模块图 + 入口导出使用 → 语句级活跃不动点（Living §Pack 第 4/5 条）。
//!
//! 语义模型：
//! - 入口声明 `used_exports = None` 时整体执行（全量活跃）；`Some(names)` 时
//!   具名解析，未命中的纯语句可剪除。
//! - 符号需求沿 worklist 传播到不动点：具名使用命中导出 → 激活声明语句或
//!   沿 import 绑定传播；命中重导出 → 向来源模块继续传播；命名空间使用与
//!   未知使用形态 → 目标模块全量激活。
//! - 模块保留（保守）：入口、显式副作用导入边目标、被符号使用的模块、
//!   含非纯顶层语句（或事实不完整无法证明纯）且从保留模块可达的模块。
//!   纯且无使用的模块消除。判定不了即非纯，宁保守勿误剪。
//! - 名字解析不到任何导出时给 `vmz::pack::link::unknown_export` 诊断，并把
//!   该模块保守转为全量活跃（Oak 事实缺口如多变量声明只记首名，会在此暴露）。
//!
//! 本层不做分包与产物生成；图可达不等于活跃，活跃只由入口使用、效果分类
//! 与保守规则驱动。

use std::collections::{HashSet, VecDeque};

use crate::diag::PackDiagnostic;
use crate::graph::{EdgeKind, ModuleGraph, NodeKind};
use crate::module::{ExportFact, ImportKind, ImportedName, StatementEffect};

/// 请求的导出名在模块导出事实中不存在。
const UNKNOWN_EXPORT: &str = "vmz::pack::link::unknown_export";

/// 入口的导出使用声明。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntryUse {
    /// 与 [`crate::graph::GraphEntry::logical`] 对应的入口逻辑名。
    pub entry_logical: String,
    /// 入口被消费的导出名；`None` 表示入口整体执行（全量活跃）。
    pub used_exports: Option<Vec<String>>,
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

/// 传播中的使用需求。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Demand {
    /// 模块全量执行（入口整体、命名空间使用、未知使用保守升级）。
    Full(usize),
    /// 模块的某个导出名被使用。
    Symbol(usize, String),
    /// 模块仅保留执行（可达非纯或入口保留），不指定导出使用。
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
                self.demand(Demand::Full(target));
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
                        self.demand(Demand::Symbol(target, "default".to_string()));
                    }
                    ImportedName::Name(imported) => {
                        self.demand(Demand::Symbol(target, imported));
                    }
                    ImportedName::Namespace => {
                        self.demand(Demand::Full(target));
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
        self.demand(Demand::Full(node));
    }

    /// 解析 `Symbol(node, name)`。
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
                        self.demand(Demand::Symbol(target, local));
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
                        self.demand(Demand::Full(target));
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
                self.demand(Demand::Symbol(target, name.to_string()));
            }
        }
        if !matched {
            self.unknown_export(node, name);
        }
    }

    /// 活跃语句的引用名命中 import 绑定 → 传播。
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
                    self.demand(Demand::Full(target));
                }
            }
        }
    }

    fn run(&mut self) {
        while let Some(demand) = self.worklist.pop_front() {
            match demand {
                Demand::Full(node) => {
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
                                    self.demand(Demand::Symbol(target, local));
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
                                    self.demand(Demand::Full(target));
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
                                    self.demand(Demand::Full(target));
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
                Demand::Symbol(node, name) => {
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

/// 从模块图与入口使用声明计算链接计划。
///
/// `entry_uses` 中缺失的入口按全量执行处理（保守）。
pub fn link(graph: &ModuleGraph, entry_uses: &[EntryUse]) -> LinkPlan {
    let mut linker = Linker::new(graph);
    for entry in &graph.entries {
        let Some(index) = graph.index_of(&entry.id) else { continue };
        let declaration =
            entry_uses.iter().find(|candidate| candidate.entry_logical == entry.logical);
        match declaration.and_then(|candidate| candidate.used_exports.as_ref()) {
            None => linker.demand(Demand::Full(index)),
            Some(names) => {
                linker.demand(Demand::Retain(index));
                for name in names {
                    linker.demand(Demand::Symbol(index, name.clone()));
                }
            }
        }
    }
    linker.run();
    linker.finish()
}
