//! Vue template syntax → VMZ [`TemplateIr`].
//!
//! **Syntax ≡ Vue template** (`{{ }}`, `v-*` / `@` / `:` / `#`). JSX / single-brace
//! `{expr}` and `attr={…}` are hard errors. Semantic depth (full Vue directive set,
//! formatter, LSP) lands in later knives; this module only parses the author surface
//! and lowers into the existing IR shape the pipeline already consumes.

use std::fmt;

/// One node in the template tree produced by [`parse_template`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateNode {
    /// Element with tag name, attributes, and child nodes.
    Element {
        /// Tag name as written (`div`, `MyComp`, ...).
        tag: String,
        /// Attributes in source order (directives already lowered).
        attrs: Vec<TemplateAttr>,
        /// Nested children (empty for self-closing tags).
        children: Vec<TemplateNode>,
    },
    /// Decoded text run between tags / interpolations.
    Text(String),
    /// `{{ expr }}` mustache body (trimmed), without the braces.
    Interp(String),
}

/// One attribute on a [`TemplateNode::Element`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateAttr {
    /// Canonical IR name (`if`, `each`, `@click`, `class`, …).
    pub name: String,
    /// Static string or expression binding.
    pub value: AttrValue,
}

/// Attribute value form after template parse / directive lower.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrValue {
    /// Quoted or bare static text (HTML entities decoded).
    Static(String),
    /// Expression binding body (trimmed).
    Interp(String),
}

/// Forest of template roots for one `<template>` body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateIr {
    /// Top-level nodes in document order (comments skipped).
    pub roots: Vec<TemplateNode>,
}

/// Parse failure for Vue template syntax (including JSX rejection).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateParseError {
    /// Human-readable diagnostic.
    pub message: String,
    /// Byte offset into the template body.
    pub offset: usize,
}

impl fmt::Display for TemplateParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} (offset {})", self.message, self.offset)
    }
}

impl std::error::Error for TemplateParseError {}

/// Parse a `<template>` body as Vue template syntax into VMZ IR.
pub fn parse_template(input: &str) -> Result<TemplateIr, TemplateParseError> {
    let mut parser = Parser { input, pos: 0 };
    let mut roots = Vec::new();
    while parser.pos < parser.input.len() {
        match parser.parse_node()? {
            Some(node) => roots.push(node),
            None => break,
        }
    }
    Ok(TemplateIr { roots })
}

struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn err(&self, message: impl Into<String>) -> TemplateParseError {
        TemplateParseError { message: message.into(), offset: self.pos }
    }

    fn rest(&self) -> &'a str {
        &self.input[self.pos..]
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn starts_with(&self, s: &str) -> bool {
        self.rest().starts_with(s)
    }

    fn bump(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.bump();
        }
    }

    fn parse_node(&mut self) -> Result<Option<TemplateNode>, TemplateParseError> {
        self.skip_ws();
        if self.pos >= self.input.len() {
            return Ok(None);
        }
        if self.starts_with("<!--") {
            self.skip_comment();
            return self.parse_node();
        }
        if self.starts_with("{{") {
            return Ok(Some(TemplateNode::Interp(self.parse_mustache()?)));
        }
        if self.starts_with("{") {
            return Err(self.err(
                "JSX / single-brace `{…}` is not valid VMZ template syntax; use Vue `{{ … }}` or `:attr=\"…\"`",
            ));
        }
        if self.starts_with("</") {
            return Ok(None);
        }
        if self.starts_with("<") {
            return Ok(Some(self.parse_element()?));
        }
        Ok(self.parse_text()?)
    }

    fn skip_comment(&mut self) {
        self.pos += 4; // <!--
        if let Some(end) = self.rest().find("-->") {
            self.pos += end + 3;
        } else {
            self.pos = self.input.len();
        }
    }

    fn parse_mustache(&mut self) -> Result<String, TemplateParseError> {
        let start = self.pos;
        self.pos += 2; // {{
        let expr_start = self.pos;
        let mut depth = 0usize;
        while self.pos < self.input.len() {
            if self.starts_with("}}") && depth == 0 {
                let expr = self.input[expr_start..self.pos].trim().to_string();
                self.pos += 2;
                if expr.is_empty() {
                    return Err(TemplateParseError {
                        message: "empty mustache `{{ }}`".into(),
                        offset: start,
                    });
                }
                return Ok(expr);
            }
            let c = self.bump().ok_or_else(|| TemplateParseError {
                message: "unclosed mustache `{{`".into(),
                offset: start,
            })?;
            match c {
                '{' => depth += 1,
                '}' => depth = depth.saturating_sub(1),
                '\'' | '"' | '`' => self.skip_js_string(c)?,
                _ => {}
            }
        }
        Err(TemplateParseError {
            message: "unclosed mustache `{{`".into(),
            offset: start,
        })
    }

    fn skip_js_string(&mut self, quote: char) -> Result<(), TemplateParseError> {
        let start = self.pos.saturating_sub(quote.len_utf8());
        while let Some(c) = self.bump() {
            if c == '\\' {
                self.bump();
                continue;
            }
            if c == quote {
                return Ok(());
            }
        }
        Err(TemplateParseError {
            message: "unclosed string in mustache expression".into(),
            offset: start,
        })
    }

    fn parse_text(&mut self) -> Result<Option<TemplateNode>, TemplateParseError> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == '<' {
                break;
            }
            if c == '{' {
                if self.starts_with("{{") {
                    break;
                }
                return Err(self.err(
                    "JSX / single-brace `{…}` is not valid VMZ template syntax; use Vue `{{ … }}`",
                ));
            }
            self.bump();
        }
        let text = decode_html_entities(&self.input[start..self.pos]);
        if text.trim().is_empty() {
            return self.parse_node();
        }
        Ok(Some(TemplateNode::Text(text)))
    }

    fn parse_element(&mut self) -> Result<TemplateNode, TemplateParseError> {
        let elem_start = self.pos;
        self.bump(); // <
        let tag = self.parse_tag_name()?.ok_or_else(|| TemplateParseError {
            message: "expected tag name after `<`".into(),
            offset: elem_start,
        })?;
        let mut raw_attrs = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with("/>") {
                self.pos += 2;
                let attrs = lower_attrs(raw_attrs, elem_start)?;
                return Ok(TemplateNode::Element { tag, attrs, children: Vec::new() });
            }
            if self.starts_with(">") {
                self.bump();
                break;
            }
            if self.pos >= self.input.len() {
                return Err(TemplateParseError {
                    message: format!("unclosed start tag `<{tag}`"),
                    offset: elem_start,
                });
            }
            raw_attrs.push(self.parse_raw_attr()?);
        }

        let mut children = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with(&format!("</{tag}>")) {
                self.pos += tag.len() + 3;
                break;
            }
            if self.pos >= self.input.len() {
                break;
            }
            match self.parse_node()? {
                Some(child) => children.push(child),
                None if self.starts_with("</") => break,
                None => break,
            }
        }

        let attrs = lower_attrs(raw_attrs, elem_start)?;
        Ok(TemplateNode::Element { tag, attrs, children })
    }

    fn parse_tag_name(&mut self) -> Result<Option<String>, TemplateParseError> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' {
                self.bump();
            } else {
                break;
            }
        }
        if start == self.pos {
            return Ok(None);
        }
        Ok(Some(self.input[start..self.pos].to_string()))
    }

    fn parse_attr_name(&mut self) -> Result<String, TemplateParseError> {
        let start = self.pos;
        // Vue shorthands: @click, #header, :title, v-bind:foo
        if matches!(self.peek(), Some('@' | '#' | ':')) {
            self.bump();
        }
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':' || c == '.' {
                self.bump();
            } else {
                break;
            }
        }
        if start == self.pos {
            return Err(self.err("expected attribute name"));
        }
        Ok(self.input[start..self.pos].to_string())
    }

    fn parse_raw_attr(&mut self) -> Result<RawAttr, TemplateParseError> {
        let name = self.parse_attr_name()?;
        self.skip_ws();
        if !self.starts_with("=") {
            return Ok(RawAttr { name, value: None });
        }
        self.bump();
        self.skip_ws();
        if self.starts_with("{") {
            return Err(self.err(format!(
                "JSX attribute `{}={{…}}` is not valid VMZ template syntax; use `:{}=\"…\"` or a Vue directive",
                name, name.trim_start_matches([':', '@', '#'])
            )));
        }
        if self.starts_with("\"") || self.starts_with("'") {
            let value = self.parse_quoted()?;
            return Ok(RawAttr { name, value: Some(value) });
        }
        Err(self.err(format!(
            "attribute `{name}` value must be a quoted string (Vue template); JSX `{{…}}` is rejected"
        )))
    }

    fn parse_quoted(&mut self) -> Result<String, TemplateParseError> {
        let quote = self.bump().ok_or_else(|| self.err("expected quote"))?;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == quote {
                let val = decode_html_entities(&self.input[start..self.pos]);
                self.bump();
                return Ok(val);
            }
            self.bump();
        }
        Err(TemplateParseError {
            message: "unclosed attribute string".into(),
            offset: start.saturating_sub(1),
        })
    }
}

