//! WeChat custom tabBar lowering from RouteContract.tab (SVG -> PNG).
//!
//! Authors write host-neutral `order` / `label` / `icon`. Pack emits
//! `custom: true` + `custom-tab-bar/` because native tabBar cannot raise a
//! center slot. Icons are PNG (WeChat `<image>` does not show SVG).

use std::fs;
use std::path::{Path, PathBuf};

use vmz_types::RouteTabDecl;

/// Tab icon size (WeChat recommends 81px).
pub const TAB_ICON_PX: u32 = 81;
/// Unselected tab chrome (pack default, not defineConfig).
pub const TAB_COLOR: &str = "#8A8A8A";
/// Selected tab chrome (pack default, not defineConfig).
pub const TAB_SELECTED_COLOR: &str = "#3D6B2F";
/// tabBar background chrome (pack default, not defineConfig).
pub const TAB_BG: &str = "#ffffff";
/// Center raised button glyph (pack default).
const TAB_CENTER_WHITE: &str = "#FFFFFF";

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

/// White glyph for the raised center slot (5-tab pack chrome).
pub fn materialize_center_white_icon(
    root: &Path,
    pack_abs: &Path,
    tab: &RouteTabDecl,
) -> Result<String, String> {
    let src = resolve_asset(root, &tab.icon)
        .ok_or_else(|| format!("tab icon not found: {}", tab.icon))?;
    let icon_stem = asset_stem(&tab.icon);
    let rel = format!("assets/{icon_stem}-white.png");
    let abs = pack_abs.join("assets").join(format!("{icon_stem}-white.png"));
    if is_ext(&src, "svg") {
        write_svg_png(&src, &abs, TAB_CENTER_WHITE)?;
        Ok(rel)
    } else if is_ext(&src, "png") {
        copy_png(&src, &abs)?;
        Ok(rel)
    } else {
        Err(format!("tab icon must be .svg or .png: {}", tab.icon))
    }
}

/// One entry for the custom-tab-bar component list.
pub struct CustomTabItem {
    /// WeChat page stem (`pages/home/home`).
    pub page_path: String,
    /// Tab label.
    pub text: String,
    /// Pack-relative icon (`assets/tab-home.png`).
    pub icon_path: String,
    /// Pack-relative selected icon.
    pub selected_icon_path: String,
    /// Raised center slot.
    pub center: bool,
}

/// Pack chrome files for `custom-tab-bar/`.
pub fn write_custom_tab_bar(
    pack_abs: &Path,
    items: &[CustomTabItem],
    center_white_rel: Option<&str>,
) -> Result<Vec<String>, String> {
    let dir = pack_abs.join("custom-tab-bar");
    fs::create_dir_all(&dir).map_err(|e| format!("create custom-tab-bar failed: {e}"))?;

    let mut list_js = String::from("[\n");
    for (i, item) in items.iter().enumerate() {
        let path = format!("/{}", item.page_path.trim_start_matches('/'));
        let icon = format!("/{}", item.icon_path.trim_start_matches('/'));
        let selected = format!("/{}", item.selected_icon_path.trim_start_matches('/'));
        list_js.push_str("      {\n");
        list_js.push_str(&format!("        pagePath: '{}',\n", path.replace('\'', "\\'")));
        list_js.push_str(&format!("        text: '{}',\n", item.text.replace('\'', "\\'")));
        list_js.push_str(&format!("        iconPath: '{}',\n", icon.replace('\'', "\\'")));
        list_js
            .push_str(&format!("        selectedIconPath: '{}',\n", selected.replace('\'', "\\'")));
        if item.center {
            list_js.push_str("        center: true,\n");
        }
        list_js.push_str("      }");
        if i + 1 != items.len() {
            list_js.push(',');
        }
        list_js.push('\n');
    }
    list_js.push_str("    ]");

    let center_src = center_white_rel
        .map(|r| format!("/{}", r.trim_start_matches('/')))
        .unwrap_or_else(|| "/assets/tab-qr-white.png".into());

    let js = format!(
        "Component({{
  data: {{
    selected: 0,
    list: {list_js},
  }},
  methods: {{
    onSwitch(e) {{
      const path = e.currentTarget.dataset.path;
      const index = e.currentTarget.dataset.index;
      wx.switchTab({{ url: path }});
      this.setData({{ selected: index }});
    }},
  }},
}});
"
    );

    let wxml = format!(
        r#"<view class="tabbar">
  <view
    wx:for="{{{{list}}}}"
    wx:key="pagePath"
    class="tab {{{{selected === index ? 'on' : ''}}}} {{{{item.center ? 'center' : ''}}}}"
    data-index="{{{{index}}}}"
    data-path="{{{{item.pagePath}}}}"
    bindtap="onSwitch"
  >
    <block wx:if="{{{{item.center}}}}">
      <view class="center-wrap">
        <view class="center-inner">
          <image class="center-icon" src="{center_src}" mode="aspectFit" />
        </view>
      </view>
      <text class="label center-label">{{{{item.text}}}}</text>
    </block>
    <block wx:else>
      <view class="icon-wrap">
        <image
          class="icon"
          src="{{{{selected === index ? item.selectedIconPath : item.iconPath}}}}"
          mode="aspectFit"
        />
      </view>
      <text class="label">{{{{item.text}}}}</text>
    </block>
  </view>
</view>
"#
    );

    let wxss = r#".tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 108rpx;
  padding-bottom: constant(safe-area-inset-bottom);
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: content-box;
  background: #fff;
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  z-index: 999;
}
.tab {
  flex: 1;
  height: 108rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 10rpx;
  box-sizing: border-box;
  color: #8a8a8a;
  font-size: 20rpx;
  position: relative;
}
.tab.on { color: #3d6b2f; }
.icon { width: 44rpx; height: 44rpx; margin-bottom: 6rpx; }
.icon-wrap {
  position: relative;
  width: 44rpx;
  height: 44rpx;
  margin-bottom: 6rpx;
}
.icon-wrap .icon { margin-bottom: 0; }
.label { line-height: 1.2; font-size: 20rpx; }
.tab.center { overflow: visible; }
.center-wrap {
  position: absolute;
  left: 50%;
  bottom: 34rpx;
  transform: translateX(-50%);
  width: 76rpx;
  height: 76rpx;
}
.center-inner {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  background: linear-gradient(160deg, #5a8f3f, #2f5624);
  box-shadow: 0 4rpx 12rpx rgba(61, 107, 47, 0.25);
  display: flex;
  align-items: center;
  justify-content: center;
  border: 4rpx solid #fff;
}
.center-icon { width: 36rpx; height: 36rpx; }
.center-label { position: relative; z-index: 1; }
"#;

    let json = "{\n  \"component\": true\n}\n";

    let mut written = Vec::new();
    for (name, body) in [
        ("index.js", js.as_str()),
        ("index.wxml", wxml.as_str()),
        ("index.wxss", wxss),
        ("index.json", json),
    ] {
        let abs = dir.join(name);
        fs::write(&abs, body).map_err(|e| format!("write custom-tab-bar/{name} failed: {e}"))?;
        written.push(format!("dist/wechat/custom-tab-bar/{name}"));
    }
    Ok(written)
}

/// Shared page chrome appended to `app.wxss` (not defineConfig).
pub fn pack_app_wxss_chrome() -> &'static str {
    r#"
page {
  background-color: #f6f3ec;
}
.tab-spacer {
  width: 100%;
  height: calc(200rpx + constant(safe-area-inset-bottom));
  height: calc(200rpx + env(safe-area-inset-bottom));
  pointer-events: none;
}
"#
}
