//! 文件候选与 canonicalize 归一。
//!
//! 解析层只管**文件身份**：LOAD_AS_FILE（原样路径 → 依次追加候选扩展）→
//! LOAD_AS_DIRECTORY（`index.*`）。命中后一律 `canonicalize`（跟随符号链接），
//! 返回的真实物理文件即 [`crate::resolve::Resolved::path`]。
//! `.css`/`.wasm` 等资源只要以原样路径存在即命中，无需出现在扩展列表中。

use std::path::{Path, PathBuf};

/// 相对/子路径解析的候选扩展（按顺序尝试）。
const EXTENSIONS: &[&str] = &[".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"];

/// 解析一个候选基路径（文件、目录或无扩展路径）为 canonical 真实文件。
///
/// 覆盖 TS 源码包的 NodeNext 书写形态：包未预构建、入口直指 `src/` 时，
/// 说明符按惯例写 `./client.js` 而落盘是 `./client.ts`——与
/// `tsc --rewriteRelativeImportExtensions` / bundler 的 `.js`→`.ts` 替换一致。
pub(crate) fn resolve_file(base: &Path) -> Option<PathBuf> {
    // 1) 原样路径本身是文件（覆盖 `.js` 显式扩展与 `.css`/`.wasm` 等资源）。
    if let Some(path) = canonical_file(base) {
        return Some(path);
    }
    // 1.5) `.js`/`.mjs`/`.cjs` 说明符替换为同源 TS 扩展（TS 源码包形态）。
    let ts_substitutes: &[(&str, &[&str])] =
        &[(".js", &[".ts", ".tsx"]), (".mjs", &[".mts"]), (".cjs", &[".cts"])];
    for (js_ext, ts_exts) in ts_substitutes {
        if let Some(stem) = base.as_os_str().to_str().and_then(|s| s.strip_suffix(js_ext)) {
            for ts_ext in *ts_exts {
                if let Some(path) = canonical_file(Path::new(&format!("{stem}{ts_ext}"))) {
                    return Some(path);
                }
            }
        }
    }
    // 2) 依次追加候选扩展（与 CJS LOAD_AS_FILE 一致：即使已带扩展也继续尝试）。
    for ext in EXTENSIONS {
        let mut candidate = base.as_os_str().to_os_string();
        candidate.push(ext);
        if let Some(path) = canonical_file(Path::new(&candidate)) {
            return Some(path);
        }
    }
    // 3) 目录 → `index.*`。
    if base.is_dir() {
        for ext in EXTENSIONS {
            let index = base.join(format!("index{ext}"));
            if let Some(path) = canonical_file(&index) {
                return Some(path);
            }
        }
    }
    None
}

fn canonical_file(path: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(path).ok()?;
    if canonical.is_file() { Some(canonical) } else { None }
}
