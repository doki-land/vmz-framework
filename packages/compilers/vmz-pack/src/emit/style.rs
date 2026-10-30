//! Style 聚合：chunk 成员执行序 × 有序静态边 → 每 chunk 一个 CSS 产物。
//!
//! 合同（Living §Pack）：
//! - 级联/副作用顺序是合同：按 chunk 成员执行序、成员内静态边源码序
//!   收集 Style 节点，同 chunk 内同身份去重先到先得；不重排、不按体积
//!   或路径启发式合并。
//! - 可达性即宿主活跃性：只有分包后 chunk 成员（链接层保留的 JS 模块）
//!   的边才贡献级联；死模块与被剪枝分支的 CSS 不读取、不输出。
//! - 产物文本 = 各节点重写后文本按序 `\n` 拼接，整体指纹定名
//!   （`style-<hash8>.css`，规则与 chunk 一致复用 [`super::manifest::hex`]）。
//! - CSS 内相对 `url()` 按 asset 规则搬迁：与 JS 资产共享同一磁盘缓存与
//!   命名（`assets/<stem>-<hex16>.<ext>`），重写为 `./assets/…` 相对路径；
//!   读不到即显式拒绝，不猜 URL、不静默保留错误路径。
//! - `@import` 跨文件级联未实现：显式拒绝，禁止静默拼接错误顺序。

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::PathBuf;

use crate::chunk::ChunkPlan;
use crate::diag::PackDiagnostic;
use crate::graph::{ModuleGraph, NodeKind};

use super::assemble::apply_replacements;
use super::manifest::hex;
use super::{AssetArtifact, EmitOptions, StyleArtifact, lexical_join, normalize_path};

/// 按 chunk 聚合 CSS 产物；失败（读取、`@import`、`url()` 不可解析）推入
/// `errors`，该 chunk 不产出条目。资产缓存与 `collect_assets` 共享，
/// CSS 派生资产经同一 `asset_index` 进入 [`super::write_emit`] 拷贝。
pub(crate) fn collect_styles(
    graph: &ModuleGraph,
    chunks: &ChunkPlan,
    retained: &[bool],
    asset_index: &mut BTreeMap<(String, String), AssetArtifact>,
    by_disk: &mut HashMap<PathBuf, (String, String)>,
    options: &EmitOptions,
    errors: &mut Vec<PackDiagnostic>,
) -> Vec<StyleArtifact> {
    // 节点重写文本缓存：`None` = 已失败（诊断已推入，不重复报）。
    let mut cache: HashMap<usize, Option<String>> = HashMap::new();
    let mut artifacts = Vec::new();
    for chunk in &chunks.chunks {
        let mut seen_styles: HashSet<usize> = HashSet::new();
        let mut seen_members: HashSet<usize> = HashSet::new();
        let mut texts: Vec<String> = Vec::new();
        let mut source_paths: Vec<String> = Vec::new();
        let mut modules: Vec<String> = Vec::new();
        let mut failed = false;
        for &member in &chunk.modules {
            let Some(member_node) = graph.nodes.get(member) else { continue };
            if member_node.kind != NodeKind::Js {
                continue;
            }
            let member_path = normalize_path(&member_node.resolved.path);
            for edge in &member_node.static_edges {
                let Ok(id) = edge.target.as_ref() else { continue };
                let Some(target) = graph.index_of(id) else { continue };
                if !retained.get(target).copied().unwrap_or(false) {
                    continue;
                }
                let Some(target_node) = graph.nodes.get(target) else { continue };
                if target_node.kind != NodeKind::Style {
                    continue;
                }
                let rewritten = match cache.get(&target) {
                    Some(cached) => cached.clone(),
                    None => {
                        let built = rewrite_style_file(
                            graph,
                            target,
                            asset_index,
                            by_disk,
                            options,
                            errors,
                        );
                        cache.insert(target, built.clone());
                        built
                    }
                };
                match &rewritten {
                    Some(_) => {
                        // 来源模块按执行序记录所有引用成员（含被去重的引用：
                        // 先到先得只影响正文拼接，不影响 provenance）。
                        if seen_members.insert(member) {
                            modules.push(member_path.clone());
                        }
                    }
                    None => failed = true,
                }
                // 同 chunk 同身份去重：先到先得，重复引用不重复拼接。
                if seen_styles.insert(target) {
                    if let Some(text) = rewritten {
                        source_paths.push(normalize_path(&target_node.resolved.path));
                        texts.push(text);
                    }
                }
            }
        }
        if failed || texts.is_empty() {
            continue;
        }
        let content = texts.join("\n");
        let file_name = format!("style-{}.css", hex(content.as_bytes(), 8));
        let url = format!("{}{file_name}", options.public_base);
        artifacts.push(StyleArtifact { file_name, url, content, modules, source_paths });
    }
    artifacts
}

