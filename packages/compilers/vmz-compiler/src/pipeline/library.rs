//! Library artifact emit: one ESM module and one stylesheet per package entry.
//!
//! 库产物与交付装配的分界只在「说明符与分块两端」：本模块复用单文件
//! `.vmz` 编译前端，把每个入口写成 `<Name>.js`（保留裸说明符，不生成
//! 页面、路由、部署清单，不做内容指纹与代码分块），并把该入口自己的
//! `<style>` 块编译成 `<Name>.css`。样式由宿主的样式插件按 `sources`
//! 子集编译，不聚合整个项目的 CSS。
//!
//! 显式拒绝（不静默产出错误产物）：
//! - 入口名含路径分隔符或 `..`：`vmz::lib::entry_name_invalid`
//! - 产物仍引用交付运行时文件（`./vmz-runtime.js` / `./dom-core.js` 之外的
//!   `./*.js` 运行时同伴）：`vmz::lib::runtime_import_unsupported`
//! - 入口 `<style>` 含 `url(...)`：`vmz::lib::style_url_unsupported`——
//!   资源搬迁与指纹属于交付链，库产物不复制资源文件
//!
//! 运行时映射（库产物不携带运行时文件）：`vmz:runtime` 的交付重写结果
//! `./vmz-runtime.js` 归一到 `@vmz/core`，`vmz:dom` 的 `./dom-core.js` 归一到
//! `@vmz/core/dom/client`（两个公开 face 的 registry 入口）。

use std::fs;
use std::path::{Path, PathBuf};

use crate::check::{CheckOptions, check_path};
use crate::diagnostic::ReportedDiagnostic;
use crate::pipeline::compile::{CompileOptions, CompileReport, compile_path};
use crate::scss::ScssEmitRequest;

/// 一个库入口：发布名 + 源 `.vmz` 文件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryEntry {
    /// 产物名（`<Name>.js` / `<Name>.css`），同时是 ESM 入口标识。
    pub name: String,
    /// 入口 `.vmz` 的绝对路径。
    pub path: PathBuf,
}

const ENTRY_NAME_INVALID: &str = "vmz::lib::entry_name_invalid";
const ENTRY_MISSING: &str = "vmz::lib::entry_missing";
const CLIENT_EMIT_FAILED: &str = "vmz::lib::client_emit_failed";
const RUNTIME_IMPORT_UNSUPPORTED: &str = "vmz::lib::runtime_import_unsupported";
const STYLE_URL_UNSUPPORTED: &str = "vmz::lib::style_url_unsupported";

/// 交付运行时文件相对引用 → `@vmz/core` 公开 face。
const RUNTIME_FACE_MAP: [(&str, &str); 2] =
    [("./vmz-runtime.js", "@vmz/core"), ("./dom-core.js", "@vmz/core/dom/client")];

/// 交付运行时同伴文件名（与 `delivery-runtime-files.json` 的 `out` 同口径）。
/// 库产物不携带这些文件；映射表之外的引用一律拒绝。
const RUNTIME_COMPANIONS: [&str; 13] = [
    "./vmz-runtime.js",
    "./vmz-dom.js",
    "./dom-core.js",
    "./dom-ssr.js",
    "./dom.client.js",
    "./dom.browser.js",
    "./direct-host-box.js",
    "./unknown-component.js",
    "./dom-attr-normalize.js",
    "./html-digest.js",
    "./row-key.js",
    "./vmz-http.js",
    "./vmz-client-nav.js",
];

/// 编译库入口集：每个入口一组 `<Name>.js` + `<Name>.css`（有样式时）。
///
/// `options.scss` 为 `None` 时不产出 CSS；`options.runtime_dist` 只影响单文件
/// 编译前端的运行时探测，产物本身不携带运行时文件。
pub fn compile_library(
    entries: &[LibraryEntry],
    options: &CompileOptions,
) -> crate::Result<CompileReport> {
    let mut report = CompileReport::default();
    fs::create_dir_all(&options.out_dir)?;
    if entries.is_empty() {
        report
            .diagnostics
            .push(ReportedDiagnostic::error(options.out_dir.clone(), "vmz::lib::entries_empty"));
        return Ok(report);
    }

    for entry in entries {
        if !is_plain_name(&entry.name) {
            report.diagnostics.push(
                ReportedDiagnostic::error(&entry.path, ENTRY_NAME_INVALID)
                    .with_arg("name", entry.name.clone()),
            );
            continue;
        }
        if !entry.path.is_file() {
            report.diagnostics.push(
                ReportedDiagnostic::error(&entry.path, ENTRY_MISSING)
                    .with_arg("path", entry.path.display().to_string()),
            );
            continue;
        }

        let check = check_path(&entry.path, &CheckOptions::default())?;
        if check.has_errors() {
            report.diagnostics.extend(check.diagnostics);
            continue;
        }

        if let Some(client) = emit_entry_client(entry, options, &mut report)? {
            let (code, unmapped) = rewrite_runtime_faces(&client.code);
            if let Some(first) = unmapped.first() {
                report.diagnostics.push(
                    ReportedDiagnostic::error(&entry.path, RUNTIME_IMPORT_UNSUPPORTED)
                        .with_arg("name", entry.name.clone())
                        .with_arg("specifier", first.clone()),
                );
                continue;
            }
            let js_path = options.out_dir.join(format!("{}.js", entry.name));
            fs::write(&js_path, &code)?;
            report.emitted.push(js_path);
        }

        if let Some(scss) = &options.scss {
            let result = scss.emit_project(&ScssEmitRequest {
                project_root: package_root(&entry.path),
                out_dir: options.out_dir.clone(),
                sources: vec![entry.path.clone()],
                designs_style_entry: None,
                designs_style_files: Vec::new(),
                provenance_comments: false,
            });
            report.diagnostics.extend(result.diagnostics);
            if result.css.contains("url(") {
                report.diagnostics.push(
                    ReportedDiagnostic::error(&entry.path, STYLE_URL_UNSUPPORTED)
                        .with_arg("name", entry.name.clone()),
                );
                continue;
            }
            if !result.css.trim().is_empty() {
                let css_path = options.out_dir.join(format!("{}.css", entry.name));
                fs::write(&css_path, ensure_trailing_newline(&result.css))?;
                report.emitted.push(css_path);
            }
        }
    }

    Ok(report)
}

