//! 分包计划实现：链接保留集合 → 确定性 chunk 集合。
//! 语义模型（根集合、可达签名、收缩单元、执行序与诊断口径）见 [`super`] 模块注释。

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};
use std::path::Path;

use crate::diag::PackDiagnostic;
use crate::graph::{ModuleGraph, NodeKind};
use crate::link::{LinkPlan, UsedReexport};

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
    /// 稳定 chunk id（`entry/…`、`async/…`、`shared/…`、`isolated/…`），同输入必同输出。
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
    // Style/Json 节点不参与分包：它们没有 JS 文本可装配。Style 的级联归属由
    // emit 层按「chunk 成员模块的执行序 × 有序副作用边」聚合；Json 的值绑定
    // 文本由 emit 层在导入者所属 chunk 内合成，二者都不是 chunk 成员。
    let mut retained = vec![false; node_count];
    for module in &plan.modules {
        if module.node < node_count
            && !matches!(graph.nodes[module.node].kind, NodeKind::Style | NodeKind::Json)
        {
            retained[module.node] = true;
        }
    }

    // opaque 模块（scope 事实不完整，精确原因清单非空）禁止进入共享 chunk：
    // chunk 层强制 singleton 分区，emit 层独立发射真 ESM 文件（Living
    // §同 chunk 作用域隔离：隔离即独立发射）。名字层面的 `rename_unsafe`
    // 标记不触发隔离，判定只依据不完整原因清单。CJS 模块同理强制隔离：
    // 互操作壳与 `module`/`exports`/`require` 材料只在独立文件里成立。
    let mut isolated = vec![false; node_count];
    for (index, node) in graph.nodes.iter().enumerate() {
        isolated[index] = retained[index]
            && (node.record.is_scope_incomplete() || node.kind == crate::graph::NodeKind::Cjs);
    }

    // 依赖边 = 可观察求值目标 ∪ 本模块传播了符号需求的目标。前者是 ESM 求值
    // 语义（求值本模块必然求值它的可观察静态依赖），后者是真正被合成 import /
    // export-from 引用的目标。未被任何活跃语句消费、也不可观察求值的纯目标是
    // 无依赖边：它既不会被导入，也不需要与之同 chunk。
    let effectful = crate::link::effectful_modules(graph);
    let mut used_targets: Vec<BTreeSet<usize>> = vec![BTreeSet::new(); node_count];
    for module in &plan.modules {
        if module.node >= node_count {
            continue;
        }
        used_targets[module.node].extend(module.used_targets.iter().copied());
        used_targets[module.node].extend(module.used_reexports.iter().map(|used| match used {
            UsedReexport::Named { target_node, .. }
            | UsedReexport::All { target_node, .. }
            | UsedReexport::Namespace { target_node, .. } => *target_node,
        }));
    }
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
            if !effectful[target] && !used_targets[index].contains(&target) {
                continue;
            }
            forward[index].insert(target);
            reverse[target].insert(index);
        }
    }

    // 强连通收缩：单元按 min 成员节点号重编号，成员内部升序。
    // opaque 成员从单元拆出为独立 singleton 单元：隔离模块不与任何其它模块
    // 共享 chunk。拆分只删边不造环——同 chunk 内仍无环；跨 chunk 的环由产物
    // 层占位符两遍法解决，独立发射的真 ESM 文件天然保持 live binding 与
    // 求值顺序，不需要同 chunk 平铺来维持。
    let raw_units = strong_components(node_count, &retained, &forward, &reverse);
    let mut units: Vec<Vec<usize>> = Vec::with_capacity(raw_units.len());
    let mut unit_isolated: Vec<bool> = Vec::with_capacity(raw_units.len());
    for members in raw_units {
        let opaque: Vec<usize> = members.iter().copied().filter(|m| isolated[*m]).collect();
        if opaque.is_empty() {
            units.push(members);
            unit_isolated.push(false);
            continue;
        }
        let rest: Vec<usize> = members.into_iter().filter(|m| !isolated[*m]).collect();
        for node in opaque {
            units.push(vec![node]);
            unit_isolated.push(true);
        }
        if !rest.is_empty() {
            units.push(rest);
            unit_isolated.push(false);
        }
    }
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

    // 签名相同的单元合成一个 chunk 分区；isolated 单元禁止合并，各自成组，
    // id 以模块相对路径标签派生，保证唯一稳定。
    let mut groups: BTreeMap<BTreeSet<RootId>, Vec<usize>> = BTreeMap::new();
    let mut solos: Vec<(usize, BTreeSet<RootId>)> = Vec::new();
    for (unit, signature) in signatures.iter().enumerate() {
        if unit_isolated[unit] {
            solos.push((unit, signature.clone()));
        } else {
            groups.entry(signature.clone()).or_default().push(unit);
        }
    }

    struct Draft {
        id: String,
        origin: ChunkOrigin,
        units: Vec<usize>,
    }
    let mut drafts: Vec<Draft> = Vec::new();
    for (signature, group_units) in &groups {
        let origin = chunk_origin(graph, signature);
        let id = chunk_id(graph, &origin);
        drafts.push(Draft { id, origin, units: group_units.clone() });
    }
    for (unit, signature) in &solos {
        let origin = chunk_origin(graph, signature);
        let label = relative_label(graph, &graph.nodes[units[*unit][0]].resolved.path);
        drafts.push(Draft { id: format!("isolated/{label}"), origin, units: vec![*unit] });
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

/// 分区来源根：单入口根、单异步根；其余（多根共同可达与防御性零根）为共享。
fn chunk_origin(graph: &ModuleGraph, signature: &BTreeSet<RootId>) -> ChunkOrigin {
    match signature.iter().next() {
        Some(&RootId::Entry(index)) if signature.len() == 1 => {
            ChunkOrigin::Entry { logical: graph.entries[index].logical.clone() }
        }
        Some(&RootId::Async(node)) if signature.len() == 1 => {
            ChunkOrigin::Async { root_node: node }
        }
        _ => ChunkOrigin::Shared {
            roots: signature.iter().map(|&root| root_label(graph, root)).collect(),
        },
    }
}

/// 分区 id：由来源根确定性派生（isolated 分区由调用处按模块标签另行命名）。
fn chunk_id(graph: &ModuleGraph, origin: &ChunkOrigin) -> String {
    match origin {
        ChunkOrigin::Entry { logical } => format!("entry/{logical}"),
        ChunkOrigin::Async { root_node } => {
            format!("async/{}", relative_label(graph, &graph.nodes[*root_node].resolved.path))
        }
        ChunkOrigin::Shared { roots } => format!("shared/{}", roots.join("+")),
    }
}

/// 相对命名基准派生的可移植路径标签。
///
/// 命名基准按优先级取：输出树根（`graph.out_root`，编译产物一律按其相对
/// 路径命名，换 `--out-dir`、换机器或换绝对位置都产出同一 chunk id）→
/// 项目根（源树与依赖包，允许 `../` 前缀表达跨仓兄弟目录）→ 路径摘要
/// `external/<hex8>`（跨卷等无法相对化的情况，不把机器相关绝对路径写进
/// chunk id）。
fn relative_label(graph: &ModuleGraph, path: &Path) -> String {
    let target = label_components(path);
    if let Some(out_root) = &graph.out_root {
        if let Some(label) = relative_under(&label_components(out_root), &target, false) {
            return label;
        }
    }
    if let Some(label) = relative_under(&label_components(&graph.root), &target, true) {
        return label;
    }
    format!("external/{}", digest_label(&target))
}

/// 路径 → 可比较的组件序列：Windows 的 verbatim 前缀（`\\\\?\\C:`）与普通
/// 盘符前缀归一为同一键，`canonicalize` 与否不再改变比较结果。
fn label_components(path: &Path) -> Vec<String> {
    use std::path::Component;
    let mut out = Vec::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push(prefix_key(&prefix.kind())),
            Component::RootDir => out.push(String::new()),
            Component::CurDir => {}
            Component::ParentDir => out.push("..".to_string()),
            Component::Normal(name) => out.push(name.to_string_lossy().into_owned()),
        }
    }
    out
}

