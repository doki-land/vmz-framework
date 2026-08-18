//! Per-page WXSS from SFC style slices (not the concatenated CSS bundle).
//!
//! `vmz-style.css` is a browser bundle: every SFC `<style>` plus optional
//! `/designs` SCSS. WeChat page WXSS must not replay that whole file or
//! `.page` rules collide. Split on the `/* <source path> */` comments the
//! SCSS plugin already writes; shared TW/designs layers go to `app.wxss`.

use std::fs;
use std::path::Path;

/// CSS inputs for one WeChat pack.
pub struct PackStyle {
    /// TW + designs + `/designs` SCSS for `app.wxss`.
    pub shared: String,
    file_slices: Vec<(String, String)>,
    /// Whole style layer when it has no per-file comments (unit fixtures).
    undivided: String,
}

/// Load style layers from `dist/` for WeChat packaging.
pub fn load_pack_style(root: &Path) -> PackStyle {
    let dist = root.join("dist");
    let mut shared_parts = Vec::new();
    for name in ["vmz-tw.css", "vmz-designs.css"] {
        if let Ok(text) = fs::read_to_string(dist.join(name))
            && !text.trim().is_empty()
        {
            shared_parts.push(text);
        }
    }
    let style_text = read_style_layer(&dist);
    let slices = split_file_slices(&style_text);
    let mut undivided = String::new();
    if slices.is_empty() {
        undivided = style_text;
    } else {
        for (path, css) in &slices {
            if is_shared_style_path(path) {
                shared_parts.push(css.clone());
            }
        }
    }
    PackStyle { shared: shared_parts.join("\n"), file_slices: slices, undivided }
}

fn read_style_layer(dist: &Path) -> String {
    let style = dist.join("vmz-style.css");
    if let Ok(text) = fs::read_to_string(&style)
        && !text.trim().is_empty()
    {
        return text;
    }
    let entry = dist.join("vmz.css");
    if let Ok(text) = fs::read_to_string(&entry)
        && !text.trim().is_empty()
        && !text.contains("@import")
    {
        return text;
    }
    String::new()
}

fn is_shared_style_path(path: &str) -> bool {
    posix(path).to_ascii_lowercase().contains("/designs/")
}

fn posix(p: &str) -> String {
    p.replace('\\', "/")
}

/// CSS for one page SFC. Empty when slices exist but none match.
pub fn page_css(style: &PackStyle, source: &str) -> String {
    if style.file_slices.is_empty() {
        return style.undivided.clone();
    }
    let src = posix(source);
    for (path, css) in &style.file_slices {
        if is_shared_style_path(path) {
            continue;
        }
        if paths_match(&src, path) {
            return css.clone();
        }
    }
    String::new()
}

fn paths_match(source: &str, comment_path: &str) -> bool {
    let a = posix(source);
    let b = posix(comment_path);
    if a.eq_ignore_ascii_case(&b) {
        return true;
    }
    let a_low = a.to_ascii_lowercase();
    let b_low = b.to_ascii_lowercase();
    a_low.ends_with(&b_low) || b_low.ends_with(&a_low)
}

fn split_file_slices(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut current_path: Option<String> = None;
    let mut buf = String::new();
    for line in text.lines() {
        if let Some(path) = file_comment(line) {
            flush_slice(&mut current_path, &mut buf, &mut out);
            current_path = Some(path);
            continue;
        }
        if current_path.is_some() {
            buf.push_str(line);
            buf.push('\n');
        }
    }
    flush_slice(&mut current_path, &mut buf, &mut out);
    out
}

fn flush_slice(
    current_path: &mut Option<String>,
    buf: &mut String,
    out: &mut Vec<(String, String)>,
) {
    if let Some(p) = current_path.take() {
        let body = buf.trim().to_string();
        if !body.is_empty() {
            out.push((p, body));
        }
    }
    buf.clear();
}

fn is_layer_comment(line: &str) -> bool {
    line.trim().starts_with("/* vmz style layer")
}

fn file_comment(line: &str) -> Option<String> {
    let t = line.trim();
    if is_layer_comment(line) {
        return None;
    }
    if !t.starts_with("/*") || !t.ends_with("*/") {
        return None;
    }
    let inner = t[2..t.len() - 2].trim();
    if inner.is_empty() {
        return None;
    }
    if inner.contains(".vmz")
        || inner.contains(".scss")
        || inner.contains(".css")
        || inner.contains('/')
        || inner.contains('\\')
    {
        Some(posix(inner))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::{PackStyle, page_css, split_file_slices};

    #[test]
    fn splits_sfc_comments_and_ignores_other_pages() {
        let text = "/* vmz style layer: Scss */\n/* src/pages/home.vmz */\n.home { color: red; }\n/* src/pages/cart.vmz */\n.cart { color: blue; }\n";
        let slices = split_file_slices(text);
        assert_eq!(slices.len(), 2);
        let style =
            PackStyle { shared: String::new(), file_slices: slices, undivided: String::new() };
        let home = page_css(&style, "E:/app/src/pages/home.vmz");
        assert!(home.contains(".home"), "{home}");
        assert!(!home.contains(".cart"), "{home}");
        let cart = page_css(&style, "src/pages/cart.vmz");
        assert!(cart.contains(".cart"), "{cart}");
        assert!(!cart.contains(".home"), "{cart}");
    }
}