#[derive(Debug)]
struct RawAttr {
    name: String,
    value: Option<String>,
}

/// Lower Vue attribute / directive surface into pipeline IR names.
fn lower_attrs(raw: Vec<RawAttr>, offset: usize) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    let mut out = Vec::new();
    for attr in raw {
        out.extend(lower_one_attr(attr, offset)?);
    }
    Ok(out)
}

fn lower_one_attr(attr: RawAttr, offset: usize) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    let RawAttr { name, value } = attr;
    let val = value.as_deref().map(str::trim);

    if name == "v-if" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr { name: "if".into(), value: AttrValue::Interp(expr) }]);
    }
    if name == "v-else-if" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr { name: "else-if".into(), value: AttrValue::Interp(expr) }]);
    }
    if name == "v-else" {
        return Ok(vec![TemplateAttr { name: "else".into(), value: AttrValue::Static(String::new()) }]);
    }
    if name == "v-html" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr { name: "html".into(), value: AttrValue::Interp(expr) }]);
    }
    if name == "v-for" {
        let expr = require_expr(&name, val, offset)?;
        return parse_v_for(&expr, offset);
    }
    if name == "v-show" {
        // Syntax accepted; pipeline may not yet honor show — keep as static-named interp for later.
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr { name: "show".into(), value: AttrValue::Interp(expr) }]);
    }

    if let Some(rest) = name.strip_prefix(':') {
        let expr = require_expr(&name, val, offset)?;
        let ir_name = if rest == "key" { "key" } else { rest };
        return Ok(vec![TemplateAttr {
            name: ir_name.into(),
            value: AttrValue::Interp(expr),
        }]);
    }
    if let Some(rest) = name.strip_prefix("v-bind:") {
        let expr = require_expr(&name, val, offset)?;
        let ir_name = if rest == "key" { "key" } else { rest };
        return Ok(vec![TemplateAttr {
            name: ir_name.into(),
            value: AttrValue::Interp(expr),
        }]);
    }
    if name == "v-bind" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr { name: "v-bind".into(), value: AttrValue::Interp(expr) }]);
    }

    if let Some(rest) = name.strip_prefix('@') {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr {
            name: format!("@{rest}"),
            value: AttrValue::Interp(expr),
        }]);
    }
    if let Some(rest) = name.strip_prefix("v-on:") {
        let expr = require_expr(&name, val, offset)?;
        return Ok(vec![TemplateAttr {
            name: format!("@{rest}"),
            value: AttrValue::Interp(expr),
        }]);
    }

    if let Some(rest) = name.strip_prefix('#') {
        return Ok(vec![TemplateAttr {
            name: format!("#{rest}"),
            value: AttrValue::Static(val.unwrap_or("").to_string()),
        }]);
    }
    if let Some(rest) = name.strip_prefix("v-slot:") {
        return Ok(vec![TemplateAttr {
            name: format!("#{rest}"),
            value: AttrValue::Static(val.unwrap_or("").to_string()),
        }]);
    }

    // Plain HTML / component prop: static string, or bare boolean attribute.
    Ok(vec![TemplateAttr {
        name,
        value: AttrValue::Static(val.unwrap_or("").to_string()),
    }])
}

