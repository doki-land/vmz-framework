//! Compile-time each row kernel — oxc/Native View analysis → static HTML + hydrate/apply.
//!
//! When the item template is a fixed element tree (no nested each/if/component) and
//! dynamics are only item-field texts, a `this.<host> === item.<field> ? … : …` class
//! ternary, and `this.m(item.<field>)` clicks, emit a `rowKernel` so runtime skips
//! first-row blueprint recording. Field names come from the author expression.

use vmz_types::{ViewAttr, ViewAttrValue, ViewNode};

use crate::emit::{bind_field_idents, event_dom_type, is_event_attr, sanitize_interp};

#[derive(Debug)]
enum Slot {
    Text {
        path: Vec<u32>,
        field: String,
    },
    Class {
        path: Vec<u32>,
        on_val: String,
        off_val: String,
        host_field: String,
        item_field: String,
    },
    Act {
        path: Vec<u32>,
        method: String,
        event: String,
        arg_field: String,
    },
}

/// Build `rowKernel: { ... }, ` JS fragment, or `None` if the row is not statically eligible.
pub fn try_emit_row_kernel_js(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    as_name: &str,
    box_id: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    key_bound: Option<&str>,
) -> Option<String> {
    let item_prefix = format!("{box_id}.item.");
    let mut slots = Vec::new();
    let html = emit_html_element(
        tag,
        attrs,
        children,
        &[],
        as_name,
        &item_prefix,
        fields,
        scope,
        aliases,
        &mut slots,
    )?;
    if slots.is_empty() {
        return None;
    }

    let mut text_slots = Vec::new();
    let mut class_slot = None;
    let mut acts = Vec::new();
    for s in &slots {
        match s {
            Slot::Text { path, field } => text_slots.push((path.clone(), field.clone())),
            Slot::Class { path, on_val, off_val, host_field, item_field } => {
                if class_slot.is_some() {
                    return None;
                }
                class_slot = Some((
                    path.clone(),
                    on_val.clone(),
                    off_val.clone(),
                    host_field.clone(),
                    item_field.clone(),
                ));
            }
            Slot::Act { path, method, event, arg_field } => {
                acts.push((path.clone(), method.clone(), event.clone(), arg_field.clone()));
            }
        }
    }

    // Fixed-structure rows: 1–4 item-field texts + optional host/item class ternary + actions.
    if text_slots.len() < 1 || text_slots.len() > 4 {
        return None;
    }

    // All actions must pass the same item field (e.g. item.id) so one actArgField suffices.
    let act_arg_field = if acts.is_empty() {
        None
    } else {
        let f0 = acts[0].3.clone();
        if acts.iter().any(|a| a.3 != f0) {
            return None;
        }
        Some(f0)
    };

    let hydrate = emit_hydrate_js(&text_slots, class_slot.as_ref());
    let apply = emit_apply_js(&text_slots, class_slot.as_ref());
    let key_field = key_bound.and_then(|k| parse_item_field(k.trim(), &item_prefix));
    // Create is inlined (local path vars + parent.insertBefore) — does not call hydrate
    // (vanillajs-style; Fragment mid-hop is slower than live insertBefore on this bench).
    let create = emit_create_js(&text_slots, class_slot.as_ref(), key_field.as_deref());
    let events: Vec<String> = {
        let mut e = acts.iter().map(|(_, _, ev, _)| format!("{:?}", ev)).collect::<Vec<_>>();
        e.sort();
        e.dedup();
        e
    };
    let events_js = events.join(", ");

    let key_field_js =
        key_field.as_ref().map(|f| format!(", keyField: {:?}", f)).unwrap_or_default();

    let host_fields_js = if let Some((_, _, _, host, _)) = &class_slot {
        format!(", hostFields: [{:?}]", host)
    } else {
        String::new()
    };

    let act_arg_js =
        act_arg_field.as_ref().map(|f| format!(", actArgField: {:?}", f)).unwrap_or_default();

    let item_fields_js = {
        let mut fields: Vec<String> = text_slots.iter().map(|(_, f)| f.clone()).collect();
        if let Some((_, _, _, _, item_f)) = &class_slot {
            fields.push(item_f.clone());
        }
        if let Some(f) = &act_arg_field {
            fields.push(f.clone());
        }
        fields.sort();
        fields.dedup();
        let inner = fields.iter().map(|f| format!("{:?}", f)).collect::<Vec<_>>().join(", ");
        format!(", itemFields: [{inner}]")
    };

    // IIFE keeps hydrate/apply/create as one rowKernel object (shape-agnostic).
    Some(format!(
        "rowKernel: (function(){{ var hydrate = {hydrate}; var apply = {apply}; var create = {create}; return {{ html: {:?}, hydrate: hydrate, apply: apply, create: create, events: [{events_js}]{key_field_js}{host_fields_js}{act_arg_js}{item_fields_js} }}; }})(), ",
        html
    ))
}

