//! opaque 模块独立发射（Living §同 chunk 作用域隔离：隔离即独立发射）。
//!
//! chunk 成员的 scope 事实不完整（精确原因清单非空）时，同 chunk 平铺拼接
//! 的前提「全部顶层绑定可改名」不成立。chunk 层已把这类模块划为 singleton
//! chunk，本层按整文件文本发射真 ESM 文件，不走活跃语句切片、绑定合成与
//! 改名守卫：
//! - 静态 import / 重导出说明符原地重写为目标 chunk 占位符（第三遍替换为
//!   `./<目标文件名>`）；目标被链接层剪除时整条语句删除（引用只可能落在
//!   永不求值的死代码里，与平铺路径的剪枝语义一致）；Style 目标整句删除
//!   （级联由 `style` 层聚合）；Json 目标按 default 绑定语义整句替换为
//!   `const <local> = <原始 JSON 文本>;`。
//! - `import type`、全内联 type 绑定导入与类型重导出整句删除：图层不为
//!   它们建边，保留文本会产出指向不存在产物的引用。
//! - 动态 import 与资源引用沿用平铺路径的 span 重写与保留诊断；动态目标
//!   被剪除时文本原样保留并给非致命诊断（死代码路径，执行即断链，如实
//!   报告不猜）。
//! - export 语句原文保留：live binding 由原生 ESM 保证，不合成 getter。
//! - 剪枝只到模块级：文件内不删任何语句（语义降级如实），发非致命诊断
//!   `vmz::pack::emit::module_isolated` 携带精确原因清单；chunk id 的
//!   `isolated/…` 前缀即 manifest 标注。
//! - 顶层 `return` 无法作为独立 ESM 文件发射（SyntaxError），显式拒绝。
//! - source map 按整文件单切片 (0, len) 生成，映射链与平铺路径一致：
//!   生成行 → 擦除删除表 → 整文件替换表 → 模块源行列。

use std::collections::{BTreeMap, HashMap};

use crate::diag::PackDiagnostic;
use crate::graph::{EdgeKind, NodeKind};
use crate::module::{
    ExportFact, ImportBinding, ImportFact, ImportKind, ImportedName, ScopeIncompleteReason,
};

use super::assemble::{
    AssembledChunk, ChunkSegment, apply_replacements, chunk_of_node, json_text, map_replaced_offset,
};
use super::{EmitContext, PLACEHOLDER_PREFIX, json_string, normalize_path, placeholder};

/// 该 chunk 是否为 opaque 独立发射单元（单成员且 scope 事实不完整）。
/// 判定只依据模块事实，与 chunk 层的 singleton 分区同一谓词。
/// CJS 模块同为独立发射：互操作壳只在单文件 chunk 里成立。
pub(crate) fn is_isolated_chunk(context: &EmitContext<'_>, chunk_index: usize) -> bool {
    let chunk = &context.chunks.chunks[chunk_index];
    chunk.modules.len() == 1
        && context
            .graph
            .nodes
            .get(chunk.modules[0])
            .is_some_and(|node| node.record.is_scope_incomplete() || node.kind == NodeKind::Cjs)
}

