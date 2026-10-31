//! 单 chunk 文本装配：活跃语句切片 → 切片内替换（动态占位符与资源 URL）→
//! 类型擦除 → 合成跨 chunk import/export → 名字唯一性检查。
//!
//! 拼接语义的前提：同 chunk 模块直接文本拼接，绑定必须原同名可达；
//! 同 chunk 具名重导出沿目标模块的导出事实解析为 chunk 内绑定名，与
//! deferred Local 导出同一机制发 `export { <绑定名> [as <导出名>] };`，
//! 事实链离开本 chunk 时与跨 chunk 分支同形态发 `export { … } from`；
//! 解析不到绑定事实的形态（只有星号来源、具名来自表达式 default、来源链
//! 成环）与需要 scope 重写（重命名绑定）或运行时命名空间合成（星号语义、
//! 同 chunk 动态边界）的形态都显式诊断拒绝，不产出猜测文本。跨 chunk 引用在第一遍只写占位符（chunk 间可成环，
//! 不能提前定名），指纹与替换由 `manifest` 层的两遍法完成。
//!
//! Style 目标节点的边在本层只负责 JS 侧文本处置：副作用/空绑定形态的
//! import 语句整体移除（级联由 `style` 层聚合为独立 CSS artifact），
//! 绑定、重导出与动态导入形态显式诊断拒绝。资源引用只重写
//! `new URL` 第一参数，保留 URL 构造外壳。
//!
//! Json 目标节点的边按 default 值绑定合成：被导入的 JSON 模块在 chunk 文本
//! 头部合成为 `const <local> = <原始 JSON 文本>;`——JSON 文本本身是合法 JS
//! 表达式，字节保真、不重新序列化、不改缩进（等价于合成模块
//! `export default <JSON>;` 的 default 绑定内联）。未被活跃语句引用的绑定
//! 不合成（与跨 chunk 绑定同口径）。具名/命名空间绑定、重导出与动态导入
//! 显式诊断拒绝——不透明值节点给不出其它导出形态。
//!
//! 行级 source map 合同：每个活跃语句切片的生成行在列 0 记一条回指段，
//! 映射链为 生成行起点 → 类型擦除删除表 → 切片内替换表 → 模块源行列，
//! 逐段复合（复用 `vmz_generator::js` 的擦除偏移映射，不平行重写）。
//! 合成行（跨 chunk import/export、JSON `const` 内联）无原文来源，不产段；
//! `imports_text` 定稿后按行数整体平移段号。

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use crate::chunk::Chunk;
use crate::diag::PackDiagnostic;
use crate::graph::{EdgeKind, ModuleNode, NodeKind};
use crate::link::{LinkedModule, UsedReexport};
use crate::module::{ExportFact, ImportKind, ImportedName};

use super::{EmitContext, PLACEHOLDER_PREFIX, json_string, normalize_path, placeholder};

/// 目标 chunk 的合并绑定（合成 import 语句的语法成分）。
#[derive(Default)]
struct Bindings {
    defaults: BTreeSet<String>,
    namespaces: BTreeSet<String>,
    named: BTreeSet<(String, String)>,
}

/// 待决议的本模块导出：`local` 需确认在 chunk 内可解析后才合成。
struct DeferredExport {
    local: String,
    exported: String,
    module: String,
    is_default: bool,
}

/// 装配产物：chunk 文本（含占位符）与行级映射段。
pub(crate) struct AssembledChunk {
    /// 第一遍装配文本（`imports_text + body + exports_text`）。
    pub(crate) code: String,
    /// 行级映射段，`gen_line` 为最终 chunk 文本内的 0-based 行号。
    pub(crate) segments: Vec<ChunkSegment>,
}

/// 一条生成行回指原模块位置的段（列恒 0，行级合同）。
pub(crate) struct ChunkSegment {
    pub(crate) gen_line: u32,
    /// 规范化模块路径，与 manifest `modules` 同口径。
    pub(crate) source: String,
    pub(crate) src_line: u32,
    pub(crate) src_col: u32,
}

