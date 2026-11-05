//! 文件系统写出：唯一写盘层。单文件失败记录诊断并继续尝试其余文件，
//! 最终整体 `Err`——产物集必须完整，不接受半套输出被当作成功。
//!
//! 两种模式共享同一份「产物闭包」定义：
//! - [`write_emit`]：全量写，每个产物都落盘（测试与无缓存调用）；
//! - [`write_emit_incremental`]：`reuse = true` 时逐字节比较已存在文件，
//!   内容相同即跳过写（复用判定只看内容，不看 mtime / 时间戳）。
//!
//! 两种模式都会删除输出目录内不再属于闭包的旧产物（chunk / map / css 与
//! `assets/` 下的资源），不留孤儿。删除是逐文件的非递归操作，且不触碰
//! 缓存目录 `.vmz-pack-cache/` 与其它外来文件（如 Node 侧 `package.json`）。

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use crate::diag::PackDiagnostic;

use super::EmitPlan;

pub fn write_emit(plan: &EmitPlan, out_dir: &Path) -> Result<(), Vec<PackDiagnostic>> {
    write_emit_incremental(plan, out_dir, false)
}

/// 增量写出：`reuse = true` 时跳过内容逐字节相同的既有文件。
pub fn write_emit_incremental(
    plan: &EmitPlan,
    out_dir: &Path,
    reuse: bool,
) -> Result<(), Vec<PackDiagnostic>> {
    let mut diagnostics: Vec<PackDiagnostic> = Vec::new();
    if let Err(err) = std::fs::create_dir_all(out_dir) {
        diagnostics.push(write_failed(out_dir, &err));
    }
    let mut expected: BTreeSet<String> = BTreeSet::new();
    for artifact in &plan.artifacts {
        expected.insert(artifact.file_name.clone());
        let map_name = format!("{}.map", artifact.file_name);
        expected.insert(map_name.clone());
        write_bytes(
            out_dir,
            &artifact.file_name,
            artifact.code.as_bytes(),
            reuse,
            &mut diagnostics,
        );
        write_bytes(out_dir, &map_name, artifact.source_map.as_bytes(), reuse, &mut diagnostics);
    }
    for style in &plan.styles {
        expected.insert(style.file_name.clone());
        write_bytes(out_dir, &style.file_name, style.content.as_bytes(), reuse, &mut diagnostics);
    }
    for asset in &plan.assets {
        expected.insert(asset.file_name.clone());
        let target = out_dir.join(&asset.file_name);
        if let Some(parent) = target.parent()
            && let Err(err) = std::fs::create_dir_all(parent)
        {
            diagnostics.push(write_failed(parent, &err));
            continue;
        }
        // 资源文件名已含源内容指纹：同名即同内容，复用模式无需重拷。
        if reuse && target.is_file() {
            continue;
        }
        if let Err(err) = std::fs::copy(&asset.source_path, &target) {
            diagnostics.push(write_failed(&target, &err));
        }
    }
    expected.insert("manifest.json".to_string());
    write_bytes(out_dir, "manifest.json", plan.manifest_json.as_bytes(), reuse, &mut diagnostics);
    sweep_orphans(out_dir, &expected, &mut diagnostics);
    if diagnostics.is_empty() { Ok(()) } else { Err(diagnostics) }
}

/// 写单文件；`reuse` 且既有字节完全相同时跳过。
fn write_bytes(
    out_dir: &Path,
    file_name: &str,
    bytes: &[u8],
    reuse: bool,
    diagnostics: &mut Vec<PackDiagnostic>,
) {
    let path = out_dir.join(file_name);
    if reuse
        && let Ok(existing) = fs::read(&path)
        && existing == bytes
    {
        return;
    }
    if let Some(parent) = path.parent()
        && let Err(err) = fs::create_dir_all(parent)
    {
        diagnostics.push(write_failed(parent, &err));
        return;
    }
    if let Err(err) = fs::write(&path, bytes) {
        diagnostics.push(write_failed(&path, &err));
    }
}

/// 清理不属于本次产物闭包的旧文件：
/// - 输出目录根：只删 `*.js` / `*.map` / `*.css` 形态的旧产物；
/// - `assets/`：删除不在闭包内的全部普通文件；
/// - 其它子目录（含 `.vmz-pack-cache/`）与非产物形态文件一律不碰。
///
/// 全部是逐文件删除，不做递归目录删除。
fn sweep_orphans(
    out_dir: &Path,
    expected: &BTreeSet<String>,
    diagnostics: &mut Vec<PackDiagnostic>,
) {
    if out_dir.file_name().is_none() {
        // 防御性拒绝：根路径不允许被当作产物目录清理。
        return;
    }
    let Ok(entries) = fs::read_dir(out_dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            if name == "assets" {
                sweep_dir_files(&path, "assets/", expected, diagnostics);
            }
            continue;
        }
        if expected.contains(&name) || !is_artifact_name(&name) {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            diagnostics.push(write_failed(&path, &err));
        }
    }
}

fn sweep_dir_files(
    dir: &Path,
    prefix: &str,
    expected: &BTreeSet<String>,
    diagnostics: &mut Vec<PackDiagnostic>,
) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if !entry.file_type().map(|kind| kind.is_file()).unwrap_or(false) {
            continue;
        }
        let name = format!("{prefix}{}", entry.file_name().to_string_lossy());
        if expected.contains(&name) {
            continue;
        }
        if let Err(err) = fs::remove_file(&path) {
            diagnostics.push(write_failed(&path, &err));
        }
    }
}

/// 产物形态判定：只为避免误删外来文件，不承担闭包定义。
fn is_artifact_name(name: &str) -> bool {
    name.ends_with(".js") || name.ends_with(".map") || name.ends_with(".css")
}

fn write_failed(path: &Path, err: &std::io::Error) -> PackDiagnostic {
    PackDiagnostic::new("vmz::pack::emit::write_failed", format!("cannot write artifact: {err}"))
        .with_path(path.display().to_string())
}
