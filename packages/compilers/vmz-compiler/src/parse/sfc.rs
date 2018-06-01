//! Split a `.vmz` file into template / style / script client / script server.
//!
//! Required order: template ?style? ?client ?server?

use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SfcError {
    #[error("{path}: {message}")]
    Invalid { path: PathBuf, message: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScriptKind {
    Client,
    Server,
}

#[derive(Debug, Clone)]
pub struct TemplateBlock {
    pub content: String,
    /// Byte offset of content start in the original source.
    pub content_start: usize,
}

/// `<style>` dialect. Default is SCSS (no `lang` attribute).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StyleLanguage {
    Scss,
    Css,
    Sass,
}

impl StyleLanguage {
    pub fn parse_attr(raw: Option<&str>) -> Result<Self, String> {
        match raw.map(str::trim).filter(|s| !s.is_empty()) {
            None => Ok(Self::Scss),
            Some("scss") => Ok(Self::Scss),
            Some("css") => Ok(Self::Css),
            Some("sass") => Ok(Self::Sass),
            Some(other) => Err(format!(
                "unsupported `<style lang=\"{other}\">`; use scss (default), css, or sass"
            )),
        }
    }
}

#[derive(Debug, Clone)]
pub struct StyleBlock {
    pub content: String,
    pub content_start: usize,
    pub lang: StyleLanguage,
}

#[derive(Debug, Clone)]
pub struct ScriptBlock {
    pub kind: ScriptKind,
    pub content: String,
    pub content_start: usize,
}

#[derive(Debug, Clone)]
pub struct DataBlock {
    pub content: String,
    pub content_start: usize,
    /// `None` or `json5` (default); `yaml` reserved.
    pub lang: Option<String>,
    /// Opening-tag attributes (e.g. `<router path="/x" />` sugar → same RouteContract).
    pub attrs: String,
}

#[derive(Debug, Clone)]
pub struct ParsedVmz {
    pub path: PathBuf,
    pub source: String,
    pub template: TemplateBlock,
    pub style: Option<StyleBlock>,
    pub client: ScriptBlock,
    pub server: Option<ScriptBlock>,
    /// Optional RouteContract data block (≤1).
    pub router: Option<DataBlock>,
    /// Optional PageMeta data block (≤1).
    pub meta: Option<DataBlock>,
}

pub fn parse_vmz(path: impl AsRef<Path>, source: impl Into<String>) -> Result<ParsedVmz, SfcError> {
    let path = path.as_ref().to_path_buf();
    let source = source.into();
    let blocks = extract_blocks(&path, &source)?;

    let mut router = None;
    let mut meta = None;
    let mut template = None;
    let mut style = None;
    let mut client = None;
    let mut server = None;
    let mut last_role = BlockRole::None;

    for block in blocks {
        match block.role {
            BlockRole::Router => {
                if !matches!(last_role, BlockRole::None | BlockRole::Meta) {
                    return Err(err(
                        &path,
                        "`<router>` must appear before `<template>` (with optional `<meta>`)",
                    ));
                }
                if router.is_some() {
                    return Err(err(&path, "duplicate `<router>`"));
                }
                router = Some(DataBlock {
                    content: block.content,
                    content_start: block.content_start,
                    lang: block.lang,
                    attrs: block.attrs,
                });
                last_role = BlockRole::Router;
            }
            BlockRole::Meta => {
                if !matches!(last_role, BlockRole::None | BlockRole::Router) {
                    return Err(err(
                        &path,
                        "`<meta>` must appear before `<template>` (with optional `<router>`)",
                    ));
                }
                if meta.is_some() {
                    return Err(err(&path, "duplicate `<meta>`"));
                }
                meta = Some(DataBlock {
                    content: block.content,
                    content_start: block.content_start,
                    lang: block.lang,
                    attrs: block.attrs,
                });
                last_role = BlockRole::Meta;
            }
            BlockRole::Template => {
                if !matches!(last_role, BlockRole::None | BlockRole::Router | BlockRole::Meta) {
                    return Err(err(&path, "`<template>` must be the first view block"));
                }
                if template.is_some() {
                    return Err(err(&path, "duplicate `<template>`"));
                }
                template = Some(TemplateBlock {
                    content: block.content,
                    content_start: block.content_start,
                });
                last_role = BlockRole::Template;
            }
            BlockRole::Style => {
                if !matches!(last_role, BlockRole::Template) {
                    return Err(err(
                        &path,
                        "`<style>` must follow `<template>` (view before logic)",
                    ));
                }
                if style.is_some() {
                    return Err(err(&path, "duplicate `<style>`"));
                }
                let lang = StyleLanguage::parse_attr(block.lang.as_deref())
                    .map_err(|message| err(&path, message))?;
                style = Some(StyleBlock {
                    content: block.content,
                    content_start: block.content_start,
                    lang,
                });
                last_role = BlockRole::Style;
            }
            BlockRole::Client => {
                if !matches!(last_role, BlockRole::Template | BlockRole::Style) {
                    return Err(err(
                        &path,
                        "`<script client>` must follow template/style (view ?client ?server)",
                    ));
                }
                if client.is_some() {
                    return Err(err(&path, "duplicate `<script client>`"));
                }
                client = Some(ScriptBlock {
                    kind: ScriptKind::Client,
                    content: block.content,
                    content_start: block.content_start,
                });
                last_role = BlockRole::Client;
            }
            BlockRole::Server => {
                if !matches!(last_role, BlockRole::Client) {
                    return Err(err(
                        &path,
                        "`<script server>` must follow `<script client>` (view ?client ?server)",
                    ));
                }
                if server.is_some() {
                    return Err(err(&path, "duplicate `<script server>`"));
                }
                server = Some(ScriptBlock {
                    kind: ScriptKind::Server,
                    content: block.content,
                    content_start: block.content_start,
                });
                last_role = BlockRole::Server;
            }
            BlockRole::BareScript => {
                return Err(err(
                    &path,
                    "bare `<script>` is forbidden; use `<script client>` or `<script server>`",
                ));
            }
            BlockRole::None => {}
        }
    }

    let Some(template) = template else {
        return Err(err(&path, "missing `<template>`"));
    };
    let Some(client) = client else {
        return Err(err(&path, "missing `<script client>`"));
    };

    let _ = last_role;
    Ok(ParsedVmz { path, source, template, style, client, server, router, meta })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BlockRole {
    None,
    Router,
    Meta,
    Template,
    Style,
    Client,
    Server,
    BareScript,
}

struct RawBlock {
    role: BlockRole,
    content: String,
    content_start: usize,
    lang: Option<String>,
    attrs: String,
}

fn extract_blocks(path: &Path, source: &str) -> Result<Vec<RawBlock>, SfcError> {
    let mut blocks = Vec::new();
    let bytes = source.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        skip_ws_and_comments(bytes, &mut i);
        if i >= bytes.len() {
            break;
        }
        if bytes[i] != b'<' {
            return Err(err(
                path,
                &format!("unexpected content at byte {i}; expected a SFC block tag"),
            ));
        }

        let tag_start = i;
        i += 1;
        let name_start = i;
        while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'-') {
            i += 1;
        }
        let name = std::str::from_utf8(&bytes[name_start..i]).unwrap_or("");

        // read rest of opening tag
        let mut attrs = String::new();
        while i < bytes.len() && bytes[i] != b'>' {
            attrs.push(bytes[i] as char);
            i += 1;
        }
        if i >= bytes.len() {
            return Err(err(path, &format!("unclosed tag starting at byte {tag_start}")));
        }
        i += 1; // '>'
        let content_start = i;

        let self_closing = attrs.trim_end().ends_with('/');
        if self_closing {
            attrs = attrs.trim_end().trim_end_matches('/').to_string();
        }

        let (role, close) = match name {
            "router" => (BlockRole::Router, "</router>"),
            "meta" => (BlockRole::Meta, "</meta>"),
            "template" => (BlockRole::Template, "</template>"),
            "style" => (BlockRole::Style, "</style>"),
            "script" => {
                let attrs_l = attrs.to_ascii_lowercase();
                if attrs_l.split_whitespace().any(|a| a == "client") {
                    (BlockRole::Client, "</script>")
                } else if attrs_l.split_whitespace().any(|a| a == "server") {
                    (BlockRole::Server, "</script>")
                } else {
                    (BlockRole::BareScript, "</script>")
                }
            }
            other => {
                return Err(err(path, &format!("unknown SFC tag `<{other}>`")));
            }
        };

        if self_closing && !matches!(role, BlockRole::Router | BlockRole::Meta) {
            return Err(err(
                path,
                &format!("self-closing `<{name} />` is only allowed for `<router>` / `<meta>`"),
            ));
        }

        let (content, content_start) = if self_closing {
            (String::new(), content_start)
        } else {
            let Some(rel) = source[content_start..].find(close) else {
                return Err(err(path, &format!("missing closing `{close}`")));
            };
            let content_end = content_start + rel;
            let content = source[content_start..content_end].to_string();
            i = content_end + close.len();
            (content, content_start)
        };

        let lang = if matches!(role, BlockRole::Style | BlockRole::Router | BlockRole::Meta) {
            parse_lang_attr(&attrs)
        } else {
            None
        };

        blocks.push(RawBlock { role, content, content_start, lang, attrs });
    }

    Ok(blocks)
}