/// 独立发射装配：整文件文本 + 全文件替换表 → 类型擦除 → 行级映射段。
pub(crate) fn assemble_isolated(
    context: &EmitContext<'_>,
    chunk_index: usize,
    errors: &mut Vec<PackDiagnostic>,
    warnings: &mut Vec<PackDiagnostic>,
) -> Option<AssembledChunk> {
    let chunk = &context.chunks.chunks[chunk_index];
    let errors_before = errors.len();
    let node_index = chunk.modules.first()?;
    let node = context.graph.nodes.get(*node_index)?;
    if node.kind == NodeKind::Cjs {
        return assemble_cjs(context, chunk_index, *node_index, errors, warnings);
    }
    let source = context.sources.get(node_index)?;
    let module_path = normalize_path(&node.resolved.path);
    let record = &node.record;

    if source.contains(PLACEHOLDER_PREFIX) {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::placeholder_collision",
                "源文本包含产物占位符前缀，替换会有歧义",
            )
            .with_path(module_path.clone()),
        );
        return None;
    }

    // 隔离事实如实报告（Living §同 chunk 作用域隔离第 3 条：降级非静默）。
    let reasons: Vec<&'static str> =
        record.scope_incomplete_reasons.iter().copied().map(reason_label).collect();
    warnings.push(
        PackDiagnostic::new(
            "vmz::pack::emit::module_isolated",
            format!(
                "模块 scope 事实不完整（{}），按模块级隔离独立发射为真 ESM 文件：剪枝只到模块级，文件内语句全部保留",
                reasons.join(", ")
            ),
        )
        .with_path(module_path.clone()),
    );

    // 顶层 return 独立发射即 SyntaxError，无法作为 ESM 文件交付。
    if record.scope_incomplete_reasons.contains(&ScopeIncompleteReason::TopLevelReturn) {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::isolated_unemittable",
                "模块含顶层 `return`，无法作为独立 ESM 文件发射",
            )
            .with_path(module_path.clone()),
        );
        return None;
    }

    let mut replacements: BTreeMap<(usize, usize), String> = BTreeMap::new();
    let mut json_texts: HashMap<usize, Option<String>> = HashMap::new();

    // import 事实：静态/副作用原地重写或删除，动态沿用平铺分类。
    for import in &record.imports {
        match import.kind {
            ImportKind::Dynamic => {
                plan_dynamic_import(
                    context,
                    node,
                    import,
                    &module_path,
                    &mut replacements,
                    errors,
                    warnings,
                );
            }
            ImportKind::Static | ImportKind::SideEffect => {
                let type_only = import.type_only
                    || (import.kind == ImportKind::Static
                        && !import.bindings.is_empty()
                        && import.bindings.iter().all(|binding| binding.inline_type_only));
                if type_only {
                    // 图层不建边：整句删除，与平铺路径「不合成任何文本」同口径。
                    replacements.insert(import.span, String::new());
                    continue;
                }
                let edge_kind = if import.kind == ImportKind::Static {
                    EdgeKind::Static
                } else {
                    EdgeKind::SideEffect
                };
                let Some(edge) = node
                    .static_edges
                    .iter()
                    .find(|edge| edge.kind == edge_kind && edge.specifier == import.specifier)
                else {
                    errors.push(
                        inconsistent(format!("import `{}` 找不到对应静态边", import.specifier))
                            .with_path(module_path.clone()),
                    );
                    continue;
                };
                let Ok(id) = edge.target.as_ref() else {
                    if matches!(
                        edge.target.as_ref().err(),
                        Some(diagnostic) if diagnostic.code == crate::resolve::CODE_NODE_BUILTIN
                    ) {
                        // Node target：整文件逐字发射，静态 `node:` import 语句
                        // 原样留在模块文本里，由 Node 宿主解析，无需重写。
                        // Browser target：内建模块不存在，维持显式拒绝。
                        if context.graph.target == crate::resolve::Target::Node {
                            warnings.push(
                                PackDiagnostic::new(
                                    "vmz::pack::emit::node_builtin_static_kept",
                                    format!(
                                        "静态导入 `{}` 是 Node.js 内建模块，整文件发射原样保留，由 Node 宿主解析",
                                        import.specifier
                                    ),
                                )
                                .with_path(module_path.clone())
                                .with_span(import.span),
                            );
                            continue;
                        }
                        errors.push(
                            PackDiagnostic::new(
                                "vmz::pack::emit::node_builtin_static_unsupported",
                                format!(
                                    "静态导入 `{}` 是 Node.js 内建模块：浏览器目标不支持内建模块，改用动态 `import(\"node:…\")` 或移除该依赖",
                                    import.specifier
                                ),
                            )
                            .with_path(module_path.clone())
                            .with_span(import.span),
                        );
                        continue;
                    }
                    errors.push(
                        super::edge_unresolved(
                            "静态导入",
                            &import.specifier,
                            "独立发射无法重写说明符",
                            edge.target.as_ref().err(),
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
                match context.graph.nodes[target].kind {
                    NodeKind::Style => {
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
                        // 级联由 style 层聚合，JS 侧语句文本整体移除。
                        replacements.insert(import.span, String::new());
                    }
                    NodeKind::Json => {
                        let mut default_local: Option<&String> = None;
                        for binding in &import.bindings {
                            if binding.inline_type_only {
                                continue;
                            }
                            match &binding.imported {
                                ImportedName::Default => {
                                    if default_local.replace(&binding.local).is_some() {
                                        break;
                                    }
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
                        match default_local {
                            Some(local) => {
                                let Some(text) =
                                    json_text(context, target, &mut json_texts, errors)
                                else {
                                    continue;
                                };
                                replacements
                                    .insert(import.span, format!("const {local} = {text};"));
                            }
                            None => {
                                // 副作用 JSON 导入：值节点求值无可观察效果，整句删除。
                                replacements.insert(import.span, String::new());
                            }
                        }
                    }
                    NodeKind::Js | NodeKind::Cjs => {
                        if !context.retained[target] {
                            // 目标被链接层剪除：绑定必无活跃消费路径可达，整句删除。
                            replacements.insert(import.span, String::new());
                            continue;
                        }
                        let Some(target_chunk) =
                            chunk_of_node(context, target, &module_path, errors)
                        else {
                            continue;
                        };
                        // 面名分裂后，绑定名必须映射到本模块事实链认领者的发射
                        // 面名（如 `plannerCopy__vmzN as plannerCopy`）：只重写
                        // 说明符会把跨 chunk 消费绑到 canonical 认领者（真实
                        // 事故：static 装配期 `plannerCopy()` 调到了同名 locales
                        // getter）。任一绑定面名漂移即整句重建，不再原地改写。
                        let face_map = import
                            .bindings
                            .iter()
                            .filter(|binding| !binding.inline_type_only)
                            .map(|binding| {
                                let source_name = match &binding.imported {
                                    ImportedName::Default => "default".to_string(),
                                    ImportedName::Name(name) => name.clone(),
                                    ImportedName::Namespace => String::new(),
                                };
                                let emitted = if source_name.is_empty() {
                                    source_name.clone()
                                } else {
                                    super::assemble::resolve_emitted_face(
                                        context,
                                        target_chunk,
                                        target,
                                        &source_name,
                                    )
                                };
                                (binding, source_name, emitted)
                            })
                            .collect::<Vec<_>>();
                        let needs_rebuild = face_map.iter().any(|(_, source_name, emitted)| {
                            !source_name.is_empty() && *emitted != *source_name
                        });
                        if needs_rebuild {
                            let text = rebuild_static_import(
                                import,
                                &face_map,
                                &placeholder(target_chunk),
                            );
                            replacements.insert(import.span, text);
                            continue;
                        }
                        match import.specifier_span {
                            Some(span) => {
                                replacements.insert(span, json_string(&placeholder(target_chunk)));
                            }
                            None => errors.push(
                                PackDiagnostic::new(
                                    "vmz::pack::emit::import_unrewritable",
                                    format!(
                                        "import `{}` 缺少说明符 span，独立发射无法原地重写",
                                        import.specifier
                                    ),
                                )
                                .with_path(module_path.clone())
                                .with_span(import.span),
                            ),
                        }
                    }
                }
            }
        }
    }

    // 重导出事实：说明符原地重写；类型形态与剪除目标整句删除。
    for export in &record.exports {
        let (kind, source, source_span, span, type_only) = match export {
            ExportFact::Local { .. } | ExportFact::Default { .. } => continue,
            ExportFact::ReexportNamed { source, source_span, span, type_only, .. } => {
                (EdgeKind::ReexportNamed, source, *source_span, *span, *type_only)
            }
            ExportFact::ReexportAll { source, source_span, span, .. } => {
                (EdgeKind::ReexportAll, source, *source_span, *span, false)
            }
            ExportFact::ReexportNamespace { source, source_span, span, type_only, .. } => {
                (EdgeKind::ReexportNamespace, source, *source_span, *span, *type_only)
            }
        };
        if type_only {
            replacements.insert(span, String::new());
            continue;
        }
        let Some(edge) =
            node.static_edges.iter().find(|edge| edge.kind == kind && edge.specifier == *source)
        else {
            errors.push(
                inconsistent(format!("重导出 `{source}` 找不到对应静态边"))
                    .with_path(module_path.clone()),
            );
            continue;
        };
        let Ok(id) = edge.target.as_ref() else {
            errors.push(
                super::edge_unresolved(
                    "重导出",
                    source,
                    "独立发射无法重写说明符",
                    edge.target.as_ref().err(),
                )
                .with_path(module_path.clone())
                .with_span(span),
            );
            continue;
        };
        let Some(target) = context.graph.index_of(id) else {
            errors.push(
                inconsistent(format!("重导出 `{source}` 目标不在图中"))
                    .with_path(module_path.clone()),
            );
            continue;
        };
        match context.graph.nodes[target].kind {
            NodeKind::Style => errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::reexport_style_unsupported",
                    format!("重导出 `{source}` 目标是 CSS：样式节点不透明，无导出绑定"),
                )
                .with_path(module_path.clone())
                .with_span(span),
            ),
            NodeKind::Json => errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::reexport_json_unsupported",
                    format!("重导出 `{source}` 目标是 JSON：值节点只支持 default 导入绑定"),
                )
                .with_path(module_path.clone())
                .with_span(span),
            ),
            NodeKind::Js | NodeKind::Cjs => {
                if !context.retained[target] {
                    // 目标剪除：消费该重导出的需求必不存在（否则目标已保留），整句删除。
                    replacements.insert(span, String::new());
                    continue;
                }
                let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                else {
                    continue;
                };
                // 具名重导出的来源名同样要过面名分裂映射（与 import 同合同）：
                // 来源名漂移时整句重建为 `export { <发射面名> as <对外名> }`。
                if let ExportFact::ReexportNamed { local, exported, .. } = export {
                    let emitted =
                        super::assemble::resolve_emitted_face(context, target_chunk, target, local);
                    if emitted != *local {
                        let text = format!(
                            "export {{ {} as {} }} from {};",
                            emitted,
                            exported,
                            json_string(&placeholder(target_chunk))
                        );
                        replacements.insert(span, text);
                        continue;
                    }
                }
                match source_span {
                    Some(specifier_span) => {
                        replacements
                            .insert(specifier_span, json_string(&placeholder(target_chunk)));
                    }
                    None => errors.push(
                        PackDiagnostic::new(
                            "vmz::pack::emit::reexport_unrewritable",
                            format!("重导出 `{source}` 缺少说明符 span，独立发射无法原地重写"),
                        )
                        .with_path(module_path.clone())
                        .with_span(span),
                    ),
                }
            }
        }
    }

    // 资源引用：整文件发射即全部语句保留，活跃判定按全部语句而非链接切片。
    for asset in &record.assets {
        let live = record.statements.iter().any(|statement| contains(statement.span, asset.span));
        if !live {
            continue;
        }
        let key = (module_path.clone(), asset.specifier.clone());
        let Some(artifact) = context.asset_index.get(&key) else { continue };
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
        replacements.insert(specifier_span, json_string(&format!("./{}", artifact.file_name)));
    }

    if errors.len() > errors_before {
        return None;
    }

    let replaced = match apply_replacements(source, 0, &replacements) {
        Ok(text) => text,
        Err(diagnostic) => {
            errors.push(diagnostic.with_path(module_path.clone()));
            return None;
        }
    };
    let (erased, deletions) = match vmz_generator::js::erase_types_with_deletions(&replaced) {
        Ok(pair) => pair,
        Err(err) => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::erase_failed",
                    format!("TypeScript 类型擦除失败: {err}"),
                )
                .with_path(module_path.clone()),
            );
            return None;
        }
    };

    // 行级映射：整文件单切片 (0, len)，生成行起点 → 擦除删除表 →
    // 整文件替换表 → 模块源行列，与平铺路径同一复合链。
    let source_lines = vmz_generator::js::SourceLines::new(source);
    let mut segments: Vec<ChunkSegment> = Vec::new();
    let mut line_off = 0usize;
    for (line_index, generated) in erased.split('\n').enumerate() {
        let replaced_off = vmz_generator::js::map_erased_offset(line_off, &deletions);
        let raw_off = map_replaced_offset(replaced_off, source, 0, &replacements);
        let (src_line, src_col) = source_lines.line_col(raw_off);
        segments.push(ChunkSegment {
            gen_line: line_index as u32,
            source: module_path.clone(),
            src_line,
            src_col,
        });
        line_off += generated.len() + 1;
    }

    Some(AssembledChunk { code: erased, segments })
}

