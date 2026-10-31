//! 单 chunk 文本装配：活跃语句切片 → 切片内替换（动态占位符与资源 URL）→
//! 类型擦除 → 合成跨 chunk import/export → 名字唯一性检查。
//!
//! 拼接语义的前提：同 chunk 模块直接文本拼接，绑定必须原同名可达；
//! import 绑定的使用判定：scope 事实完整可信时按引用 span 落点精确判定
//! （used 当且仅当至少一个值引用落在活跃语句或 export 子句内；未使用的
//! 绑定不合成、不重写、不登记），`scope_incomplete`、无绑定事实、类型位置
//! 引用或引用 span 漂移时回退语法名字匹配 ∪ export 子句名字消费（保守
//! 超集，只多留不误剪）。
//! 同 chunk 静态 import 绑定沿目标模块导出事实链解析落点绑定名：落点与
//! 消费者本地名不一致时对消费者做 scope 重写——其绑定的值引用 span 改写
//! 为落点名，守卫全部成立才执行（上游 `scope_incomplete` 未置位、绑定无
//! 类型位置引用、落点名按词边界不出现在消费者文本、引用 span 切片回原文
//! 且落点可判定），任一失败维持 `binding_rename_unsupported` 显式拒绝；
//! 事实链离开本 chunk 的按跨 chunk 形态合成 import；同 chunk 命名空间
//! 绑定合成 `import * as <local> from <本 chunk 自身产物>`（真实 Module
//! Namespace，名字集按 chunk 加宽，与既有加宽合同同构）。
//! 同 chunk `declared × declared` 冲突中，未被任何非类型导出事实消费的
//! 声明改名 `{name}__vmz{node_index}`（声明 token 与活跃值引用一并改写，
//! chunk 对外名字集不变）；守卫任一不成立不改名，冲突维持 `name_conflict`
//! 显式拒绝。
//! 同 chunk 具名重导出沿目标模块的导出事实解析为 chunk 内绑定名，与
//! deferred Local 导出同一机制发 `export { <绑定名> [as <导出名>] };`，
//! 事实链离开本 chunk 时与跨 chunk 分支同形态发 `export { … } from`；
//! 同 chunk `export *` 枚举目标模块直接非类型具名导出（不递归星号链、
//! `default` 不随星号传播），逐个沿同一事实链机制展开为具名导出；
//! 解析不到绑定事实的形态（具名解析落在星号来源、具名来自表达式
//! default、来源链成环、星号来源自身含活跃星号链）显式诊断拒绝，
//! 不产出猜测文本。
//! `export * as ns` 与同 chunk 动态边界改写为对本 chunk 自身产物文件的
//! 引用（第三遍占位符替换同样成立）：命名空间是原生 ESM 的真实
//! Module Namespace，名字集按 chunk 粒度加宽，发非致命诊断
//! `namespace_widened` / `dynamic_same_chunk_widened`，与跨 chunk 命名空间
//! 与动态边界的既有加宽合同同构，不合成 getter 伪命名空间。跨 chunk 引用在第一遍只写占位符（chunk 间可成环，
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
use crate::module::{ExportFact, ImportKind, ImportedName, ModuleRecord};

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

    // 同 chunk 声明改名预决议：必须先于逐模块处理——fresh 名的碰撞扫描
    // 覆盖 chunk 全部活跃语句文本，改名 span 与消费者 scope 重写共用同一
    // 替换表注入切片。守卫不成立的冲突维持由 `check_names` 显式拒绝。
    let declaration_renames = plan_declaration_renames(context, chunk_index);

    for &node_index in &chunk.modules {
        let Some(node) = context.graph.nodes.get(node_index) else { continue };
        let Some(linked) = context.linked[node_index] else { continue };
        let Some(source) = context.sources.get(&node_index) else { continue };
        let module_path = normalize_path(&node.resolved.path);
        let record = &node.record;
        let source_lines = vmz_generator::js::SourceLines::new(source);

        // 绑定使用判定输入：活跃语句 span、export 子句 span 与语法名字
        // 回退集。回退集是保守超集（含属性名与遮蔽标识符），只在 scope
        // 事实不可信时使用；scope 完整时按引用 span 落点精确判定。
        let active_spans: Vec<(usize, usize)> = linked
            .active_statements
            .iter()
            .filter_map(|&index| record.statements.get(index).map(|statement| statement.span))
            .collect();
        let export_spans: Vec<(usize, usize)> =
            record.exports.iter().map(export_fact_span).collect();
        let mut referenced_in_active: HashSet<&str> = HashSet::new();
        for &statement_index in &linked.active_statements {
            if let Some(statement) = record.statements.get(statement_index) {
                for name in &statement.referenced_names {
                    referenced_in_active.insert(name.as_str());
                }
            }
        }

        // 同 chunk 静态 import 绑定预决议：必须先于语句切片——scope 重写的
        // 引用 span 要进入切片替换表，映射链（生成行→擦除→替换→源）随之成立。
        let (mut renames, binding_decisions) = plan_same_chunk_bindings(
            context,
            chunk_index,
            node,
            record,
            source,
            &active_spans,
            &export_spans,
            &referenced_in_active,
            &module_path,
            &mut merged,
            &mut same_chunk_locals,
            &mut import_locals,
            warnings,
            errors,
        );
        // 声明改名并入同一重写表：import local 与声明名在同模块内不相交
        // （重复绑定即 scope_incomplete，两侧守卫都已拒绝），切片注入、
        // `renamed_local` 与 deferred 导出统一消费。
        if let Some(declared_renames) = declaration_renames.get(&node_index) {
            for (name, rewrite) in declared_renames {
                renames.insert(name.clone(), rewrite.clone());
            }
        }

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
                        // 同 chunk 动态边界：说明符改写为本 chunk 自身产物文件
                        // （自引用）。原生 ESM 返回已实例化模块的真实命名空间，
                        // 名字集加宽到整个 chunk——与跨 chunk 动态边界（同样按
                        // chunk 粒度取命名空间）同一合同，不合成 getter 伪命名空间。
                        warnings.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::dynamic_same_chunk_widened",
                                format!(
                                    "动态 import `{}` 目标与源同 chunk，改写为 chunk 自身文件，命名空间加宽到整个 chunk",
                                    edge.specifier
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
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
                declared.push((renamed_local(&renames, name), module_path.clone()));
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
            // scope 重写：消费者绑定名在其值引用 span 上改写为 chunk 绑定名。
            for rewrite in renames.values() {
                for span in &rewrite.spans {
                    if !contains(statement.span, *span) {
                        continue;
                    }
                    if replacements.contains_key(span) {
                        errors.push(
                            inconsistent(format!("绑定重写 span {span:?} 与切片内既有替换区间冲突"))
                                .with_path(module_path.clone())
                                .with_span(statement.span),
                        );
                        continue;
                    }
                    replacements.insert(*span, rewrite.new_name.clone());
                }
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
                            local: renamed_local(&renames, local),
                            exported: exported.clone(),
                            module: module_path.clone(),
                            is_default: false,
                        });
                    }
                }
                ExportFact::Default { local, span } => match local {
                    Some(name) => deferred.push(DeferredExport {
                        local: renamed_local(&renames, name),
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
                            "vmz::pack::emit::reexport_rename_unsupported",
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
                        // 同 chunk 星号重导出：枚举目标模块直接非类型导出
                        // （不递归星号链），逐个沿具名重导出同一事实链机制
                        // 解析为 chunk 内绑定名，与 deferred Local 同一口径
                        // 发 `export {local [as exported]}`；`default` 按 ESM
                        // 星号语义不随 `export *` 传播，不参与展开。目标模块
                        // 自身含活跃星号重导出喂入不可枚举名字时保持显式拒绝。
                        if target_has_active_star(context, target, &module_path, errors) {
                            continue;
                        }
                        let mut star_names: Vec<(String, String)> = Vec::new();
                        collect_direct_exports(context, target, &mut star_names);
                        for (exported, _) in star_names {
                            if exported == "default" {
                                continue;
                            }
                            match resolve_same_chunk_reexport(
                                context,
                                chunk_index,
                                target,
                                &exported,
                                &module_path,
                                "vmz::pack::emit::reexport_rename_unsupported",
                                errors,
                            ) {
                                Some(ReexportBinding::Declared(binding)) => {
                                    deferred.push(DeferredExport {
                                        local: binding,
                                        exported,
                                        module: module_path.clone(),
                                        is_default: false,
                                    });
                                }
                                Some(ReexportBinding::External { chunk, name }) => {
                                    if emitted_reexports
                                        .insert((chunk, name.clone(), exported.clone()))
                                    {
                                        let clause = if name == exported {
                                            name
                                        } else {
                                            format!("{name} as {exported}")
                                        };
                                        exports_text.push_str(&format!(
                                            "export {{ {clause} }} from {};\n",
                                            json_string(&placeholder(chunk))
                                        ));
                                        export_names.push((exported, module_path.clone()));
                                    }
                                }
                                None => {}
                            }
                        }
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
                        // 同 chunk `export * as ns`：发对本 chunk 自身产物文件的
                        // 自引用。命名空间是真实 Module Namespace（原生 ESM 自
                        // 引用），名字集含整个 chunk 的全部导出——与跨 chunk
                        // `namespace_widened` 同一加宽合同；星号链与跨 chunk 重
                        // 导出的名字沿 chunk 导出面自然流入，无需枚举合成。
                        warnings.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::namespace_widened",
                                format!(
                                    "同 chunk `export * as {namespace}` 改写为 chunk 自身文件，实际拿到整个 chunk 的命名空间（比源模块宽）"
                                ),
                            )
                            .with_path(module_path.clone()),
                        );
                    }
                    exports_text.push_str(&format!(
                        "export * as {namespace} from {};\n",
                        json_string(&placeholder(target_chunk))
                    ));
                    export_names.push((namespace.clone(), module_path.clone()));
                }
            }
        }

        // import 事实：同 chunk 绑定已由预决议消费（同名可达/scope 重写/
        // 自引用命名空间/显式拒绝/未使用跳过），仅事实链离开本 chunk 的按
        // 目标 chunk 合成；跨 chunk 按使用过滤后合并。使用判定见
        // [`binding_is_used`]：scope 事实完整可信时按引用 span 落点精确判定
        // （未使用绑定不合成——引用只可能出现在被剪除语句里），否则回退
        // 语法名字匹配 ∪ export 子句名字消费（保守超集，只会多留不会误剪）。
        for (import_index, import) in record.imports.iter().enumerate() {
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
                            // 未被发射文本消费的绑定不合成（与跨 chunk 同口径）。
                            if !binding_is_used(
                                record,
                                source,
                                binding.local.as_str(),
                                &active_spans,
                                &export_spans,
                                &referenced_in_active,
                            ) {
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
                    for (binding_index, binding) in import.bindings.iter().enumerate() {
                        if binding.inline_type_only {
                            continue;
                        }
                        // 同 chunk 绑定：预决议消费后仅剩事实链离开本 chunk 的
                        // 绑定，按其所在 chunk 合成（跨 chunk 形态），落点导出
                        // 名沿事实链取（`external_name`）。
                        let (synth_chunk, external_name) = if target_chunk == chunk_index {
                            match binding_decisions.get(&(import_index, binding_index)) {
                                Some(BindingDecision::External { chunk, name }) => {
                                    (*chunk, Some(name.clone()))
                                }
                                _ => continue,
                            }
                        } else {
                            (target_chunk, None)
                        };
                        let bindings = merged.entry(synth_chunk).or_default();
                        // 未被引用的绑定不合成：目标 chunk 可能已剪除该声明，
                        // 合成会产出引用不存在导出的错误 JS。
                        if !binding_is_used(
                            record,
                            source,
                            binding.local.as_str(),
                            &active_spans,
                            &export_spans,
                            &referenced_in_active,
                        ) {
                            continue;
                        }
                        match &binding.imported {
                            ImportedName::Default => match external_name {
                                // 事实链落点是其它 chunk 的具名导出（同 chunk
                                // barrel 以 `export { q as default } from` 喂入）：
                                // 按具名导入合成，不是目标 chunk 的 default。
                                Some(name) => {
                                    bindings.named.insert((name, binding.local.clone()));
                                }
                                None => {
                                    bindings.defaults.insert(binding.local.clone());
                                }
                            },
                            ImportedName::Namespace => {
                                bindings.namespaces.insert(binding.local.clone());
                                warnings.push(
                                    PackDiagnostic::new(
                                        "vmz::pack::emit::namespace_widened",
                                        format!(
                                            "命名空间绑定 `{}` 指向 chunk `{}`，实际拿到整个 chunk 的命名空间（比源模块宽）",
                                            binding.local,
                                            context.chunks.chunks[synth_chunk].id
                                        ),
                                    )
                                    .with_path(module_path.clone())
                                    .with_span(import.span),
                                );
                            }
                            ImportedName::Name(name) => {
                                bindings.named.insert((
                                    external_name.unwrap_or_else(|| name.clone()),
                                    binding.local.clone(),
                                ));
                            }
                        }
                        import_locals.push((
                            binding.local.clone(),
                            synth_chunk,
                            module_path.clone(),
                        ));
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

/// scope 重写计划：消费者绑定旧名在其值引用 span 上改写为 chunk 落点名，
/// 或同 chunk 声明改名时声明 token 与其值引用 span 改写为 fresh 名。
#[derive(Clone)]
struct BindingRewrite {
    new_name: String,
    /// 落在活跃语句内的值引用 span（import/export 子句内的不发射，不入表；
    /// 声明改名时另含声明 token 自身）。
    spans: Vec<(usize, usize)>,
}

/// 同 chunk 静态 import 绑定的预决议结果。
enum BindingDecision {
    /// 已由预决议消费：同名可达、scope 重写、自引用命名空间，或显式拒绝
    /// 诊断已给出。主 import 循环不再为该绑定合成任何文本。
    Handled,
    /// 事实链离开本 chunk：按 `chunk` 合成跨 chunk import，落点导出名为
    /// `name`（沿导出事实链解析，可能与消费者声明的来源名不同）。
    External { chunk: usize, name: String },
}

/// 改名后的本地名：命中 scope 重写计划时取落点名，否则原样。
fn renamed_local(renames: &BTreeMap<String, BindingRewrite>, name: &str) -> String {
    match renames.get(name) {
        Some(rewrite) => rewrite.new_name.clone(),
        None => name.to_string(),
    }
}

/// 词边界出现检查：标识符字节为 ASCII 字母数字、`_`、`$` 与非 ASCII 字节
/// （保守口径：字符串、注释里的出现同样命中，只会多拒绝不会漏）。
fn contains_identifier(haystack: &str, needle: &str) -> bool {
    if needle.is_empty() {
        return false;
    }
    let bytes = haystack.as_bytes();
    let pattern = needle.as_bytes();
    let is_ident_byte =
        |b: u8| b.is_ascii_alphanumeric() || b == b'_' || b == b'$' || b >= 0x80;
    let mut from = 0usize;
    while from < bytes.len() {
        let Some(offset) = bytes[from..].windows(pattern.len()).position(|w| w == pattern) else {
            return false;
        };
        let start = from + offset;
        let end = start + pattern.len();
        let left_ok = start == 0 || !is_ident_byte(bytes[start - 1]);
        let right_ok = end == bytes.len() || !is_ident_byte(bytes[end]);
        if left_ok && right_ok {
            return true;
        }
        from = start + 1;
    }
    false
}

/// 精确判定绑定是否被发射文本消费（仅在 scope 事实可信时有结论）：
/// 绑定 used 当且仅当其至少一个值引用 span 落在活跃语句内（引用随切片
/// 发射）或落在 export 子句内（deferred 导出机制消费绑定）。返回 `None`
/// 表示无法精确判定，调用方必须回退语法名字匹配（保守超集）：
/// - `scope_incomplete` 置位：引用清单可能漏引用；
/// - 绑定无 scope 事实：引用清单给不全；
/// - `has_type_references`：类型位置不记 span，而 `extends Foo` 是运行时
///   值使用却被上游记为类型引用，按 span 清单剪枝会漏引用；
/// - 引用 span 切片回原文不是本名：源码与事实漂移。
fn precise_binding_used(
    record: &ModuleRecord,
    source: &str,
    name: &str,
    active_spans: &[(usize, usize)],
    export_spans: &[(usize, usize)],
) -> Option<bool> {
    if record.scope_incomplete {
        return None;
    }
    let binding = record.scope_bindings.iter().find(|item| item.name == name)?;
    if binding.has_type_references {
        return None;
    }
    let mut used = false;
    for span in &binding.references {
        if source.get(span.0..span.1) != Some(name) {
            return None;
        }
        if active_spans.iter().any(|outer| contains(*outer, *span))
            || export_spans.iter().any(|outer| contains(*outer, *span))
        {
            used = true;
        }
    }
    Some(used)
}

/// 绑定是否被发射文本消费：scope 事实完整可信时按引用 span 落点精确判定
/// （未使用的 import 绑定不合成、不重写——其引用只可能出现在被剪除的
/// 语句里），否则回退语法名字匹配 ∪ export 子句名字消费（与链接层同口径
/// 的保守超集，只会多留不会误剪）。
fn binding_is_used(
    record: &ModuleRecord,
    source: &str,
    name: &str,
    active_spans: &[(usize, usize)],
    export_spans: &[(usize, usize)],
    referenced_in_active: &HashSet<&str>,
) -> bool {
    if let Some(used) = precise_binding_used(record, source, name, active_spans, export_spans) {
        return used;
    }
    if referenced_in_active.contains(name) {
        return true;
    }
    record.exports.iter().any(|export| match export {
        ExportFact::Local { local, type_only, .. } => !type_only && local == name,
        ExportFact::Default { local: Some(item), .. } => item == name,
        _ => false,
    })
}

/// 绑定改名守卫：全部成立才产出重写计划，任一失败返回拒绝原因（调用方发
/// `binding_rename_unsupported`）。前提是不漏引用——引用清单不完整、落点
/// 名与消费者任何文本形态碰撞、引用 span 无法判定发射归属，都拒绝。
fn plan_binding_rewrite(
    record: &ModuleRecord,
    source: &str,
    old: &str,
    new: &str,
    active_spans: &[(usize, usize)],
    stripped_spans: &[(usize, usize)],
) -> Result<BindingRewrite, String> {
    if record.scope_incomplete {
        return Err(format!("消费者模块 scope 事实不完整，无法证明 `{old}` 的全部引用"));
    }
    if record.scope_bindings.iter().any(|binding| binding.name == new) {
        return Err(format!("消费者模块已有名为 `{new}` 的模块级绑定，重写会碰撞"));
    }
    let Some(binding) = record.scope_bindings.iter().find(|item| item.name == old) else {
        return Err(format!("`{old}` 无 scope 绑定事实，引用清单给不全"));
    };
    if binding.has_type_references {
        return Err(format!("`{old}` 存在类型位置引用（span 不记录），重写会漏掉类型引用"));
    }
    let mut spans: Vec<(usize, usize)> = Vec::with_capacity(binding.references.len());
    for span in &binding.references {
        if source.get(span.0..span.1) != Some(old) {
            return Err(format!("`{old}` 的引用 span {span:?} 切片回原文不是本名（源码与事实漂移）"));
        }
        let in_active = active_spans.iter().any(|outer| contains(*outer, *span));
        let in_stripped = stripped_spans.iter().any(|outer| contains(*outer, *span));
        if in_active {
            // 活跃语句切片即发射文本（export 包裹声明时切片含声明体），
            // 其中的引用必须全部重写。
            spans.push(*span);
        } else if !in_stripped {
            return Err(format!(
                "`{old}` 的引用 span {span:?} 既不在活跃语句也不在被移除的 import/export 子句内，无法判定发射归属"
            ));
        }
    }
    // 碰撞扫描只针对会发射的文本：落点名出现在 import/export 子句里随
    // 子句一起消失，不构成碰撞；出现在活跃语句里（嵌套遮蔽声明、同名
    // 绑定）才可能让重写后的引用指向错误绑定，保守拒绝。
    for outer in active_spans {
        let Some(text) = source.get(outer.0..outer.1) else {
            return Err(format!("活跃语句 span {outer:?} 超出源码长度（源码与事实漂移）"));
        };
        if contains_identifier(text, new) {
            return Err(format!("落点名 `{new}` 按词边界出现在消费者活跃语句文本中，重写会碰撞"));
        }
    }
    Ok(BindingRewrite { new_name: new.to_string(), spans })
}

/// 同 chunk 静态 import 绑定预决议：先于语句切片执行，产出 scope 重写计划
/// 与逐绑定决议。只处理目标为同 chunk JS 节点的静态值导入；其余形态
/// （Style/Json/未解析/未保留/跨 chunk）原样留给主循环按既有合同处置。
/// 未被发射文本消费的绑定（[`binding_is_used`] 判否）直接跳过：不重写、
/// 不登记同名、不合成自引用，import 文本随绑定一起消失。
#[allow(clippy::too_many_arguments)]
fn plan_same_chunk_bindings(
    context: &EmitContext<'_>,
    chunk_index: usize,
    node: &ModuleNode,
    record: &ModuleRecord,
    source: &str,
    active_spans: &[(usize, usize)],
    export_spans: &[(usize, usize)],
    referenced_in_active: &HashSet<&str>,
    module_path: &str,
    merged: &mut BTreeMap<usize, Bindings>,
    same_chunk_locals: &mut BTreeSet<String>,
    import_locals: &mut Vec<(String, usize, String)>,
    warnings: &mut Vec<PackDiagnostic>,
    errors: &mut Vec<PackDiagnostic>,
) -> (BTreeMap<String, BindingRewrite>, HashMap<(usize, usize), BindingDecision>) {
    const REJECT: &str = "vmz::pack::emit::binding_rename_unsupported";
    let mut renames: BTreeMap<String, BindingRewrite> = BTreeMap::new();
    let mut decisions: HashMap<(usize, usize), BindingDecision> = HashMap::new();

    // import 语句与 export 子句文本不进入 body（语句事实不含这些形态），
    // 其中的名字引用由合成语句与 deferred 导出机制携带落点名。
    let mut stripped_spans: Vec<(usize, usize)> =
        record.imports.iter().map(|import| import.span).collect();
    stripped_spans.extend(export_spans.iter().copied());

    for (import_index, import) in record.imports.iter().enumerate() {
        if import.kind != ImportKind::Static
            || import.type_only
            || import.bindings.is_empty()
            || import.bindings.iter().all(|binding| binding.inline_type_only)
        {
            continue;
        }
        let Some(edge) = node
            .static_edges
            .iter()
            .find(|edge| edge.kind == EdgeKind::Static && edge.specifier == import.specifier)
        else {
            continue;
        };
        let Ok(id) = edge.target.as_ref() else { continue };
        let Some(target) = context.graph.index_of(id) else { continue };
        if context.graph.nodes[target].kind != NodeKind::Js || !context.retained[target] {
            continue;
        }
        let Some(target_chunk) = context.node_chunk[target] else { continue };
        if target_chunk != chunk_index {
            continue;
        }
        for (binding_index, binding) in import.bindings.iter().enumerate() {
            if binding.inline_type_only {
                continue;
            }
            let consumer = binding.local.as_str();
            if !binding_is_used(
                record,
                source,
                consumer,
                active_spans,
                export_spans,
                referenced_in_active,
            ) {
                decisions.insert((import_index, binding_index), BindingDecision::Handled);
                continue;
            }
            if binding.imported == ImportedName::Namespace {
                // 同 chunk 命名空间：对本 chunk 自身产物发 import-from-self，
                // 拿到真实 Module Namespace（名字集按 chunk 加宽，与跨 chunk
                // 加宽合同同构），不做任何名字重写。
                merged.entry(chunk_index).or_default().namespaces.insert(consumer.to_string());
                import_locals.push((consumer.to_string(), chunk_index, module_path.to_string()));
                warnings.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::namespace_widened",
                        format!(
                            "同 chunk 命名空间绑定 `{consumer}` 指向 chunk 自身文件，实际拿到整个 chunk 的命名空间（比源模块宽）"
                        ),
                    )
                    .with_path(module_path.to_string())
                    .with_span(import.span),
                );
                decisions.insert((import_index, binding_index), BindingDecision::Handled);
                continue;
            }
            let source_name = match &binding.imported {
                ImportedName::Default => "default".to_string(),
                ImportedName::Name(name) => name.clone(),
                ImportedName::Namespace => unreachable!("上面已处理命名空间绑定"),
            };
            let mut scratch: Vec<PackDiagnostic> = Vec::new();
            match resolve_same_chunk_reexport(
                context,
                chunk_index,
                target,
                &source_name,
                module_path,
                REJECT,
                &mut scratch,
            ) {
                Some(ReexportBinding::Declared(landing)) => {
                    if landing == consumer {
                        same_chunk_locals.insert(consumer.to_string());
                    } else {
                        match plan_binding_rewrite(
                            record,
                            source,
                            consumer,
                            &landing,
                            active_spans,
                            &stripped_spans,
                        ) {
                            Ok(rewrite) => {
                                if renames.insert(consumer.to_string(), rewrite).is_some() {
                                    errors.push(
                                        PackDiagnostic::new(
                                            REJECT,
                                            format!("消费者模块存在多个名为 `{consumer}` 的 import 绑定，非法源形态"),
                                        )
                                        .with_path(module_path.to_string())
                                        .with_span(import.span),
                                    );
                                }
                            }
                            Err(reason) => errors.push(
                                PackDiagnostic::new(
                                    REJECT,
                                    format!(
                                        "同 chunk import 绑定 `{consumer}` 需 scope 重写为 `{landing}`：{reason}，未实现"
                                    ),
                                )
                                .with_path(module_path.to_string())
                                .with_span(import.span),
                            ),
                        }
                    }
                    decisions.insert((import_index, binding_index), BindingDecision::Handled);
                }
                Some(ReexportBinding::External { chunk, name }) => {
                    decisions
                        .insert((import_index, binding_index), BindingDecision::External { chunk, name });
                }
                None => {
                    // 具名同名（shorthand）：名字经拼接直接可达（星号来源不
                    // 展开的既有口径）；其余形态解析器已给出拒绝诊断。
                    if consumer == source_name {
                        same_chunk_locals.insert(consumer.to_string());
                    } else {
                        errors.append(&mut scratch);
                    }
                    decisions.insert((import_index, binding_index), BindingDecision::Handled);
                }
            }
        }
    }
    (renames, decisions)
}

/// export 事实的整条语句 span。
fn export_fact_span(export: &ExportFact) -> (usize, usize) {
    match export {
        ExportFact::Local { span, .. }
        | ExportFact::Default { span, .. }
        | ExportFact::ReexportNamed { span, .. }
        | ExportFact::ReexportAll { span, .. }
        | ExportFact::ReexportNamespace { span, .. } => *span,
    }
}

/// chunk 成员扫描快照：活跃语句 span 与活跃声明名，供声明改名预决议。
struct ChunkModuleScan<'a> {
    source: &'a str,
    active_spans: Vec<(usize, usize)>,
    declared: BTreeSet<String>,
}