fn parse_lang_attr(attrs: &str) -> Option<String> {
    parse_attr_value(attrs, "lang")
}

/// Read `name="value"` / `name='value'` from an HTML-like attribute list.
pub fn parse_attr_value(attrs: &str, name: &str) -> Option<String> {
    let lower = attrs.to_ascii_lowercase();
    let key = name.to_ascii_lowercase();
    let mut search = 0;
    while let Some(rel) = lower[search..].find(&key) {
        let idx = search + rel;
        let before_ok = idx == 0 || lower.as_bytes()[idx - 1].is_ascii_whitespace();
        let after = idx + key.len();
        let after_ok = after >= lower.len()
            || lower.as_bytes()[after].is_ascii_whitespace()
            || lower.as_bytes()[after] == b'=';
        if before_ok && after_ok {
            let rest = attrs[after..].trim_start();
            let rest = rest.strip_prefix('=')?.trim_start();
            if let Some(r) = rest.strip_prefix('"') {
                let end = r.find('"')?;
                return Some(r[..end].to_string());
            }
            if let Some(r) = rest.strip_prefix('\'') {
                let end = r.find('\'')?;
                return Some(r[..end].to_string());
            }
            let end = rest
                .find(|c: char| c.is_ascii_whitespace() || c == '/' || c == '>')
                .unwrap_or(rest.len());
            let v = rest[..end].trim();
            if !v.is_empty() {
                return Some(v.to_string());
            }
            return None;
        }
        search = idx + 1;
    }
    None
}

fn skip_ws_and_comments(bytes: &[u8], i: &mut usize) {
    loop {
        while *i < bytes.len() && bytes[*i].is_ascii_whitespace() {
            *i += 1;
        }
        if *i + 3 < bytes.len() && &bytes[*i..*i + 4] == b"<!--" {
            *i += 4;
            while *i + 2 < bytes.len() && &bytes[*i..*i + 3] != b"-->" {
                *i += 1;
            }
            if *i + 2 < bytes.len() {
                *i += 3;
            }
            continue;
        }
        break;
    }
}

fn err(path: &Path, message: impl Into<String>) -> SfcError {
    SfcError::Invalid { path: path.to_path_buf(), message: message.into() }
}
