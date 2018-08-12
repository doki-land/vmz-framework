//! WeChat packaging layout: compiler orchestrates `vmz-generator` printers.
//!
//! Writes a WeChat DevTools project under `dist/wechat/` (`dist/{target}/` layout):
//! `app.json` / `app.js` / `app.wxss` / `project.config.json` / page files.
//! WXML/WXSS are not authoring truth; adapters must not own this printer.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::json;
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{ProgramModule, ProgramUnit};

/// Report schema for WeChat packaging writes.
pub const MINI_WECHAT_PACK_REPORT_SCHEMA: &str = "vmz.target.mini_wechat_pack.v0";

/// Packaging target folder name under `dist/`.
pub const WECHAT_PACK_TARGET: &str = "wechat";

/// Relative root of the WeChat DevTools project (`dist/wechat`).
pub const WECHAT_PACK_ROOT: &str = "dist/wechat";

/// One written WeChat page (or app chrome) file set.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WechatPackFile {
    /// Deployment chunk id (`pages/home`).
    pub chunk_id: String,
    /// Program unit name.
    pub unit_name: String,
    /// Stem relative to the WeChat pack root (`pages/home/home`).
    pub stem: String,
    /// Written paths relative to workspace root.
    pub files: Vec<String>,
}

/// Aggregated WeChat packaging report.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniWechatPackReport {
    /// Always [`MINI_WECHAT_PACK_REPORT_SCHEMA`].
    pub schema: String,
    /// Aggregate status.
    pub status: CheckReportStatus,
    /// Packaging root relative to workspace.
    pub pack_root: String,
    /// Printer crate (never an adapter-owned emitter).
    pub printer: String,
    /// Written page/app file sets.
    pub pages: Vec<WechatPackFile>,
    /// Diagnostics.
    pub diagnostics: Vec<TargetDiagnostic>,
}

impl MiniWechatPackReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        vmz_generator::to_pretty_json(self).unwrap_or_else(|_| "{}".into())
    }
}

fn diag(
    path: &str,
    severity: Severity,
    message: impl Into<String>,
    code: &str,
) -> TargetDiagnostic {
    TargetDiagnostic::with_severity(path, severity, message).with_code(code)
}

/// Map `pages/home` → `pages/home/home` (WeChat page stem).
pub fn wechat_page_stem(chunk_id: &str) -> String {
    let chunk = chunk_id.trim().trim_matches('/');
    let name = chunk.rsplit('/').next().unwrap_or("index");
    if chunk.starts_with("pages/") {
        format!("{chunk}/{name}")
    } else {
        format!("pages/{name}/{name}")
    }
}

/// Emit one page's WXML + WXSS via generator printers.
pub fn emit_wechat_page(
    unit: &ProgramUnit,
    css: &str,
) -> Result<(String, String), Vec<TargetDiagnostic>> {
    let emit = match vmz_generator::emit_wechat_wxml(&unit.view.roots, Some(&unit.reactive)) {
        Ok(e) => e,
        Err(errs) => return Err(crate::miniprogram::map_mini_emit_errors(&unit.name, errs)),
    };
    let wxss = vmz_generator::print_wxss(css, false);
    Ok((emit.template, wxss))
}

fn is_page_unit(unit: &ProgramUnit) -> bool {
    matches!(unit.deployment.unit_kind, Some(VmzModuleKind::Page))
        || unit.deployment.chunk_id.as_deref().is_some_and(|c| c.starts_with("pages/"))
}

fn wechat_pack_abs(root: &Path) -> PathBuf {
    root.join("dist").join(WECHAT_PACK_TARGET)
}

fn page_rank(stem: &str) -> u8 {
    match stem {
        "pages/home/home" | "pages/index/index" => 0,
        _ => 1,
    }
}

