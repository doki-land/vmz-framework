//! Pack 增量缓存：按内容摘要复用 chunk 最终文本与 source map。
//!
//! 判定只用内容摘要，不用 mtime、时间戳或「上次运行时间」：
//! - `graphDigest` 覆盖图结构（节点身份与类别、静态/动态边、chunk 划分、
//!   链接活跃结果、入口与动态边界）。它变化即整体失效，缓存条目全部丢弃。
//! - `inputDigest` 在 `graphDigest` 之上再覆盖每个节点的源文件字节与
//!   emit 选项，用于如实报告「本次 pack 的输入摘要」。
//! - 单个 chunk 的键覆盖占位符替换后的文本、成员模块、成员源文本摘要、
//!   装配段与 emit 选项；键相同即最终文本与 map 逐字节相同，直接复用。
//!
//! 缓存落在输出目录的 `.vmz-pack-cache/`：`index.json` 记录版本与两个摘要，
//! 每 chunk 一个条目文件。未被本次构建使用的条目文件在写回时删除，避免
//! 缓存孤儿；条目文件不属于交付闭包。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::chunk::ChunkPlan;
use crate::graph::ModuleGraph;
use crate::link::LinkPlan;

use super::EmitOptions;
use super::manifest::hex;

/// 缓存子目录（相对输出目录）。
pub(crate) const CACHE_DIR: &str = ".vmz-pack-cache";
/// 缓存格式版本；形状变化必须递增，旧版本按空缓存处理。
const CACHE_VERSION: u32 = 1;

/// 一次 pack 的输入摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PackDigests {
    /// 图结构与链接/分包结果摘要：变化即整体失效。
    pub graph: String,
    /// 图摘要 + 全部节点源字节 + emit 选项。
    pub input: String,
}

/// 由图、链接与分包结果计算两个摘要。
///
/// 序列化是确定性的纯文本：节点按索引、边按源码顺序、chunk 按计划顺序；
/// 路径统一 `/` 分隔，不写时间戳。
pub(crate) fn pack_digests(
    graph: &ModuleGraph,
    link: &LinkPlan,
    chunks: &ChunkPlan,
    options: &EmitOptions,
) -> PackDigests {
    let mut hasher = Sha256::new();
    hasher.update(b"vmz-pack-graph-v1\0");
    hasher.update(format!("target={:?}\0", graph.target).as_bytes());
    // 节点与边一律用 chunk id 同款可移植相对标签，不把机器绝对路径写进摘要：
    // 同相对布局换目录、换机器仍是同一图摘要。
    for entry in &graph.entries {
        hasher.update(
            format!("entry {}={}\0", entry.logical, crate::chunk::relative_label(graph, &entry.id))
                .as_bytes(),
        );
    }
    for (index, node) in graph.nodes.iter().enumerate() {
        hasher.update(
            format!(
                "node {index} {:?} {}\0",
                node.kind,
                crate::chunk::relative_label(graph, &node.resolved.path)
            )
            .as_bytes(),
        );
        for edge in node.static_edges.iter().chain(node.dynamic_edges.iter()) {
            let target = match &edge.target {
                Ok(id) => crate::chunk::relative_label(graph, id),
                Err(diagnostic) => format!("err:{}", diagnostic.code),
            };
            hasher.update(format!("edge {:?} {} {target}\0", edge.kind, edge.specifier).as_bytes());
        }
    }
    for module in &link.modules {
        hasher.update(
            format!(
                "linked {} active={:?} targets={:?} dynamic={:?} reexports={:?}\0",
                crate::chunk::relative_label(graph, &graph.nodes[module.node].resolved.path),
                module.active_statements,
                module.used_targets,
                module.dynamic_edges,
                module.used_reexports
            )
            .as_bytes(),
        );
    }
    for chunk in &chunks.chunks {
        let modules: Vec<String> = chunk
            .modules
            .iter()
            .map(|&node| crate::chunk::relative_label(graph, &graph.nodes[node].resolved.path))
            .collect();
        let depends: Vec<&str> =
            chunk.depends_on.iter().map(|&index| chunks.chunks[index].id.as_str()).collect();
        hasher.update(format!("chunk {} {modules:?} deps={depends:?}\0", chunk.id).as_bytes());
    }
    for (logical, index) in &chunks.entry_chunks {
        hasher.update(format!("entry_chunk {logical}={}\0", chunks.chunks[*index].id).as_bytes());
    }
    for (from, to) in &chunks.dynamic_boundaries {
        hasher.update(
            format!(
                "dynamic {}->{}\0",
                crate::chunk::relative_label(graph, &graph.nodes[*from].resolved.path),
                chunks.chunks[*to].id
            )
            .as_bytes(),
        );
    }
    let graph_digest = digest_hex(&hasher.finalize(), 32);

    let mut input_hasher = Sha256::new();
    input_hasher.update(graph_digest.as_bytes());
    input_hasher.update(
        format!("\0public_base={}\0minify={}", options.public_base, options.minify).as_bytes(),
    );
    for node in &graph.nodes {
        let path = &node.resolved.path;
        input_hasher.update(super::normalize_path(path).as_bytes());
        input_hasher.update([0u8]);
        match fs::read(path) {
            Ok(bytes) => input_hasher.update(digest_hex(&Sha256::digest(&bytes), 32).as_bytes()),
            Err(error) => input_hasher.update(format!("unreadable:{error}").as_bytes()),
        };
        input_hasher.update([0u8]);
    }
    PackDigests { graph: graph_digest, input: digest_hex(&input_hasher.finalize(), 32) }
}