pub(crate) fn assemble_chunk(
    context: &EmitContext<'_>,
    chunk_index: usize,
    errors: &mut Vec<PackDiagnostic>,
    warnings: &mut Vec<PackDiagnostic>,
) -> Option<AssembledChunk> {
    let chunk = &context.chunks.chunks[chunk_index];
    let errors_before = errors.len();

    let mut body = String::new();
    let mut segments: Vec<ChunkSegment> = Vec::new();
    let mut body_line: u32 = 0;
    let mut imports_text = String::new();
    let mut exports_text = String::new();
    // (a) 活跃声明名 / (b) 合成 import 绑定 local / (c) 对外导出名。
    let mut declared: Vec<(String, String)> = Vec::new();
    let mut import_locals: Vec<(String, usize, String)> = Vec::new();
    let mut same_chunk_locals: BTreeSet<String> = BTreeSet::new();
    let mut export_names: Vec<(String, String)> = Vec::new();
    let mut merged: BTreeMap<usize, Bindings> = BTreeMap::new();
    let mut side_effects: BTreeSet<usize> = BTreeSet::new();
    let mut deferred: Vec<DeferredExport> = Vec::new();
    // 导出事实去重：同 chunk 重导出链的落点与落点模块自身的 Local/Default
    // 事实是同一 chunk 绑定的同一导出名（`X as X` 即典型），跨 chunk 同形态
    // export-from 也按 (chunk, 目标导出名, 导出名) 合一；同一绑定同一名字只
    // 发一条导出，不同绑定同名仍由 `check_names` 判冲突。
    let mut emitted_bindings: HashSet<(String, String)> = HashSet::new();
    let mut emitted_reexports: HashSet<(usize, String, String)> = HashSet::new();
    // JSON 值节点：(节点, 绑定名) 去重（同 chunk 同名绑定共享一条 const），
    // 原始文本按节点缓存（读失败缓存 `None`，诊断不重复报）。
    let mut json_locals: BTreeSet<(usize, String)> = BTreeSet::new();
    let mut json_texts: HashMap<usize, Option<String>> = HashMap::new();

    for &node_index in &chunk.modules {
        let Some(node) = context.graph.nodes.get(node_index) else { continue };
        let Some(linked) = context.linked[node_index] else { continue };
        let Some(source) = context.sources.get(&node_index) else { continue };
        let module_path = normalize_path(&node.resolved.path);
        let record = &node.record;
        let source_lines = vmz_generator::js::SourceLines::new(source);

        // 存活动态边分类：一次判定，避免按语句重复诊断。
        let mut dynamic_replacements: Vec<(String, usize)> = Vec::new();
        for &edge_index in &linked.dynamic_edges {
            let Some(edge) = node.dynamic_edges.get(edge_index) else {
                errors.push(
                    inconsistent(format!("动态边下标 {edge_index} 越界"))
                        .with_path(module_path.clone()),
                );
                continue;
            };
            match edge.target.as_ref() {
                Err(_) if edge.specifier.is_empty() => {
                    // 非字面量动态 import：文本原样保留，只给非致命诊断。
                    let mut diagnostic = PackDiagnostic::new(
                        "vmz::pack::emit::dynamic_unresolved_kept",
                        "非字面量动态 import 说明符原样保留，产物层不保证运行时可解析",
                    )
                    .with_path(module_path.clone());
                    if let Some(import) = record.imports.iter().find(|import| {
                        import.kind == ImportKind::Dynamic && import.specifier.is_empty()
                    }) {
                        diagnostic = diagnostic.with_span(import.span);
                    }
                    warnings.push(diagnostic);
                }
                Err(_) if edge.specifier.starts_with('/') => {
                    // 根绝对 URL 动态 import（如运行时 face 加载 `/dom.browser.js`）：
                    // 文本原样保留，由站点 origin 运行时解析，与非字面量保留同构，
                    // 属非致命诊断。
                    let mut diagnostic = PackDiagnostic::new(
                        "vmz::pack::emit::dynamic_url_kept",
                        format!(
                            "根绝对 URL 动态 import `{}` 原样保留，由站点 origin 运行时解析",
                            edge.specifier
                        ),
                    )
                    .with_path(module_path.clone());
                    if let Some(import) = record.imports.iter().find(|import| {
                        import.kind == ImportKind::Dynamic && import.specifier == edge.specifier
                    }) {
                        diagnostic = diagnostic.with_span(import.span);
                    }
                    warnings.push(diagnostic);
                }
                Err(_) => errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::dynamic_unresolved",
                        format!(
                            "动态 import `{}` 目标未解析，无法重写为 chunk 文件",
                            edge.specifier
                        ),
                    )
                    .with_path(module_path.clone()),
                ),
                Ok(id) => {
                    let Some(target) = context.graph.index_of(id) else {
                        errors.push(
                            inconsistent(format!("动态 import 目标不在图中: `{}`", edge.specifier))
                                .with_path(module_path.clone()),
                        );
                        continue;
                    };
                    if context.graph.nodes[target].kind == NodeKind::Style {
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::dynamic_style_unsupported",
                                format!(
                                    "动态 import `{}` 目标是 CSS：样式只经宿主模块静态副作用边进入级联",
                                    edge.specifier
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                        continue;
                    }
                    if context.graph.nodes[target].kind == NodeKind::Json {
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::dynamic_json_unsupported",
                                format!(
                                    "动态 import `{}` 目标是 JSON：值节点只经宿主模块静态 default 导入合成绑定",
                                    edge.specifier
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                        continue;
                    }
                    let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                    else {
                        continue;
                    };
                    if target_chunk == chunk_index {
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::dynamic_same_chunk_unsupported",
                                format!(
                                    "动态 import `{}` 目标与源同 chunk，需要运行时命名空间合成，未实现",
                                    edge.specifier
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                        continue;
                    }
                    dynamic_replacements.push((edge.specifier.clone(), target_chunk));
                }
            }
        }

        // 语句切片 + 切片内替换 + 类型擦除。
        for &statement_index in &linked.active_statements {
            let Some(statement) = record.statements.get(statement_index) else {
                errors.push(
                    inconsistent(format!("语句下标 {statement_index} 越界"))
                        .with_path(module_path.clone()),
                );
                continue;
            };
            let Some(raw) = source.get(statement.span.0..statement.span.1) else {
                errors.push(
                    inconsistent(format!(
                        "语句 span {:?} 超出重读源码长度（源码与事实漂移）",
                        statement.span
                    ))
                    .with_path(module_path.clone())
                    .with_span(statement.span),
                );
                continue;
            };
            if raw.contains(PLACEHOLDER_PREFIX) {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::placeholder_collision",
                        "源文本包含产物占位符前缀，替换会有歧义",
                    )
                    .with_path(module_path.clone())
                    .with_span(statement.span),
                );
                continue;
            }
            for name in &statement.declared_names {
                declared.push((name.clone(), module_path.clone()));
            }
            let mut replacements: BTreeMap<(usize, usize), String> = BTreeMap::new();
            for (specifier, target_chunk) in &dynamic_replacements {
                for import in record.imports.iter().filter(|import| {
                    import.kind == ImportKind::Dynamic
                        && &import.specifier == specifier
                        && contains(statement.span, import.span)
                }) {
                    match import.specifier_span {
                        Some(span) if contains(statement.span, span) => {
                            replacements.insert(span, json_string(&placeholder(*target_chunk)));
                        }
                        Some(_) => errors.push(
                            inconsistent(format!(
                                "动态 import 说明符 span 不在语句内: `{specifier}`"
                            ))
                            .with_path(module_path.clone())
                            .with_span(statement.span),
                        ),
                        None => errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::dynamic_unresolved",
                                format!("动态 import `{specifier}` 缺少字面量 span，无法重写"),
                            )
                            .with_path(module_path.clone())
                            .with_span(import.span),
                        ),
                    }
                }
            }
            for asset in &record.assets {
                if !contains(statement.span, asset.span) {
                    continue;
                }
                // 资源读不到的已在 `collect_assets` 阶段整体拒绝；这里只消费。
                let key = (module_path.clone(), asset.specifier.clone());
                let Some(artifact) = context.asset_index.get(&key) else { continue };
                // URL 对象语义：只重写 `new URL` 的第一参数为指纹化相对
                // 路径，保留构造外壳；chunk 与资产同目录写出，运行时按
                // chunk 自身 URL 解析成立。整段替换成字符串是错误语义。
                let Some(specifier_span) = asset.specifier_span else {
                    errors.push(
                        PackDiagnostic::new(
                            "vmz::pack::emit::asset_unrewritable",
                            format!(
                                "资源 `{}` 字面量 span 缺失，无法重写 `new URL` 第一参数",
                                asset.specifier
                            ),
                        )
                        .with_path(module_path.clone())
                        .with_span(asset.span),
                    );
                    continue;
                };
                replacements
                    .insert(specifier_span, json_string(&format!("./{}", artifact.file_name)));
            }
            let replaced = match apply_replacements(raw, statement.span.0, &replacements) {
                Ok(text) => text,
                Err(diagnostic) => {
                    errors.push(diagnostic.with_path(module_path.clone()));
                    continue;
                }
            };
            let (erased, deletions) = match vmz_generator::js::erase_types_with_deletions(&replaced)
            {
                Ok(pair) => pair,
                Err(err) => {
                    errors.push(
                        PackDiagnostic::new(
                            "vmz::pack::emit::erase_failed",
                            format!("TypeScript 类型擦除失败: {err}"),
                        )
                        .with_path(module_path.clone())
                        .with_span(statement.span),
                    );
                    continue;
                }
            };
            // 擦除后为空（纯类型语句）跳过；非空补 `;` 防 ASI 粘连。
            if !erased.trim().is_empty() {
                // 行级映射：生成行起点 → 擦除删除表 → 切片替换表 → 模块行列。
                let mut line_off = 0usize;
                for (line_index, generated) in erased.split('\n').enumerate() {
                    let replaced_off = vmz_generator::js::map_erased_offset(line_off, &deletions);
                    let raw_off =
                        map_replaced_offset(replaced_off, raw, statement.span.0, &replacements);
                    let (src_line, src_col) = source_lines.line_col(statement.span.0 + raw_off);
                    segments.push(ChunkSegment {
                        gen_line: body_line + line_index as u32,
                        source: module_path.clone(),
                        src_line,
                        src_col,
                    });
                    line_off += generated.len() + 1;
                }
                body_line += erased.matches('\n').count() as u32 + 1;
                body.push_str(&erased);
                body.push_str(";\n");
            }
        }

        // export 事实：Local/Default 延后决议，重导出按链接层使用记录合成。
        for (export_index, export) in record.exports.iter().enumerate() {
            match export {
                ExportFact::Local { local, exported, type_only, .. } => {
                    if !*type_only {
                        deferred.push(DeferredExport {
                            local: local.clone(),
                            exported: exported.clone(),
                            module: module_path.clone(),
                            is_default: false,
                        });
                    }
                }
                ExportFact::Default { local, span } => match local {
                    Some(name) => deferred.push(DeferredExport {
                        local: name.clone(),
                        exported: "default".to_string(),
                        module: module_path.clone(),
                        is_default: true,
                    }),
                    None => {
                        // `export default <表达式>` 的文本在语句切片里自带，
                        // 切片活跃即占位一个 `default` 导出名。
                        let active = linked.active_statements.iter().any(|&index| {
                            record.statements.get(index).is_some_and(|item| item.span == *span)
                        });
                        if active {
                            export_names.push(("default".to_string(), module_path.clone()));
                        }
                    }
                },
                ExportFact::ReexportNamed { source, local, exported, type_only, .. } => {
                    if *type_only || !used_reexport(linked, export_index, is_named) {
                        continue;
                    }
                    let Some(target) = edge_target_node(
                        context,
                        node,
                        EdgeKind::ReexportNamed,
                        source,
                        &module_path,
                        errors,
                    ) else {
                        continue;
                    };
                    let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                    else {
                        continue;
                    };
                    if target_chunk == chunk_index {
                        // 同 chunk 具名重导出：目标导出名沿导出事实链解析为
                        // chunk 内绑定名，与 deferred Local 同一机制决议；
                        // 链离开本 chunk 时按跨 chunk 同形态发 export-from。
                        // 解析不到绑定事实（星号来源、表达式 default、成环）
                        // 显式拒绝，不做名字猜测。
                        match resolve_same_chunk_reexport(
                            context,
                            chunk_index,
                            target,
                            local,
                            &module_path,
                            errors,
                        ) {
                            Some(ReexportBinding::Declared(binding)) => {
                                deferred.push(DeferredExport {
                                    local: binding,
                                    exported: exported.clone(),
                                    module: module_path.clone(),
                                    is_default: false,
                                });
                            }
                            Some(ReexportBinding::External { chunk, name }) => {
                                if emitted_reexports.insert((chunk, name.clone(), exported.clone())) {
                                    let clause = if name == *exported {
                                        name
                                    } else {
                                        format!("{name} as {exported}")
                                    };
                                    exports_text.push_str(&format!(
                                        "export {{ {clause} }} from {};\n",
                                        json_string(&placeholder(chunk))
                                    ));
                                    export_names.push((exported.clone(), module_path.clone()));
                                }
                            }
                            None => {}
                        }
                        continue;
                    }
                    let clause = if local == exported {
                        local.clone()
                    } else {
                        format!("{local} as {exported}")
                    };
                    exports_text.push_str(&format!(
                        "export {{ {clause} }} from {};\n",
                        json_string(&placeholder(target_chunk))
                    ));
                    export_names.push((exported.clone(), module_path.clone()));
                }
                ExportFact::ReexportAll { source, .. } => {
                    if !used_reexport(linked, export_index, is_all) {
                        continue;
                    }
                    let Some(target) = edge_target_node(
                        context,
                        node,
                        EdgeKind::ReexportAll,
                        source,
                        &module_path,
                        errors,
                    ) else {
                        continue;
                    };
                    let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                    else {
                        continue;
                    };
                    if target_chunk == chunk_index {
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::namespace_synthesis_unsupported",
                                format!(
                                    "同 chunk `export * from '{source}'` 拼接后无法表达星号语义，未实现"
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                        continue;
                    }
                    exports_text.push_str(&format!(
                        "export * from {};\n",
                        json_string(&placeholder(target_chunk))
                    ));
                    // (c) 收集目标模块直接非类型导出名（不递归星号链）。
                    collect_direct_exports(context, target, &mut export_names);
                }
                ExportFact::ReexportNamespace { source, namespace, type_only, .. } => {
                    if *type_only || !used_reexport(linked, export_index, is_namespace) {
                        continue;
                    }
                    let Some(target) = edge_target_node(
                        context,
                        node,
                        EdgeKind::ReexportNamespace,
                        source,
                        &module_path,
                        errors,
                    ) else {
                        continue;
                    };
                    let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                    else {
                        continue;
                    };
                    if target_chunk == chunk_index {
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::namespace_synthesis_unsupported",
                                format!(
                                    "同 chunk `export * as {namespace} from '{source}'` 拼接后无法表达命名空间语义，未实现"
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                        continue;
                    }
                    exports_text.push_str(&format!(
                        "export * as {namespace} from {};\n",
                        json_string(&placeholder(target_chunk))
                    ));
                    export_names.push((namespace.clone(), module_path.clone()));
                }
            }
        }

        // import 事实：同 chunk 只接受具名同名绑定；跨 chunk 按使用过滤后合并。
        // used 集合 = 活跃语句引用名 ∪ 本模块待决议导出 local（`export {a as b}`
        // 消费的是 import 绑定，不体现在 referenced_names 里）。
        // referenced_names 是语法名字匹配（Oak 无 scope/reference 事实，与链接层
        // 同口径）：对 import 保留是保守超集，只会多留不会误剪；收紧到绑定级
        // 精确以补上游 Oak scope 事实为前提，不在本层堆名字匹配特例。
        let mut used_names: HashSet<&str> = HashSet::new();
        for &statement_index in &linked.active_statements {
            if let Some(statement) = record.statements.get(statement_index) {
                for name in &statement.referenced_names {
                    used_names.insert(name.as_str());
                }
            }
        }
        for item in &deferred {
            if item.module == module_path {
                used_names.insert(item.local.as_str());
            }
        }
        for import in &record.imports {
            if import.type_only {
                continue;
            }
            if import.kind == ImportKind::Static
                && !import.bindings.is_empty()
                && import.bindings.iter().all(|binding| binding.inline_type_only)
            {
                // 与 graph 层同口径：全内联 type 绑定的静态导入不建边。
                continue;
            }
            let edge_kind = match import.kind {
                ImportKind::Static => EdgeKind::Static,
                ImportKind::SideEffect => EdgeKind::SideEffect,
                ImportKind::Dynamic => continue,
            };
            let Some(edge) = node
                .static_edges
                .iter()
                .find(|edge| edge.kind == edge_kind && edge.specifier == import.specifier)
            else {
                errors.push(
                    inconsistent(format!("import `{}` 找不到对应静态边", import.specifier))
                        .with_path(module_path.clone())
                        .with_span(import.span),
                );
                continue;
            };
            let Ok(id) = edge.target.as_ref() else {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::edge_unresolved",
                        format!(
                            "静态导入 `{}` 目标未解析，无法拼接或合成 import",
                            import.specifier
                        ),
                    )
                    .with_path(module_path.clone())
                    .with_span(import.span),
                );
                continue;
            };
            let Some(target) = context.graph.index_of(id) else {
                errors.push(
                    inconsistent(format!("import `{}` 目标不在图中", import.specifier))
                        .with_path(module_path.clone()),
                );
                continue;
            };
            if context.graph.nodes[target].kind == NodeKind::Style {
                // CSS 导入语句的文本一律移除（不留空壳）：级联内容由
                // `style` 层聚合为独立 CSS artifact，副作用顺序即执行序。
                // 只有绑定形态需要显式拒绝——不透明节点给不出绑定。
                if import.bindings.iter().any(|binding| !binding.inline_type_only) {
                    errors.push(
                        PackDiagnostic::new(
                            "vmz::pack::emit::style_binding_unsupported",
                            format!(
                                "import `{}` 从 CSS 获取绑定：样式节点不透明，无导出绑定",
                                import.specifier
                            ),
                        )
                        .with_path(module_path.clone())
                        .with_span(import.span),
                    );
                }
                continue;
            }
            if context.graph.nodes[target].kind == NodeKind::Json {
                // JSON 值节点：default 绑定在 chunk 文本头部合成为
                // `const <local> = <原始 JSON 文本>;`（字节保真）；具名与
                // 命名空间绑定显式拒绝——不透明值节点给不出其它导出形态。
                for binding in &import.bindings {
                    if binding.inline_type_only {
                        continue;
                    }
                    match &binding.imported {
                        ImportedName::Default => {
                            // 未被活跃语句引用的绑定不合成（与跨 chunk 同口径）。
                            if !used_names.contains(binding.local.as_str()) {
                                continue;
                            }
                            if !json_locals.insert((target, binding.local.clone())) {
                                continue;
                            }
                            let Some(text) =
                                json_text(context, target, &mut json_texts, errors)
                            else {
                                continue;
                            };
                            let json_path =
                                normalize_path(&context.graph.nodes[target].resolved.path);
                            imports_text.push_str(&format!("const {} = {text};\n", binding.local));
                            declared.push((binding.local.clone(), json_path));
                        }
                        _ => errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::json_binding_unsupported",
                                format!(
                                    "import `{}` 从 JSON 获取非 default 绑定：值节点只支持 default 导入，未实现",
                                    import.specifier
                                ),
                            )
                            .with_path(module_path.clone())
                            .with_span(import.span),
                        ),
                    }
                }
                continue;
            }
            if !context.retained[target] {
                // 目标被链接层剪除：绑定必未被活跃语句引用，import 文本一并消失。
                continue;
            }
            let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors) else {
                continue;
            };
            match import.kind {
                ImportKind::Static => {
                    if target_chunk == chunk_index {
                        for binding in &import.bindings {
                            if binding.inline_type_only {
                                continue;
                            }
                            match &binding.imported {
                                ImportedName::Name(name) if name == &binding.local => {
                                    same_chunk_locals.insert(binding.local.clone());
                                }
                                _ => errors.push(
                                    PackDiagnostic::new(
                                        "vmz::pack::emit::binding_rename_unsupported",
                                        format!(
                                            "同 chunk import 绑定 `{}` 需要 scope 重写，未实现",
                                            binding.local
                                        ),
                                    )
                                    .with_path(module_path.clone())
                                    .with_span(import.span),
                                ),
                            }
                        }
                    } else {
                        let bindings = merged.entry(target_chunk).or_default();
                        for binding in &import.bindings {
                            if binding.inline_type_only {
                                continue;
                            }
                            // 未被引用的绑定不合成：目标 chunk 可能已剪除该声明，
                            // 合成会产出引用不存在导出的错误 JS。
                            if !used_names.contains(binding.local.as_str()) {
                                continue;
                            }
                            match &binding.imported {
                                ImportedName::Default => {
                                    bindings.defaults.insert(binding.local.clone());
                                }
                                ImportedName::Namespace => {
                                    bindings.namespaces.insert(binding.local.clone());
                                    warnings.push(
                                        PackDiagnostic::new(
                                            "vmz::pack::emit::namespace_widened",
                                            format!(
                                                "命名空间绑定 `{}` 指向 chunk `{}`，实际拿到整个 chunk 的命名空间（比源模块宽）",
                                                binding.local,
                                                context.chunks.chunks[target_chunk].id
                                            ),
                                        )
                                        .with_path(module_path.clone())
                                        .with_span(import.span),
                                    );
                                }
                                ImportedName::Name(name) => {
                                    bindings.named.insert((name.clone(), binding.local.clone()));
                                }
                            }
                            import_locals.push((
                                binding.local.clone(),
                                target_chunk,
                                module_path.clone(),
                            ));
                        }
                    }
                }
                ImportKind::SideEffect => {
                    if target_chunk != chunk_index {
                        side_effects.insert(target_chunk);
                    }
                }
                ImportKind::Dynamic => unreachable!("动态导入已在上面 continue"),
            }
        }
    }

    // 合成 import：按目标 chunk 升序保证确定性；首个 default 与具名合并一条，
    // 多余 default 与命名空间各自成条（ESM 语法不允许 default 与 `* as` 同条）。
    for (target_chunk, bindings) in &merged {
        let quoted = json_string(&placeholder(*target_chunk));
        let named_clause = if bindings.named.is_empty() {
            String::new()
        } else {
            let parts: Vec<String> = bindings
                .named
                .iter()
                .map(
                    |(name, local)| {
                        if name == local { name.clone() } else { format!("{name} as {local}") }
                    },
                )
                .collect();
            format!("{{ {} }}", parts.join(", "))
        };
        let mut defaults = bindings.defaults.iter();
        match defaults.next() {
            Some(first) if !named_clause.is_empty() => {
                imports_text.push_str(&format!("import {first}, {named_clause} from {quoted};\n"));
            }
            Some(first) => {
                imports_text.push_str(&format!("import {first} from {quoted};\n"));
            }
            None => {
                if !named_clause.is_empty() {
                    imports_text.push_str(&format!("import {named_clause} from {quoted};\n"));
                }
            }
        }
        for extra in defaults {
            imports_text.push_str(&format!("import {extra} from {quoted};\n"));
        }
        for namespace in &bindings.namespaces {
            imports_text.push_str(&format!("import * as {namespace} from {quoted};\n"));
        }
    }
    for target_chunk in &side_effects {
        imports_text.push_str(&format!("import {};\n", json_string(&placeholder(*target_chunk))));
    }

    // 决议延后的 Local/Default 导出：local 必须在 chunk 内可解析
    // （活跃声明、同 chunk 接受绑定或已合成 import 绑定），否则说明
    // 声明已被链接层剪除，导出随之消失（未用纯导出剪枝语义）。
    let resolvable: HashSet<&str> = declared
        .iter()
        .map(|(name, _)| name.as_str())
        .chain(same_chunk_locals.iter().map(String::as_str))
        .chain(import_locals.iter().map(|(local, _, _)| local.as_str()))
        .collect();
    for item in &deferred {
        if !resolvable.contains(item.local.as_str()) {
            continue;
        }
        let key = (
            item.local.clone(),
            if item.is_default { "default".to_string() } else { item.exported.clone() },
        );
        if !emitted_bindings.insert(key) {
            continue;
        }
        if item.is_default {
            exports_text.push_str(&format!("export {{ {} as default }};\n", item.local));
            export_names.push(("default".to_string(), item.module.clone()));
        } else {
            if item.local == item.exported {
                exports_text.push_str(&format!("export {{ {} }};\n", item.local));
            } else {
                exports_text
                    .push_str(&format!("export {{ {} as {} }};\n", item.local, item.exported));
            }
            export_names.push((item.exported.clone(), item.module.clone()));
        }
    }

    check_names(chunk, &declared, &import_locals, &export_names, errors);

    if errors.len() > errors_before {
        return None;
    }
    // `imports_text` 定稿：body 段号整体平移合成 import 行数。
    let shift = imports_text.matches('\n').count() as u32;
    for segment in &mut segments {
        segment.gen_line += shift;
    }
    Some(AssembledChunk { code: format!("{imports_text}{body}{exports_text}"), segments })
}

