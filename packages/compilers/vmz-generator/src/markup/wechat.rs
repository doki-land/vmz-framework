//! WeChat packaging printer: Native View -> WXML.
//!
//! Vendor-neutral Mini dialect stays in [`super::wxml`]. This module prints the
//! WeChat **packaging surface** (`wx:for` / `wx:if` / `bindtap`). Adapters must
//! not own this printer and must not treat WXML as authoring truth.

use std::collections::BTreeMap;

use vmz_types::{ReactiveComponent, ViewAttr, ViewAttrValue, ViewNode};

use crate::core::{escape_xml_attr, escape_xml_text};

use super::wxml::{
    MiniEmitError, MiniEmitErrorKind, MiniEventHandler, MiniTemplateEmit, is_event_attr,
    wire_event_handler,
};

/// WeChat template dialect marker (packaging only; not a second IR).
pub const WECHAT_WXML_DIALECT: &str = "wxml";

/// Emit WeChat WXML from Native View (structure + events when `reactive` is set).
pub fn emit_wechat_wxml(
    roots: &[ViewNode],
    reactive: Option<&ReactiveComponent>,
) -> Result<MiniTemplateEmit, Vec<MiniEmitError>> {
    let mut patch_bindings = BTreeMap::new();
    let mut ctx = WechatCtx {
        reactive,
        next_handler: 0,
        handlers: Vec::new(),
        errors: Vec::new(),
        failed: false,
        each_item: None,
    };

    let mut body = String::new();
    for root in roots {
        match emit_node(root, &mut patch_bindings, &mut ctx) {
            Ok(chunk) => body.push_str(&chunk),
            Err(()) => return Err(ctx.errors),
        }
    }
    if ctx.failed || !ctx.errors.is_empty() {
        return Err(ctx.errors);
    }

    let template =
        if roots.len() == 1 { body } else { format!("<view class=\"vmz-root\">{body}</view>") };

    Ok(MiniTemplateEmit { template, patch_bindings, handlers: ctx.handlers })
}

struct WechatCtx<'a> {
    reactive: Option<&'a ReactiveComponent>,
    next_handler: u32,
    handlers: Vec<MiniEventHandler>,
    errors: Vec<MiniEmitError>,
    failed: bool,
    each_item: Option<String>,
}

fn push_err(ctx: &mut WechatCtx<'_>, kind: MiniEmitErrorKind, message: impl Into<String>) {
    ctx.errors.push(MiniEmitError { kind, message: message.into() });
    ctx.failed = true;
}

fn emit_node(
    node: &ViewNode,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &mut WechatCtx<'_>,
) -> Result<String, ()> {
    match node {
        ViewNode::Text { value } => Ok(escape_xml_text(value)),
        ViewNode::Interp { expr, binding } => Ok(interp_text(expr, *binding, patch_bindings, ctx)),
        ViewNode::Element { tag, attrs, children, each } => {
            emit_element(tag, attrs, children, each.as_ref(), patch_bindings, ctx)
        }
        ViewNode::If { region: _, binding, branches } => {
            let mut out = String::new();
            for (i, br) in branches.iter().enumerate() {
                let mut open = String::from("<block");
                if i == 0 {
                    if let Some(b) = binding {
                        patch_bindings.insert(b.0, ());
                        open.push_str(&format!(" wx:if=\"{{{{b.B_{}}}}}\"", b.0));
                    } else if let Some(cond) = &br.cond {
                        open.push_str(&format!(" wx:if=\"{{{{{cond}}}}}\""));
                    }
                } else if br.cond.is_none() {
                    open.push_str(" wx:else");
                } else if let Some(cond) = &br.cond {
                    open.push_str(&format!(" wx:elif=\"{{{{{cond}}}}}\""));
                }
                open.push('>');
                let body = emit_node(&br.body, patch_bindings, ctx)?;
                out.push_str(&open);
                out.push_str(&body);
                out.push_str("</block>");
            }
            Ok(out)
        }
        ViewNode::Component { tag, attrs, children } => {
            let wtag = kebab(tag);
            let mut attr_s = String::new();
            for a in attrs {
                if is_event_attr(&a.name) {
                    emit_event(a, &mut attr_s, ctx)?;
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings, ctx);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ctx)?);
            }
            if inner.is_empty() {
                Ok(format!("<{wtag}{attr_s} />"))
            } else {
                Ok(format!("<{wtag}{attr_s}>{inner}</{wtag}>"))
            }
        }
        ViewNode::Slot { name, attrs, children } => {
            let mut attr_s = String::new();
            if let Some(n) = name
                && !n.is_empty()
                && n != "slot"
            {
                attr_s.push_str(&format!(" name=\"{}\"", escape_xml_attr(n)));
            }
            for a in attrs {
                if is_event_attr(&a.name) {
                    continue;
                }
                emit_plain_attr(a, &mut attr_s, patch_bindings, ctx);
            }
            let mut inner = String::new();
            for c in children {
                inner.push_str(&emit_node(c, patch_bindings, ctx)?);
            }
            if inner.is_empty() {
                Ok(format!("<slot{attr_s} />"))
            } else {
                Ok(format!("<slot{attr_s}>{inner}</slot>"))
            }
        }
    }
}

