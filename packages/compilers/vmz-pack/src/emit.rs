//! 产物发射的宿主适配：源码读取走本地文件系统，写出走本地文件系统端口。
//!
//! 装配、指纹、压缩、source map 与 manifest 全部归 `compiler-bundle`；
//! 本文件只做两件事：
//!
//! - 以 [`StdSourceReader`] 绑定只读源码端口；
//! - 以 [`FsOutputSink`] 绑定产物写出端口，并保留 VMZ 侧的两个写出入口
//!   （[`write_emit`] 全量、[`write_emit_incremental`] 内容复用）。

use std::path::Path;

use compiler_bundle::chunk::ChunkPlan;
use compiler_bundle::graph::ModuleGraph;
use compiler_bundle::link::LinkPlan;
use compiler_bundle::{PackDiagnostic, StdSourceReader};

pub use compiler_bundle::emit::*;

/// 由模块图、链接计划与分包计划产出产物计划（本地文件系统读源码）。
pub fn plan_emit(
    graph: &ModuleGraph,
    link: &LinkPlan,
    chunks: &ChunkPlan,
    options: &EmitOptions,
) -> Result<EmitPlan, Vec<PackDiagnostic>> {
    compiler_bundle::emit::plan_emit(graph, link, chunks, options, &StdSourceReader)
}

/// 带增量缓存的产物计划入口（本地文件系统读源码）。
pub fn plan_emit_with_cache(
    graph: &ModuleGraph,
    link: &LinkPlan,
    chunks: &ChunkPlan,
    options: &EmitOptions,
    cache: &mut EmitCache,
) -> Result<EmitPlan, Vec<PackDiagnostic>> {
    compiler_bundle::emit::plan_emit_with_cache(graph, link, chunks, options, &StdSourceReader, cache)
}

/// 全量写出：每个产物都落盘。
pub fn write_emit(plan: &EmitPlan, out_dir: &Path) -> Result<(), Vec<PackDiagnostic>> {
    compiler_bundle::emit::write_emit_with(&FsOutputSink, plan, out_dir)
}

/// 增量写出：`reuse = true` 时跳过内容逐字节相同的既有文件。
pub fn write_emit_incremental(
    plan: &EmitPlan,
    out_dir: &Path,
    reuse: bool,
) -> Result<(), Vec<PackDiagnostic>> {
    compiler_bundle::emit::write_emit_incremental_with(&FsOutputSink, plan, out_dir, reuse)
}

/// 本地文件系统写出端口。
pub struct FsOutputSink;

impl OutputSink for FsOutputSink {
    fn create_dir_all(&self, path: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(path)
    }

    fn read(&self, path: &Path) -> std::io::Result<Vec<u8>> {
        std::fs::read(path)
    }

    fn write(&self, path: &Path, bytes: &[u8]) -> std::io::Result<()> {
        std::fs::write(path, bytes)
    }

    fn copy(&self, from: &Path, to: &Path) -> std::io::Result<u64> {
        std::fs::copy(from, to)
    }

    fn list(&self, directory: &Path) -> std::io::Result<Vec<(String, bool)>> {
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            entries.push((entry.file_name().to_string_lossy().to_string(), file_type.is_file()));
        }
        Ok(entries)
    }

    fn remove_file(&self, path: &Path) -> std::io::Result<()> {
        std::fs::remove_file(path)
    }

    fn is_file(&self, path: &Path) -> bool {
        path.is_file()
    }
}