/// 替换文本偏移 → 切片原文偏移：落在替换新文本内取替换起点，
/// 否则扣除此前替换的长度增量；结果夹到切片长度。
fn map_replaced_offset(
    replaced_off: usize,
    raw: &str,
    base: usize,
    replacements: &BTreeMap<(usize, usize), String>,
) -> usize {
    let mut pos = 0usize; // 当前原文段在替换文本中的起点。
    let mut raw_pos = 0usize; // 当前原文段在切片中的起点。
    for ((start, end), text) in replacements {
        let (rel_start, rel_end) = (start - base, end - base);
        let gap = rel_start - raw_pos;
        if replaced_off < pos + gap {
            return (raw_pos + (replaced_off - pos)).min(raw.len());
        }
        pos += gap;
        if replaced_off < pos + text.len() {
            return rel_start;
        }
        pos += text.len();
        raw_pos = rel_end;
    }
    (raw_pos + replaced_off.saturating_sub(pos)).min(raw.len())
}

/// (a) 声明名 + (b) import 绑定两两不相交（同模块内重复忽略——源本身非法），
/// (b) 同名绑定必须指向同一目标 chunk，(c) 对外导出名不得重复。
fn check_names(
    chunk: &Chunk,
    declared: &[(String, String)],
    import_locals: &[(String, usize, String)],
    export_names: &[(String, String)],
    errors: &mut Vec<PackDiagnostic>,
) {
    let conflict = |name: &str, first: &str, second: &str| {
        PackDiagnostic::new(
            "vmz::pack::emit::name_conflict",
            format!("chunk `{}` 内名字 `{name}` 冲突: `{first}` 与 `{second}`", chunk.id),
        )
    };
    let mut decl_modules: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (name, module) in declared {
        decl_modules.entry(name).or_default().insert(module);
    }
    for (name, modules) in &decl_modules {
        if modules.len() > 1 {
            let list: Vec<&&str> = modules.iter().collect();
            errors.push(conflict(name, list[0], list[1]));
        }
    }
    let mut binding_origins: BTreeMap<&str, BTreeSet<(usize, &str)>> = BTreeMap::new();
    for (local, target, module) in import_locals {
        binding_origins.entry(local).or_default().insert((*target, module));
    }
    for (local, origins) in &binding_origins {
        let targets: BTreeSet<usize> = origins.iter().map(|(target, _)| *target).collect();
        if targets.len() > 1 {
            let list: Vec<&str> = origins.iter().map(|(_, module)| *module).collect();
            errors.push(conflict(local, list[0], list[1]));
            continue;
        }
        if let Some(modules) = decl_modules.get(local) {
            let binding_modules: BTreeSet<&str> =
                origins.iter().map(|(_, module)| *module).collect();
            if let Some(other) = modules.iter().find(|module| !binding_modules.contains(*module)) {
                errors.push(conflict(local, other, binding_modules.iter().next().unwrap()));
            }
        }
    }
    let mut export_modules: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (name, module) in export_names {
        export_modules.entry(name).or_default().insert(module);
    }
    for (name, modules) in &export_modules {
        if modules.len() > 1 {
            let list: Vec<&&str> = modules.iter().collect();
            errors.push(conflict(name, list[0], list[1]));
        }
    }
}

