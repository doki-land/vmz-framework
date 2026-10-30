//! 产物写出层：分包计划 → 最终 JS 文本、文件名/内容指纹、资源 URL 与 manifest。
//!
//! 语义模型（Living §Pack 第 6 条）：
//! - 在最终活跃 chunk 图上装配文本：chunk 成员按执行序取活跃语句切片，
//!   切片内做动态 import 占位符替换与资源 URL 替换，再经
//!   `vmz_generator::js::erase_types` 擦除 TypeScript 类型语法；跨 chunk
//!   的 import/export 语义用合成语句表达。
//! - 文件名 = chunk id slug + 内容指纹（sha256 前 8 hex）。chunk 间引用
//!   可能成环，不能拓扑展开，故用占位符两遍法：第一遍装配含占位符的
//!   文本并定指纹，第三遍把占位符替换为 `./<目标文件名>`。
//! - manifest 把逻辑入口映射回物理文件，资源以内容指纹命名落在
//!   `assets/` 子目录，URL = `public_base` + 文件名。
//! - 未实现的语义（同 chunk 重命名绑定、星号合成、同 chunk 动态边界、
//!   事实不完整、无法重写的说明符等）一律显式诊断拒绝，禁止猜测、
//!   禁止静默产出错误 JS、禁止兼容层。
//!
//! [`plan_emit`] 是纯计算（只按 [`crate::graph::ModuleNode::resolved`] 路径
//! 重读模块源码与资源字节，IO 姿态与 `graph` 层一致）；[`write_emit`]
//! 是唯一写盘的函数。输入必须是同一目标图上的 [`crate::graph::ModuleGraph`]、
//! [`crate::link::LinkPlan`] 与 [`crate::chunk::ChunkPlan`]，形状不一致
//! （越界、重复归属、未被链接保留）按 `vmz::pack::emit::input_inconsistent`
//! 拒绝。

mod assemble;
mod manifest;
mod write;

use std::collections::{BTreeMap, HashMap};
use std::path::{Component, Path, PathBuf};

use crate::chunk::ChunkPlan;
use crate::diag::PackDiagnostic;
use crate::graph::ModuleGraph;
use crate::link::{LinkPlan, LinkedModule};

pub use write::write_emit;

/// 模块事实不完整诊断在 `module` 层的稳定码，emit 前置拒绝据此判定。
const STATEMENT_FACT_INCOMPLETE: &str = "vmz::pack::module::statement_fact_incomplete";

/// chunk 引用占位符前缀；源码切片含此前缀即拒绝产出（防替换歧义）。
pub(crate) const PLACEHOLDER_PREFIX: &str = "__vmz_chunk_";

/// 生成 chunk 引用占位符（带完整 `__…__` 定界，第三遍整串替换）。
pub(crate) fn placeholder(chunk_index: usize) -> String {
    format!("{PLACEHOLDER_PREFIX}{chunk_index}__")
}

/// JSON 字符串字面量（含引号与转义），用于替换文本与合成语句。
pub(crate) fn json_string(value: &str) -> String {
    serde_json::to_string(value).expect("Rust String 的 JSON 序列化不可能失败")
}

/// 路径规范化：分隔符统一为 `/`，与 `chunk` 层 id 口径一致。
pub(crate) fn normalize_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// 产物写出选项。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmitOptions {
    /// 资源 URL 前缀（如 `/_vmz/`），只影响 [`AssetArtifact::url`]
    /// 与产物内联的资源字符串，不影响 chunk 文件互引（相对路径）。
    pub public_base: String,
}

/// 一个 chunk 的最终产物。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChunkArtifact {
    /// 对应的 [`crate::chunk::Chunk::id`]。
    pub chunk_id: String,
    /// 产物文件名（`<slug>-<hash8>.js`）。
    pub file_name: String,
    /// 最终 JS 文本（占位符已替换为 `./<目标文件名>`）。
    pub code: String,
    /// 成员模块规范化路径，按 chunk 内执行序。
    pub modules: Vec<String>,
    /// 依赖 chunk 的文件名，升序去重。
    pub imports: Vec<String>,
    /// 动态加载目标 chunk 的文件名，升序去重。
    pub dynamic: Vec<String>,
}

/// 一条资源产物引用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssetArtifact {
    /// 引用方模块规范化路径。
    pub module_path: String,
    /// 原字面量（`new URL` 第一实参）。
    pub specifier: String,
    /// 产物文件名（`assets/<stem>-<hex16>.<ext>`）。
    pub file_name: String,
    /// 资源 URL（`public_base` + 文件名）。
    pub url: String,
    /// 磁盘绝对路径，[`write_emit`] 阶段从此拷贝。
    pub source_path: String,
}