/// 面名分裂命中时的整句 import 重建：绑定按事实重排（default → 命名空间 →
/// 具名子句），具名子句的来源名写发射面名（与本地名不同时 `as <本地名>`
/// 保住本地绑定）。内联 `type` 绑定不参与面分裂，原文保留进具名子句。
/// `face_map` 逐项对应非内联类型绑定与其发射面名（命名空间项为空串）。
fn rebuild_static_import(
    import: &ImportFact,
    face_map: &[(&ImportBinding, String, String)],
    placeholder_spec: &str,
) -> String {
    let mut default_part: Option<String> = None;
    let mut namespace_part: Option<String> = None;
    let mut named: Vec<String> = Vec::new();
    for binding in &import.bindings {
        if binding.inline_type_only {
            let inner = match &binding.imported {
                ImportedName::Name(name) => name.clone(),
                ImportedName::Default => "default".to_string(),
                ImportedName::Namespace => continue,
            };
            named.push(if inner == binding.local {
                format!("type {inner}")
            } else {
                format!("type {inner} as {}", binding.local)
            });
            continue;
        }
        let emitted = face_map
            .iter()
            .find(|(b, _, _)| std::ptr::eq(*b, binding))
            .map(|(_, _, emitted)| emitted.clone())
            .unwrap_or_default();
        match &binding.imported {
            ImportedName::Default => {
                if emitted.is_empty() || emitted == "default" {
                    default_part = Some(binding.local.clone());
                } else {
                    named.push(format!("{emitted} as {}", binding.local));
                }
            }
            ImportedName::Namespace => {
                namespace_part = Some(format!("* as {}", binding.local));
            }
            ImportedName::Name(name) => {
                let face = if emitted.is_empty() { name.clone() } else { emitted };
                named.push(if face == binding.local {
                    face
                } else {
                    format!("{face} as {}", binding.local)
                });
            }
        }
    }
    let mut lhs = String::from("import ");
    let mut need_sep = false;
    if let Some(def) = default_part {
        lhs.push_str(&def);
        need_sep = true;
    }
    if let Some(ns) = namespace_part {
        if need_sep {
            lhs.push_str(", ");
        }
        lhs.push_str(&ns);
        need_sep = true;
    }
    if !named.is_empty() {
        if need_sep {
            lhs.push_str(", ");
        }
        lhs.push_str(&format!("{{ {} }}", named.join(", ")));
        need_sep = true;
    }
    if !need_sep {
        return format!("import {};", json_string(placeholder_spec));
    }
    format!("{lhs} from {};", json_string(placeholder_spec))
}

