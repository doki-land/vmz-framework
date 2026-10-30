//! 分包计划实现：链接保留集合 → 确定性 chunk 集合。
//! 语义模型（根集合、可达签名、收缩单元、执行序与诊断口径）见 [`super`] 模块注释。

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};
use std::path::Path;

use crate::diag::PackDiagnostic;
use crate::graph::{ModuleGraph, NodeKind};
use crate::link::LinkPlan;

/// 保留节点缺少完整模块事实时的显式诊断码。
const INCOMPLETE_FACTS: &str = "vmz::pack::chunk::incomplete_facts";

/// 分包根：静态入口或存活动态边目标。`Entry` 排在 `Async` 前，同型按索引升序。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum RootId {
    /// [`crate::graph::ModuleGraph::entries`] 下标。
    Entry(usize),
    /// 异步根（存活动态边目标）所在图节点索引。
    Async(usize),
}

/// 一个 chunk：稳定 id、来源、执行序内的节点与跨 chunk 依赖。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Chunk {
    /// 稳定 chunk id（`entry/…`、`async/…`、`shared/…`），同输入必同输出。
    pub id: String,
    /// chunk 的来源根形态。
    pub origin: ChunkOrigin,
    /// 图节点索引，按 chunk 内执行序（被依赖者先于导入者）。
    pub modules: Vec<usize>,
    /// 依赖的其它 chunk 在 [`ChunkPlan::chunks`] 中的索引，升序去重。
    pub depends_on: Vec<usize>,
}

/// chunk 的来源。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChunkOrigin {
    /// 单一静态入口独占。
    Entry {
        /// 入口逻辑名。
        logical: String,
    },
    /// 单一异步根独占。
    Async {
        /// 异步根所在图节点索引。
        root_node: usize,
    },
    /// 多根共同可达（防御性的零根分区 `roots` 为空）。
    Shared {
        /// 根标签集合（入口逻辑名或异步根规范化路径），按稳定序。
        roots: Vec<String>,
    },
}

/// 分包产物。
#[derive(Debug, Clone, PartialEq)]
pub struct ChunkPlan {
    /// 全部 chunk，按 id 升序；索引即 chunk 索引。
    pub chunks: Vec<Chunk>,
    /// 入口逻辑名 → chunk 索引，按 `graph.entries` 顺序（仅保留的入口）。
    pub entry_chunks: Vec<(String, usize)>,
    /// 动态边界：源图节点 → 目标 chunk 索引，去重升序。
    pub dynamic_boundaries: Vec<(usize, usize)>,
    /// 分包诊断（当前为 `incomplete_facts`）。
    pub diagnostics: Vec<PackDiagnostic>,
}