/// 切片内替换：按起点升序应用，区间不得重叠或越出切片。
pub(crate) fn apply_replacements(
    raw: &str,
    base: usize,
    replacements: &BTreeMap<(usize, usize), String>,
) -> Result<String, PackDiagnostic> {
    let mut out = String::with_capacity(raw.len());
    let mut cursor = 0usize; // 相对切片偏移。
    for ((start, end), text) in replacements {
        let (start, end) = (start - base, end - base);
        if start < cursor || end > raw.len() {
            return Err(inconsistent(format!(
                "替换区间 ({start}, {end}) 与切片 [0, {}) 冲突",
                raw.len()
            )));
        }
        if !raw.is_char_boundary(start) || !raw.is_char_boundary(end) {
            return Err(inconsistent("替换区间边界不在 UTF-8 char 边界上".to_string()));
        }
        out.push_str(&raw[cursor..start]);
        out.push_str(&text);
        cursor = end;
    }
    out.push_str(&raw[cursor..]);
    Ok(out)
}

/// 静态边（含重导出边）目标 → 图节点索引；边缺失/未解析/不在图都显式拒绝。
fn edge_target_node(
    context: &EmitContext<'_>,
    node: &ModuleNode,
    kind: EdgeKind,
    specifier: &str,
    module_path: &str,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<usize> {
    let Some(edge) =
        node.static_edges.iter().find(|edge| edge.kind == kind && edge.specifier == specifier)
    else {
        errors.push(
            inconsistent(format!("重导出 `{specifier}` 找不到对应边"))
                .with_path(module_path.to_string()),
        );
        return None;
    };
    let Ok(id) = edge.target.as_ref() else {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::edge_unresolved",
                format!("重导出 `{specifier}` 目标未解析，无法合成 export-from"),
            )
            .with_path(module_path.to_string()),
        );
        return None;
    };
    match context.graph.index_of(id) {
        Some(target) if context.graph.nodes[target].kind == NodeKind::Style => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::style_reexport_unsupported",
                    format!("重导出 `{specifier}` 目标是 CSS：样式节点不透明，无法导出绑定"),
                )
                .with_path(module_path.to_string()),
            );
            None
        }
        Some(target) if context.graph.nodes[target].kind == NodeKind::Json => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::json_reexport_unsupported",
                    format!(
                        "重导出 `{specifier}` 目标是 JSON：值节点只提供 default 绑定，无法重导出具名"
                    ),
                )
                .with_path(module_path.to_string()),
            );
            None
        }
        Some(target) => Some(target),
        None => {
            errors.push(
                inconsistent(format!("重导出 `{specifier}` 目标不在图中"))
                    .with_path(module_path.to_string()),
            );
            None
        }
    }
}

