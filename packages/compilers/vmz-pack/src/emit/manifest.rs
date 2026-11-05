//! 文件名与内容指纹（占位符两遍法的第二/三遍）、chunk 压缩、token 级
//! source map v3 复合映射以及 manifest 序列化。
//!
//! 指纹只覆盖第一遍装配文本（含占位符）：chunk 间引用成环时无法拓扑定名，
//! 占位符把「引用目标」与「目标最终名」解耦，同输入必同输出，禁止随机或
//! 时间戳。第三遍占位符替换不增删行且段全在列 0；随后按装配行映射压缩
//! （`vmz_generator::js::minify_source`，token 级、不重命名标识符）并把压缩
//! token 位置复合回原模块，`sourceMappingURL` 注释行在压缩完成后追加，
//! 压缩与注释都不参与指纹。manifest 合同版本命名空间固定 `v0`。

use std::collections::BTreeMap;

use serde::Serialize;
use sha2::{Digest, Sha256};
use vmz_generator::js::{SourceMapSegment, source_map_json};

use super::assemble::ChunkSegment;
use super::cache::{EmitCache, PackDigests};
use super::{
    AssetArtifact, ChunkArtifact, EmitContext, EmitOptions, EmitPlan, StyleArtifact,
    normalize_path, placeholder,
};

/// sha256 摘要的前 `digits` 位十六进制（小写）。
pub(crate) fn hex(bytes: &[u8], digits: usize) -> String {
    Sha256::digest(bytes)
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0F])
        .take(digits)
        .map(|nibble| char::from_digit(u32::from(nibble), 16).unwrap_or('0'))
        .collect()
}

/// chunk id → 文件名 slug：非 `[A-Za-z0-9._-]` 一律换 `-`，超 80 截断。
pub(crate) fn slug(chunk_id: &str) -> String {
    let mut out: String = chunk_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' })
        .collect();
    out.truncate(80);
    out
}

/// 单 chunk 的缓存键：覆盖决定最终文本与 map 的全部输入。
///
/// 键相同的充要条件是两个 chunk 在压缩与 source map 阶段会产出相同字节：
/// 替换后文本（含跨 chunk 引用文件名）、自身文件名、压缩选项、装配段与
/// 成员源文本摘要。不含时间戳、mtime 或运行序号。
fn chunk_key(
    chunk_id: &str,
    file_name: &str,
    options: &EmitOptions,
    text: &str,
    segments: &[ChunkSegment],
    sources: &[String],
    sources_content: &[String],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"vmz-pack-chunk-v1\0");
    hasher.update(chunk_id.as_bytes());
    hasher.update([0u8]);
    hasher.update(file_name.as_bytes());
    hasher.update(format!("\0minify={}\0", options.minify).as_bytes());
    hasher.update(text.as_bytes());
    hasher.update([0u8]);
    for segment in segments {
        hasher.update(
            format!(
                "{}|{}|{}|{}\0",
                segment.gen_line, segment.source, segment.src_line, segment.src_col
            )
            .as_bytes(),
        );
    }
    for source in sources {
        hasher.update(source.as_bytes());
        hasher.update([0u8]);
    }
    for content in sources_content {
        hasher.update(hex(content.as_bytes(), 64).as_bytes());
        hasher.update([0u8]);
    }
    let digest = hasher.finalize();
    digest
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0F])
        .map(|nibble| char::from_digit(u32::from(nibble), 16).unwrap_or('0'))
        .collect()
}