/// 由模块图与链接计划产出确定性分包计划。
///
/// 输入必须是同一目标图上的 [`ModuleGraph`] 与 [`LinkPlan`]；本函数不重算
/// 活跃性，只消费保留集合与存活动态边。
pub fn plan_chunks(graph: &ModuleGraph, plan: &LinkPlan) -> ChunkPlan {
    let node_count = graph.nodes.len();
    // Style 节点不参与分包：它们没有 JS 文本可装配，级联归属由 emit 层
    // 按「chunk 成员模块的执行序 × 有序副作用边」聚合，不是 chunk 成员。
    let mut retained = vec![false; node_count];
    for module in &plan.modules {
        if module.node < node_count && graph.nodes[module.node].kind != NodeKind::Style {
            retained[module.node] = true;
        }
    }

    // 保留集合上的静态边邻接（保守：一律算依赖，不重判语句活跃）。
    let mut forward: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); node_count];
    let mut reverse: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); node_count];
    for (index, node) in graph.nodes.iter().enumerate() {
        if !retained[index] {
            continue;
        }
        for edge in &node.static_edges {
            let Ok(target_id) = edge.target.as_ref() else { continue };
            let Some(target) = graph.index_of(target_id) else { continue };
            if !retained[target] {
                continue;
            }
            forward[index].insert(target);
            reverse[target].insert(index);
        }
    }

    // 强连通收缩：单元按 min 成员节点号重编号，成员内部升序。
    let units = strong_components(node_count, &retained, &forward, &reverse);
    let mut unit_of = vec![usize::MAX; node_count];
    for (unit, members) in units.iter().enumerate() {
        for &member in members {
            unit_of[member] = unit;
        }
    }
    let min_node: Vec<usize> = units.iter().map(|members| members[0]).collect();

    // 单元级邻接（去自环）。
    let mut unit_forward: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); units.len()];
    let mut unit_reverse: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); units.len()];
    for unit in 0..units.len() {
        for &member in &units[unit] {
            for &target in &forward[member] {
                let other = unit_of[target];
                if other != unit {
                    unit_forward[unit].insert(other);
                    unit_reverse[other].insert(unit);
                }
            }
        }
    }

    // 根集合：保留的静态入口 ∪ 存活动态边目标（已是入口节点的目标不另立根）。
    let entry_node: Vec<Option<usize>> =
        graph.entries.iter().map(|entry| graph.index_of(&entry.id)).collect();
    let mut entry_nodes: BTreeSet<usize> = BTreeSet::new();
    let mut roots: BTreeSet<RootId> = BTreeSet::new();
    for (index, node) in entry_node.iter().enumerate() {
        if let Some(node) = node {
            entry_nodes.insert(*node);
            if retained[*node] {
                roots.insert(RootId::Entry(index));
            }
        }
    }
    for module in &plan.modules {
        if module.node >= node_count {
            continue;
        }
        for &edge_index in &module.dynamic_edges {
            let Some(edge) = graph.nodes[module.node].dynamic_edges.get(edge_index) else {
                continue;
            };
            let Ok(target_id) = edge.target.as_ref() else { continue };
            let Some(target) = graph.index_of(target_id) else { continue };
            if retained[target] && !entry_nodes.contains(&target) {
                roots.insert(RootId::Async(target));
            }
        }
    }

    // 每根沿单元前向邻接 DFS，累积可达签名。
    let mut signatures: Vec<BTreeSet<RootId>> = vec![BTreeSet::new(); units.len()];
    for &root in &roots {
        let Some(root_unit) = root_unit_of(root, &entry_node, &unit_of) else { continue };
        let mut seen = vec![false; units.len()];
        let mut stack = vec![root_unit];
        seen[root_unit] = true;
        while let Some(unit) = stack.pop() {
            signatures[unit].insert(root);
            for &next in &unit_forward[unit] {
                if !seen[next] {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
    }

    // 签名相同的单元合成一个 chunk 分区。
    let mut groups: BTreeMap<BTreeSet<RootId>, Vec<usize>> = BTreeMap::new();
    for (unit, signature) in signatures.iter().enumerate() {
        groups.entry(signature.clone()).or_default().push(unit);
    }

    struct Draft {
        id: String,
        origin: ChunkOrigin,
        units: Vec<usize>,
    }
    let mut drafts: Vec<Draft> = Vec::new();
    for (signature, group_units) in &groups {
        let (id, origin) = match signature.iter().next() {
            Some(&RootId::Entry(index)) if signature.len() == 1 => {
                let logical = graph.entries[index].logical.clone();
                (format!("entry/{logical}"), ChunkOrigin::Entry { logical })
            }
            Some(&RootId::Async(node)) if signature.len() == 1 => {
                let label = relative_label(graph, &graph.nodes[node].resolved.path);
                (format!("async/{label}"), ChunkOrigin::Async { root_node: node })
            }
            _ => {
                let labels: Vec<String> =
                    signature.iter().map(|&root| root_label(graph, root)).collect();
                (format!("shared/{}", labels.join("+")), ChunkOrigin::Shared { roots: labels })
            }
        };
        drafts.push(Draft { id, origin, units: group_units.clone() });
    }
    drafts.sort_by(|a, b| a.id.cmp(&b.id));

    let mut chunk_of_unit = vec![usize::MAX; units.len()];
    for (chunk_index, draft) in drafts.iter().enumerate() {
        for &unit in &draft.units {
            chunk_of_unit[unit] = chunk_index;
        }
    }

    let mut chunks: Vec<Chunk> = Vec::with_capacity(drafts.len());
    for (chunk_index, draft) in drafts.iter().enumerate() {
        // chunk 内执行序：Kahn（被依赖单元先于导入者；同层按 min 节点先出）。
        let in_chunk: BTreeSet<usize> = draft.units.iter().copied().collect();
        let mut pending: BTreeMap<usize, usize> = BTreeMap::new();
        for &unit in &draft.units {
            let count = unit_forward[unit].iter().filter(|next| in_chunk.contains(next)).count();
            pending.insert(unit, count);
        }
        let mut ready: BinaryHeap<Reverse<(usize, usize)>> = BinaryHeap::new();
        for &unit in &draft.units {
            if pending[&unit] == 0 {
                ready.push(Reverse((min_node[unit], unit)));
            }
        }
        let mut modules = Vec::new();
        let mut emitted = 0usize;
        while let Some(Reverse((_, unit))) = ready.pop() {
            modules.extend(units[unit].iter().copied());
            emitted += 1;
            for &importer in &unit_reverse[unit] {
                if let Some(count) = pending.get_mut(&importer) {
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        ready.push(Reverse((min_node[importer], importer)));
                    }
                }
            }
        }
        if emitted < draft.units.len() {
            // 防御：收缩后 chunk 内无环，Kahn 必完成；未出队单元按 min 节点补齐，不丢模块。
            let mut rest: Vec<usize> =
                draft.units.iter().filter(|&&unit| pending[&unit] > 0).copied().collect();
            rest.sort_by_key(|&unit| min_node[unit]);
            for unit in rest {
                modules.extend(units[unit].iter().copied());
            }
        }

        // 跨 chunk 同步依赖。
        let mut depends_on: BTreeSet<usize> = BTreeSet::new();
        for &unit in &draft.units {
            for &next in &unit_forward[unit] {
                let other = chunk_of_unit[next];
                if other != chunk_index {
                    depends_on.insert(other);
                }
            }
        }
        chunks.push(Chunk {
            id: draft.id.clone(),
            origin: draft.origin.clone(),
            modules,
            depends_on: depends_on.into_iter().collect(),
        });
    }

    // 入口映射：按 graph.entries 顺序，仅保留的入口。
    let entry_chunks: Vec<(String, usize)> = graph
        .entries
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let node = entry_node[index]?;
            retained[node].then(|| (entry.logical.clone(), chunk_of_unit[unit_of[node]]))
        })
        .collect();

    // 动态边界：源节点 → 目标 chunk 索引。
    let mut boundaries: BTreeSet<(usize, usize)> = BTreeSet::new();
    for module in &plan.modules {
        if module.node >= node_count {
            continue;
        }
        for &edge_index in &module.dynamic_edges {
            let Some(edge) = graph.nodes[module.node].dynamic_edges.get(edge_index) else {
                continue;
            };
            let Ok(target_id) = edge.target.as_ref() else { continue };
            let Some(target) = graph.index_of(target_id) else { continue };
            if retained[target] {
                boundaries.insert((module.node, chunk_of_unit[unit_of[target]]));
            }
        }
    }

    // 事实不完整的保留节点：显式诊断，保守留在所属 chunk。
    let mut diagnostics = Vec::new();
    for (index, node) in graph.nodes.iter().enumerate() {
        if !retained[index] || (node.record.path.is_some() && node.diagnostics.is_empty()) {
            continue;
        }
        let chunk_id = &chunks[chunk_of_unit[unit_of[index]]].id;
        let path = node.record.path.clone().unwrap_or_else(|| normalize_path(&node.resolved.path));
        diagnostics.push(
            PackDiagnostic::new(
                INCOMPLETE_FACTS,
                format!("模块事实不完整，保守保留在 chunk `{chunk_id}`"),
            )
            .with_path(path),
        );
    }

    ChunkPlan {
        chunks,
        entry_chunks,
        dynamic_boundaries: boundaries.into_iter().collect(),
        diagnostics,
    }
}

