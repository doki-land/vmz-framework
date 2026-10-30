//! 文件系统写出：唯一写盘层。单文件失败记录诊断并继续尝试其余文件，
//! 最终整体 `Err`——产物集必须完整，不接受半套输出被当作成功。

use std::path::Path;

use crate::diag::PackDiagnostic;

use super::EmitPlan;

pub fn write_emit(plan: &EmitPlan, out_dir: &Path) -> Result<(), Vec<PackDiagnostic>> {
    let mut diagnostics: Vec<PackDiagnostic> = Vec::new();
    if let Err(err) = std::fs::create_dir_all(out_dir) {
        diagnostics.push(write_failed(out_dir, &err));
    }
    for artifact in &plan.artifacts {
        let path = out_dir.join(&artifact.file_name);
        if let Err(err) = std::fs::write(&path, artifact.code.as_bytes()) {
            diagnostics.push(write_failed(&path, &err));
        }
    }
    for style in &plan.styles {
        let path = out_dir.join(&style.file_name);
        if let Err(err) = std::fs::write(&path, style.content.as_bytes()) {
            diagnostics.push(write_failed(&path, &err));
        }
    }
    for asset in &plan.assets {
        let target = out_dir.join(&asset.file_name);
        if let Some(parent) = target.parent()
            && let Err(err) = std::fs::create_dir_all(parent)
        {
            diagnostics.push(write_failed(parent, &err));
            continue;
        }
        if let Err(err) = std::fs::copy(&asset.source_path, &target) {
            diagnostics.push(write_failed(&target, &err));
        }
    }
    let manifest_path = out_dir.join("manifest.json");
    if let Err(err) = std::fs::write(&manifest_path, plan.manifest_json.as_bytes()) {
        diagnostics.push(write_failed(&manifest_path, &err));
    }
    if diagnostics.is_empty() { Ok(()) } else { Err(diagnostics) }
}

fn write_failed(path: &Path, err: &std::io::Error) -> PackDiagnostic {
    PackDiagnostic::new("vmz::pack::emit::write_failed", format!("cannot write artifact: {err}"))
        .with_path(path.display().to_string())
}