fn emit_element(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    each: Option<&vmz_types::ViewEach>,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &mut WechatCtx<'_>,
) -> Result<String, ()> {
    let wtag = wechat_tag(tag);
    let mut attr_s = String::new();
    let mut prev_item = None;
    if let Some(e) = each {
        prev_item = ctx.each_item.clone();
        ctx.each_item = Some(e.as_name.clone());
        if let Some(list_b) = e.list_binding {
            patch_bindings.insert(list_b.0, ());
            attr_s.push_str(&format!(" wx:for=\"{{{{b.B_{}}}}}\"", list_b.0));
        } else {
            attr_s.push_str(&format!(" wx:for=\"{{{{{}}}}}\"", e.list_expr));
        }
        if !e.as_name.is_empty() && e.as_name != "item" {
            attr_s.push_str(&format!(" wx:for-item=\"{}\"", escape_xml_attr(&e.as_name)));
        }
        attr_s.push_str(&format!(" wx:key=\"{}\"", wx_key(&e.as_name, e.key_expr.as_deref())));
    }
    for a in attrs {
        if is_event_attr(&a.name) {
            emit_event(a, &mut attr_s, ctx)?;
            continue;
        }
        emit_mapped_attr(wtag, a, &mut attr_s, patch_bindings, ctx);
    }
    let mut inner = String::new();
    for c in children {
        inner.push_str(&emit_node(c, patch_bindings, ctx)?);
    }
    if each.is_some() {
        ctx.each_item = prev_item;
    }
    if inner.is_empty() {
        Ok(format!("<{wtag}{attr_s} />"))
    } else {
        Ok(format!("<{wtag}{attr_s}>{inner}</{wtag}>"))
    }
}

fn interp_text(
    expr: &str,
    binding: Option<vmz_types::BindingId>,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &WechatCtx<'_>,
) -> String {
    if let Some(item) = ctx.each_item.as_deref() {
        let prefix = format!("{item}.");
        if expr == item || expr.starts_with(&prefix) {
            return format!("{{{{{expr}}}}}");
        }
    }
    if let Some(b) = binding {
        patch_bindings.insert(b.0, ());
        format!("{{{{b.B_{}}}}}", b.0)
    } else {
        format!("{{{{{expr}}}}}")
    }
}

fn emit_plain_attr(
    a: &ViewAttr,
    attr_s: &mut String,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &WechatCtx<'_>,
) {
    emit_mapped_attr("", a, attr_s, patch_bindings, ctx);
}

fn emit_mapped_attr(
    wtag: &str,
    a: &ViewAttr,
    attr_s: &mut String,
    patch_bindings: &mut BTreeMap<u32, ()>,
    ctx: &WechatCtx<'_>,
) {
    let name = if wtag == "navigator" && a.name == "href" { "url" } else { a.name.as_str() };
    match &a.value {
        ViewAttrValue::Static { value } => {
            attr_s.push_str(&format!(" {name}=\"{}\"", escape_xml_attr(value)));
        }
        ViewAttrValue::Bare => {
            attr_s.push(' ');
            attr_s.push_str(name);
        }
        ViewAttrValue::Interp { expr } => {
            let val = interp_text(expr, a.binding, patch_bindings, ctx);
            attr_s.push_str(&format!(" {name}=\"{val}\""));
        }
    }
}

fn emit_event(a: &ViewAttr, attr_s: &mut String, ctx: &mut WechatCtx<'_>) -> Result<(), ()> {
    let Some(reactive) = ctx.reactive else {
        push_err(
            ctx,
            MiniEmitErrorKind::ArtifactInvalid,
            format!("wechat wxml: event attr {} needs ReactiveComponent", a.name),
        );
        return Err(());
    };
    match wire_event_handler(a, reactive, &mut ctx.next_handler, &mut ctx.handlers) {
        Ok(h) => {
            attr_s.push_str(&format!(" {}=\"{}\"", wechat_event_attr(&h.event_kind), h.method));
            Ok(())
        }
        Err(e) => {
            ctx.errors.push(e);
            ctx.failed = true;
            Err(())
        }
    }
}

fn wechat_event_attr(kind: &str) -> String {
    match kind {
        "click" | "tap" => "bindtap".into(),
        "input" => "bindinput".into(),
        "change" => "bindchange".into(),
        "submit" => "bindsubmit".into(),
        "longpress" | "longtap" => "bindlongpress".into(),
        "touchstart" => "bindtouchstart".into(),
        "touchmove" => "bindtouchmove".into(),
        "touchend" => "bindtouchend".into(),
        other => format!("bind{other}"),
    }
}

fn wechat_tag(tag: &str) -> &str {
    match tag {
        "div" | "p" | "section" | "header" | "footer" | "main" | "article" | "nav" | "ul"
        | "ol" | "li" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "aside" | "figure"
        | "figcaption" | "span" => "view",
        "strong" | "em" | "b" | "i" | "label" | "small" => "text",
        "img" => "image",
        "a" => "navigator",
        other => other,
    }
}

