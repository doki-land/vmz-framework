//! Layer-1 Concrete Template AST — **deprecated adapter** (stage C).
//!
//! **Only path**: Oak Vue AST via [`super::template_oak::parse_template_layers_primary`].
//! This module remains only as:
//! - IR shape shared by Oak lowering / Semantic / legacy TemplateIr
//! - shared attribute classification algebra ([`classify_concrete_attr`])
//!
//! # Feature freeze (hard)
//!
//! Do **not** extend this module with new Vue syntax. Gaps go to Oaks (`oak-vue`)
//! first; VMZ only adapts. Allowed changes: bugfixes that restore prior behavior,
//! diagnostic clarity, and Oak classify helpers ([`classify_concrete_attr`]).
//!
//! Expressions remain `String` here (`ExprPlan` is Oak-primary snippet ingress).
//! Downstream emit still consumes [`super::template::TemplateIr`] via
//! [`super::template_lower`].

use super::template_common::TemplateParseError;
use super::template_span::TemplateSpan;

/// Forest of concrete roots for one `<template>` body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConcreteIr {
    /// Top-level nodes in document order.
    pub roots: Vec<ConcreteNode>,
}

/// One concrete template node with source span.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConcreteNode {
    /// Element / component tag.
    Element {
        /// Tag name as written.
        tag: String,
        /// Attributes / directives in source order.
        attrs: Vec<ConcreteAttr>,
        /// Nested children.
        children: Vec<ConcreteNode>,
        /// Span covering the whole element (start tag through end tag / self-close).
        span: TemplateSpan,
    },
    /// Decoded text run.
    Text {
        /// Text content (HTML entities decoded).
        value: String,
        /// Span of the text run in the template body.
        span: TemplateSpan,
    },
    /// `{{ expr }}` mustache (trimmed body).
    Interpolation {
        /// Expression text without braces.
        expr: String,
        /// Span covering `{{ … }}`.
        span: TemplateSpan,
    },
    /// HTML comment `<!-- … -->`.
    Comment {
        /// Comment body without delimiters.
        value: String,
        /// Span covering `<!-- … -->`.
        span: TemplateSpan,
    },
}

/// Attribute or directive on an element.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConcreteAttr {
    /// Plain HTML / component static attribute.
    Static {
        /// Attribute name as written.
        name: String,
        /// Decoded static value (empty for bare boolean attrs).
        value: String,
        /// Span of the attribute in the start tag.
        span: TemplateSpan,
    },
    /// Structured Vue directive.
    Directive {
        /// Parsed directive payload.
        dir: Directive,
        /// Span of the attribute in the start tag.
        span: TemplateSpan,
    },
}

/// Directive argument (`click`, `[eventName]`, …).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DirectiveArg {
    /// Static argument name.
    Static(String),
    /// Dynamic argument expression inside `[…]`.
    Dynamic(String),
}

