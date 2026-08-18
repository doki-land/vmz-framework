//! Markup AST + printer (HTML5 / XML-ish).

use crate::core::{escape_html_attr, escape_html_text, escape_xml_attr, escape_xml_text};

/// Markup dialect controls void tags and escape flavor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MarkupDialect {
    /// HTML5 (void elements, HTML escapes).
    #[default]
    Html5,
    /// XML / Mini template dialect.
    Xml,
}

/// One markup node.
#[derive(Debug, Clone)]
pub enum MarkupNode {
    /// Element with attributes and children.
    Element {
        /// Tag name.
        tag: String,
        /// Attribute list `(name, value)`. Empty value => boolean/bare attr in HTML.
        attrs: Vec<(String, String)>,
        /// Child nodes.
        children: Vec<MarkupNode>,
        /// Self-closing (XML) / void (HTML).
        void: bool,
    },
    /// Escaped text.
    Text(String),
    /// Trusted raw fragment (caller responsibility).
    Raw(String),
    /// HTML/XML comment.
    Comment(String),
}

/// Document wrapper (doctype + root).
#[derive(Debug, Clone)]
pub struct MarkupDocument {
    /// Optional doctype string without `<!DOCTYPE ` prefix (e.g. `html`).
    pub doctype: Option<String>,
    /// Root nodes.
    pub roots: Vec<MarkupNode>,
    /// Dialect.
    pub dialect: MarkupDialect,
}

/// Print a markup document to text (dev: doctype newline; comments kept).
pub fn emit_markup(doc: &MarkupDocument) -> String {
    emit_markup_opts(doc, false)
}

/// Print markup; `minify` drops comments and extra whitespace (not inside
/// `pre` / `textarea` / `script` / `style`).
pub fn emit_markup_opts(doc: &MarkupDocument, minify: bool) -> String {
    let mut out = String::new();
    if let Some(dt) = &doc.doctype {
        out.push_str("<!DOCTYPE ");
        out.push_str(dt);
        out.push('>');
        if !minify {
            out.push('\n');
        }
    }
    for n in &doc.roots {
        print_node(&mut out, n, doc.dialect, minify, false);
    }
    out
}

fn is_preformatted(tag: &str) -> bool {
    matches!(tag, "pre" | "textarea" | "script" | "style")
}

fn print_node(
    out: &mut String,
    node: &MarkupNode,
    dialect: MarkupDialect,
    minify: bool,
    preformatted: bool,
) {
    match node {
        MarkupNode::Text(t) => {
            match dialect {
                MarkupDialect::Html5 => {
                    if minify && !preformatted {
                        out.push_str(&escape_html_text(&collapse_ws(t)));
                    } else {
                        out.push_str(&escape_html_text(t));
                    }
                }
                MarkupDialect::Xml => out.push_str(&escape_xml_text(t)),
            };
        }
        MarkupNode::Raw(t) => {
            if minify && !preformatted {
                out.push_str(&minify_raw_html(t));
            } else {
                out.push_str(t);
            }
        }
        MarkupNode::Comment(c) => {
            if minify {
                return;
            }
            out.push_str("<!--");
            out.push_str(c);
            out.push_str("-->");
        }
        MarkupNode::Element { tag, attrs, children, void } => {
            out.push('<');
            out.push_str(tag);
            for (name, value) in attrs {
                out.push(' ');
                out.push_str(name);
                if value.is_empty() && dialect == MarkupDialect::Html5 {
                    continue;
                }
                out.push_str("=\"");
                match dialect {
                    MarkupDialect::Html5 => out.push_str(&escape_html_attr(value)),
                    MarkupDialect::Xml => out.push_str(&escape_xml_attr(value)),
                }
                out.push('"');
            }
            if *void && children.is_empty() {
                if dialect == MarkupDialect::Xml {
                    out.push_str(" />");
                } else {
                    out.push('>');
                }
                return;
            }
            out.push('>');
            let child_pre = preformatted || is_preformatted(tag);
            for c in children {
                print_node(out, c, dialect, minify, child_pre);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
    }
}

fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for ch in s.chars() {
        if ch.is_whitespace() {
            if !prev_space && !out.is_empty() {
                out.push(' ');
                prev_space = true;
            }
        } else {
            prev_space = false;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

/// Collapse whitespace between tags; leave `pre`/`textarea`/`script`/`style` bodies.
fn minify_raw_html(input: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    let mut in_pre = false;
    while i < bytes.len() {
        if !in_pre && bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if bytes[i] == b'<' {
            let rest_l = &lower[i..];
            if rest_l.starts_with("<!--") {
                if let Some(end) = rest_l.find("-->") {
                    i += end + 3;
                    continue;
                }
            }
            if rest_l.starts_with("<pre")
                || rest_l.starts_with("<textarea")
                || rest_l.starts_with("<script")
                || rest_l.starts_with("<style")
            {
                in_pre = true;
            } else if rest_l.starts_with("</pre")
                || rest_l.starts_with("</textarea")
                || rest_l.starts_with("</script")
                || rest_l.starts_with("</style")
            {
                in_pre = false;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}