/// 产物计划：全部文本与元数据，[`write_emit`] 之前不落盘。
#[derive(Debug, Clone, PartialEq)]
pub struct EmitPlan {
    /// chunk 产物，按 chunk id 升序（与 [`ChunkPlan::chunks`] 同序）。
    pub artifacts: Vec<ChunkArtifact>,
    /// 资源产物，按 `(module_path, specifier)` 稳定序。
    pub assets: Vec<AssetArtifact>,
    /// 逻辑入口 → 产物文件名，按 [`ChunkPlan::entry_chunks`] 序。
    pub entry_files: Vec<(String, String)>,
    /// 动态加载映射：源 chunk 文件 → 目标 chunk 文件，去重升序。
    pub dynamic_files: Vec<(String, String)>,
    /// 序列化的产物 manifest（合同版本命名空间 `v0`）。
    pub manifest_json: String,
    /// 非致命诊断（保留的非字面量动态 import、命名空间加宽）。
    pub diagnostics: Vec<PackDiagnostic>,
}

/// assemble 与 manifest 共享的只读上下文。
pub(crate) struct EmitContext<'a> {
    pub graph: &'a ModuleGraph,
    pub chunks: &'a ChunkPlan,
    /// 节点 → 所属 chunk 索引（已校验越界与重复归属）。
    pub node_chunk: Vec<Option<usize>>,
    /// 链接层保留集合。
    pub retained: Vec<bool>,
    /// 节点 → 链接结果。
    pub linked: Vec<Option<&'a LinkedModule>>,
    /// chunk 成员模块源码（按 `resolved.path` 重读）。
    pub sources: HashMap<usize, String>,
    /// `(引用模块规范化路径, specifier)` → 资源产物。
    pub asset_index: BTreeMap<(String, String), AssetArtifact>,
}

