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

/// Print a markup document to text.
pub fn emit_markup(doc: &MarkupDocument) -> String {
    let mut out = String::new();
    if let Some(dt) = &doc.doctype {
        out.push_str("<!DOCTYPE ");
        out.push_str(dt);
        out.push_str(">\n");
    }
    for n in &doc.roots {
        print_node(&mut out, n, doc.dialect, 0);
    }
    out
}

fn print_node(out: &mut String, node: &MarkupNode, dialect: MarkupDialect, depth: usize) {
    match node {
        MarkupNode::Text(t) => {
            match dialect {
                MarkupDialect::Html5 => out.push_str(&escape_html_text(t)),
                MarkupDialect::Xml => out.push_str(&escape_xml_text(t)),
            };
        }
        MarkupNode::Raw(t) => out.push_str(t),
        MarkupNode::Comment(c) => {
            out.push_str("<!--");
            out.push_str(c);
            out.push_str("-->");
        }
        MarkupNode::Element { tag, attrs, children, void } => {
            let _ = depth;
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
            for c in children {
                print_node(out, c, dialect, depth + 1);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
    }
}
