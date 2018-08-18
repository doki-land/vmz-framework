//! WeChat packaging layout: compiler orchestrates `vmz-generator` printers.
//!
//! Writes a WeChat DevTools project under `dist/wechat/` (`dist/{target}/` layout):
//! `app.json` / `app.js` / `app.wxss` / `project.config.json` / page files /
//! `custom-tab-bar/` when `<router>.tab` is present.
//! Page JS seeds `data` from class field literals and may sync tab selection.
//! WXML/WXSS are not authoring truth; adapters must not own this printer.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;
use walkdir::WalkDir;

use vmz_protocol::{
    CheckReportStatus, DIAG_ARTIFACT_INVALID, Severity, TargetDiagnostic, VmzModuleKind,
};
use vmz_types::{ProgramModule, ProgramUnit, RouteTabDecl};

use super::wechat_page_js::{format_page_js, page_data_fields};
use super::wechat_tab::{
    CustomTabItem, TAB_BG, TAB_COLOR, TAB_SELECTED_COLOR, materialize_center_white_icon,
    materialize_tab_icons, pack_app_wxss_chrome, write_custom_tab_bar,
};
use super::wechat_wxss::{load_pack_style, page_css};

pub use super::wechat_tab::rasterize_svg_png;

/// Pack-default navigation bar background (not defineConfig).
const WINDOW_NAV_BG: &str = "#3D6B2F";
/// Pack-default navigation bar text style (not defineConfig).
const WINDOW_NAV_TEXT: &str = "white";
/// Pack-default page background (not defineConfig).
const WINDOW_BG: &str = "#F6F3EC";

/// Report schema for WeChat packaging writes.
pub const MINI_WECHAT_PACK_REPORT_SCHEMA: &str = "vmz.target.mini_wechat_pack.v0";

/// Packaging target folder name under `dist/`.
pub const WECHAT_PACK_TARGET: &str = "wechat";

/// Relative root of the WeChat DevTools project (`dist/wechat`).
pub const WECHAT_PACK_ROOT: &str = "dist/wechat";

/// Contract written from defineConfig delivery.packaging.wechat.
pub const WECHAT_PACKAGING_REL: &str = "dist/_vmz/wechat-packaging.json";

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WechatPackagingSpec {
    #[serde(default)]
    app_id: String,
    #[serde(default)]
    project_name: String,
    #[serde(default)]
    title: String,
}

