//! Lower Oak TypeScript AST into [`ComponentDecl`] surface (phase B2).

use oak_typescript::ast::{
    ClassDeclaration, ClassMember, Expression, ExpressionKind, Statement, TypeAnnotation,
    Visibility as OakVisibility,
};
use oak_typescript::TypeScriptRoot;
use oxc_span::Span;
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};
use vmz_types::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};

use crate::sfc::ScriptKind;

/// Try Oak TypeScript AST → component surface. `None` when Oak fails or yields no usable class.
pub fn try_component_decl_via_oak(kind: ScriptKind, source: &str) -> Option<ComponentDecl> {
    let shell = ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: match kind {
            ScriptKind::Client => ScriptRole::Client,
            ScriptKind::Server => ScriptRole::Server,
        },
    };
    let parsed = parse_script_ast(&shell);
    if !parsed.ok {
        return None;
    }
    let root = parsed.root.as_ref()?;
    let decl = component_decl_from_root(root, source)?;
    if decl.name == "Anonymous" {
        return None;
    }
    Some(decl)
}

fn component_decl_from_root(root: &TypeScriptRoot, source: &str) -> Option<ComponentDecl> {
    let mut default_class: Option<&ClassDeclaration> = None;
    let mut internals = Vec::new();

    for stmt in &root.statements {
        match stmt {
            Statement::ExportDeclaration(exp) if exp.is_default => {
                if let Some(Statement::ClassDeclaration(class)) = exp.declaration.as_deref() {
                    default_class = Some(class);
                }
            }
            Statement::ClassDeclaration(class) => {
                if !class.name.is_empty() {
                    internals.push(class);
                }
            }
            Statement::ExportDeclaration(exp) if !exp.is_default => {
                if let Some(Statement::ClassDeclaration(class)) = exp.declaration.as_deref() {
                    if !class.name.is_empty() {
                        internals.push(class);
                    }
                }
            }
            _ => {}
        }
    }

    let class = default_class?;
    let name = if class.name.is_empty() { "Default".to_string() } else { class.name.clone() };
    let class_span = range_to_span(class.span.start, class.span.end);
    let name_span = name_span_in(source, class.span.start, class.span.end, &name);
    let mut decl = ComponentDecl::new(name, class_span, name_span);
    fill_members_from_oak(&mut decl, &class.body, source);
    decl.internal_classes = internals
        .into_iter()
        .filter(|c| c.name != decl.name)
        .map(|c| InternalClassDecl {
            name: c.name.clone(),
            span: range_to_span(c.span.start, c.span.end),
            name_span: name_span_in(source, c.span.start, c.span.end, &c.name),
        })
        .collect();
    Some(decl)
}

fn fill_members_from_oak(decl: &mut ComponentDecl, body: &[ClassMember], source: &str) {
    for member in body {
        match member {
            ClassMember::Property {
                name,
                ty,
                initializer,
                visibility,
                is_static,
                span,
                ..
            } => {
                if *is_static || name.is_empty() {
                    continue;
                }
                let visibility = map_visibility(visibility.as_ref());
                let kind = if matches!(visibility, Visibility::Public) {
                    FieldKind::Prop
                } else {
                    FieldKind::State
                };
                let field = FieldDecl {
                    name: name.clone(),
                    type_text: ty.as_ref().map(type_annotation_text),
                    init_text: initializer.as_ref().map(|e| {
                        source[e.span.start..e.span.end.min(source.len())].to_string()
                    }),
                    kind,
                    visibility,
                    span: range_to_span(span.start, span.end),
                    name_span: name_span_in(source, span.start, span.end, name),
                };
                match kind {
                    FieldKind::Prop => decl.properties.push(field),
                    FieldKind::State => decl.fields.push(field),
                }
            }
            ClassMember::Method {
                name,
                body: _body,
                decorators,
                visibility,
                is_static,
                is_async,
                span,
                ..
            } => {
                if name.is_empty() || name == "constructor" {
                    continue;
                }
                let is_private = name.starts_with('#')
                    || matches!(visibility, Some(OakVisibility::Private));
                let http = decorators.iter().find_map(|d| http_route_from_oak_expr(&d.expression));
                decl.methods.push(MethodDecl {
                    name: name.clone(),
                    is_async: *is_async,
                    is_static: *is_static,
                    is_private,
                    http,
                    reads: Vec::new(),
                    writes: Vec::new(),
                    calls: Vec::new(),
                    opaque_callee: false,
                    star_reasons: Vec::new(),
                    span: range_to_span(span.start, span.end),
                    name_span: name_span_in(source, span.start, span.end, name),
                });
            }
        }
    }
}

/// Copy oxc method read/write/call summaries onto Oak surface methods (matched by name).
pub fn graft_oxc_method_summaries(oak: &mut ComponentDecl, oxc: &ComponentDecl) {
    for m in &mut oak.methods {
        if let Some(src) = oxc.methods.iter().find(|o| o.name == m.name) {
            m.reads = src.reads.clone();
            m.writes = src.writes.clone();
            m.calls = src.calls.clone();
            m.opaque_callee = src.opaque_callee;
            m.star_reasons = src.star_reasons.clone();
            // Prefer oxc async/http when Oak missed them.
            if !m.is_async {
                m.is_async = src.is_async;
            }
            if m.http.is_none() {
                m.http = src.http.clone();
            }
        }
    }
}

fn http_route_from_oak_expr(expr: &Expression) -> Option<HttpRoute> {
    let ExpressionKind::CallExpression { func, args } = expr.kind.as_ref() else {
        return None;
    };
    let ExpressionKind::Identifier(verb_name) = func.kind.as_ref() else {
        return None;
    };
    let verb = http_verb_from_name(verb_name)?;
    let path = args.first().and_then(|a| match a.kind.as_ref() {
        ExpressionKind::StringLiteral(s) => Some(s.clone()),
        _ => None,
    })?;
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

fn map_visibility(v: Option<&OakVisibility>) -> Visibility {
    match v {
        Some(OakVisibility::Public) => Visibility::Public,
        Some(OakVisibility::Private) => Visibility::Private,
        Some(OakVisibility::Protected) => Visibility::Protected,
        None => Visibility::Private,
    }
}

fn type_annotation_text(ty: &TypeAnnotation) -> String {
    match ty {
        TypeAnnotation::Identifier(s) | TypeAnnotation::Predefined(s) => s.clone(),
        TypeAnnotation::Reference { name, .. } => name.clone(),
        TypeAnnotation::Array(inner) => format!("{}[]", type_annotation_text(inner)),
        _ => "unknown".into(),
    }
}

fn range_to_span(start: usize, end: usize) -> Span {
    Span::new(start as u32, end as u32)
}

fn name_span_in(source: &str, start: usize, end: usize, name: &str) -> Span {
    let end = end.min(source.len());
    let start = start.min(end);
    let slice = &source[start..end];
    if let Some(rel) = slice.find(name) {
        let s = (start + rel) as u32;
        return Span::new(s, s + name.len() as u32);
    }
    range_to_span(start, end)
}
