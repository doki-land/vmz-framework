//! Faithful `.vmz` reassembly: preserve router/meta/lang/attrs/block order.

use vmz_compiler::{DataBlock, ParsedVmz, ScriptBlock, ScriptLanguage, StyleLanguage};

use crate::editorconfig::EditorSettings;

/// Reassemble a formatted SFC from parsed structure + formatted bodies.
pub fn assemble_vmz(
    parsed: &ParsedVmz,
    client: &str,
    server: Option<&str>,
    style: Option<&str>,
    settings: &EditorSettings,
) -> String {
    let nl = settings.newline();
    let mut parts: Vec<String> = Vec::new();

    if let Some(router) = &parsed.router {
        parts.push(emit_data_block("router", router, settings));
    }
    if let Some(meta) = &parsed.meta {
        parts.push(emit_data_block("meta", meta, settings));
    }

    parts.push(emit_tagged_block(
        "template",
        None,
        &indent_block(&parsed.template.content, settings),
        settings,
    ));

    if let (Some(style_body), Some(style_block)) = (style, parsed.style.as_ref()) {
        let lang_attr = match style_block.lang {
            StyleLanguage::Css => Some("css"),
            StyleLanguage::Sass => Some("sass"),
            // Default SCSS: omit lang (matches author surface default).
            StyleLanguage::Scss => None,
        };
        parts.push(emit_tagged_block("style", lang_attr, style_body, settings));
    }

    parts.push(emit_script_block(&parsed.client, client, settings));

    if let (Some(server_body), Some(server_block)) = (server, parsed.server.as_ref()) {
        parts.push(emit_script_block(server_block, server_body, settings));
    }

    let mut out = parts.join(nl);
    if settings.insert_final_newline {
        if !out.ends_with(nl) {
            out.push_str(nl);
        }
    } else {
        while out.ends_with('\n') || out.ends_with('\r') {
            out.pop();
        }
    }
    out
}

fn emit_data_block(name: &str, block: &DataBlock, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let attrs = block.attrs.trim();
    let lang = block.lang.as_deref().filter(|s| !s.is_empty());

    let mut open = format!("<{name}");
    if !attrs.is_empty() {
        open.push(' ');
        open.push_str(attrs);
    }
    if let Some(lang) = lang {
        // Avoid duplicating lang if already in attrs.
        if !attrs.to_ascii_lowercase().contains("lang=") {
            open.push_str(&format!(" lang=\"{lang}\""));
        }
    }

    let body = block.content.trim();
    if body.is_empty() {
        // Self-closing when original had no body (attrs-only sugar).
        if attrs.contains('/') || block.content.is_empty() {
            // Prefer explicit close when we only have empty content from a pair of tags;
            // self-close when attrs look like opening-tag sugar without body.
            if block.content.is_empty() && !attrs.is_empty() {
                return format!("{open} />");
            }
        }
        return format!("{open}>{nl}</{name}>");
    }

    let indented = indent_block(body, settings);
    format!("{open}>{nl}{indented}</{name}>")
}

fn emit_tagged_block(
    name: &str,
    lang: Option<&str>,
    body: &str,
    settings: &EditorSettings,
) -> String {
    let nl = settings.newline();
    let open = match lang {
        Some(lang) => format!("<{name} lang=\"{lang}\">"),
        None => format!("<{name}>"),
    };
    let body = ensure_trailing_nl(body, nl);
    format!("{open}{nl}{body}</{name}>")
}

fn emit_script_block(block: &ScriptBlock, body: &str, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let role = match block.kind {
        vmz_compiler::ScriptKind::Client => "client",
        vmz_compiler::ScriptKind::Server => "server",
    };
    let open = match block.lang {
        ScriptLanguage::Ts => format!("<script {role}>"),
        other => format!("<script {role} lang=\"{}\">", other.as_str()),
    };
    let body = ensure_trailing_nl(body, nl);
    format!("{open}{nl}{body}</script>")
}

fn indent_block(content: &str, settings: &EditorSettings) -> String {
    let nl = settings.newline();
    let unit = settings.indent_unit();
    let lines = normalize_relative_lines(content);
    let mut out = String::new();
    for line in lines {
        let line =
            if settings.trim_trailing_whitespace { line.trim_end().to_string() } else { line };
        if line.is_empty() {
            out.push_str(nl);
        } else {
            out.push_str(&unit);
            out.push_str(&line);
            out.push_str(nl);
        }
    }
    out
}

/// Drop the shared leading indent so envelope re-indent is idempotent, while
/// preserving relative indentation inside the block.
fn normalize_relative_lines(content: &str) -> Vec<String> {
    let raw: Vec<&str> = content.lines().collect();
    let mut min_indent: Option<usize> = None;
    for line in &raw {
        if line.trim().is_empty() {
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        min_indent = Some(match min_indent {
            Some(m) => m.min(indent),
            None => indent,
        });
    }
    let min_indent = min_indent.unwrap_or(0);
    raw.into_iter()
        .map(|line| {
            if line.trim().is_empty() {
                String::new()
            } else if min_indent == 0 {
                line.to_string()
            } else {
                line.get(min_indent..).unwrap_or(line).to_string()
            }
        })
        .collect()
}

fn ensure_trailing_nl(body: &str, nl: &str) -> String {
    let mut body = body.to_string();
    if body.is_empty() {
        return body;
    }
    // Normalize internal newlines to the EditorConfig ending first.
    body = body.replace("\r\n", "\n").replace('\r', "\n");
    if nl != "\n" {
        body = body.replace('\n', nl);
    }
    if !body.ends_with(nl) {
        body.push_str(nl);
    }
    body
}
