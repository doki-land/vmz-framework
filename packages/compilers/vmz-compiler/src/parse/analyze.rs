//! Analyze `<script client|server>` with oxc: default-export class, fields, and methods.

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, Class, ClassElement, ExportDefaultDeclarationKind, Expression, PropertyKey,
    Statement, TSAccessibility,
};
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};

use vmz_types::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};

use crate::field_rw::{FieldRw, ForbiddenFactory};
use crate::sfc::ScriptKind;

/// Oxc analysis result for one client or server script body.
#[derive(Debug, Clone)]
pub struct AnalyzedScript {
    /// Whether this body was analyzed as client or server.
    pub kind: ScriptKind,
    /// Default-exported component declaration (Anonymous when missing).
    pub decl: ComponentDecl,
    /// Oxc parse diagnostics as plain strings.
    pub parse_errors: Vec<String>,
    /// `useX` / `createX` calls found in this script (oxc).
    pub forbidden_factories: Vec<ForbiddenFactory>,
}

/// Parse `source` as TypeScript and lower the default-export class into [`ComponentDecl`].
pub fn analyze_script(kind: ScriptKind, source: &str) -> AnalyzedScript {
    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let ret = Parser::new(&allocator, source, source_type).parse();

    let parse_errors: Vec<String> = ret.diagnostics.iter().map(|e| e.to_string()).collect();

    let mut decl = ComponentDecl::new("Anonymous", Span::default(), Span::default());
    let mut found_default = false;
    let mut internal = Vec::new();
    let mut forbidden_factories = Vec::new();

    for stmt in &ret.program.body {
        match stmt {
            Statement::ExportDefaultDeclaration(export) => {
                if let ExportDefaultDeclarationKind::ClassDeclaration(class) = &export.declaration {
                    found_default = true;
                    let (d, forbidden) = class_to_decl(class, source);
                    decl = d;
                    forbidden_factories.extend(forbidden);
                }
            }
            Statement::ClassDeclaration(class) => {
                push_internal(&mut internal, class);
            }
            Statement::ExportDeclaration(export) => {
                if let oxc_ast::ast::Declaration::ClassDeclaration(class) = &export.declaration {
                    push_internal(&mut internal, class);
                }
            }
            _ => {}
        }
    }

    // Also scan whole program for factories outside the class (imports/calls).
    if kind == ScriptKind::Client {
        let mut rw = FieldRw::default();
        rw.visit_program(&ret.program);
        for f in rw.forbidden {
            if !forbidden_factories.iter().any(|e| e.name == f.name && e.span == f.span) {
                forbidden_factories.push(f);
            }
        }
    }

    decl.internal_classes =
        internal.into_iter().filter(|c| !(found_default && c.name == decl.name)).collect();

    AnalyzedScript { kind, decl, parse_errors, forbidden_factories }
}

fn push_internal(internal: &mut Vec<InternalClassDecl>, class: &Class<'_>) {
    if let Some(id) = &class.id {
        internal.push(InternalClassDecl {
            name: id.name.to_string(),
            span: class.span,
            name_span: id.span,
        });
    }
}

fn class_to_decl(class: &Class<'_>, source: &str) -> (ComponentDecl, Vec<ForbiddenFactory>) {
    let (name, name_span) = match &class.id {
        Some(id) => (id.name.to_string(), id.span),
        None => ("Default".to_string(), class.span),
    };
    let mut decl = ComponentDecl::new(name, class.span, name_span);
    let forbidden = fill_members(&mut decl, &class.body.body, source);
    (decl, forbidden)
}