/// 读取并重写单个 CSS 文件：`@import` 显式拒绝、相对 `url()` 搬迁重写。
fn rewrite_style_file(
    graph: &ModuleGraph,
    node: usize,
    asset_index: &mut BTreeMap<(String, String), AssetArtifact>,
    by_disk: &mut HashMap<PathBuf, (String, String)>,
    options: &EmitOptions,
    errors: &mut Vec<PackDiagnostic>,
) -> Option<String> {
    let path = &graph.nodes[node].resolved.path;
    let path_display = normalize_path(path);
    let text = match std::fs::read_to_string(path) {
        Ok(text) => text,
        Err(err) => {
            errors.push(
                PackDiagnostic::new(
                    "vmz::pack::emit::read_failed",
                    format!("cannot re-read style file: {err}"),
                )
                .with_path(path_display),
            );
            return None;
        }
    };
    let scan = scan_css(text.as_bytes());
    if let Some(span) = scan.import {
        errors.push(
            PackDiagnostic::new(
                "vmz::pack::emit::style_import_unsupported",
                "CSS `@import` 跨文件级联未实现，显式拒绝；不静默拼接错误顺序",
            )
            .with_path(path_display.clone())
            .with_span(span),
        );
        return None;
    }
    let Some(dir) = path.parent() else {
        return Some(text);
    };
    let mut replacements: BTreeMap<(usize, usize), String> = BTreeMap::new();
    for url_ref in scan.urls {
        let value = &text[url_ref.value_span.0..url_ref.value_span.1];
        if !is_relocatable(value) {
            continue;
        }
        let disk = lexical_join(dir, value);
        let key = (path_display.clone(), value.to_string());
        let file_name = match asset_index.get(&key) {
            Some(existing) => existing.file_name.clone(),
            None => {
                let (file_name, url) = match by_disk.get(&disk) {
                    Some(cached) => cached.clone(),
                    None => {
                        let bytes = match std::fs::read(&disk) {
                            Ok(bytes) => bytes,
                            Err(err) => {
                                errors.push(
                                    PackDiagnostic::new(
                                        "vmz::pack::emit::style_asset_unresolved",
                                        format!(
                                            "CSS `url()` 资源 `{value}` 无法解析为可读文件: {}: {err}",
                                            disk.display()
                                        ),
                                    )
                                    .with_path(path_display.clone())
                                    .with_span(url_ref.value_span),
                                );
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
                        let file_name = format!("assets/{stem}-{}{extension}", hex(&bytes, 16));
                        let url = format!("{}{file_name}", options.public_base);
                        by_disk.insert(disk.clone(), (file_name.clone(), url.clone()));
                        (file_name, url)
                    }
                };
                asset_index.insert(
                    key,
                    AssetArtifact {
                        module_path: path_display.clone(),
                        specifier: value.to_string(),
                        file_name: file_name.clone(),
                        url,
                        source_path: disk.display().to_string(),
                    },
                );
                file_name
            }
        };
        let new_value = format!("./{file_name}");
        // quoted：只换引号内文本，保留原引号；unquoted：补双引号防歧义。
        let replacement = if url_ref.quoted { new_value } else { super::json_string(&new_value) };
        replacements.insert(url_ref.value_span, replacement);
    }
    match apply_replacements(&text, 0, replacements) {
        Ok(rewritten) => Some(rewritten),
        Err(diagnostic) => {
            errors.push(diagnostic.with_path(path_display));
            None
        }
    }
}

/// 一次 `url()` 引用：值文本 span 与是否带引号。
struct UrlRef {
    value_span: (usize, usize),
    quoted: bool,
}

/// CSS 扫描结果：首个 `@import` 位置与全部 `url()` 引用。
struct Scan {
    import: Option<(usize, usize)>,
    urls: Vec<UrlRef>,
}

/// 字节级 CSS 词法扫描：跳过注释与字符串，检出 `@import` 与 `url()`。
/// 只识别搬迁所需的最小词法，不做完整 CSS 解析；任何形态拿不准都按
/// 原文保留（搬迁失败会显式拒绝，不存在静默错误输出）。
fn scan_css(bytes: &[u8]) -> Scan {
    let mut import = None;
    let mut urls: Vec<UrlRef> = Vec::new();
    let len = bytes.len();
    let mut i = 0usize;
    while i < len {
        match bytes[i] {
            b'/' if i + 1 < len && bytes[i + 1] == b'*' => {
                i += 2;
                while i + 1 < len && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = i + 2;
            }
            quote @ (b'\'' | b'"') => {
                i = skip_string(bytes, i, quote);
            }
            b'@' => {
                if import.is_none()
                    && matches_ignore_case(bytes, i + 1, b"import")
                    && !bytes.get(i + 7).is_some_and(|b| is_ident_byte(*b))
                {
                    import = Some((i, i + 7));
                }
                i += 1;
            }
            b'u' | b'U' => {
                let boundary = i == 0 || !is_ident_byte(bytes[i - 1]);
                if !boundary {
                    i += 1;
                    continue;
                }
                match try_url(bytes, i) {
                    Some((url_ref, next)) => {
                        urls.push(url_ref);
                        i = next;
                    }
                    None => i += 1,
                }
            }
            _ => i += 1,
        }
    }
    Scan { import, urls }
}

/// 从 `start`（引号处）跳过字符串字面量，返回结束后的位置。
fn skip_string(bytes: &[u8], start: usize, quote: u8) -> usize {
    let mut i = start + 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b if b == quote => return i + 1,
            _ => i += 1,
        }
    }
    bytes.len()
}

