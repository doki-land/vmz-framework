//! Mini template dialect printer over Native View nodes.

use vmz_types::{ViewAttr, ViewAttrValue, ViewNode};

use crate::core::escape_xml_attr;

use super::ast::{MarkupDialect, MarkupDocument, MarkupNode, emit_markup};

/// Emit Mini `vmz.mini.template.v0` markup from Native View roots.
pub fn emit_mini_template(roots: &[ViewNode]) -> String {
    let kids: Vec<MarkupNode> = roots.iter().map(view_to_markup).collect();
    let doc = MarkupDocument { doctype: None, dialect: MarkupDialect::Xml, roots: kids };
    emit_markup(&doc)
}

fn view_to_markup(node: &ViewNode) -> MarkupNode {
    match node {
        ViewNode::Text { value } => MarkupNode::Text(value.clone()),
        ViewNode::Interp { binding, .. } => {
            let id = binding.map(|b| b.0).unwrap_or(0);
            MarkupNode::Raw(format!("{{{{b.B_{id}}}}}"))
        }
        ViewNode::Element { tag, attrs, children, .. } => {
            let m_attrs = attrs_to_pairs(attrs);
            let kids: Vec<_> = children.iter().map(view_to_markup).collect();
            MarkupNode::Element {
                tag: tag.clone(),
                attrs: m_attrs,
                children: kids,
                void: false,
            }
        }
        ViewNode::If { binding, branches, .. } => {
            let id = binding.map(|b| b.0).unwrap_or(0);
            let mut kids = Vec::new();
            for (i, br) in branches.iter().enumerate() {
                let mut block_attrs = vec![("data-vmz-if".into(), format!("B_{id}"))];
                if i > 0 {
                    block_attrs.push(("data-vmz-branch".into(), i.to_string()));
                }
                kids.push(MarkupNode::Element {
                    tag: "block".into(),
                    attrs: block_attrs,
                    children: vec![view_to_markup(&br.body)],
                    void: false,
                });
            }
            MarkupNode::Element {
                tag: "block".into(),
                attrs: vec![("data-vmz-if-root".into(), format!("B_{id}"))],
                children: kids,
                void: false,
            }
        }
        ViewNode::Component { tag, attrs, children } => {
            let mut m_attrs = attrs_to_pairs(attrs);
            m_attrs.insert(0, ("data-vmz-component".into(), tag.clone()));
            MarkupNode::Element {
                tag: "vmz-component".into(),
                attrs: m_attrs,
                children: children.iter().map(view_to_markup).collect(),
                void: false,
            }
        }
        ViewNode::Slot { name, attrs, children } => {
            let mut m_attrs = attrs_to_pairs(attrs);
            if let Some(n) = name {
                if !m_attrs.iter().any(|(k, _)| k == "name") {
                    m_attrs.insert(0, ("name".into(), n.clone()));
                }
            }
            MarkupNode::Element {
                tag: "slot".into(),
                attrs: m_attrs,
                children: children.iter().map(view_to_markup).collect(),
                void: false,
            }
        }
    }
}

fn attrs_to_pairs(attrs: &[ViewAttr]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for a in attrs {
        match &a.value {
            ViewAttrValue::Static { value } => {
                out.push((a.name.clone(), value.clone()));
            }
            ViewAttrValue::Interp { .. } => {
                let bind = a.binding.map(|b| b.0).unwrap_or(0);
                out.push((a.name.clone(), format!("{{{{b.B_{bind}}}}}")));
            }
            ViewAttrValue::Bare => {
                out.push((a.name.clone(), String::new()));
            }
        }
    }
    // Ensure attr values are safe when printed (emit_markup escapes again; keep raw here).
    let _ = escape_xml_attr;
    out
}
