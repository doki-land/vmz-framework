//! `node_modules` 逐级上溯与最近 package.json 定位。

use std::path::{Path, PathBuf};

/// 从 `from` 目录逐级向文件系统根查找 `node_modules/<pkg_rel>`。
/// `pkg_rel` 形如 `pkg` 或 `@scope/pkg`（可含子路径段时不传子路径）。
/// 命中即返回**未 canonicalize** 的目录；归一由调用方负责。
pub(crate) fn find_package_dir(pkg_rel: &str, from: &Path) -> Option<PathBuf> {
    let mut dir = Some(from);
    while let Some(current) = dir {
        let candidate = current.join("node_modules").join(pkg_rel);
        if candidate.is_dir() {
            return Some(candidate);
        }
        dir = current.parent();
    }
    None
}

/// 从 `from` 目录逐级向上找最近的 `package.json`，返回其所在目录。
/// 用于定位 `#imports` 归属的包实例。
pub(crate) fn find_owning_package_root(from: &Path) -> Option<PathBuf> {
    let mut dir = Some(from);
    while let Some(current) = dir {
        if current.join("package.json").is_file() {
            return Some(current.to_path_buf());
        }
        dir = current.parent();
    }
    None
}