struct EntryClient {
    code: String,
}

/// 复用单文件编译前端产出入口模块文本：写进临时目录，只取回 `*.client.js`
/// 与其 source map，改名后由调用方落到 `out_dir`。临时目录不留在产物里。
fn emit_entry_client(
    entry: &LibraryEntry,
    options: &CompileOptions,
    report: &mut CompileReport,
) -> crate::Result<Option<EntryClient>> {
    let staging = options.out_dir.join(".vmz-lib").join(&entry.name);
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;

    let staged = compile_path(
        &entry.path,
        &CompileOptions {
            out_dir: staging.clone(),
            release: options.release,
            tw: None,
            scss: None,
            runtime_dist: options.runtime_dist.clone(),
        },
    );
    let staged = match staged {
        Ok(report) => report,
        Err(err) => {
            let _ = fs::remove_dir_all(&staging);
            return Err(err);
        }
    };

    // 临时目录里还有编译前端复制的运行时同伴（含 `dom.client.js`），
    // 只认入口自己的 `<文件 stem>.client.js`，不按后缀猜第一个。
    let entry_stem = entry.path.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default();
    let expected = format!("{entry_stem}.client.js");
    let client_path = staged
        .emitted
        .iter()
        .find(|path| path.file_name().and_then(|name| name.to_str()) == Some(expected.as_str()))
        .cloned();
    let client_path = match client_path {
        Some(path) => path,
        None => {
            fs::remove_dir_all(&staging)?;
            report.diagnostics.extend(staged.diagnostics);
            report.diagnostics.push(
                ReportedDiagnostic::error(&entry.path, CLIENT_EMIT_FAILED)
                    .with_arg("name", entry.name.clone()),
            );
            return Ok(None);
        }
    };

    let original = fs::read_to_string(&client_path)?;
    report.diagnostics.extend(staged.diagnostics);
    fs::remove_dir_all(&staging)?;

    Ok(Some(EntryClient { code: strip_source_map_comment(&original) }))
}

/// 产物名必须是裸文件名：路径分隔符或 `..` 会把库产物写到其它目录。
fn is_plain_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && name != "."
}

/// 从入口向上找最近的 `package.json` 目录，作为样式插件的项目根。
fn package_root(path: &Path) -> PathBuf {
    let mut current = path.parent();
    while let Some(dir) = current {
        if dir.join("package.json").is_file() {
            return dir.to_path_buf();
        }
        current = dir.parent();
    }
    path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

/// 库产物不携带 source map：map 内嵌构建机绝对路径，且与「不做内容指纹」
/// 的库产物契约无关。同时去掉产物尾部的 `sourceMappingURL` 注释，避免指向
/// 不存在的文件。
fn strip_source_map_comment(code: &str) -> String {
    let mut out = String::with_capacity(code.len());
    for line in code.lines() {
        if line.trim_start().starts_with("//# sourceMappingURL=") {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// 把交付运行时同伴的相对引用改为 `@vmz/core` 公开 face，并返回仍未被映射的
/// 运行时同伴引用（去重、按出现顺序）。映射表与 leader 名单同源，新增同伴
/// 必须先补映射，否则库产物会带一个指不出去的相对路径。
fn rewrite_runtime_faces(code: &str) -> (String, Vec<String>) {
    let mut out = code.to_string();
    for (from, to) in RUNTIME_FACE_MAP {
        out = out.replace(&format!("\"{from}\""), &format!("\"{to}\""));
    }
    let mut unmapped: Vec<String> = Vec::new();
    for companion in RUNTIME_COMPANIONS {
        let needle = format!("\"{companion}\"");
        if out.contains(&needle) && !unmapped.iter().any(|seen| seen == companion) {
            unmapped.push(companion.to_string());
        }
    }
    (out, unmapped)
}

fn ensure_trailing_newline(css: &str) -> String {
    let trimmed = css.trim_end();
    format!("{trimmed}\n")
}

#[cfg(test)]
mod tests {
    use super::{rewrite_runtime_faces, strip_source_map_comment};

    #[test]
    fn maps_runtime_faces_to_public_core_entries() {
        let (code, unmapped) = rewrite_runtime_faces(
            r#"import{a}from"./vmz-runtime.js";import{b}from"./dom-core.js";"#,
        );
        assert_eq!(code, r#"import{a}from"@vmz/core";import{b}from"@vmz/core/dom/client";"#);
        assert!(unmapped.is_empty());
    }

    #[test]
    fn reports_runtime_companions_without_public_face() {
        let (_, unmapped) = rewrite_runtime_faces(r#"import{c}from"./vmz-dom.js";"#);
        assert_eq!(unmapped, vec!["./vmz-dom.js".to_string()]);
    }

    #[test]
    fn drops_source_map_reference_without_keeping_a_dangling_comment() {
        let code = strip_source_map_comment(
            "export default class X{}\n//# sourceMappingURL=Chart.client.js.map\n",
        );
        assert_eq!(code, "export default class X{}\n");
    }
}