/// 同 chunk 具名重导出的事实解析结果。
enum ReexportBinding {
    /// 目标导出名解析为 chunk 内绑定名：交给 deferred Local 机制发
    /// `export { <绑定名> [as <导出名>] };`。
    Declared(String),
    /// 来源链离开本 chunk：与跨 chunk 分支同形态发
    /// `export { <目标导出名> [as <导出名>] } from <占位符>;`。
    External { chunk: usize, name: String },
}

/// 同 chunk 具名重导出 → 绑定事实：从目标模块的导出事实逐跳解析
/// （`Local` 与具名 `Default` 落在 chunk 内绑定名；`ReexportNamed` 沿边
/// 继续走，跨 chunk 即停）。只有星号来源、表达式 default、来源链成环
/// 解析不出绑定，显式拒绝。
fn resolve_same_chunk_reexport(
    context: &EmitContext<'_>,
    chunk_index: usize,
    target: usize,
    name: &str,
    module_path: &str,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<ReexportBinding> {
    let unsupported = |message: String| {
        PackDiagnostic::new("vmz::pack::emit::reexport_rename_unsupported", message)
            .with_path(module_path.to_string())
    };
    let mut visited: BTreeSet<usize> = BTreeSet::new();
    let mut node = target;
    let mut name = name.to_string();
    loop {
        if !visited.insert(node) {
            errors.push(unsupported(format!(
                "同 chunk 重导出 `{name}` 的来源链成环，无绑定事实可解析，未实现"
            )));
            return None;
        }
        let record = &context.graph.nodes[node].record;
        let mut next: Option<(usize, String)> = None;
        for export in &record.exports {
            match export {
                ExportFact::Local { local, exported, type_only, .. } => {
                    if !type_only && exported == &name {
                        return Some(ReexportBinding::Declared(local.clone()));
                    }
                }
                ExportFact::Default { local, .. } => {
                    if name != "default" {
                        continue;
                    }
                    match local {
                        Some(binding) => {
                            return Some(ReexportBinding::Declared(binding.clone()));
                        }
                        None => {
                            errors.push(unsupported(
                                "同 chunk 重导出 `default`：`export default <表达式>` 无绑定名可引用，未实现"
                                    .to_string(),
                            ));
                            return None;
                        }
                    }
                }
                ExportFact::ReexportNamed { source, local, exported, type_only, .. } => {
                    if *type_only || exported != &name {
                        continue;
                    }
                    let Some(step) = edge_target_node(
                        context,
                        &context.graph.nodes[node],
                        EdgeKind::ReexportNamed,
                        source,
                        module_path,
                        errors,
                    ) else {
                        return None;
                    };
                    let Some(step_chunk) = chunk_of_node(context, step, module_path, errors) else {
                        return None;
                    };
                    if step_chunk == chunk_index {
                        next = Some((step, local.clone()));
                        break;
                    }
                    return Some(ReexportBinding::External { chunk: step_chunk, name: local.clone() });
                }
                _ => {}
            }
        }
        if let Some((step, step_name)) = next {
            node = step;
            name = step_name;
            continue;
        }
        errors.push(unsupported(format!(
            "同 chunk 重导出 `{name}` 在目标模块 `{}` 的具名导出事实中解析不到绑定（星号来源不展开），未实现",
            normalize_path(&context.graph.nodes[node].resolved.path)
        )));
        return None;
    }
}

/// 节点 → 所属 chunk 索引；未保留/未分包显式拒绝（调用方已保证保留的
/// 静态导入路径不会走到拒绝分支）。
fn chunk_of_node(
    context: &EmitContext<'_>,
    node: usize,
    module_path: &str,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<usize> {
    if !context.retained[node] {
        errors.push(
            inconsistent(format!(
                "目标 `{}` 未被链接层保留",
                normalize_path(&context.graph.nodes[node].resolved.path)
            ))
            .with_path(module_path.to_string()),
        );
        return None;
    }
    match context.node_chunk[node] {
        Some(chunk_index) => Some(chunk_index),
        None => {
            errors.push(
                inconsistent(format!(
                    "目标 `{}` 未被分包",
                    normalize_path(&context.graph.nodes[node].resolved.path)
                ))
                .with_path(module_path.to_string()),
            );
            None
        }
    }
}

/// 读取 JSON 值节点的原始文本：按 chunk 装配缓存，读失败显式拒绝
/// （`vmz::pack::emit::read_failed`，与模块/样式重读同口径），失败缓存
/// `None` 不重复报诊断。
fn json_text(
    context: &EmitContext<'_>,
    node: usize,
    cache: &mut HashMap<usize, Option<String>>,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<String> {
    if let Some(cached) = cache.get(&node) {
        return cached.clone();
    }
    let path = &context.graph.nodes[node].resolved.path;
    let path_display = normalize_path(path);
    let built = match std::fs::read_to_string(path) {
        Ok(text) => Some(text),
        Err(err) => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::read_failed",
                    format!("cannot re-read json module file: {err}"),
                )
                .with_path(path_display),
            );
            None
        }
    };
    cache.insert(node, built.clone());
    built
}