fn collect_program_json(root: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let pack = wechat_pack_abs(root);
    let candidates = [root.join("dist"), root.to_path_buf()];
    for search in &candidates {
        if !search.exists() {
            continue;
        }
        for entry in WalkDir::new(search).into_iter().filter_map(|e| e.ok()) {
            let p = entry.path();
            if p.starts_with(&pack) {
                continue;
            }
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if p.is_file() && name.ends_with(".program.json") {
                out.push(p.to_path_buf());
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

fn print_chrome_js(source: &str, filename: &str) -> Result<String, String> {
    vmz_generator::print_js_source(source, filename, &vmz_generator::JsPrintOptions::default())
        .map(|emitted| emitted.code)
}

fn read_css_bundle(root: &Path) -> String {
    let dist = root.join("dist");
    let mut parts = Vec::new();
    // Prefer layer bodies (SFC / TW / designs). `vmz.css` is an @import entry
    // and must not be the only WXSS source.
    for name in ["vmz-style.css", "vmz-tw.css", "vmz-designs.css"] {
        let p = dist.join(name);
        if let Ok(text) = fs::read_to_string(&p)
            && !text.trim().is_empty()
        {
            parts.push(text);
        }
    }
    if parts.is_empty() {
        let p = dist.join("vmz.css");
        if let Ok(text) = fs::read_to_string(&p)
            && !text.trim().is_empty()
            && !text.contains("@import")
        {
            parts.push(text);
        }
    }
    parts.join("\n")
}

fn write_pack_file(abs: &Path, body: &str) -> std::io::Result<()> {
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(abs, body)
}

/// Lower page units into WeChat packaging files (generator printers only).
pub fn lower_miniprogram_wechat_packaging(root: &Path) -> MiniWechatPackReport {
    let mut diagnostics = Vec::new();
    let mut pages = Vec::new();
    let programs = collect_program_json(root);
    if programs.is_empty() {
        diagnostics.push(diag(
            "",
            Severity::Advice,
            "no *.program.json — build workspace before wechat packaging",
            "vmz::target::mini_wechat_pack_catalog_only",
        ));
        return MiniWechatPackReport {
            schema: MINI_WECHAT_PACK_REPORT_SCHEMA.into(),
            status: CheckReportStatus::Incomplete,
            pack_root: WECHAT_PACK_ROOT.into(),
            printer: "vmz-generator".into(),
            pages,
            diagnostics,
        };
    }

    let pack_abs = wechat_pack_abs(root);
    let _ = fs::create_dir_all(&pack_abs);
    let legacy = root.join("dist").join("_vmz").join("mini-deploy").join("wechat");
    if legacy.exists() {
        let _ = fs::remove_dir_all(&legacy);
    }
    let css = read_css_bundle(root);
    let mut app_pages: Vec<String> = Vec::new();

    for prog_path in &programs {
        let rel =
            prog_path.strip_prefix(root).unwrap_or(prog_path).to_string_lossy().replace('\\', "/");
        let text = match fs::read_to_string(prog_path) {
            Ok(t) => t,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("read program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        let module: ProgramModule = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                diagnostics.push(diag(
                    &rel,
                    Severity::Error,
                    format!("parse program.json failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
                continue;
            }
        };
        for unit in &module.units {
            if !is_page_unit(unit) {
                continue;
            }
            let chunk = unit.deployment.chunk_id.clone().unwrap_or_else(|| unit.name.clone());
            let stem = wechat_page_stem(&chunk);
            match emit_wechat_page(unit, &css) {
                Ok((wxml, wxss)) => {
                    let wxml_rel = format!("{WECHAT_PACK_ROOT}/{stem}.wxml");
                    let wxss_rel = format!("{WECHAT_PACK_ROOT}/{stem}.wxss");
                    let json_rel = format!("{WECHAT_PACK_ROOT}/{stem}.json");
                    let js_rel = format!("{WECHAT_PACK_ROOT}/{stem}.js");
                    let page_json = json!({ "usingComponents": {} });
                    let page_json_body =
                        vmz_generator::to_pretty_json(&page_json).unwrap_or_else(|_| "{}".into());
                    let page_js = match print_chrome_js("Page({});\n", &format!("{stem}.js")) {
                        Ok(code) => code,
                        Err(e) => {
                            diagnostics.push(diag(
                                &js_rel,
                                Severity::Error,
                                format!("print page js failed: {e}"),
                                DIAG_ARTIFACT_INVALID,
                            ));
                            continue;
                        }
                    };
                    let mut written = Vec::new();
                    for (rel_path, body) in [
                        (wxml_rel.as_str(), wxml.as_str()),
                        (wxss_rel.as_str(), wxss.as_str()),
                        (json_rel.as_str(), page_json_body.as_str()),
                        (js_rel.as_str(), page_js.as_str()),
                    ] {
                        if let Err(e) = write_pack_file(&root.join(rel_path), &format!("{body}\n"))
                        {
                            diagnostics.push(diag(
                                rel_path,
                                Severity::Error,
                                format!("write wechat pack file failed: {e}"),
                                DIAG_ARTIFACT_INVALID,
                            ));
                        } else {
                            written.push(rel_path.to_string());
                        }
                    }
                    app_pages.push(stem.clone());
                    pages.push(WechatPackFile {
                        chunk_id: chunk,
                        unit_name: unit.name.clone(),
                        stem,
                        files: written,
                    });
                }
                Err(mut unit_diags) => diagnostics.append(&mut unit_diags),
            }
        }
    }

    app_pages.sort_by(|a, b| page_rank(a).cmp(&page_rank(b)).then_with(|| a.cmp(b)));
    app_pages.dedup();
    let app_json = json!({
        "pages": app_pages,
        "window": {
            "navigationBarTitleText": "VMZ"
        },
        "sitemapLocation": "sitemap.json"
    });
    let app_json_rel = format!("{WECHAT_PACK_ROOT}/app.json");
    let app_json_body = vmz_generator::to_pretty_json(&app_json).unwrap_or_else(|_| "{}".into());
    if let Err(e) = write_pack_file(&root.join(&app_json_rel), &format!("{app_json_body}\n")) {
        diagnostics.push(diag(
            &app_json_rel,
            Severity::Error,
            format!("write app.json failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        ));
    }
    let app_wxss = vmz_generator::print_wxss(&css, false);
    let app_wxss_rel = format!("{WECHAT_PACK_ROOT}/app.wxss");
    let _ = write_pack_file(&root.join(&app_wxss_rel), &format!("{app_wxss}\n"));

    let app_js_rel = format!("{WECHAT_PACK_ROOT}/app.js");
    match print_chrome_js("App({});\n", "app.js") {
        Ok(code) => {
            if let Err(e) = write_pack_file(&root.join(&app_js_rel), &format!("{code}\n")) {
                diagnostics.push(diag(
                    &app_js_rel,
                    Severity::Error,
                    format!("write app.js failed: {e}"),
                    DIAG_ARTIFACT_INVALID,
                ));
            }
        }
        Err(e) => diagnostics.push(diag(
            &app_js_rel,
            Severity::Error,
            format!("print app.js failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        )),
    }

    let sitemap = json!({
        "desc": "vmz wechat pack",
        "rules": [{ "action": "allow", "page": "*" }]
    });
    let sitemap_rel = format!("{WECHAT_PACK_ROOT}/sitemap.json");
    let sitemap_body = vmz_generator::to_pretty_json(&sitemap).unwrap_or_else(|_| "{}".into());
    let _ = write_pack_file(&root.join(&sitemap_rel), &format!("{sitemap_body}\n"));

    let projectname = root.file_name().and_then(|s| s.to_str()).unwrap_or("vmz");
    let project_config = json!({
        "description": "VMZ WeChat pack: open this folder in WeChat DevTools",
        "packOptions": { "ignore": [], "include": [] },
        "setting": {
            "es6": true,
            "postcss": true,
            "minified": false,
            "enhance": true,
            "minifyWXSS": false,
            "minifyWXML": false
        },
        "compileType": "miniprogram",
        "libVersion": "3.7.12",
        "appid": "touristappid",
        "projectname": projectname,
        "miniprogramRoot": "./",
        "condition": {},
        "editorSetting": { "tabIndent": "insertSpaces", "tabSize": 2 }
    });
    let project_rel = format!("{WECHAT_PACK_ROOT}/project.config.json");
    let project_body =
        vmz_generator::to_pretty_json(&project_config).unwrap_or_else(|_| "{}".into());
    if let Err(e) = write_pack_file(&root.join(&project_rel), &format!("{project_body}\n")) {
        diagnostics.push(diag(
            &project_rel,
            Severity::Error,
            format!("write project.config.json failed: {e}"),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    let status = if failed {
        CheckReportStatus::Failed
    } else if pages.is_empty() {
        CheckReportStatus::Incomplete
    } else {
        CheckReportStatus::Ready
    };

    MiniWechatPackReport {
        schema: MINI_WECHAT_PACK_REPORT_SCHEMA.into(),
        status,
        pack_root: WECHAT_PACK_ROOT.into(),
        printer: "vmz-generator".into(),
        pages,
        diagnostics,
    }
}