/// CJS 模块的互操作壳发射（独立发射的 CJS 分支）。
///
/// 壳合同：
/// - 头部为每个去重后的 require 说明符合成一条 hoisted 静态 import
///   （default 绑定 = 目标模块的 `module.exports`），并装填 `module`/
///   `exports` 材料与按说明符查表的局部 `require`；require 调用点不改写——
///   惰性 require 的运行时语义由查表函数保留（hoisted import 使目标提前
///   求值，与 Node 的差异仅在循环/惰性形态下可观察）。
/// - 源文本只重写资源引用与动态 import 说明符（与 ESM 独立发射同路径）；
///   `import type` 整句删除。
/// - 尾部合成 `export default module.exports` 与检测到的具名导出快照
///   （Node 对 CJS 的具名导出同为求值后快照语义）。
/// - 拒绝形态全部结构化：混入运行时 ESM import/export 语法
///   （`cjs_esm_syntax`）、非字面量 require（`cjs_require_nonliteral`）、
///   与壳材料同名的顶层绑定（`cjs_shim_collision`）、require ESM/JSON/CSS
///   目标（各自显式诊断码）。
fn assemble_cjs(
    context: &EmitContext<'_>,
    chunk_index: usize,
    node_index: usize,
    errors: &mut Vec<PackDiagnostic>,
    warnings: &mut Vec<PackDiagnostic>,
) -> Option<AssembledChunk> {
    let errors_before = errors.len();
    let node = context.graph.nodes.get(node_index)?;
    let record = &node.record;
    let module_path = normalize_path(&node.resolved.path);
    let source = context.sources.get(&node_index).cloned().unwrap_or_default();

    if source.contains(PLACEHOLDER_PREFIX) {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::placeholder_collision",
                "源文本包含产物占位符前缀，替换会有歧义",
            )
            .with_path(module_path.clone()),
        );
        return None;
    }

    // 混入运行时 ESM 语法在 Node 里即 SyntaxError，打包层同样显式拒绝。
    if record.imports.iter().any(|import| !import.type_only && import.kind != ImportKind::Dynamic)
        || !record.exports.is_empty()
    {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::cjs_esm_syntax",
                "CJS 模块混入运行时 ESM import/export 语法：Node 同样拒绝该形态，打包层不猜测混合语义",
            )
            .with_path(module_path.clone()),
        );
    }
    if record.flags.require_nonliteral {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::cjs_require_nonliteral",
                "CJS 模块含非字符串字面量 require：无法静态装填依赖表",
            )
            .with_path(module_path.clone()),
        );
    }
    // 壳材料名（`module`/`exports`/`require`）与顶层声明冲突时拒绝。
    for binding in &record.scope_bindings {
        if matches!(binding.name.as_str(), "module" | "exports" | "require") {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::cjs_shim_collision",
                    format!(
                        "CJS 模块顶层声明了壳材料名 `{}`：互操作装填会与之冲突，显式拒绝",
                        binding.name
                    ),
                )
                .with_path(module_path.clone()),
            );
        }
    }

    // 去重后的 require 说明符 → hoisted import 绑定与查表 case。
    // 内建外部模块（`node:` 任意 target、裸名内建仅 Node target 解析到此）不生成
    // hoisted import：Node target 上由 `createRequire` 兜底真实装载；Browser
    // target 上查表未命中即抛错（如实，不假装可解析）。
    let mut header = String::new();
    let mut cases = String::new();
    let mut has_builtin_require = false;
    let mut seen: Vec<&str> = Vec::new();
    for require in &record.requires {
        let specifier = require.specifier.as_str();
        if seen.contains(&specifier) {
            continue;
        }
        seen.push(specifier);
        let binding = format!("__vmz_require_{}", seen.len() - 1);
        let Some(edge) = node
            .static_edges
            .iter()
            .find(|edge| edge.kind == EdgeKind::Static && edge.specifier == specifier)
        else {
            errors.push(
                inconsistent(format!("require `{specifier}` 找不到对应静态边"))
                    .with_path(module_path.clone()),
            );
            continue;
        };
        let Ok(id) = edge.target.as_ref() else {
            if matches!(
                edge.target.as_ref().err(),
                Some(diagnostic) if diagnostic.code == crate::resolve::CODE_NODE_BUILTIN
            ) {
                has_builtin_require = true;
                continue;
            }
            errors.push(
                super::edge_unresolved(
                    "require",
                    specifier,
                    "互操作壳无法装填依赖",
                    edge.target.as_ref().err(),
                )
                .with_path(module_path.clone())
                .with_span(require.span),
            );
            continue;
        };
        let Some(target) = context.graph.index_of(id) else {
            errors.push(
                inconsistent(format!("require `{specifier}` 目标不在图中"))
                    .with_path(module_path.clone()),
            );
            continue;
        };
        match context.graph.nodes[target].kind {
            NodeKind::Cjs => {
                let Some(target_chunk) = chunk_of_node(context, target, &module_path, errors)
                else {
                    continue;
                };
                header.push_str(&format!(
                    "import {binding} from {};\n",
                    json_string(&placeholder(target_chunk))
                ));
                cases.push_str(&format!("case {}: return {binding};\n", json_string(specifier)));
            }
            NodeKind::Js => {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::cjs_require_esm",
                        format!(
                            "require `{specifier}` 的目标是 ESM 模块：CJS 同步 require 不能装载 ESM（Node 同形拒绝），请改动态 import"
                        ),
                    )
                    .with_path(module_path.clone())
                    .with_span(require.span),
                );
            }
            NodeKind::Json => {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::cjs_require_json_unsupported",
                        format!("require `{specifier}` 的目标是 JSON：CJS require JSON 未实现"),
                    )
                    .with_path(module_path.clone())
                    .with_span(require.span),
                );
            }
            NodeKind::Style => {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::cjs_require_style_unsupported",
                        format!("require `{specifier}` 的目标是 CSS：样式节点不透明，无模块导出"),
                    )
                    .with_path(module_path.clone())
                    .with_span(require.span),
                );
            }
        }
    }

    let mut replacements: BTreeMap<(usize, usize), String> = BTreeMap::new();
    // `import type` 整句删除（无运行时边）。
    for import in &record.imports {
        if import.type_only {
            replacements.insert(import.span, String::new());
        }
    }
    // 动态 import：与 ESM 独立发射同一处置。
    for import in &record.imports {
        if import.kind == ImportKind::Dynamic {
            plan_dynamic_import(
                context,
                node,
                import,
                &module_path,
                &mut replacements,
                errors,
                warnings,
            );
        }
    }
    // 资源引用：整文件存活，与 ESM 独立发射同一路径。
    for asset in &record.assets {
        let key = (module_path.clone(), asset.specifier.clone());
        let Some(artifact) = context.asset_index.get(&key) else { continue };
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
        replacements.insert(specifier_span, json_string(&format!("./{}", artifact.file_name)));
    }

    if errors.len() > errors_before {
        return None;
    }

    let replaced = match apply_replacements(&source, 0, &replacements) {
        Ok(text) => text,
        Err(diagnostic) => {
            errors.push(diagnostic.with_path(module_path.clone()));
            return None;
        }
    };
    let (body, _deletions) = match vmz_generator::js::erase_types_with_deletions(&replaced) {
        Ok(pair) => pair,
        Err(err) => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::erase_failed",
                    format!("TypeScript 类型擦除失败: {err}"),
                )
                .with_path(module_path.clone()),
            );
            return None;
        }
    };

    // 壳文本：header（合成 import）+ shim（材料与查表 require）+ body + footer。
    // Node target 且存在内建 require 时经 `createRequire` 真实装载；Browser
    // target 的查表未命中是显式抛错。
    let node_fallback = has_builtin_require && context.graph.target == crate::resolve::Target::Node;
    if node_fallback {
        header.push_str("import { createRequire as __vmz_createRequire } from \"node:module\";\n");
    }
    let fallback = if node_fallback {
        "default: return __vmz_cjs_require(id);"
    } else {
        "default: throw new Error(\"vmz-pack: unbound require \" + id);"
    };
    let shim = format!(
        "let module = {{ exports: {{}} }};\nlet exports = module.exports;\n{create_require}function require(id) {{\nswitch (id) {{\n{cases}{fallback}\n}}\n}}\n",
        create_require = if node_fallback {
            "const __vmz_cjs_require = __vmz_createRequire(import.meta.url);\n"
        } else {
            ""
        },
    );
    let mut footer =
        String::from("const __vmz_exports = module.exports;\nexport default __vmz_exports;\n");
    for (index, name) in record.cjs_named_exports.iter().enumerate() {
        footer.push_str(&format!(
            "const __vmz_named_{index} = __vmz_exports.{name};\nexport {{ __vmz_named_{index} as {name} }};\n"
        ));
    }

    let head_lines = header.matches('\n').count() + shim.matches('\n').count();
    // 源文件缺尾换行时 body 末行会与 footer 首行粘连：补一个换行
    // （不改既有行的行号口径）。
    let body = if body.ends_with('\n') { body } else { format!("{body}\n") };
    let code = format!("{header}{shim}{body}{footer}");

    // 行级映射：替换与擦除都保持行结构（说明符同行改写、擦除为空格化），
    // body 第 i 行即源文件第 i 行；合成的壳行无原文来源，不产段。
    let mut segments: Vec<ChunkSegment> = Vec::new();
    for (line_index, _line) in body.split('\n').enumerate() {
        segments.push(ChunkSegment {
            gen_line: (head_lines + line_index) as u32,
            source: module_path.clone(),
            src_line: line_index as u32,
            src_col: 0,
        });
    }

    Some(AssembledChunk { code, segments })
}