fn emit_html_element(
    tag: &str,
    attrs: &[ViewAttr],
    children: &[ViewNode],
    path: &[u32],
    as_name: &str,
    item_prefix: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
    slots: &mut Vec<Slot>,
) -> Option<String> {
    let mut open = format!("<{tag}");
    for a in attrs {
        if a.name == "style:tw" {
            continue;
        }
        match &a.value {
            ViewAttrValue::Static { value: s } => {
                let name = if a.name == "className" { "class" } else { a.name.as_str() };
                open.push(' ');
                open.push_str(name);
                open.push_str("=\"");
                open.push_str(&escape_attr(s));
                open.push('"');
            }
            ViewAttrValue::Bare => {
                open.push(' ');
                open.push_str(&a.name);
            }
            ViewAttrValue::Interp { expr: e } if is_event_attr(&a.name) => {
                let body = bind_field_idents(e, fields, scope, aliases);
                let (method, arg_field) = parse_item_field_action(&body, item_prefix)?;
                let event = event_dom_type(&a.name);
                open.push_str(&format!(" data-vmz-act=\"{}\"", escape_attr(&method)));
                slots.push(Slot::Act {
                    path: path.to_vec(),
                    method,
                    event: event.to_string(),
                    arg_field,
                });
            }
            ViewAttrValue::Interp { expr: e } => {
                let name = if a.name == "className" { "class" } else { a.name.as_str() };
                if name != "class" {
                    return None;
                }
                let body = bind_field_idents(&sanitize_interp(e), fields, scope, aliases);
                let (on_val, off_val, host_field, item_field) =
                    parse_host_item_class_ternary(&body, item_prefix)?;
                open.push_str(" class=\"\"");
                slots.push(Slot::Class {
                    path: path.to_vec(),
                    on_val,
                    off_val,
                    host_field,
                    item_field,
                });
            }
        }
    }
    open.push('>');

    let mut inner = String::new();
    let mut child_i = 0u32;
    for child in children {
        match child {
            ViewNode::Text { value: t } => {
                inner.push_str(&escape_text(t));
            }
            ViewNode::Interp { expr, .. } => {
                let body = bind_field_idents(&sanitize_interp(expr), fields, scope, aliases);
                let field = parse_item_field(&body, item_prefix)?;
                let mut p = path.to_vec();
                // Text node is a child; path points at the text node index among children.
                // For hydrate we walk element children then .firstChild for text — see emit_hydrate.
                // We store path to the *parent element that contains the text as firstChild*,
                // or path including text index when mixed. Simplest: path to text's parent + note.
                // Convention: path is childNodes indices from row root to the Text node.
                p.push(child_i);
                slots.push(Slot::Text { path: p, field });
                // Placeholder text node (space keeps layout closer to createItem empty text).
                inner.push(' ');
                child_i += 1;
            }
            ViewNode::Element { tag, attrs, children, each } => {
                if each.is_some() {
                    return None;
                }
                let mut p = path.to_vec();
                p.push(child_i);
                inner.push_str(&emit_html_element(
                    tag,
                    attrs,
                    children,
                    &p,
                    as_name,
                    item_prefix,
                    fields,
                    scope,
                    aliases,
                    slots,
                )?);
                child_i += 1;
            }
            ViewNode::If { .. } | ViewNode::Component { .. } | ViewNode::Slot { .. } => {
                return None;
            }
        }
    }

    Some(format!("{open}{inner}</{tag}>"))
}

fn emit_hydrate_js(
    texts: &[(Vec<u32>, String)],
    class: Option<&(Vec<u32>, String, String, String, String)>,
) -> String {
    // Single-row path (append one / reconcile miss). Create loop inlines its own writes.
    // No __vmzBp: Element entry is identified by nodeType === 1.
    let mut body = String::from("root.__vmzBox = item;\n");
    for (path, field) in texts {
        let get = path_expr("root", path);
        body.push_str(&format!("{get}.nodeValue = item.{field};\n"));
    }
    if let Some((path, on_val, off_val, host, item_f)) = class {
        let get = path_expr("root", path);
        body.push_str(&format!(
            "var hv = this.{host};\nif (hv != null) {{ ({get}).className = hv === item.{item_f} ? {:?} : {:?}; }}\n",
            on_val, off_val
        ));
    }
    format!("function(root, item) {{\n{} }}", indent(&body))
}