fn load_wechat_packaging(root: &Path) -> WechatPackagingSpec {
    let path = root.join("dist").join("_vmz").join("wechat-packaging.json");
    let Ok(text) = fs::read_to_string(path) else {
        return WechatPackagingSpec::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn wechat_app_id(spec: &WechatPackagingSpec) -> &str {
    let id = spec.app_id.trim();
    if id.is_empty() { "touristappid" } else { id }
}

fn wechat_title(spec: &WechatPackagingSpec) -> &str {
    let title = spec.title.trim();
    if title.is_empty() { "VMZ" } else { title }
}

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

fn write_pack_file(abs: &Path, body: &str) -> std::io::Result<()> {
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(abs, body)
}

struct PendingPage {
    chunk_id: String,
    unit_name: String,
    stem: String,
    module_source: String,
    wxml: String,
    wxss: String,
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
    let packaging = load_wechat_packaging(root);
    let legacy = root.join("dist").join("_vmz").join("mini-deploy").join("wechat");
    if legacy.exists() {
        let _ = fs::remove_dir_all(&legacy);
    }
    let styles = load_pack_style(root);
    let mut pending: Vec<PendingPage> = Vec::new();
    let mut app_pages: Vec<String> = Vec::new();
    let mut tab_pages: Vec<(u32, String, RouteTabDecl)> = Vec::new();

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
            let css = page_css(&styles, &module.source);
            match emit_wechat_page(unit, &css) {
                Ok((wxml, wxss)) => {
                    if let Some(tab) = unit.deployment.tab.clone() {
                        tab_pages.push((tab.order, stem.clone(), tab));
                    }
                    pending.push(PendingPage {
                        chunk_id: chunk,
                        unit_name: unit.name.clone(),
                        stem: stem.clone(),
                        module_source: module.source.clone(),
                        wxml,
                        wxss,
                    });
                    app_pages.push(stem);
                }
                Err(mut unit_diags) => diagnostics.append(&mut unit_diags),
            }
        }
    }

    app_pages.sort_by(|a, b| page_rank(a).cmp(&page_rank(b)).then_with(|| a.cmp(b)));
    app_pages.dedup();

    tab_pages.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));
    let mut seen_orders = BTreeSet::new();
    let mut tab_ok = true;
    for (order, stem, _) in &tab_pages {
        if !seen_orders.insert(*order) {
            tab_ok = false;
            diagnostics.push(diag(
                stem,
                Severity::Error,
                format!("duplicate `<router>.tab.order` {order}"),
                DIAG_ARTIFACT_INVALID,
            ));
        }
    }
    if tab_pages.len() == 1 {
        tab_ok = false;
        diagnostics.push(diag(
            &tab_pages[0].1,
            Severity::Error,
            "WeChat custom tabBar requires 2-5 `<router>.tab` pages",
            DIAG_ARTIFACT_INVALID,
        ));
    } else if tab_pages.len() > 5 {
        tab_ok = false;
        diagnostics.push(diag(
            "",
            Severity::Error,
            format!(
                "WeChat custom tabBar allows at most 5 `<router>.tab` pages (got {})",
                tab_pages.len()
            ),
            DIAG_ARTIFACT_INVALID,
        ));
    }

    let mut tab_list = Vec::new();
    let mut custom_items = Vec::new();
    let mut center_white: Option<String> = None;
    if tab_ok && tab_pages.len() >= 2 {
        let raise_center = tab_pages.len() == 5;
        for (i, (_, stem, tab)) in tab_pages.iter().enumerate() {
            match materialize_tab_icons(root, &pack_abs, tab) {
                Ok((icon_path, selected_path)) => {
                    let center = raise_center && i == 2;
                    if center {
                        match materialize_center_white_icon(root, &pack_abs, tab) {
                            Ok(white) => center_white = Some(white),
                            Err(e) => {
                                tab_ok = false;
                                diagnostics.push(diag(
                                    stem,
                                    Severity::Error,
                                    e,
                                    DIAG_ARTIFACT_INVALID,
                                ));
                            }
                        }
                    }
                    tab_list.push(json!({
                        "pagePath": stem,
                        "text": tab.label,
                        "iconPath": icon_path,
                        "selectedIconPath": selected_path
                    }));
                    custom_items.push(CustomTabItem {
                        page_path: stem.clone(),
                        text: tab.label.clone(),
                        icon_path,
                        selected_icon_path: selected_path,
                        center,
                    });
                }
                Err(e) => {
                    tab_ok = false;
                    diagnostics.push(diag(stem, Severity::Error, e, DIAG_ARTIFACT_INVALID));
                }
            }
        }
    }

    let mut tab_selected: BTreeMap<String, u32> = BTreeMap::new();
    if tab_ok && tab_list.len() >= 2 {
        let tab_stems: Vec<String> = tab_pages.iter().map(|t| t.1.clone()).collect();
        for (i, stem) in tab_stems.iter().enumerate() {
            tab_selected.insert(stem.clone(), i as u32);
        }
        let mut rest: Vec<String> =
            app_pages.iter().filter(|p| !tab_stems.contains(p)).cloned().collect();
        rest.sort_by(|a, b| page_rank(a).cmp(&page_rank(b)).then_with(|| a.cmp(b)));
        app_pages = tab_stems.into_iter().chain(rest).collect();
        app_pages.dedup();

        match write_custom_tab_bar(&pack_abs, &custom_items, center_white.as_deref()) {
            Ok(_) => {}
            Err(e) => {
                tab_ok = false;
                diagnostics.push(diag(
                    "dist/wechat/custom-tab-bar",
                    Severity::Error,
                    e,
                    DIAG_ARTIFACT_INVALID,
                ));
            }
        }
    }

    let share_title =
        serde_json::to_string(wechat_title(&packaging)).unwrap_or_else(|_| "\"VMZ\"".into());

    for page in pending {
        let wxml_rel = format!("{WECHAT_PACK_ROOT}/{}.wxml", page.stem);
        let wxss_rel = format!("{WECHAT_PACK_ROOT}/{}.wxss", page.stem);
        let json_rel = format!("{WECHAT_PACK_ROOT}/{}.json", page.stem);
        let js_rel = format!("{WECHAT_PACK_ROOT}/{}.js", page.stem);
        let page_json = json!({
            "usingComponents": {},
            "enableShareAppMessage": true
        });
        let page_json_body =
            vmz_generator::to_pretty_json(&page_json).unwrap_or_else(|_| "{}".into());
        let fields = page_data_fields(root, &page.module_source);
        let selected = tab_selected.get(&page.stem).copied();
        let page_js_src = format_page_js(&share_title, &fields, selected);
        let page_js = match print_chrome_js(&page_js_src, &format!("{}.js", page.stem)) {
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
            (wxml_rel.as_str(), page.wxml.as_str()),
            (wxss_rel.as_str(), page.wxss.as_str()),
            (json_rel.as_str(), page_json_body.as_str()),
            (js_rel.as_str(), page_js.as_str()),
        ] {
            if let Err(e) = write_pack_file(&root.join(rel_path), &format!("{body}\n")) {
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
        pages.push(WechatPackFile {
            chunk_id: page.chunk_id,
            unit_name: page.unit_name,
            stem: page.stem,
            files: written,
        });
    }

    let mut app_json = json!({
        "pages": app_pages,
        "window": {
            "navigationBarTitleText": wechat_title(&packaging),
            "navigationBarBackgroundColor": WINDOW_NAV_BG,
            "navigationBarTextStyle": WINDOW_NAV_TEXT,
            "backgroundColor": WINDOW_BG
        },
        "sitemapLocation": "sitemap.json"
    });
    if tab_ok && tab_list.len() >= 2 {
        app_json["tabBar"] = json!({
            "custom": true,
            "color": TAB_COLOR,
            "selectedColor": TAB_SELECTED_COLOR,
            "backgroundColor": TAB_BG,
            "borderStyle": "white",
            "list": tab_list
        });
    }
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

    let mut app_wxss_src = styles.shared;
    if !app_wxss_src.ends_with('\n') && !app_wxss_src.is_empty() {
        app_wxss_src.push('\n');
    }
    app_wxss_src.push_str(pack_app_wxss_chrome());
    let app_wxss = vmz_generator::print_wxss(&app_wxss_src, false);
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

    let folder_name = root.file_name().and_then(|s| s.to_str()).unwrap_or("vmz");
    let projectname = {
        let n = packaging.project_name.trim();
        if n.is_empty() { folder_name } else { n }
    };
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
        "appid": wechat_app_id(&packaging),
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