fn require_expr(name: &str, val: Option<&str>, offset: usize) -> Result<String, TemplateParseError> {
    match val {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => Err(TemplateParseError {
            message: format!("directive `{name}` requires an expression value"),
            offset,
        }),
    }
}

/// `item in list` / `(item, i) in list` / `item of list` → `each` + `as`.
fn parse_v_for(expr: &str, offset: usize) -> Result<Vec<TemplateAttr>, TemplateParseError> {
    let (alias_part, list_part) = split_v_for(expr).ok_or_else(|| TemplateParseError {
        message: format!("invalid `v-for` expression `{expr}` (expected `alias in list`)"),
        offset,
    })?;
    let alias = alias_part
        .trim()
        .trim_start_matches('(')
        .trim_end_matches(')')
        .split(',')
        .next()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| TemplateParseError {
            message: format!("invalid `v-for` alias in `{expr}`"),
            offset,
        })?;
    let list = list_part.trim();
    if list.is_empty() {
        return Err(TemplateParseError {
            message: format!("invalid `v-for` list in `{expr}`"),
            offset,
        });
    }
    Ok(vec![
        TemplateAttr { name: "each".into(), value: AttrValue::Interp(list.to_string()) },
        TemplateAttr { name: "as".into(), value: AttrValue::Static(alias.to_string()) },
    ])
}

fn split_v_for(expr: &str) -> Option<(&str, &str)> {
    for kw in [" in ", " of "] {
        if let Some(idx) = expr.find(kw) {
            return Some((&expr[..idx], &expr[idx + kw.len()..]));
        }
    }
    None
}

/// Decode HTML character references in template text / static attrs.
/// Authors write `&gt;` / `&amp;` like HTML; IR stores the decoded Unicode so SSR
/// `escapeHtml` does not double-encode (`&amp;gt;` -> visible `&gt;`).
pub fn decode_html_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'&' {
            let ch = input[i..].chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
            continue;
        }
        let rest = &input[i..];
        if let Some((ch, consumed)) = match_entity(rest) {
            out.push(ch);
            i += consumed;
        } else {
            out.push('&');
            i += 1;
        }
    }
    out
}

fn match_entity(s: &str) -> Option<(char, usize)> {
    if s.starts_with("&amp;") {
        return Some(('&', 5));
    }
    if s.starts_with("&lt;") {
        return Some(('<', 4));
    }
    if s.starts_with("&gt;") {
        return Some(('>', 4));
    }
    if s.starts_with("&quot;") {
        return Some(('"', 6));
    }
    if s.starts_with("&apos;") {
        return Some(('\'', 6));
    }
    if s.starts_with("&nbsp;") {
        return Some(('\u{00A0}', 6));
    }
    // Numeric: &#123; or &#x1F; / &#X1F;
    if let Some(rest) = s.strip_prefix("&#") {
        let hex = rest.as_bytes().first().is_some_and(|b| *b == b'x' || *b == b'X');
        let digits = if hex { &rest[1..] } else { rest };
        let end = digits.find(';')?;
        let num_str = &digits[..end];
        if num_str.is_empty() {
            return None;
        }
        let code = if hex {
            u32::from_str_radix(num_str, 16).ok()?
        } else {
            num_str.parse::<u32>().ok()?
        };
        let ch = char::from_u32(code)?;
        let consumed = 2 + if hex { 1 } else { 0 } + end + 1; // &# + [x] + digits + ;
        return Some((ch, consumed));
    }
    None
}
