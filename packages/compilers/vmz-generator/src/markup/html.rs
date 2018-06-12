//! HTML document helpers for static / serve hosts.

use super::ast::{MarkupDialect, MarkupDocument, MarkupNode, emit_markup};

/// Build a minimal HTML shell document.
pub fn emit_html_document(
    title: &str,
    body_children: Vec<MarkupNode>,
    head_extra: Vec<MarkupNode>,
) -> String {
    let mut head_kids = vec![
        MarkupNode::Element {
            tag: "meta".into(),
            attrs: vec![("charset".into(), "utf-8".into())],
            children: vec![],
            void: true,
        },
        MarkupNode::Element {
            tag: "meta".into(),
            attrs: vec![
                ("name".into(), "viewport".into()),
                ("content".into(), "width=device-width, initial-scale=1".into()),
            ],
            children: vec![],
            void: true,
        },
        MarkupNode::Element {
            tag: "title".into(),
            attrs: vec![],
            children: vec![MarkupNode::Text(title.into())],
            void: false,
        },
    ];
    head_kids.extend(head_extra);
    let doc = MarkupDocument {
        doctype: Some("html".into()),
        dialect: MarkupDialect::Html5,
        roots: vec![MarkupNode::Element {
            tag: "html".into(),
            attrs: vec![("lang".into(), "en".into())],
            children: vec![
                MarkupNode::Element {
                    tag: "head".into(),
                    attrs: vec![],
                    children: head_kids,
                    void: false,
                },
                MarkupNode::Element {
                    tag: "body".into(),
                    attrs: vec![],
                    children: body_children,
                    void: false,
                },
            ],
            void: false,
        }],
    };
    emit_markup(&doc)
}