/// Fresh-create loop: clone + local path vars + keyed.set + parent.insertBefore(root, end).
/// Inlined (not hydrate.call) so V8 sees straight-line DOM writes like hand-tuned keyed apps.
fn emit_create_js(
    texts: &[(Vec<u32>, String)],
    class: Option<&(Vec<u32>, String, String, String, String)>,
    key_field: Option<&str>,
) -> String {
    let mut body = String::from(
        "for (var i = startIdx; i < list.length; i++) {\n  var item = list[i];\n  var root = tpl.cloneNode(true);\n  root.__vmzBox = item;\n",
    );
    // Hoist shared firstChild / nextSibling walks into locals (generic for any path set).
    let locals = emit_path_locals("root", texts, class.map(|c| c.0.as_slice()));
    body.push_str(&locals.code);
    for (i, (_path, field)) in texts.iter().enumerate() {
        body.push_str(&format!("  {0}.nodeValue = item.{field};\n", locals.text_names[i]));
    }
    if let Some((_path, on_val, off_val, host, item_f)) = class {
        let class_target = locals.class_name.as_deref().unwrap_or("root");
        body.push_str(&format!(
            "  var hv = this.{host};\n  if (hv != null) {{ {class_target}.className = hv === item.{item_f} ? {:?} : {:?}; }}\n",
            on_val, off_val
        ));
    }
    match key_field {
        Some(f) => body.push_str(&format!(
            "  var k = item.{f};\n  root.__vmzKey = k;\n  keyed.set(k, root);\n"
        )),
        None => body
            .push_str("  var k = keyOf(item, i);\n  root.__vmzKey = k;\n  keyed.set(k, root);\n"),
    }
    body.push_str("  parent.insertBefore(root, end);\n}\n");
    format!("function(list, startIdx, tpl, keyed, parent, end, keyOf) {{\n{} }}", indent(&body))
}

struct PathLocals {
    code: String,
    text_names: Vec<String>,
    class_name: Option<String>,
}

/// Emit `var pN = …` with common-subexpression reuse across text/class paths.
fn emit_path_locals(
    root: &str,
    texts: &[(Vec<u32>, String)],
    class_path: Option<&[u32]>,
) -> PathLocals {
    use std::collections::HashMap;
    let mut temps: HashMap<Vec<u32>, String> = HashMap::new();
    temps.insert(vec![], root.to_string());
    let mut code = String::new();
    let mut next_tmp = 0u32;

    let mut ensure = |path: &[u32],
                      code: &mut String,
                      temps: &mut HashMap<Vec<u32>, String>,
                      next_tmp: &mut u32|
     -> String {
        if let Some(n) = temps.get(path) {
            return n.clone();
        }
        let mut best = 0usize;
        for len in 0..path.len() {
            if temps.contains_key(&path[..len]) {
                best = len;
            }
        }
        let mut cur = path[..best].to_vec();
        let mut cur_name = temps[&cur].clone();
        for &idx in &path[best..] {
            cur.push(idx);
            if let Some(n) = temps.get(&cur) {
                cur_name = n.clone();
                continue;
            }
            let name = format!("p{next_tmp}");
            *next_tmp += 1;
            let step = if idx <= 4 {
                let mut e = format!("{cur_name}.firstChild");
                for _ in 0..idx {
                    e.push_str(".nextSibling");
                }
                e
            } else {
                format!("{cur_name}.childNodes[{idx}]")
            };
            code.push_str(&format!("  var {name} = {step};\n"));
            temps.insert(cur.clone(), name.clone());
            cur_name = name;
        }
        cur_name
    };

    let mut text_names = Vec::new();
    for (path, _) in texts {
        text_names.push(ensure(path, &mut code, &mut temps, &mut next_tmp));
    }
    let class_name = class_path.map(|p| {
        if p.is_empty() {
            root.to_string()
        } else {
            ensure(p, &mut code, &mut temps, &mut next_tmp)
        }
    });

    PathLocals { code, text_names, class_name }
}