fn fill_members(
    decl: &mut ComponentDecl,
    body: &[ClassElement<'_>],
    source: &str,
) -> Vec<ForbiddenFactory> {
    let mut forbidden = Vec::new();

    let mut field_names: Vec<String> = Vec::new();
    for el in body {
        if let ClassElement::PropertyDefinition(prop) = el {
            if prop.r#static {
                continue;
            }
            if let Some(name) = prop_key_name(&prop.key) {
                field_names.push(name);
            }
        }
    }

    for el in body {
        match el {
            ClassElement::PropertyDefinition(prop) => {
                if prop.r#static {
                    continue;
                }
                let Some((name, name_span)) = prop_key_name_span(&prop.key) else {
                    continue;
                };

                let visibility = match prop.accessibility {
                    Some(TSAccessibility::Public) => Visibility::Public,
                    Some(TSAccessibility::Private) => Visibility::Private,
                    Some(TSAccessibility::Protected) => Visibility::Protected,
                    None if name.starts_with('#') => Visibility::Private,
                    None => Visibility::Private,
                };

                let kind = if matches!(prop.accessibility, Some(TSAccessibility::Public)) {
                    FieldKind::Prop
                } else {
                    FieldKind::State
                };

                let type_text = prop.type_annotation.as_ref().map(|t| {
                    let span = t.type_annotation.span();
                    source[span.start as usize..span.end as usize].to_string()
                });

                let init_text = prop.value.as_ref().map(|expr| {
                    let span = expr.span();
                    source[span.start as usize..span.end as usize].to_string()
                });

                if let Some(expr) = &prop.value {
                    let mut rw = FieldRw::new(field_names.iter().cloned());
                    rw.visit_expression(expr);
                    forbidden.extend(rw.forbidden);
                }

                let field = FieldDecl {
                    name,
                    type_text,
                    init_text,
                    kind,
                    visibility,
                    span: prop.span,
                    name_span,
                };

                match kind {
                    FieldKind::Prop => decl.properties.push(field),
                    FieldKind::State => decl.fields.push(field),
                }
            }
            ClassElement::MethodDefinition(method) => {
                let Some((name, name_span)) = prop_key_name_span(&method.key) else {
                    continue;
                };
                let is_private = name.starts_with('#')
                    || matches!(method.accessibility, Some(TSAccessibility::Private));
                let http =
                    method.decorators.iter().find_map(|d| http_route_from_decorator(&d.expression));

                let mut rw = FieldRw::new(field_names.iter().cloned());
                if let Some(body) = &method.value.body {
                    rw.visit_function_body(body);
                }
                forbidden.extend(rw.forbidden);

                decl.methods.push(MethodDecl {
                    name,
                    is_async: method.value.r#async,
                    is_static: method.r#static,
                    is_private,
                    http,
                    reads: rw.reads,
                    writes: rw.writes,
                    calls: rw.calls,
                    opaque_callee: rw.opaque_callee,
                    star_reasons: rw.star_reasons,
                    span: method.span,
                    name_span,
                });
            }
            _ => {}
        }
    }

    // Keep only callees that are known methods on this class (call graph, not DOM/helpers).
    // Unresolved `this.foo` (not a method) → opaque, never silently empty.
    let method_names: Vec<String> = decl.methods.iter().map(|m| m.name.clone()).collect();
    for m in &mut decl.methods {
        let mut known = Vec::new();
        for c in &m.calls {
            if method_names.iter().any(|n| n == c) {
                known.push(c.clone());
            } else {
                m.opaque_callee = true;
                for f in &field_names {
                    if !m.star_reasons.iter().any(|(n, _)| n == f) {
                        m.star_reasons.push((f.clone(), "unresolved_method".into()));
                    }
                }
            }
        }
        m.calls = known;
    }
    // Compose callee reads/writes into callers (transitive; opaque widens to field.*).
    crate::method_compose::compose_cross_method_rw(&mut decl.methods, &field_names);

    forbidden
}

fn http_route_from_decorator(expr: &Expression<'_>) -> Option<HttpRoute> {
    let Expression::CallExpression(call) = expr else {
        return None;
    };
    let verb = match &call.callee {
        Expression::Identifier(id) => http_verb_from_name(id.name.as_str())?,
        _ => return None,
    };
    let path = call.arguments.first().and_then(arg_string_literal)?;
    Some(HttpRoute { verb, path })
}

fn http_verb_from_name(name: &str) -> Option<String> {
    let verb = match name {
        "Get" => "GET",
        "Post" => "POST",
        "Put" => "PUT",
        "Delete" => "DELETE",
        "Patch" => "PATCH",
        _ => return None,
    };
    Some(verb.to_string())
}

fn arg_string_literal(arg: &Argument<'_>) -> Option<String> {
    match arg {
        Argument::StringLiteral(lit) => Some(lit.value.to_string()),
        Argument::TemplateLiteral(tpl) if tpl.expressions.is_empty() => Some(
            tpl.quasis
                .iter()
                .map(|q| q.value.cooked.as_ref().map(|s| s.as_str()).unwrap_or(""))
                .collect(),
        ),
        _ => None,
    }
}

fn prop_key_name(key: &PropertyKey<'_>) -> Option<String> {
    prop_key_name_span(key).map(|(name, _)| name)
}

fn prop_key_name_span(key: &PropertyKey<'_>) -> Option<(String, oxc_span::Span)> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some((id.name.to_string(), id.span)),
        PropertyKey::PrivateIdentifier(id) => Some((format!("#{}", id.name), id.span)),
        PropertyKey::Identifier(id) => Some((id.name.to_string(), id.span)),
        PropertyKey::StringLiteral(lit) => Some((lit.value.to_string(), lit.span)),
        _ => None,
    }
}