/// 由模块图、链接计划与分包计划产出产物计划。
///
/// 任何前置拒绝或装配失败（事实不完整、名字冲突、未实现语义、读取
/// 失败、类型擦除失败、占位符碰撞、资源不可解析）都返回 `Err`，
/// 诊断携带相关文件路径；不产出部分结果。
pub fn plan_emit(
    graph: &ModuleGraph,
    link: &LinkPlan,
    chunks: &ChunkPlan,
    options: &EmitOptions,
) -> Result<EmitPlan, Vec<PackDiagnostic>> {
    let mut errors: Vec<PackDiagnostic> = Vec::new();
    let mut warnings: Vec<PackDiagnostic> = Vec::new();

    // 输入一致性：节点归属与依赖索引。
    let node_count = graph.nodes.len();
    let mut node_chunk: Vec<Option<usize>> = vec![None; node_count];
    for (chunk_index, chunk) in chunks.chunks.iter().enumerate() {
        for &node in &chunk.modules {
            if node >= node_count {
                errors.push(inconsistent(format!("chunk `{}` 引用越界节点索引 {node}", chunk.id)));
                continue;
            }
            if node_chunk[node].is_some() {
                errors.push(
                    inconsistent(format!("节点 {node} 同时属于多个 chunk"))
                        .with_path(normalize_path(&graph.nodes[node].resolved.path)),
                );
                continue;
            }
            node_chunk[node] = Some(chunk_index);
        }
        for &dep in &chunk.depends_on {
            if dep >= chunks.chunks.len() {
                errors.push(inconsistent(format!(
                    "chunk `{}` 引用越界依赖 chunk 索引 {dep}",
                    chunk.id
                )));
            }
        }
    }

    let mut retained = vec![false; node_count];
    let mut linked: Vec<Option<&LinkedModule>> = vec![None; node_count];
    for module in &link.modules {
        if module.node < node_count {
            retained[module.node] = true;
            linked[module.node] = Some(module);
        }
    }

    // 前置拒绝 + 重读源码。
    let mut sources: HashMap<usize, String> = HashMap::new();
    for chunk in &chunks.chunks {
        for &node in &chunk.modules {
            let Some(module_node) = graph.nodes.get(node) else { continue };
            let path_display = normalize_path(&module_node.resolved.path);
            if linked[node].is_none() {
                errors.push(
                    inconsistent(format!("chunk 成员未被链接层保留")).with_path(path_display),
                );
                continue;
            }
            // 事实不完整时名字唯一性检查不可信，宁拒绝不产出错误 JS。
            if module_node.record.path.is_none()
                || !module_node.diagnostics.is_empty()
                || module_node
                    .record
                    .diagnostics
                    .iter()
                    .any(|diagnostic| diagnostic.code == STATEMENT_FACT_INCOMPLETE)
            {
                errors.push(
                    PackDiagnostic::new(
                        "vmz::pack::emit::incomplete_facts",
                        "模块事实不完整，无法安全装配产物文本",
                    )
                    .with_path(path_display),
                );
                continue;
            }
            match std::fs::read_to_string(&module_node.resolved.path) {
                Ok(source) => {
                    sources.insert(node, source);
                }
                Err(err) => {
                    errors.push(
                        PackDiagnostic::new(
                            "vmz::pack::emit::read_failed",
                            format!("cannot re-read module file: {err}"),
                        )
                        .with_path(path_display),
                    );
                }
            }
        }
    }

    let (asset_index, asset_errors) = collect_assets(graph, chunks, &node_chunk, options);
    errors.extend(asset_errors);
    if !errors.is_empty() {
        return Err(errors);
    }

    let context = EmitContext { graph, chunks, node_chunk, retained, linked, sources, asset_index };

    // 第一遍装配（含占位符）。
    let mut codes: Vec<String> = Vec::with_capacity(chunks.chunks.len());
    for chunk_index in 0..chunks.chunks.len() {
        match assemble::assemble_chunk(&context, chunk_index, &mut errors, &mut warnings) {
            Some(code) => codes.push(code),
            None => codes.push(String::new()),
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    // 第二/三遍：指纹定名、占位符替换、manifest 序列化。
    Ok(manifest::finalize(&context, codes, warnings))
}

/// 解析并指纹化全部 [`crate::module::AssetFact`]。同一磁盘路径只读一次；
/// 读不到即 `vmz::pack::emit::asset_unresolved`（拒绝，不猜 URL）。
fn collect_assets(
    graph: &ModuleGraph,
    chunks: &ChunkPlan,
    node_chunk: &[Option<usize>],
    options: &EmitOptions,
) -> (BTreeMap<(String, String), AssetArtifact>, Vec<PackDiagnostic>) {
    let mut index: BTreeMap<(String, String), AssetArtifact> = BTreeMap::new();
    let mut by_disk: HashMap<PathBuf, (String, String)> = HashMap::new();
    let mut errors: Vec<PackDiagnostic> = Vec::new();
    for chunk in &chunks.chunks {
        for &node in &chunk.modules {
            if node_chunk[node].is_none() {
                continue;
            }
            let Some(module_node) = graph.nodes.get(node) else { continue };
            if module_node.record.path.is_none() {
                continue;
            }
            let module_path = normalize_path(&module_node.resolved.path);
            for asset in &module_node.record.assets {
                let key = (module_path.clone(), asset.specifier.clone());
                if index.contains_key(&key) {
                    continue;
                }
                let disk = match module_node.resolved.path.parent() {
                    Some(dir) => lexical_join(dir, &asset.specifier),
                    None => {
                        errors.push(asset_unresolved(
                            &module_path,
                            &asset.specifier,
                            "no parent dir",
                        ));
                        continue;
                    }
                };
                let (file_name, url) = match by_disk.get(&disk) {
                    Some(cached) => cached.clone(),
                    None => {
                        let bytes = match std::fs::read(&disk) {
                            Ok(bytes) => bytes,
                            Err(err) => {
                                errors.push(asset_unresolved(
                                    &module_path,
                                    &asset.specifier,
                                    &format!("{}: {err}", disk.display()),
                                ));
                                continue;
                            }
                        };
                        let stem = disk
                            .file_stem()
                            .map(|value| value.to_string_lossy().to_string())
                            .unwrap_or_else(|| "asset".to_string());
                        let extension = disk
                            .extension()
                            .map(|value| format!(".{}", value.to_string_lossy()))
                            .unwrap_or_default();
                        let file_name =
                            format!("assets/{stem}-{}{extension}", manifest::hex(&bytes, 16));
                        let url = format!("{}{file_name}", options.public_base);
                        by_disk.insert(disk.clone(), (file_name.clone(), url.clone()));
                        (file_name, url)
                    }
                };
                index.insert(
                    key,
                    AssetArtifact {
                        module_path: module_path.clone(),
                        specifier: asset.specifier.clone(),
                        file_name,
                        url,
                        source_path: disk.display().to_string(),
                    },
                );
            }
        }
    }
    (index, errors)
}

/// 词法 join：模块目录 + 说明符，按 `.`/`..` 词法折叠，不触碰文件系统。
fn lexical_join(dir: &Path, specifier: &str) -> PathBuf {
    let spec = Path::new(specifier);
    if spec.is_absolute() {
        return spec.to_path_buf();
    }
    let mut path = dir.to_path_buf();
    for component in spec.components() {
        match component {
            Component::Normal(segment) => path.push(segment),
            Component::ParentDir => {
                path.pop();
            }
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => {}
        }
    }
    path
}

fn inconsistent(message: String) -> PackDiagnostic {
    PackDiagnostic::new("vmz::pack::emit::input_inconsistent", message)
}

fn asset_unresolved(module_path: &str, specifier: &str, reason: &str) -> PackDiagnostic {
    PackDiagnostic::new(
        "vmz::pack::emit::asset_unresolved",
        format!("资源 `{specifier}` 无法解析为可读文件: {reason}"),
    )
    .with_path(module_path.to_string())
}