/// 根的所在单元；入口未解析到节点时返回 `None`（根集合已保证保留）。
fn root_unit_of(root: RootId, entry_node: &[Option<usize>], unit_of: &[usize]) -> Option<usize> {
    match root {
        RootId::Entry(index) => entry_node[index].map(|node| unit_of[node]),
        RootId::Async(node) => Some(unit_of[node]),
    }
}

/// 根的稳定标签：入口用逻辑名，异步根用相对项目根的路径。
fn root_label(graph: &ModuleGraph, root: RootId) -> String {
    match root {
        RootId::Entry(index) => graph.entries[index].logical.clone(),
        RootId::Async(node) => relative_label(graph, &graph.nodes[node].resolved.path),
    }
}

/// 相对 `graph.root` 的规范化路径标签：同内容跨机器产出相同 chunk id。
/// 与项目根不同树（跨盘）时退回规范化绝对路径——同机稳定，不假装跨机可重现。
fn relative_label(graph: &ModuleGraph, path: &Path) -> String {
    let root: Vec<std::path::Component<'_>> = graph.root.components().collect();
    let target: Vec<std::path::Component<'_>> = path.components().collect();
    let common = root.iter().zip(target.iter()).take_while(|(a, b)| a == b).count();
    if target[common..]
        .iter()
        .any(|c| matches!(c, std::path::Component::Prefix(_) | std::path::Component::RootDir))
    {
        return normalize_path(path);
    }
    let mut out = String::new();
    for component in &root[common..] {
        if matches!(component, std::path::Component::Normal(_)) {
            out.push_str("../");
        }
    }
    let rest: Vec<String> =
        target[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    out.push_str(&rest.join("/"));
    if out.is_empty() { normalize_path(path) } else { out }
}

/// 路径规范化：分隔符统一为 `/`，保证跨平台稳定 id。
fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// Kosaraju 迭代求强连通分量；单元按 min 成员升序，成员内部升序。
fn strong_components(
    node_count: usize,
    retained: &[bool],
    forward: &[BTreeSet<usize>],
    reverse: &[BTreeSet<usize>],
) -> Vec<Vec<usize>> {
    // 第一遍：前向 DFS 完成序。
    let mut visited = vec![false; node_count];
    let mut order: Vec<usize> = Vec::with_capacity(node_count);
    for start in 0..node_count {
        if !retained[start] || visited[start] {
            continue;
        }
        let mut stack: Vec<(usize, std::vec::IntoIter<usize>)> = Vec::new();
        visited[start] = true;
        stack.push((start, forward[start].iter().copied().collect::<Vec<_>>().into_iter()));
        while let Some((node, children)) = stack.last_mut() {
            match children.next() {
                Some(next) => {
                    if !visited[next] {
                        visited[next] = true;
                        stack.push((
                            next,
                            forward[next].iter().copied().collect::<Vec<_>>().into_iter(),
                        ));
                    }
                }
                None => {
                    order.push(*node);
                    stack.pop();
                }
            }
        }
    }

    // 第二遍：逆完成序沿反向邻接收集分量。
    let mut assigned = vec![false; node_count];
    let mut components: Vec<Vec<usize>> = Vec::new();
    for &start in order.iter().rev() {
        if assigned[start] {
            continue;
        }
        let mut component = Vec::new();
        let mut stack = vec![start];
        assigned[start] = true;
        while let Some(node) = stack.pop() {
            component.push(node);
            for &next in &reverse[node] {
                if !assigned[next] {
                    assigned[next] = true;
                    stack.push(next);
                }
            }
        }
        component.sort_unstable();
        components.push(component);
    }
    components.sort_by_key(|component| component[0]);
    components
}
