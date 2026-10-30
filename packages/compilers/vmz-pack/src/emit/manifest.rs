//! 文件名与内容指纹（占位符两遍法的第二/三遍）、行级 source map v3
//! 组装以及 manifest 序列化。
//!
//! 指纹只覆盖第一遍装配文本（含占位符）：chunk 间引用成环时无法拓扑定名，
//! 占位符把「引用目标」与「目标最终名」解耦，同输入必同输出，禁止随机或
//! 时间戳。第三遍占位符替换不增删行且段全在列 0，映射不受影响；
//! `sourceMappingURL` 注释行在替换完成后追加，不参与指纹。
//! manifest 合同版本命名空间固定 `v0`。

use std::collections::BTreeMap;

use serde::Serialize;
use sha2::{Digest, Sha256};
use vmz_generator::js::{SourceMapSegment, source_map_json};

use super::assemble::ChunkSegment;
use super::{
    AssetArtifact, ChunkArtifact, EmitContext, EmitPlan, StyleArtifact, normalize_path, placeholder,
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
fn slug(chunk_id: &str) -> String {
    let mut out: String = chunk_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '-' })
        .collect();
    out.truncate(80);
    out
}

/// 第二遍：按第一遍文本定指纹与文件名；第三遍：占位符整串替换为
/// `./<目标文件名>`；随后按行级映射段组装每 chunk 的 source map v3、
/// 追加 `sourceMappingURL` 注释行，并组装产物、入口映射、动态映射与 manifest。
pub(crate) fn finalize(
    context: &EmitContext<'_>,
    codes: Vec<String>,
    segments: Vec<Vec<ChunkSegment>>,
    styles: Vec<StyleArtifact>,
    warnings: Vec<PackDiagnostic>,
) -> EmitPlan {
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

    // 行级 source map v3：`sources` 按 chunk 成员节点序（与 manifest
    // `modules` 同口径，chunk 内节点不重复），`sourcesContent` 内嵌原模块
    // 文本使 map 自包含；map 文件名恒 `<file_name>.map`，内容不上 wire。
    let map_file_names: Vec<String> =
        file_names.iter().map(|name| format!("{name}.map")).collect();
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
        let src_index_of: BTreeMap<&str, u32> =
            sources.iter().enumerate().map(|(i, path)| (path.as_str(), i as u32)).collect();
        let mut mapped: Vec<SourceMapSegment> = segments[index]
            .iter()
            .map(|segment| SourceMapSegment {
                gen_line: segment.gen_line,
                gen_col: 0,
                src_index: src_index_of.get(segment.source.as_str()).copied().unwrap_or(0),
                src_line: segment.src_line,
                src_col: segment.src_col,
            })
            .collect();
        mapped.sort_by_key(|segment| (segment.gen_line, segment.gen_col));
        source_maps
            .push(source_map_json(&file_names[index], &sources, &sources_content, &mapped));
        let mut text = codes[index].clone();
        if !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&format!("//# sourceMappingURL={}\n", map_file_names[index]));
        final_codes.push(text);
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

    let manifest_json = render_manifest(&artifacts, &map_file_names, &entry_files, &assets);
    EmitPlan {
        artifacts,
        styles,
        assets,
        entry_files,
        dynamic_files: dynamic_files.into_iter().collect(),
        manifest_json,
        diagnostics: warnings,
    }
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
    chunks: Vec<ManifestChunk<'a>>,
    entries: Vec<ManifestEntry<'a>>,
    assets: Vec<ManifestAsset<'a>>,
}

fn render_manifest(
    artifacts: &[ChunkArtifact],
    map_file_names: &[String],
    entry_files: &[(String, String)],
    assets: &[AssetArtifact],
) -> String {
    let manifest = EmitManifest {
        version: "v0",
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