fn kebab(name: &str) -> String {
    let mut out = String::new();
    for (i, ch) in name.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push(ch);
        }
    }
    out
}

fn wx_key(as_name: &str, key_expr: Option<&str>) -> String {
    let Some(expr) = key_expr.map(str::trim).filter(|s| !s.is_empty()) else {
        return "*this".into();
    };
    let prefix = format!("{as_name}.");
    if let Some(rest) = expr.strip_prefix(&prefix)
        && !rest.is_empty()
        && !rest.contains('.')
        && !rest.contains('[')
    {
        return rest.to_string();
    }
    if !expr.contains('.') && !expr.contains('[') {
        return expr.to_string();
    }
    "*this".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use vmz_types::{
        Binding, BindingId, Effect, EffectId, ExprId, FieldId, FieldKind, IrDepPath,
        ReactiveComponent, StateSlot, ViewAttr, ViewAttrValue, ViewEach, ViewIfBranch, ViewNode,
        WritePath,
    };

    fn on_store_reactive() -> ReactiveComponent {
        ReactiveComponent {
            name: "HomePage".into(),
            state_slots: vec![StateSlot {
                id: FieldId(0),
                name: "store".into(),
                kind: FieldKind::State,
            }],
            properties: vec![],
            bindings: vec![
                Binding::Event {
                    id: BindingId(2),
                    reads: vec![],
                    region: None,
                    expr: Some(ExprId(0)),
                    attr: "@click".into(),
                },
                Binding::Text {
                    id: BindingId(0),
                    reads: vec![IrDepPath::Field(FieldId(0))],
                    region: None,
                    expr: Some(ExprId(1)),
                },
            ],
            effects: vec![Effect {
                id: EffectId(0),
                name: "onStore".into(),
                reads: vec![],
                writes: vec![WritePath { path: IrDepPath::Field(FieldId(0)) }],
                async_boundary: false,
                calls: vec![],
                opaque_callee: false,
                star_reasons: vec![],
            }],
            control_regions: vec![],
            exprs: vec![],
        }
    }

    #[test]
    fn home_slice_matches_rewrite_mini_shape() {
        // Mirrors rewrite-mini home: store interp, bindtap, wx:for deals.
        let roots = [ViewNode::Element {
            tag: "div".into(),
            attrs: vec![ViewAttr {
                name: "class".into(),
                value: ViewAttrValue::Static { value: "page".into() },
                binding: None,
            }],
            children: vec![
                ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![
                        ViewAttr {
                            name: "class".into(),
                            value: ViewAttrValue::Static { value: "loc".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "@click".into(),
                            value: ViewAttrValue::Interp { expr: "onStore".into() },
                            binding: Some(BindingId(2)),
                        },
                    ],
                    children: vec![ViewNode::Element {
                        tag: "span".into(),
                        attrs: vec![ViewAttr {
                            name: "class".into(),
                            value: ViewAttrValue::Static { value: "loc-name".into() },
                            binding: None,
                        }],
                        children: vec![ViewNode::Interp {
                            expr: "store".into(),
                            binding: Some(BindingId(0)),
                        }],
                        each: None,
                    }],
                    each: None,
                },
                ViewNode::Element {
                    tag: "div".into(),
                    attrs: vec![
                        ViewAttr {
                            name: "class".into(),
                            value: ViewAttrValue::Static { value: "deal".into() },
                            binding: None,
                        },
                        ViewAttr {
                            name: "data-id".into(),
                            value: ViewAttrValue::Interp { expr: "item.id".into() },
                            binding: None,
                        },
                    ],
                    children: vec![ViewNode::Interp {
                        expr: "item.title".into(),
                        binding: Some(BindingId(1)),
                    }],
                    each: Some(ViewEach {
                        list_expr: "deals".into(),
                        as_name: "item".into(),
                        key_expr: Some("item.id".into()),
                        list_binding: Some(BindingId(3)),
                        key_binding: None,
                        region: None,
                    }),
                },
                ViewNode::If {
                    region: None,
                    binding: Some(BindingId(4)),
                    branches: vec![ViewIfBranch {
                        cond: Some("show".into()),
                        body: Box::new(ViewNode::Text { value: "hi".into() }),
                    }],
                },
            ],
            each: None,
        }];
        let emit = emit_wechat_wxml(&roots, Some(&on_store_reactive())).expect("ok");
        assert!(emit.template.contains("<view class=\"page\">"), "{}", emit.template);
        assert!(emit.template.contains("bindtap=\"onStore\""), "{}", emit.template);
        assert!(emit.template.contains("{{b.B_0}}"), "{}", emit.template);
        assert!(emit.template.contains("wx:for=\"{{b.B_3}}\""), "{}", emit.template);
        assert!(emit.template.contains("wx:key=\"id\""), "{}", emit.template);
        assert!(emit.template.contains("{{item.title}}"), "{}", emit.template);
        assert!(emit.template.contains("wx:if=\"{{b.B_4}}\""), "{}", emit.template);
        assert!(!emit.template.contains("data-vmz-"), "{}", emit.template);
        assert!(!emit.template.contains("@click"), "{}", emit.template);
    }
}