fn emit_apply_js(
    texts: &[(Vec<u32>, String)],
    class: Option<&(Vec<u32>, String, String, String, String)>,
) -> String {
    let mut body = String::new();
    if !texts.is_empty() {
        body.push_str("if (!root.__vmzT0) {\n");
        for (i, (path, _)) in texts.iter().enumerate() {
            let get = path_expr("root", path);
            body.push_str(&format!("  root.__vmzT{i} = {get};\n"));
        }
        body.push_str("}\n");
        for (i, (_path, field)) in texts.iter().enumerate() {
            body.push_str(&format!("root.__vmzT{i}.nodeValue = item.{field};\n"));
        }
    }
    if let Some((_path, on_val, off_val, host, item_f)) = class {
        body.push_str(&format!(
            "root.className = this.{host} === item.{item_f} ? {:?} : {:?};\n",
            on_val, off_val
        ));
    }
    format!("function(root, item) {{\n{} }}", indent(&body))
}

fn path_expr(root: &str, path: &[u32]) -> String {
    if path.is_empty() {
        return root.to_string();
    }
    // Generic short-path walk: firstChild / nextSibling beats childNodes[i] for small indices.
    let mut e = root.to_string();
    for (depth, &idx) in path.iter().enumerate() {
        if idx <= 4 {
            e.push_str(".firstChild");
            for _ in 0..idx {
                e.push_str(".nextSibling");
            }
        } else {
            for &i in &path[depth..] {
                e.push_str(&format!(".childNodes[{i}]"));
            }
            break;
        }
    }
    e
}

fn parse_item_field(body: &str, item_prefix: &str) -> Option<String> {
    let b = body.trim();
    let rest = b.strip_prefix(item_prefix)?;
    if rest.is_empty() || !rest.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return None;
    }
    Some(rest.to_string())
}

fn parse_item_field_action(body: &str, item_prefix: &str) -> Option<(String, String)> {
    // () => this.select(box1.item.id)  OR  this.remove(box1.item.key)
    let b = body.trim();
    let b = b.strip_prefix("() =>").unwrap_or(b).trim();
    let b = b.strip_prefix("(ev) =>").unwrap_or(b).trim();
    let b = b.strip_prefix("this.").unwrap_or(b);
    let open = b.find('(')?;
    let method = b[..open].trim();
    let args = b[open + 1..].strip_suffix(')')?.trim();
    let arg_field = parse_item_field(args, item_prefix)?;
    if method.is_empty()
        || !method.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    {
        return None;
    }
    Some((method.to_string(), arg_field))
}

fn parse_host_item_class_ternary(
    body: &str,
    item_prefix: &str,
) -> Option<(String, String, String, String)> {
    // this.selected === box1.item.id ? "danger" : ""
    // this.activeKey === box1.item.key ? "on" : "off"
    let b = body.trim();
    let b = b.strip_prefix("this.")?;
    let eq = b.find("===")?;
    let host = b[..eq].trim();
    if host.is_empty() || !host.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return None;
    }
    let rest = b[eq + 3..].trim();
    let q = rest.find('?')?;
    let item_expr = rest[..q].trim();
    let item_field = parse_item_field(item_expr, item_prefix)?;
    let tern = rest[q + 1..].trim();
    let (on, off) = split_ternary_string_lits(tern)?;
    Some((on, off, host.to_string(), item_field))
}

fn split_ternary_string_lits(s: &str) -> Option<(String, String)> {
    // "danger" : ""  or 'danger' : ''
    let s = s.trim();
    let (on, rest) = take_string_lit(s)?;
    let rest = rest.trim().strip_prefix(':')?.trim();
    let (off, tail) = take_string_lit(rest)?;
    if !tail.trim().is_empty() {
        return None;
    }
    Some((on, off))
}

fn take_string_lit(s: &str) -> Option<(String, String)> {
    let s = s.trim();
    let quote = s.chars().next()?;
    if quote != '"' && quote != '\'' {
        return None;
    }
    let bytes = s.as_bytes();
    let mut i = 1;
    while i < bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] as char == quote {
            let inner = &s[1..i];
            return Some((inner.to_string(), s[i + 1..].to_string()));
        }
        i += 1;
    }
    None
}

fn escape_attr(s: &str) -> String {
    s.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;").replace('>', "&gt;")
}

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn indent(s: &str) -> String {
    s.lines().map(|l| format!("  {l}\n")).collect()
}