/// 第二遍：按第一遍文本定指纹与文件名；第三遍：占位符整串替换为
/// `./<目标文件名>`；随后按行级映射段组装每 chunk 的 source map v3、
/// 追加 `sourceMappingURL` 注释行，并组装产物、入口映射、动态映射与 manifest。
///
/// 每 chunk 的最终文本与 map 由内容摘要键决定：键命中缓存即逐字节复用，
/// 未命中才做压缩与复合映射。键覆盖替换后文本、文件名、装配段、成员源
/// 文本与 emit 选项，因此复用与全量重建的结果必然一致。
pub(crate) fn finalize(
    context: &EmitContext<'_>,
    options: &EmitOptions,
    codes: Vec<String>,
    segments: Vec<Vec<ChunkSegment>>,
    styles: Vec<StyleArtifact>,
    warnings: Vec<PackDiagnostic>,
    cache: &mut EmitCache,
    digests: &PackDigests,
) -> Result<EmitPlan, Vec<PackDiagnostic>> {
    let file_names: Vec<String> = codes
        .iter()
        .enumerate()
        .map(|(index, code)| {
            format!("{}-{}.js", slug(&context.chunks.chunks[index].id), hex(code.as_bytes(), 8))
        })
        .collect();
    let codes: Vec<String> = codes
        .iter()
        .map(|code| {
            let mut replaced = code.clone();
            for (index, name) in file_names.iter().enumerate() {
                replaced = replaced.replace(&placeholder(index), &format!("./{name}"));
            }
            replaced
        })
        .collect();

    // 行级 source map v3 的装配段 → 压缩后的 token 级复合映射：装配段把
    // chunk 文本行映射回原模块行（列取切片起点），压缩段把压缩文本的
    // token 位置映射回 chunk 文本行；复合后生成侧列精确到 token，源侧
    // 列仍是行级的切片起点列。`sources` 按 chunk 成员节点序（与 manifest
    // `modules` 同口径，chunk 内节点不重复），`sourcesContent` 内嵌原模块
    // 文本使 map 自包含；map 文件名恒 `<file_name>.map`，内容不上 wire。
    let map_file_names: Vec<String> = file_names.iter().map(|name| format!("{name}.map")).collect();
    let mut final_codes: Vec<String> = Vec::with_capacity(file_names.len());
    let mut source_maps: Vec<String> = Vec::with_capacity(file_names.len());
    for (index, chunk) in context.chunks.chunks.iter().enumerate() {
        let sources: Vec<String> = chunk
            .modules
            .iter()
            .map(|&node| normalize_path(&context.graph.nodes[node].resolved.path))
            .collect();
        let sources_content: Vec<String> =
            chunk.modules.iter().map(|&node| context.sources[&node].clone()).collect();
        let key = chunk_key(
            &chunk.id,
            &file_names[index],
            options,
            &codes[index],
            &segments[index],
            &sources,
            &sources_content,
        );
        let (text, map_json) = match cache.lookup(&chunk.id, &key) {
            Some(hit) => hit,
            None => {
                let src_index_of: BTreeMap<&str, u32> =
                    sources.iter().enumerate().map(|(i, path)| (path.as_str(), i as u32)).collect();
                let mut line_map: BTreeMap<u32, (u32, u32, u32)> = BTreeMap::new();
                for segment in &segments[index] {
                    line_map.insert(
                        segment.gen_line,
                        (
                            src_index_of.get(segment.source.as_str()).copied().unwrap_or(0),
                            segment.src_line,
                            segment.src_col,
                        ),
                    );
                }
                let mut text = codes[index].clone();
                let mut mapped: Vec<SourceMapSegment> = if options.minify {
                    let (minified, tokens) = vmz_generator::js::minify_source(&codes[index])
                        .map_err(|error| {
                            vec![
                                PackDiagnostic::new("vmz::pack::emit::minify_failed", error)
                                    .with_path(&file_names[index]),
                            ]
                        })?;
                    // 压缩段把压缩文本 token 位置映射回 chunk 文本行，再经装配行映射
                    // 复合到原模块：生成侧列精确到 token，源侧列仍是行级切片起点列。
                    text = minified;
                    tokens
                        .iter()
                        .filter_map(|token| {
                            let &(src_index, src_line, src_col) =
                                line_map.range(..=token.src_line).next_back()?.1;
                            Some(SourceMapSegment {
                                gen_line: token.gen_line,
                                gen_col: token.gen_col,
                                src_index,
                                src_line,
                                src_col,
                            })
                        })
                        .collect()
                } else {
                    segments[index]
                        .iter()
                        .map(|segment| SourceMapSegment {
                            gen_line: segment.gen_line,
                            gen_col: 0,
                            src_index: src_index_of
                                .get(segment.source.as_str())
                                .copied()
                                .unwrap_or(0),
                            src_line: segment.src_line,
                            src_col: segment.src_col,
                        })
                        .collect()
                };
                mapped.sort_by_key(|segment| (segment.gen_line, segment.gen_col));
                let map_json =
                    source_map_json(&file_names[index], &sources, &sources_content, &mapped);
                if !text.ends_with('\n') {
                    text.push('\n');
                }
                text.push_str(&format!("//# sourceMappingURL={}\n", map_file_names[index]));
                cache.record(&chunk.id, &key, text.clone(), map_json.clone());
                (text, map_json)
            }
        };
        final_codes.push(text);
        source_maps.push(map_json);
    }

    // 动态边界 → 每个 chunk 的动态目标文件名 + 全局动态文件映射。
    let mut dynamic_of_chunk: Vec<std::collections::BTreeSet<String>> =
        vec![std::collections::BTreeSet::new(); file_names.len()];
    let mut dynamic_files: std::collections::BTreeSet<(String, String)> =
        std::collections::BTreeSet::new();
    for (source_node, target_chunk) in &context.chunks.dynamic_boundaries {
        let Some(source_chunk) = context.node_chunk.get(*source_node).copied().flatten() else {
            continue;
        };
        if *target_chunk >= file_names.len() {
            continue;
        }
        let from = file_names[source_chunk].clone();
        let to = file_names[*target_chunk].clone();
        dynamic_of_chunk[source_chunk].insert(to.clone());
        dynamic_files.insert((from, to));
    }

    let artifacts: Vec<ChunkArtifact> = context
        .chunks
        .chunks
        .iter()
        .enumerate()
        .map(|(index, chunk)| ChunkArtifact {
            chunk_id: chunk.id.clone(),
            file_name: file_names[index].clone(),
            code: final_codes[index].clone(),
            modules: chunk
                .modules
                .iter()
                .map(|&node| normalize_path(&context.graph.nodes[node].resolved.path))
                .collect(),
            imports: chunk.depends_on.iter().map(|&dep| file_names[dep].clone()).collect(),
            dynamic: dynamic_of_chunk[index].clone().into_iter().collect(),
            source_map: source_maps[index].clone(),
        })
        .collect();

    let entry_files: Vec<(String, String)> = context
        .chunks
        .entry_chunks
        .iter()
        .map(|(logical, chunk_index)| (logical.clone(), file_names[*chunk_index].clone()))
        .collect();

    let assets: Vec<AssetArtifact> = context.asset_index.values().cloned().collect();

    let manifest_json =
        render_manifest(&artifacts, &map_file_names, &entry_files, &assets, digests);
    Ok(EmitPlan {
        artifacts,
        styles,
        assets,
        entry_files,
        dynamic_files: dynamic_files.into_iter().collect(),
        manifest_json,
        diagnostics: warnings,
        graph_digest: digests.graph.clone(),
        input_digest: digests.input.clone(),
    })
}