/// 动态 import 的独立发射处置：与平铺路径同一分类，说明符原地重写。
fn plan_dynamic_import(
    context: &EmitContext<'_>,
    node: &crate::graph::ModuleNode,
    import: &crate::module::ImportFact,
    module_path: &str,
    replacements: &mut BTreeMap<(usize, usize), String>,
    errors: &mut Vec<PackDiagnostic>,
    warnings: &mut Vec<PackDiagnostic>,
) {
    if import.specifier.is_empty() {
        // 非字面量动态 import：文本原样保留，产物层不保证运行时可解析。
        warnings.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_unresolved_kept",
                "非字面量动态 import 说明符原样保留，产物层不保证运行时可解析",
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        );
        return;
    }
    if import.specifier.starts_with('/') {
        warnings.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_url_kept",
                format!(
                    "根绝对 URL 动态 import `{}` 原样保留，由站点 origin 运行时解析",
                    import.specifier
                ),
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        );
        return;
    }
    if crate::resolve::is_node_builtin_specifier(&import.specifier) {
        // `node:` 内建动态 import：无文件身份可重写，说明符原文保留，
        // 由 Node 宿主在运行时解析。
        warnings.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_external_kept",
                format!(
                    "动态 import `{}` 是 Node.js 内建模块，说明符原样保留，由运行时宿主解析",
                    import.specifier
                ),
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        );
        return;
    }
    let Some(edge) = node.dynamic_edges.iter().find(|edge| edge.specifier == import.specifier)
    else {
        errors.push(
            inconsistent(format!("动态 import `{}` 找不到对应动态边", import.specifier))
                .with_path(module_path.to_string()),
        );
        return;
    };
    let Ok(id) = edge.target.as_ref() else {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_unresolved",
                format!("动态 import `{}` 目标未解析，无法重写为 chunk 文件", import.specifier),
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        );
        return;
    };
    let Some(target) = context.graph.index_of(id) else {
        errors.push(
            inconsistent(format!("动态 import 目标不在图中: `{}`", import.specifier))
                .with_path(module_path.to_string()),
        );
        return;
    };
    match context.graph.nodes[target].kind {
        NodeKind::Style => errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_style_unsupported",
                format!(
                    "动态 import `{}` 目标是 CSS：样式只经宿主模块静态副作用边进入级联",
                    import.specifier
                ),
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        ),
        NodeKind::Json => errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::dynamic_json_unsupported",
                format!(
                    "动态 import `{}` 目标是 JSON：值节点只经宿主模块静态 default 导入合成绑定",
                    import.specifier
                ),
            )
            .with_path(module_path.to_string())
            .with_span(import.span),
        ),
        NodeKind::Js | NodeKind::Cjs => {
            if !context.retained[target] {
                // 链接层剪除的动态目标：引用只可能落在死代码路径，文本
                // 原样保留并如实报告，不指向不存在的产物。
                warnings.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::dynamic_target_pruned_kept",
                        format!(
                            "动态 import `{}` 目标已被链接层剪除，说明符原样保留",
                            import.specifier
                        ),
                    )
                    .with_path(module_path.to_string())
                    .with_span(import.span),
                );
                return;
            }
            let Some(target_chunk) = chunk_of_node(context, target, module_path, errors) else {
                return;
            };
            match import.specifier_span {
                Some(span) => {
                    replacements.insert(span, json_string(&placeholder(target_chunk)));
                }
                None => errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::dynamic_unresolved",
                        format!("动态 import `{}` 缺少字面量 span，无法重写", import.specifier),
                    )
                    .with_path(module_path.to_string())
                    .with_span(import.span),
                ),
            }
        }
    }
}