fn prefix_key(prefix: &std::path::Prefix<'_>) -> String {
    use std::path::Prefix;
    match prefix {
        Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => {
            format!("{}:", char::from(*letter).to_ascii_lowercase())
        }
        Prefix::UNC(server, share) | Prefix::VerbatimUNC(server, share) => {
            format!("//{}/{}", server.to_string_lossy(), share.to_string_lossy())
        }
        Prefix::DeviceNS(name) => format!("//?/{}", name.to_string_lossy()),
        Prefix::Verbatim(name) => name.to_string_lossy().into_owned(),
    }
}

/// `target` 相对 `base` 的标签；`allow_parent` 为真时允许目标不在 base 之下
/// （同卷源树兄弟目录）并用 `../` 前缀表达，为假时要求严格包含（输出树根）。
/// 目标仍在不同卷 / 不同根标记之下时返回 `None`，由调用方降级。
fn relative_under(base: &[String], target: &[String], allow_parent: bool) -> Option<String> {
    let common = base.iter().zip(target.iter()).take_while(|(a, b)| a == b).count();
    if !allow_parent && common < base.len() {
        return None;
    }
    let rest = &target[common..];
    if rest.iter().any(|component| is_root_marker(component)) {
        return None;
    }
    let mut out = String::new();
    if allow_parent {
        for _ in &base[common..] {
            out.push_str("../");
        }
    }
    out.push_str(&rest.join("/"));
    (!out.is_empty()).then_some(out)
}

/// 组件是否为卷根 / 根目录标记（空串是 `RootDir`，带冒号是盘符前缀）。
fn is_root_marker(component: &str) -> bool {
    component.is_empty() || component.ends_with(':') || component.starts_with("//")
}

/// 无法相对化时的稳定短标签：路径组件摘要，不含机器相关绝对路径。
fn digest_label(components: &[String]) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(components.join("/").as_bytes());
    let mut out = String::with_capacity(8);
    for byte in digest.iter().take(4) {
        out.push(char::from_digit(u32::from(byte >> 4), 16).unwrap_or('0'));
        out.push(char::from_digit(u32::from(byte & 0x0F), 16).unwrap_or('0'));
    }
    out
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
