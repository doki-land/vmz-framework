//! WeChat native tabBar lowering from RouteContract.tab (SVG -> PNG).
//!
//! Authors write host-neutral `order` / `label` / `icon`. This module rasterizes
//! SVG to PNG because WeChat native tab icons are PNG-only.

use std::fs;
use std::path::{Path, PathBuf};

use vmz_types::RouteTabDecl;

/// Native tab icon size (WeChat recommends 81px).
pub const TAB_ICON_PX: u32 = 81;
/// Unselected tab chrome (pack default, not defineConfig).
pub const TAB_COLOR: &str = "#8A8A8A";
/// Selected tab chrome (pack default, not defineConfig).
pub const TAB_SELECTED_COLOR: &str = "#3D6B2F";
/// tabBar background chrome (pack default, not defineConfig).
pub const TAB_BG: &str = "#ffffff";

fn resolve_asset(root: &Path, rel: &str) -> Option<PathBuf> {
    let candidates = [root.join(rel), root.join("src").join(rel)];
    candidates.into_iter().find(|p| p.is_file())
}

/// Rasterize SVG markup to a square PNG.
pub fn rasterize_svg_png(svg: &str, px: u32) -> Result<Vec<u8>, String> {
    let tree = resvg::usvg::Tree::from_str(svg, &resvg::usvg::Options::default())
        .map_err(|e| format!("svg parse failed: {e}"))?;
    let size = tree.size();
    if size.width() <= 0.0 || size.height() <= 0.0 {
        return Err("svg has empty size".into());
    }
    let mut pixmap = resvg::tiny_skia::Pixmap::new(px, px).ok_or("tab icon pixmap")?;
    let sx = px as f32 / size.width();
    let sy = px as f32 / size.height();
    let transform = resvg::tiny_skia::Transform::from_scale(sx, sy);
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|e| format!("png encode failed: {e}"))
}

fn is_ext(path: &Path, ext: &str) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case(ext))
}

fn asset_stem(rel: &str) -> String {
    Path::new(rel).file_stem().and_then(|s| s.to_str()).unwrap_or("tab").to_string()
}

fn write_pack_bytes(abs: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = abs.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(abs, bytes)
}

fn load_svg_colored(path: &Path, color: &str) -> Result<String, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("read icon failed: {e}"))?;
    Ok(text.replace("currentColor", color))
}

fn write_svg_png(src: &Path, dest: &Path, color: &str) -> Result<(), String> {
    let svg = load_svg_colored(src, color)?;
    let png = rasterize_svg_png(&svg, TAB_ICON_PX)?;
    write_pack_bytes(dest, &png).map_err(|e| format!("write tab icon failed: {e}"))
}

fn copy_png(src: &Path, dest: &Path) -> Result<(), String> {
    let bytes = fs::read(src).map_err(|e| format!("read icon failed: {e}"))?;
    write_pack_bytes(dest, &bytes).map_err(|e| format!("write tab icon failed: {e}"))
}

/// Write tab icons under `dist/wechat/assets/` and return pack-relative PNG paths.
pub fn materialize_tab_icons(
    root: &Path,
    pack_abs: &Path,
    tab: &RouteTabDecl,
) -> Result<(String, String), String> {
    let src = resolve_asset(root, &tab.icon)
        .ok_or_else(|| format!("tab icon not found: {}", tab.icon))?;
    let icon_stem = asset_stem(&tab.icon);
    let icon_rel = format!("assets/{icon_stem}.png");
    let icon_abs = pack_abs.join("assets").join(format!("{icon_stem}.png"));

    if is_ext(&src, "svg") {
        write_svg_png(&src, &icon_abs, TAB_COLOR)?;
    } else if is_ext(&src, "png") {
        copy_png(&src, &icon_abs)?;
    } else {
        return Err(format!("tab icon must be .svg or .png: {}", tab.icon));
    }

    if let Some(sel) = tab.selected_icon.as_deref().filter(|s| !s.is_empty()) {
        let sel_src =
            resolve_asset(root, sel).ok_or_else(|| format!("tab selectedIcon not found: {sel}"))?;
        let sel_stem = asset_stem(sel);
        let sel_rel = format!("assets/{sel_stem}.png");
        let sel_abs = pack_abs.join("assets").join(format!("{sel_stem}.png"));
        if is_ext(&sel_src, "svg") {
            write_svg_png(&sel_src, &sel_abs, TAB_SELECTED_COLOR)?;
        } else if is_ext(&sel_src, "png") {
            copy_png(&sel_src, &sel_abs)?;
        } else {
            return Err(format!("tab selectedIcon must be .svg or .png: {sel}"));
        }
        return Ok((icon_rel, sel_rel));
    }

    if is_ext(&src, "svg") {
        let sel_rel = format!("assets/{icon_stem}-on.png");
        let sel_abs = pack_abs.join("assets").join(format!("{icon_stem}-on.png"));
        write_svg_png(&src, &sel_abs, TAB_SELECTED_COLOR)?;
        return Ok((icon_rel, sel_rel));
    }

    Ok((icon_rel.clone(), icon_rel))
}