/// 在 `start`（`u`/`U` 处）尝试匹配 `url( … )`；成功返回引用与 `)` 后位置。
fn try_url(bytes: &[u8], start: usize) -> Option<(UrlRef, usize)> {
    if !matches_ignore_case(bytes, start + 1, b"rl") {
        return None;
    }
    let mut i = start + 3;
    i = skip_ws(bytes, i);
    if i >= bytes.len() || bytes[i] != b'(' {
        return None;
    }
    i = skip_ws(bytes, i + 1);
    if i >= bytes.len() {
        return None;
    }
    match bytes[i] {
        quote @ (b'\'' | b'"') => {
            let value_start = i + 1;
            let mut j = value_start;
            while j < bytes.len() {
                match bytes[j] {
                    b'\\' => j += 2,
                    b if b == quote => break,
                    _ => j += 1,
                }
            }
            if j >= bytes.len() {
                return None;
            }
            Some((UrlRef { value_span: (value_start, j), quoted: true }, j + 1))
        }
        b')' | b';' | b'}' => None,
        _ => {
            let value_start = i;
            let mut j = value_start;
            while j < bytes.len() && bytes[j] != b')' && !is_ws(bytes[j]) {
                j += 1;
            }
            if j >= bytes.len() || j == value_start {
                return None;
            }
            Some((UrlRef { value_span: (value_start, j), quoted: false }, j))
        }
    }
}

/// 值是否可搬迁：空、片段、根相对/协议相对不搬；含 scheme（冒号先于
/// 任何路径分隔符，覆盖 `http:`/`data:`/Windows 盘符）不搬；其余按
/// 相对路径词法解析。
fn is_relocatable(value: &str) -> bool {
    if value.is_empty() || value.starts_with('#') || value.starts_with('/') {
        return false;
    }
    match value.find(':') {
        Some(colon) => value[..colon].contains('/') || value[..colon].contains('\\'),
        None => true,
    }
}

fn matches_ignore_case(bytes: &[u8], at: usize, word: &[u8]) -> bool {
    at + word.len() <= bytes.len()
        && bytes[at..at + word.len()].iter().zip(word).all(|(a, b)| a.eq_ignore_ascii_case(b))
}

fn skip_ws(bytes: &[u8], mut i: usize) -> usize {
    while i < bytes.len() && is_ws(bytes[i]) {
        i += 1;
    }
    i
}

fn is_ws(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0C)
}

fn is_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-' || byte >= 0x80
}
