//! 文件名与内容指纹（占位符两遍法的第二/三遍）以及 manifest 序列化。
//!
//! 指纹只覆盖第一遍装配文本（含占位符）：chunk 间引用成环时无法拓扑定名，
//! 占位符把「引用目标」与「目标最终名」解耦，同输入必同输出，禁止随机或
//! 时间戳。manifest 合同版本命名空间固定 `v0`。

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::{AssetArtifact, ChunkArtifact, EmitContext, EmitPlan, normalize_path, placeholder};

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
/// `./<目标文件名>`；随后组装产物、入口映射、动态映射与 manifest。
pub(crate) fn finalize(
    context: &EmitContext<'_>,
    codes: Vec<String>,
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
            code: codes[index].clone(),
            modules: chunk
                .modules
                .iter()
                .map(|&node| normalize_path(&context.graph.nodes[node].resolved.path))
                .collect(),
            imports: chunk.depends_on.iter().map(|&dep| file_names[dep].clone()).collect(),
            dynamic: dynamic_of_chunk[index].clone().into_iter().collect(),
        })
        .collect();

    let entry_files: Vec<(String, String)> = context
        .chunks
        .entry_chunks
        .iter()
        .map(|(logical, chunk_index)| (logical.clone(), file_names[*chunk_index].clone()))
        .collect();

    let assets: Vec<AssetArtifact> = context.asset_index.values().cloned().collect();

    let manifest_json = render_manifest(&artifacts, &entry_files, &assets);
    EmitPlan {
        artifacts,
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
    entry_files: &[(String, String)],
    assets: &[AssetArtifact],
) -> String {
    let manifest = EmitManifest {
        version: "v0",
        chunks: artifacts
            .iter()
            .map(|artifact| ManifestChunk {
                id: &artifact.chunk_id,
                file: &artifact.file_name,
                modules: &artifact.modules,
                imports: &artifact.imports,
                dynamic: &artifact.dynamic,
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