/// Structured Vue directive (layer-1; not Execution IR).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Directive {
    /// `v-if`.
    If {
        /// Condition expression text.
        test: String,
    },
    /// `v-else-if`.
    ElseIf {
        /// Condition expression text.
        test: String,
    },
    /// `v-else`.
    Else,
    /// `v-for` with full alias list retained on concrete.
    For {
        /// Iterable / source expression.
        source: String,
        /// First alias (`item` in `(item, index) in items`).
        value_alias: String,
        /// Second alias when present (Vue `key` slot in for aliases).
        key_alias: Option<String>,
        /// Third alias when present (Vue `index` slot).
        index_alias: Option<String>,
    },
    /// `:arg` / `v-bind:arg` with optional modifiers.
    Bind {
        /// Bound property argument.
        arg: DirectiveArg,
        /// Value expression.
        expr: String,
        /// Modifiers after the argument (e.g. `sync`).
        modifiers: Vec<String>,
    },
    /// `v-bind="obj"` object form.
    BindObject {
        /// Object expression to spread.
        expr: String,
    },
    /// `@arg` / `v-on:arg` with modifiers stripped from the event name.
    On {
        /// Event name / dynamic event argument.
        arg: DirectiveArg,
        /// Handler expression.
        handler: String,
        /// Event modifiers (`stop`, `prevent`, …).
        modifiers: Vec<String>,
    },
    /// `v-on="listeners"` object form.
    OnObject {
        /// Listeners object expression.
        expr: String,
    },
    /// `#name` / `v-slot:name` (optional props expression).
    Slot {
        /// Slot name argument.
        name: DirectiveArg,
        /// Optional slot props destructure / expression.
        props: Option<String>,
    },
    /// `v-html`.
    Html {
        /// HTML expression.
        expr: String,
    },
    /// `v-show`.
    Show {
        /// Visibility expression.
        expr: String,
    },
    /// `v-model` / `v-model:arg` — recognized; adapter rejects until semantic.
    Model {
        /// Optional model argument (`title` in `v-model:title`).
        arg: Option<String>,
        /// Model target expression.
        expr: String,
        /// Model modifiers (`lazy`, `number`, …).
        modifiers: Vec<String>,
    },
    /// Other `v-*` custom directive.
    Custom {
        /// Directive name without `v-` prefix.
        name: String,
        /// Optional argument.
        arg: Option<DirectiveArg>,
        /// Optional value expression.
        expr: Option<String>,
        /// Modifiers.
        modifiers: Vec<String>,
    },
}

/// Classify one template attribute/directive name + value into [`ConcreteAttr`].
///
/// Used by the Oak frontend adapter when lowering Oak Vue AST nodes.
pub fn classify_concrete_attr(
    name: &str,
    value: Option<&str>,
    span: TemplateSpan,
) -> Result<ConcreteAttr, TemplateParseError> {
    classify_one(RawAttr { name: name.to_string(), value: value.map(|s| s.to_string()), span })
}

#[derive(Debug)]
struct RawAttr {
    name: String,
    value: Option<String>,
    span: TemplateSpan,
}

fn classify_one(attr: RawAttr) -> Result<ConcreteAttr, TemplateParseError> {
    let RawAttr { name, value, span } = attr;
    let val = value.as_deref().map(str::trim);
    let offset = span.start as usize;

    if name == "v-if" {
        let test = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::If { test }, span });
    }
    if name == "v-else-if" {
        let test = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::ElseIf { test }, span });
    }
    if name == "v-else" {
        return Ok(ConcreteAttr::Directive { dir: Directive::Else, span });
    }
    if name == "v-html" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::Html { expr }, span });
    }
    if name == "v-show" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::Show { expr }, span });
    }
    if name == "v-for" {
        let expr = require_expr(&name, val, offset)?;
        let for_dir = parse_v_for_concrete(&expr, offset)?;
        return Ok(ConcreteAttr::Directive { dir: for_dir, span });
    }
    if name == "v-bind" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::BindObject { expr }, span });
    }
    if name == "v-on" {
        let expr = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive { dir: Directive::OnObject { expr }, span });
    }
    if name == "v-slot" {
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Slot {
                name: DirectiveArg::Static("default".into()),
                props: val.map(str::to_string).filter(|s| !s.is_empty()),
            },
            span,
        });
    }
    if name == "v-model" || name.starts_with("v-model.") || name.starts_with("v-model:") {
        return Ok(ConcreteAttr::Directive { dir: parse_v_model(&name, val, offset)?, span });
    }

    if let Some(rest) = name.strip_prefix(':') {
        let (arg, modifiers) = split_arg_modifiers(rest);
        let expr = bind_expr(&name, &arg, val, offset)?;
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Bind { arg: parse_directive_arg(&arg), expr, modifiers },
            span,
        });
    }
    if let Some(rest) = name.strip_prefix("v-bind:") {
        let (arg, modifiers) = split_arg_modifiers(rest);
        let expr = bind_expr(&name, &arg, val, offset)?;
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Bind { arg: parse_directive_arg(&arg), expr, modifiers },
            span,
        });
    }
    if let Some(rest) = name.strip_prefix('@') {
        let (arg, modifiers) = split_arg_modifiers(rest);
        let handler = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive {
            dir: Directive::On { arg: parse_directive_arg(&arg), handler, modifiers },
            span,
        });
    }
    if let Some(rest) = name.strip_prefix("v-on:") {
        let (arg, modifiers) = split_arg_modifiers(rest);
        let handler = require_expr(&name, val, offset)?;
        return Ok(ConcreteAttr::Directive {
            dir: Directive::On { arg: parse_directive_arg(&arg), handler, modifiers },
            span,
        });
    }
    if let Some(rest) = name.strip_prefix('#') {
        let (arg, _mods) = split_arg_modifiers(rest);
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Slot {
                name: parse_directive_arg(&arg),
                props: val.map(str::to_string).filter(|s| !s.is_empty()),
            },
            span,
        });
    }
    if let Some(rest) = name.strip_prefix("v-slot:") {
        let (arg, _mods) = split_arg_modifiers(rest);
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Slot {
                name: parse_directive_arg(&arg),
                props: val.map(str::to_string).filter(|s| !s.is_empty()),
            },
            span,
        });
    }

    if let Some(rest) = name.strip_prefix("v-") {
        let (base_and_arg, modifiers) = split_trailing_modifiers(rest);
        let (dir_name, arg) = split_v_name_arg(base_and_arg);
        return Ok(ConcreteAttr::Directive {
            dir: Directive::Custom {
                name: dir_name,
                arg,
                expr: val.map(str::to_string),
                modifiers,
            },
            span,
        });
    }

    Ok(ConcreteAttr::Static { name, value: val.unwrap_or("").to_string(), span })
}