/// 目标模块的直接非类型导出名（`export *` 的 (c) 收集口径，不递归星号链）。
fn collect_direct_exports(
    context: &EmitContext<'_>,
    target: usize,
    export_names: &mut Vec<(String, String)>,
) {
    let node = &context.graph.nodes[target];
    let module_path = normalize_path(&node.resolved.path);
    for export in &node.record.exports {
        match export {
            ExportFact::Local { exported, type_only, .. } => {
                if !type_only {
                    export_names.push((exported.clone(), module_path.clone()));
                }
            }
            ExportFact::Default { .. } => {
                export_names.push(("default".to_string(), module_path.clone()));
            }
            ExportFact::ReexportNamed { exported, type_only, .. } => {
                if !type_only {
                    export_names.push((exported.clone(), module_path.clone()));
                }
            }
            ExportFact::ReexportNamespace { namespace, type_only, .. } => {
                if !type_only {
                    export_names.push((namespace.clone(), module_path.clone()));
                }
            }
            ExportFact::ReexportAll { .. } => {}
        }
    }
}

/// 该重导出事实是否被链接层记录为使用（决定 export-from 是否合成）。
fn used_reexport(
    linked: &LinkedModule,
    export_index: usize,
    kind_matches: impl Fn(&UsedReexport) -> bool,
) -> bool {
    linked.used_reexports.iter().any(|used| {
        kind_matches(used)
            && match used {
                UsedReexport::Named { export_index: index, .. }
                | UsedReexport::All { export_index: index, .. }
                | UsedReexport::Namespace { export_index: index, .. } => *index == export_index,
            }
    })
}

fn contains(outer: (usize, usize), inner: (usize, usize)) -> bool {
    outer.0 <= inner.0 && inner.1 <= outer.1
}

fn is_named(used: &UsedReexport) -> bool {
    matches!(used, UsedReexport::Named { .. })
}

fn is_all(used: &UsedReexport) -> bool {
    matches!(used, UsedReexport::All { .. })
}

fn is_namespace(used: &UsedReexport) -> bool {
    matches!(used, UsedReexport::Namespace { .. })
}

fn inconsistent(message: String) -> PackDiagnostic {
    PackDiagnostic::new("vmz::pack::emit::input_inconsistent", message)
}