fn digest_hex(bytes: &[u8], digits: usize) -> String {
    bytes
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0F])
        .take(digits)
        .map(|nibble| char::from_digit(u32::from(nibble), 16).unwrap_or('0'))
        .collect()
}

/// 一个 chunk 的缓存条目（最终文本与 map）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
    key: String,
    code: String,
    source_map: String,
}

/// `index.json` 形状。
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheIndex {
    version: u32,
    graph_digest: String,
    input_digest: String,
    /// chunk id → 条目键。
    entries: BTreeMap<String, String>,
}

/// 增量缓存句柄。`disabled()` 表示纯计算入口（测试与 `packPlan`），
/// 不读盘也不写盘。
#[derive(Debug)]
pub struct EmitCache {
    enabled: bool,
    dir: Option<PathBuf>,
    graph_digest: String,
    input_digest: String,
    graph_changed: bool,
    entries: BTreeMap<String, CacheEntry>,
    used: BTreeSet<String>,
    dirty: BTreeSet<String>,
}

impl EmitCache {
    /// 不启用缓存的纯计算实例。
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            dir: None,
            graph_digest: String::new(),
            input_digest: String::new(),
            graph_changed: true,
            entries: BTreeMap::new(),
            used: BTreeSet::new(),
            dirty: BTreeSet::new(),
        }
    }

    /// 从输出目录读取缓存；缺失、版本不符或损坏都按空缓存处理。
    pub fn load(out_dir: &Path) -> Self {
        let dir = out_dir.join(CACHE_DIR);
        let mut cache = Self { enabled: true, dir: Some(dir.clone()), ..Self::disabled() };
        let Ok(text) = fs::read_to_string(dir.join("index.json")) else {
            return cache;
        };
        let Ok(index) = serde_json::from_str::<CacheIndex>(&text) else {
            return cache;
        };
        if index.version != CACHE_VERSION {
            return cache;
        }
        for (chunk_id, key) in &index.entries {
            let path = dir.join(entry_file_name(chunk_id));
            let Ok(text) = fs::read_to_string(&path) else {
                continue;
            };
            let Ok(entry) = serde_json::from_str::<CacheEntry>(&text) else {
                continue;
            };
            if &entry.key != key {
                continue;
            }
            cache.entries.insert(chunk_id.clone(), entry);
        }
        cache.graph_digest = index.graph_digest;
        cache.input_digest = index.input_digest;
        cache
    }

    /// 绑定本次摘要。`graphDigest` 变化即整体失效（条目全部丢弃）。
    pub(crate) fn rebind(&mut self, digests: &PackDigests) {
        self.graph_changed = self.graph_digest != digests.graph;
        if self.graph_changed {
            self.entries.clear();
            self.dirty.clear();
        }
        self.graph_digest = digests.graph.clone();
        self.input_digest = digests.input.clone();
    }

    /// 图结构相对上一次构建是否变化；变化时禁止任何 chunk 复用。
    pub fn graph_changed(&self) -> bool {
        self.graph_changed
    }

    /// 本次输入的摘要。
    pub fn input_digest(&self) -> &str {
        &self.input_digest
    }

    /// 本次图摘要。
    pub fn graph_digest(&self) -> &str {
        &self.graph_digest
    }

    /// 命中则返回 `(最终文本, source map JSON)`，否则 `None`。
    pub(crate) fn lookup(&mut self, chunk_id: &str, key: &str) -> Option<(String, String)> {
        if !self.enabled {
            return None;
        }
        let entry = self.entries.get(chunk_id)?;
        if entry.key != key {
            return None;
        }
        self.used.insert(chunk_id.to_string());
        Some((entry.code.clone(), entry.source_map.clone()))
    }

    /// 记录本次生成的条目。
    pub(crate) fn record(&mut self, chunk_id: &str, key: &str, code: String, source_map: String) {
        if !self.enabled {
            return;
        }
        self.used.insert(chunk_id.to_string());
        let changed = self.entries.get(chunk_id).map(|old| old.key != key).unwrap_or(true);
        let entry = CacheEntry { key: key.to_string(), code, source_map };
        self.entries.insert(chunk_id.to_string(), entry);
        if changed {
            self.dirty.insert(chunk_id.to_string());
        }
    }

    /// 是否启用。
    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// 写回缓存：索引 + 变更条目，删除本次未使用的条目文件。
    pub fn store(mut self) -> std::io::Result<()> {
        if !self.enabled {
            return Ok(());
        }
        let Some(dir) = self.dir.as_deref() else {
            return Ok(());
        };
        fs::create_dir_all(dir)?;
        for chunk_id in &self.dirty {
            let Some(entry) = self.entries.get(chunk_id) else { continue };
            if !self.used.contains(chunk_id) {
                continue;
            }
            let path = dir.join(entry_file_name(chunk_id));
            let text = serde_json::to_string(entry)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            fs::write(&path, text)?;
        }
        // 未被本次构建使用的条目文件是缓存孤儿，直接删除文件本身（非递归）。
        let expected: BTreeSet<PathBuf> =
            self.used.iter().map(|chunk_id| dir.join(entry_file_name(chunk_id))).collect();
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || expected.contains(&path) {
                    continue;
                }
                if entry.file_name() == "index.json" {
                    continue;
                }
                let _ = fs::remove_file(&path);
            }
        }
        let index = CacheIndex {
            version: CACHE_VERSION,
            graph_digest: self.graph_digest.clone(),
            input_digest: self.input_digest.clone(),
            entries: self
                .used
                .iter()
                .filter_map(|chunk_id| {
                    self.entries.get(chunk_id).map(|entry| (chunk_id.clone(), entry.key.clone()))
                })
                .collect(),
        };
        let text = serde_json::to_string(&index)
            .map_err(|error| std::io::Error::other(error.to_string()))?;
        fs::write(dir.join("index.json"), text)?;
        self.dirty.clear();
        Ok(())
    }
}

/// 条目文件名：chunk id slug + chunk id 摘要前 8 hex，避免 slug 截断冲突。
fn entry_file_name(chunk_id: &str) -> String {
    format!("{}-{}.json", super::manifest::slug(chunk_id), hex(chunk_id.as_bytes(), 8))
}