/// `v-bind` value, including the Vue 3.4+ same-name shorthand (`:title` → `:title="title"`).
///
/// The shorthand only applies to static arguments. Vue rejects `:[key]` without a value
/// (`X_V_BIND_INVALID_SAME_NAME_ARGUMENT`) because there is no name to expand.
fn bind_expr(
    name: &str,
    arg: &str,
    val: Option<&str>,
    offset: usize,
) -> Result<String, TemplateParseError> {
    if let Some(value) = val.filter(|s| !s.is_empty()) {
        return Ok(value.to_string());
    }
    if arg.starts_with('[') {
        return Err(TemplateParseError {
            message: "`v-bind` with same-name shorthand only allows a static argument".into(),
            offset,
        });
    }
    if arg.is_empty() {
        return Err(TemplateParseError {
            message: format!("directive `{name}` requires an expression value"),
            offset,
        });
    }
    Ok(camelize_arg(arg))
}

/// `foo-bar` → `fooBar` (Vue expands `:foo-bar` to the camelCase binding name).
fn camelize_arg(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len());
    let mut capitalize = false;
    for ch in arg.chars() {
        if ch == '-' {
            capitalize = true;
        } else if capitalize {
            out.extend(ch.to_uppercase());
            capitalize = false;
        } else {
            out.push(ch);
        }
    }
    out
}

fn require_expr(
    name: &str,
    val: Option<&str>,
    offset: usize,
) -> Result<String, TemplateParseError> {
    match val {
        Some(s) if !s.is_empty() => Ok(s.to_string()),
        _ => Err(TemplateParseError {
            message: format!("directive `{name}` requires an expression value"),
            offset,
        }),
    }
}

fn parse_directive_arg(arg: &str) -> DirectiveArg {
    let t = arg.trim();
    if let Some(inner) = t.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        DirectiveArg::Dynamic(inner.trim().to_string())
    } else {
        DirectiveArg::Static(t.to_string())
    }
}