/// 同 chunk 声明改名预决议：`declared × declared` 冲突中，未被任何非类型
/// 导出事实消费的声明改名 `{name}__vmz{node_index}`——声明 token 与其
/// 活跃语句内的值引用全部改写。改名不改变 chunk 对外名字集：被改名的
/// 绑定不在导出面上，`resolve_same_chunk_reexport` 的落点必然沿导出事实
/// 行走，不会命中被改名的声明。任一守卫不成立则不改名，冲突维持由
/// `check_names` 发 `name_conflict` 显式拒绝（保守方向只多拒绝不漏引用）：
/// - `scope_incomplete` 置位或绑定无 scope 事实：引用清单不可信/给不全；
/// - `has_type_references`：类型位置引用无 span，无法一并改写；
/// - `rename_unsafe`：声明 token 在解构模式内、或值引用是对象简写属性
///   token，改写会连带改变属性键语义；
/// - 声明/引用 span 切片回原文不是本名（事实与源码漂移），或引用发射
///   归属不可判定（既不在活跃语句、也不在被剪除语句与 import/export 子句）；
/// - fresh 名与 chunk 内任何活跃声明名相同，或按词边界出现在任一模块的
///   活跃语句文本中（字符串与注释同样命中，保守拒绝）。
fn plan_declaration_renames(
    context: &EmitContext<'_>,
    chunk_index: usize,
) -> BTreeMap<usize, BTreeMap<String, BindingRewrite>> {
    let chunk = &context.chunks.chunks[chunk_index];
    let mut scans: BTreeMap<usize, ChunkModuleScan<'_>> = BTreeMap::new();
    let mut name_nodes: BTreeMap<String, BTreeSet<usize>> = BTreeMap::new();
    for &node_index in &chunk.modules {
        let Some(node) = context.graph.nodes.get(node_index) else { continue };
        let Some(linked) = context.linked[node_index] else { continue };
        let Some(source) = context.sources.get(&node_index) else { continue };
        let mut active_spans: Vec<(usize, usize)> = Vec::new();
        let mut declared: BTreeSet<String> = BTreeSet::new();
        for &index in &linked.active_statements {
            let Some(statement) = node.record.statements.get(index) else { continue };
            active_spans.push(statement.span);
            for name in &statement.declared_names {
                declared.insert(name.clone());
            }
        }
        for name in &declared {
            name_nodes.entry(name.clone()).or_default().insert(node_index);
        }
        scans.insert(node_index, ChunkModuleScan { source, active_spans, declared });
    }
    let mut plans: BTreeMap<usize, BTreeMap<String, BindingRewrite>> = BTreeMap::new();
    for (name, nodes) in &name_nodes {
        if nodes.len() < 2 {
            continue;
        }
        for &node_index in nodes {
            if let Some(rewrite) = try_plan_declaration_rename(context, node_index, name, &scans)
            {
                plans.entry(node_index).or_default().insert(name.clone(), rewrite);
            }
        }
    }
    plans
}

