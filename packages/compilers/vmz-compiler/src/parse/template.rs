//! Minimal template IR: elements, text, `{expr}` interpolations.

/// One node in the template tree produced by [`parse_template`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateNode {
    /// Element with tag name, attributes, and child nodes.
    Element {
        /// Tag name as written (`div`, `MyComp`, ...).
        tag: String,
        /// Attributes in source order.
        attrs: Vec<TemplateAttr>,
        /// Nested children (empty for self-closing tags).
        children: Vec<TemplateNode>,
    },
    /// Decoded text run between tags / interpolations.
    Text(String),
    /// `{expr}` mustache body (trimmed), without the braces.
    Interp(String),
}

/// One attribute on a [`TemplateNode::Element`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateAttr {
    /// Attribute name, including Vue-familiar shorthands (`@click`, `#header`).
    pub name: String,
    /// Static string or `{expr}` binding.
    pub value: AttrValue,
}

/// Attribute value form after template parse.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrValue {
    /// Quoted or bare static text (HTML entities decoded).
    Static(String),
    /// `{expr}` binding body (trimmed), without the braces.
    Interp(String),
}

/// Forest of template roots for one `<template>` body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateIr {
    /// Top-level nodes in document order (comments skipped).
    pub roots: Vec<TemplateNode>,
}

/// Parse a `<template>` body into a lightweight element / text / interp IR.
pub fn parse_template(input: &str) -> TemplateIr {
    let mut parser = Parser { input, pos: 0 };
    let mut roots = Vec::new();
    while parser.pos < parser.input.len() {
        if let Some(node) = parser.parse_node() {
            roots.push(node);
        } else {
            break;
        }
    }
    TemplateIr { roots }
}

struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
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

    fn parse_node(&mut self) -> Option<TemplateNode> {
        self.skip_ws();
        if self.pos >= self.input.len() {
            return None;
        }
        if self.starts_with("<!--") {
            self.skip_comment();
            return self.parse_node();
        }
        if self.starts_with("{") {
            return self.parse_interp().map(TemplateNode::Interp);
        }
        if self.starts_with("</") {
            return None;
        }
        if self.starts_with("<") {
            return self.parse_element();
        }
        self.parse_text()
    }

    fn skip_comment(&mut self) {
        self.pos += 4; // <!--
        if let Some(end) = self.rest().find("-->") {
            self.pos += end + 3;
        } else {
            self.pos = self.input.len();
        }
    }

    fn parse_interp(&mut self) -> Option<String> {
        self.bump()?; // {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == '}' {
                let expr = self.input[start..self.pos].trim().to_string();
                self.bump();
                return Some(expr);
            }
            self.bump();
        }
        None
    }

    fn parse_text(&mut self) -> Option<TemplateNode> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == '<' || c == '{' {
                break;
            }
            self.bump();
        }
        let text = decode_html_entities(&self.input[start..self.pos]);
        if text.trim().is_empty() {
            return self.parse_node();
        }
        Some(TemplateNode::Text(text))
    }

    fn parse_element(&mut self) -> Option<TemplateNode> {
        self.bump()?; // <
        let tag = self.parse_ident()?;
        let mut attrs = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with("/>") {
                self.pos += 2;
                return Some(TemplateNode::Element { tag, attrs, children: Vec::new() });
            }
            if self.starts_with(">") {
                self.bump();
                break;
            }
            let name = self.parse_ident()?;
            self.skip_ws();
            let value = if self.starts_with("=") {
                self.bump();
                self.skip_ws();
                if self.starts_with("{") {
                    AttrValue::Interp(self.parse_interp()?)
                } else if self.starts_with("\"") || self.starts_with("'") {
                    AttrValue::Static(self.parse_quoted()?)
                } else {
                    AttrValue::Static(String::new())
                }
            } else {
                AttrValue::Static(String::new())
            };
            attrs.push(TemplateAttr { name, value });
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
            if let Some(child) = self.parse_node() {
                children.push(child);
            } else if self.starts_with("</") {
                // mismatched close: stop
                break;
            } else {
                break;
            }
        }

        Some(TemplateNode::Element { tag, attrs, children })
    }

    fn parse_ident(&mut self) -> Option<String> {
        let start = self.pos;
        // Vue-familiar attr shorthands: `@click`, `#header`, modifiers `@click.stop`.
        if matches!(self.peek(), Some('@' | '#')) {
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
            return None;
        }
        Some(self.input[start..self.pos].to_string())
    }

    fn parse_quoted(&mut self) -> Option<String> {
        let quote = self.bump()?;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == quote {
                let val = decode_html_entities(&self.input[start..self.pos]);
                self.bump();
                return Some(val);
            }
            self.bump();
        }
        None
    }
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