/// manifest 形状：Rust 字段名为真相源，serde 只做容器级 camelCase 映射。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestChunk<'a> {
    id: &'a str,
    file: &'a str,
    modules: &'a [String],
    imports: &'a [String],
    dynamic: &'a [String],
    source_map: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestEntry<'a> {
    logical: &'a str,
    file: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ManifestAsset<'a> {
    module: &'a str,
    specifier: &'a str,
    file: &'a str,
    url: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EmitManifest<'a> {
    version: &'a str,
    /// 本次 pack 输入摘要（图结构 + 源字节 + emit 选项）。
    input_digest: &'a str,
    /// 图结构摘要：变化即整体失效，不允许部分 chunk 复用。
    graph_digest: &'a str,
    chunks: Vec<ManifestChunk<'a>>,
    entries: Vec<ManifestEntry<'a>>,
    assets: Vec<ManifestAsset<'a>>,
}

fn render_manifest(
    artifacts: &[ChunkArtifact],
    map_file_names: &[String],
    entry_files: &[(String, String)],
    assets: &[AssetArtifact],
    digests: &PackDigests,
) -> String {
    let manifest = EmitManifest {
        version: "v0",
        input_digest: &digests.input,
        graph_digest: &digests.graph,
        chunks: artifacts
            .iter()
            .enumerate()
            .map(|(index, artifact)| ManifestChunk {
                id: &artifact.chunk_id,
                file: &artifact.file_name,
                modules: &artifact.modules,
                imports: &artifact.imports,
                dynamic: &artifact.dynamic,
                source_map: &map_file_names[index],
            })
            .collect(),
        entries: entry_files
            .iter()
            .map(|(logical, file)| ManifestEntry { logical, file })
            .collect(),
        assets: assets
            .iter()
            .map(|asset| ManifestAsset {
                module: &asset.module_path,
                specifier: &asset.specifier,
                file: &asset.file_name,
                url: &asset.url,
            })
            .collect(),
    };
    let mut json = serde_json::to_string_pretty(&manifest).expect("manifest 结构序列化不可能失败");
    json.push('\n');
    json
}

use crate::diag::PackDiagnostic;