/// Split `click.stop.prevent` → (`click`, [`stop`, `prevent`]).
fn split_arg_modifiers(rest: &str) -> (String, Vec<String>) {
    // Dynamic arg `[foo].mod` — keep `[foo]` intact.
    if rest.starts_with('[') {
        if let Some(end) = rest.find(']') {
            let arg = rest[..=end].to_string();
            let after = &rest[end + 1..];
            let modifiers =
                after.split('.').filter(|s| !s.is_empty()).map(str::to_string).collect();
            return (arg, modifiers);
        }
    }
    let mut parts = rest.split('.');
    let arg = parts.next().unwrap_or("").to_string();
    let modifiers = parts.filter(|s| !s.is_empty()).map(str::to_string).collect();
    (arg, modifiers)
}

fn split_trailing_modifiers(rest: &str) -> (String, Vec<String>) {
    if let Some(colon) = rest.find(':') {
        let name = &rest[..colon];
        let (arg, mods) = split_arg_modifiers(&rest[colon + 1..]);
        return (format!("{name}:{arg}"), mods);
    }
    // `dir.mod1.mod2` — first segment is name, rest modifiers (Vue custom).
    let mut parts = rest.split('.');
    let name = parts.next().unwrap_or("").to_string();
    let mods = parts.filter(|s| !s.is_empty()).map(str::to_string).collect();
    (name, mods)
}

fn split_v_name_arg(base: String) -> (String, Option<DirectiveArg>) {
    if let Some((name, arg)) = base.split_once(':') {
        (name.to_string(), Some(parse_directive_arg(arg)))
    } else {
        (base, None)
    }
}

fn parse_v_model(
    name: &str,
    val: Option<&str>,
    offset: usize,
) -> Result<Directive, TemplateParseError> {
    let expr = require_expr(name, val, offset)?;
    // v-model / v-model.trim / v-model:title.lazy
    let rest = name.strip_prefix("v-model").unwrap_or("");
    if rest.is_empty() {
        return Ok(Directive::Model { arg: None, expr, modifiers: Vec::new() });
    }
    if let Some(after) = rest.strip_prefix(':') {
        let (arg, modifiers) = split_arg_modifiers(after);
        return Ok(Directive::Model { arg: Some(arg), expr, modifiers });
    }
    if let Some(after) = rest.strip_prefix('.') {
        let modifiers = after.split('.').filter(|s| !s.is_empty()).map(str::to_string).collect();
        return Ok(Directive::Model { arg: None, expr, modifiers });
    }
    Ok(Directive::Model { arg: None, expr, modifiers: Vec::new() })
}

fn parse_v_for_concrete(expr: &str, offset: usize) -> Result<Directive, TemplateParseError> {
    let (alias_part, list_part) = split_v_for(expr).ok_or_else(|| TemplateParseError {
        message: format!("invalid `v-for` expression `{expr}` (expected `alias in list`)"),
        offset,
    })?;
    let aliases = parse_for_aliases(alias_part).ok_or_else(|| TemplateParseError {
        message: format!("invalid `v-for` alias in `{expr}`"),
        offset,
    })?;
    let source = list_part.trim();
    if source.is_empty() {
        return Err(TemplateParseError {
            message: format!("invalid `v-for` list in `{expr}`"),
            offset,
        });
    }
    Ok(Directive::For {
        source: source.to_string(),
        value_alias: aliases.0,
        key_alias: aliases.1,
        index_alias: aliases.2,
    })
}

fn parse_for_aliases(alias_part: &str) -> Option<(String, Option<String>, Option<String>)> {
    let inner = alias_part.trim().trim_start_matches('(').trim_end_matches(')').trim();
    if inner.is_empty() {
        return None;
    }
    let parts: Vec<&str> = inner.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
    match parts.as_slice() {
        [v] => Some(((*v).to_string(), None, None)),
        [v, k] => Some(((*v).to_string(), Some((*k).to_string()), None)),
        [v, k, i] => Some(((*v).to_string(), Some((*k).to_string()), Some((*i).to_string()))),
        _ => None,
    }
}

fn split_v_for(expr: &str) -> Option<(&str, &str)> {
    for kw in [" in ", " of "] {
        if let Some(idx) = expr.find(kw) {
            return Some((&expr[..idx], &expr[idx + kw.len()..]));
        }
    }
    None
}