/// 单条冲突声明的改名守卫与重写计划；任一守卫不成立返回 `None`
/// （不改名，冲突留给 `check_names` 显式拒绝）。
fn try_plan_declaration_rename(
    context: &EmitContext<'_>,
    node_index: usize,
    name: &str,
    scans: &BTreeMap<usize, ChunkModuleScan<'_>>,
) -> Option<BindingRewrite> {
    let scan = scans.get(&node_index)?;
    let record = &context.graph.nodes.get(node_index)?.record;
    if record.scope_incomplete {
        return None;
    }
    for export in &record.exports {
        match export {
            ExportFact::Local { local, type_only, .. } => {
                if !type_only && local == name {
                    return None;
                }
            }
            ExportFact::Default { local: Some(local), .. } => {
                if local == name {
                    return None;
                }
            }
            _ => {}
        }
    }
    let binding = record.scope_bindings.iter().find(|item| item.name == name)?;
    if binding.has_type_references || binding.rename_unsafe {
        return None;
    }
    if !scan.active_spans.iter().any(|outer| contains(*outer, binding.declaration)) {
        return None;
    }
    if scan.source.get(binding.declaration.0..binding.declaration.1) != Some(name) {
        return None;
    }
    let mut spans = vec![binding.declaration];
    for span in &binding.references {
        if scan.source.get(span.0..span.1) != Some(name) {
            return None;
        }
        if scan.active_spans.iter().any(|outer| contains(*outer, *span)) {
            spans.push(*span);
            continue;
        }
        // 被剪除语句与 import/export 子句内的引用不进产物文本；其余位置
        // 发射归属不可判定，拒绝。
        let in_statement = record.statements.iter().any(|item| contains(item.span, *span));
        let in_clause = record.imports.iter().any(|item| contains(item.span, *span))
            || record.exports.iter().any(|item| contains(export_fact_span(item), *span));
        if !in_statement && !in_clause {
            return None;
        }
    }
    let fresh = format!("{name}__vmz{node_index}");
    for other in scans.values() {
        if other.declared.contains(&fresh) {
            return None;
        }
        for outer in &other.active_spans {
            let Some(text) = other.source.get(outer.0..outer.1) else {
                return None;
            };
            if contains_identifier(text, &fresh) {
                return None;
            }
        }
    }
    Some(BindingRewrite { new_name: fresh, spans })
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
/// 解析不出绑定，显式拒绝。`code` 由调用方按语境给出（重导出语境与
/// import 绑定预决议语境共用本解析器）。
/// `Declared` 落点必然沿非类型导出事实行走，声明改名守卫已排除被导出
/// 的绑定，因此落点名无需按改名表二次映射。
fn resolve_same_chunk_reexport(
    context: &EmitContext<'_>,
    chunk_index: usize,
    target: usize,
    name: &str,
    module_path: &str,
    code: &str,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<ReexportBinding> {
    let unsupported = |message: String| {
        PackDiagnostic::new(code, message).with_path(module_path.to_string())
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

/// 星号重导出目标自身是否含活跃 `export *`（名字经链流入，展开时不可
/// 枚举）：命中即显式拒绝展开，不递归收集。
fn target_has_active_star(
    context: &EmitContext<'_>,
    target: usize,
    module_path: &str,
    errors: &mut Vec<PackDiagnostic>,
) -> bool {
    let Some(linked) = context.linked[target] else {
        errors.push(
            inconsistent(format!(
                "星号重导出目标 `{}` 未被链接层保留",
                normalize_path(&context.graph.nodes[target].resolved.path)
            ))
            .with_path(module_path.to_string()),
        );
        return true;
    };
    let record = &context.graph.nodes[target].record;
    for (index, export) in record.exports.iter().enumerate() {
        if matches!(export, ExportFact::ReexportAll { .. })
            && used_reexport(linked, index, is_all)
        {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::namespace_synthesis_unsupported",
                    format!(
                        "同 chunk 星号重导出的来源 `{}` 自身含活跃 `export *`，名字集不可枚举，未实现",
                        normalize_path(&context.graph.nodes[target].resolved.path)
                    ),
                )
                .with_path(module_path.to_string()),
            );
            return true;
        }
    }
    false
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