/// scope 不完整原因的稳定标签（诊断消息用，kebab-case 与产物码风格一致）。
fn reason_label(reason: ScopeIncompleteReason) -> &'static str {
    match reason {
        ScopeIncompleteReason::DirectEval => "direct-eval",
        ScopeIncompleteReason::TemplateInterpolation => "template-interpolation",
        ScopeIncompleteReason::Jsx => "jsx",
        ScopeIncompleteReason::AmbiguousMemberKey => "ambiguous-member-key",
        ScopeIncompleteReason::Namespace => "namespace",
        ScopeIncompleteReason::EmptyBindingName => "empty-binding-name",
        ScopeIncompleteReason::ZeroWidthDeclarationSpan => "zero-width-declaration-span",
        ScopeIncompleteReason::DuplicateBinding => "duplicate-binding",
        ScopeIncompleteReason::BindingSpanMismatch => "binding-span-mismatch",
        ScopeIncompleteReason::TopLevelReturn => "top-level-return",
    }
}

fn contains(outer: (usize, usize), inner: (usize, usize)) -> bool {
    outer.0 <= inner.0 && inner.1 <= outer.1
}

fn inconsistent(message: String) -> PackDiagnostic {
    PackDiagnostic::new("vmz::pack::emit::input_inconsistent", message)
}
