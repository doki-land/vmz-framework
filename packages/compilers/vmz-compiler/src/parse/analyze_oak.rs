//! Lower Oak TypeScript AST into [`ComponentDecl`] surface (phase B2).

use oak_typescript::ast::{
    ClassDeclaration, ClassMember, Expression, ExpressionKind, ImportSpecifier, Statement,
    TypeAnnotation, Visibility as OakVisibility,
};
use oak_typescript::TypeScriptRoot;
use oxc_span::Span;
use vmz_oak_frontend_adapter::{
    ByteSpan, NyarBindingKind, NyarImportBinding, NyarImportDecl, NyarImportKind, ScriptRole,
    ScriptShellInput, parse_script_ast,
};
use vmz_types::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};

use crate::field_rw::{ForbiddenFactory, is_forbidden_factory};
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

/// Collect forbidden `useX` / `createX` factory calls via Oak TypeScript AST.
///
/// Returns `None` when Oak cannot build a script root (caller keeps oxc). Spans are
/// relative to the script body (same as oxc `analyze_script` today).
pub fn collect_forbidden_factories_via_oak(
    kind: ScriptKind,
    source: &str,
) -> Option<Vec<ForbiddenFactory>> {
    if kind != ScriptKind::Client {
        return Some(Vec::new());
    }
    let shell = ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    };
    let parsed = parse_script_ast(&shell);
    let root = parsed.root.as_ref()?;
    let mut out = Vec::new();
    for stmt in &root.statements {
        walk_stmt_forbidden(stmt, &mut out);
    }
    Some(out)
}

fn walk_stmt_forbidden(stmt: &Statement, out: &mut Vec<ForbiddenFactory>) {
    match stmt {
        Statement::ClassDeclaration(class) => walk_class_forbidden(class, out),
        Statement::ExportDeclaration(exp) => {
            if let Some(inner) = exp.declaration.as_deref() {
                walk_stmt_forbidden(inner, out);
            }
        }
        Statement::ExpressionStatement(es) => walk_expr_forbidden(&es.expression, out),
        Statement::VariableDeclaration(v) => {
            if let Some(init) = &v.value {
                walk_expr_forbidden(init, out);
            }
        }
        Statement::FunctionDeclaration(f) => {
            for s in &f.body {
                walk_stmt_forbidden(s, out);
            }
        }
        Statement::ReturnStatement(r) => {
            if let Some(e) = &r.argument {
                walk_expr_forbidden(e, out);
            }
        }
        Statement::IfStatement(i) => {
            walk_expr_forbidden(&i.test, out);
            walk_stmt_forbidden(&i.consequent, out);
            if let Some(alt) = &i.alternate {
                walk_stmt_forbidden(alt, out);
            }
        }
        Statement::BlockStatement(b) => {
            for s in &b.statements {
                walk_stmt_forbidden(s, out);
            }
        }
        _ => {}
    }
}

fn walk_class_forbidden(class: &ClassDeclaration, out: &mut Vec<ForbiddenFactory>) {
    for member in &class.body {
        match member {
            ClassMember::Property { initializer, .. } => {
                if let Some(init) = initializer {
                    walk_expr_forbidden(init, out);
                }
            }
            ClassMember::Method { body, .. } => {
                for s in body {
                    walk_stmt_forbidden(s, out);
                }
            }
        }
    }
}

fn walk_expr_forbidden(expr: &Expression, out: &mut Vec<ForbiddenFactory>) {
    match expr.kind.as_ref() {
        ExpressionKind::CallExpression { func, args } => {
            if let Some(name) = oak_callee_factory_name(func) {
                if is_forbidden_factory(&name) {
                    out.push(ForbiddenFactory {
                        name,
                        span: Span::new(expr.span.start as u32, expr.span.end as u32),
                    });
                }
            }
            walk_expr_forbidden(func, out);
            for a in args {
                walk_expr_forbidden(a, out);
            }
        }
        ExpressionKind::NewExpression { func, args } => {
            walk_expr_forbidden(func, out);
            for a in args {
                walk_expr_forbidden(a, out);
            }
        }
        ExpressionKind::MemberExpression { object, property, .. } => {
            walk_expr_forbidden(object, out);
            walk_expr_forbidden(property, out);
        }
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::AssignmentExpression { left, right, .. } => {
            walk_expr_forbidden(left, out);
            walk_expr_forbidden(right, out);
        }
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::UpdateExpression { argument, .. }
        | ExpressionKind::AsExpression { expression: argument, .. } => {
            walk_expr_forbidden(argument, out);
        }
        ExpressionKind::AwaitExpression(inner) | ExpressionKind::SpreadElement(inner) => {
            walk_expr_forbidden(inner, out);
        }
        ExpressionKind::YieldExpression(Some(inner)) => walk_expr_forbidden(inner, out),
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            walk_expr_forbidden(test, out);
            walk_expr_forbidden(consequent, out);
            walk_expr_forbidden(alternate, out);
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for e in elements {
                walk_expr_forbidden(e, out);
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for p in properties {
                if let oak_typescript::ast::ObjectProperty::Property { value, .. } = p {
                    walk_expr_forbidden(value, out);
                }
            }
        }
        ExpressionKind::ArrowFunction { body, .. } => walk_stmt_forbidden(body, out),
        ExpressionKind::FunctionExpression { body, .. } => {
            for s in body {
                walk_stmt_forbidden(s, out);
            }
        }
        _ => {}
    }
}

fn oak_callee_factory_name(expr: &Expression) -> Option<String> {
    match expr.kind.as_ref() {
        ExpressionKind::Identifier(name) => Some(name.clone()),
        ExpressionKind::MemberExpression { property, computed: false, .. } => {
            match property.kind.as_ref() {
                ExpressionKind::Identifier(name) => Some(name.clone()),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Collect static `import` declarations from Oak TypeScript AST (phase D1).
///
/// Spans are relative to `source` (script body). Caller adds `content_start` for `.vmz` abs.
/// Returns empty when Oak cannot build a root (caller may leave imports empty).
pub fn collect_static_imports_via_oak(kind: ScriptKind, source: &str) -> Vec<NyarImportDecl> {
    let shell = ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: match kind {
            ScriptKind::Client => ScriptRole::Client,
            ScriptKind::Server => ScriptRole::Server,
        },
    };
    let parsed = parse_script_ast(&shell);
    let Some(root) = parsed.root.as_ref() else {
        return Vec::new();
    };
    imports_from_root(root, source)
}

/// Oak-primary static imports with oxc fallback when Oak yields empty module specifiers.
///
/// Prefer Oak after oaks `#a5ac2719` structured import / `export … from`. Oxc remains a
/// safety net if Oak parse/build fails for a given script body.
pub fn collect_static_imports(kind: ScriptKind, source: &str) -> Vec<NyarImportDecl> {
    let oak = collect_static_imports_via_oak(kind, source);
    if oak.iter().any(|imp| !imp.module_specifier.is_empty()) {
        return oak;
    }
    collect_static_imports_via_oxc(source)
}

fn collect_static_imports_via_oxc(source: &str) -> Vec<NyarImportDecl> {
    use oxc_allocator::Allocator;
    use oxc_ast::ast::{ImportDeclarationSpecifier, ModuleExportName};
    use oxc_ast_visit::{Visit, walk};
    use oxc_parser::Parser;
    use oxc_span::SourceType;

    struct ImportCollector {
        out: Vec<NyarImportDecl>,
    }

    impl<'a> Visit<'a> for ImportCollector {
        fn visit_import_declaration(&mut self, decl: &oxc_ast::ast::ImportDeclaration<'a>) {
            let module_specifier = decl.source.value.as_str().to_string();
            let decl_span = ByteSpan {
                start: decl.span.start as usize,
                end: decl.span.end as usize,
            };
            let specifier_span = ByteSpan {
                start: decl.source.span.start as usize,
                end: decl.source.span.end as usize,
            };
            let is_type_only = decl.import_kind.is_type();
            let mut specifiers = Vec::new();
            if let Some(specs) = &decl.specifiers {
                for spec in specs {
                    match spec {
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                            let local = s.local.name.as_str().to_string();
                            specifiers.push(NyarImportBinding {
                                local: local.clone(),
                                imported: None,
                                binding_kind: NyarBindingKind::Default,
                                name_span: ByteSpan {
                                    start: s.local.span.start as usize,
                                    end: s.local.span.end as usize,
                                },
                            });
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                            let local = s.local.name.as_str().to_string();
                            specifiers.push(NyarImportBinding {
                                local: local.clone(),
                                imported: None,
                                binding_kind: NyarBindingKind::Namespace,
                                name_span: ByteSpan {
                                    start: s.local.span.start as usize,
                                    end: s.local.span.end as usize,
                                },
                            });
                        }
                        ImportDeclarationSpecifier::ImportSpecifier(s) => {
                            let local = s.local.name.as_str().to_string();
                            let imported = match &s.imported {
                                ModuleExportName::IdentifierName(id) => id.name.as_str().to_string(),
                                ModuleExportName::IdentifierReference(id) => {
                                    id.name.as_str().to_string()
                                }
                                ModuleExportName::StringLiteral(lit) => lit.value.as_str().to_string(),
                            };
                            specifiers.push(NyarImportBinding {
                                local: local.clone(),
                                imported: Some(imported),
                                binding_kind: NyarBindingKind::Named,
                                name_span: ByteSpan {
                                    start: s.local.span.start as usize,
                                    end: s.local.span.end as usize,
                                },
                            });
                        }
                    }
                }
            }
            self.out.push(NyarImportDecl {
                kind: NyarImportKind::Static,
                module_specifier,
                specifiers,
                is_type_only,
                decl_span,
                specifier_span,
            });
            walk::walk_import_declaration(self, decl);
        }

        fn visit_export_from_declaration(
            &mut self,
            decl: &oxc_ast::ast::ExportFromDeclaration<'a>,
        ) {
            let module_specifier = decl.source.value.as_str().to_string();
            let decl_span = ByteSpan {
                start: decl.span.start as usize,
                end: decl.span.end as usize,
            };
            let specifier_span = ByteSpan {
                start: decl.source.span.start as usize,
                end: decl.source.span.end as usize,
            };
            let mut specifiers = Vec::new();
            for spec in &decl.specifiers {
                let imported = match &spec.local {
                    ModuleExportName::IdentifierName(id) => id.name.as_str().to_string(),
                    ModuleExportName::IdentifierReference(id) => id.name.as_str().to_string(),
                    ModuleExportName::StringLiteral(lit) => lit.value.as_str().to_string(),
                };
                let local = match &spec.exported {
                    ModuleExportName::IdentifierName(id) => id.name.as_str().to_string(),
                    ModuleExportName::IdentifierReference(id) => id.name.as_str().to_string(),
                    ModuleExportName::StringLiteral(lit) => lit.value.as_str().to_string(),
                };
                specifiers.push(NyarImportBinding {
                    local: local.clone(),
                    imported: Some(imported),
                    binding_kind: NyarBindingKind::Named,
                    name_span: ByteSpan {
                        start: spec.span.start as usize,
                        end: spec.span.end as usize,
                    },
                });
            }
            self.out.push(NyarImportDecl {
                kind: NyarImportKind::ExportFrom,
                module_specifier,
                specifiers,
                is_type_only: decl.export_kind.is_type(),
                decl_span,
                specifier_span,
            });
            walk::walk_export_from_declaration(self, decl);
        }

        fn visit_export_all_declaration(&mut self, decl: &oxc_ast::ast::ExportAllDeclaration<'a>) {
            let module_specifier = decl.source.value.as_str().to_string();
            let decl_span = ByteSpan {
                start: decl.span.start as usize,
                end: decl.span.end as usize,
            };
            let specifier_span = ByteSpan {
                start: decl.source.span.start as usize,
                end: decl.source.span.end as usize,
            };
            self.out.push(NyarImportDecl {
                kind: NyarImportKind::ExportFrom,
                module_specifier,
                specifiers: Vec::new(),
                is_type_only: decl.export_kind.is_type(),
                decl_span,
                specifier_span,
            });
            walk::walk_export_all_declaration(self, decl);
        }
    }

    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, source, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() && ret.program.body.is_empty() {
        return Vec::new();
    }
    let mut v = ImportCollector { out: Vec::new() };
    v.visit_program(&ret.program);
    v.out
}

fn imports_from_root(root: &TypeScriptRoot, source: &str) -> Vec<NyarImportDecl> {
    let mut out = Vec::new();
    for stmt in &root.statements {
        match stmt {
            Statement::ImportDeclaration(decl) => {
                if decl.module_specifier.is_empty() {
                    continue;
                }
                out.push(nyar_from_oak_import(decl, source));
            }
            Statement::ExportDeclaration(exp) => {
                let Some(module_specifier) = exp.source.as_ref().filter(|s| !s.is_empty()) else {
                    continue;
                };
                let decl_span = ByteSpan { start: exp.span.start, end: exp.span.end };
                let specifier_span =
                    specifier_span_in(source, exp.span.start, exp.span.end, module_specifier)
                        .unwrap_or(decl_span);
                let mut specifiers = Vec::new();
                for spec in &exp.specifiers {
                    if !is_simple_ident(&spec.local) {
                        continue;
                    }
                    let local_name = if spec.exported.is_empty() {
                        spec.local.clone()
                    } else {
                        spec.exported.clone()
                    };
                    specifiers.push(NyarImportBinding {
                        local: local_name,
                        imported: Some(spec.local.clone()),
                        binding_kind: NyarBindingKind::Named,
                        name_span: name_byte_span(
                            source,
                            exp.span.start,
                            exp.span.end,
                            &spec.local,
                        )
                        .unwrap_or(decl_span),
                    });
                }
                out.push(NyarImportDecl {
                    kind: NyarImportKind::ExportFrom,
                    module_specifier: module_specifier.clone(),
                    specifiers,
                    is_type_only: exp.is_type_only,
                    decl_span,
                    specifier_span,
                });
            }
            _ => {}
        }
    }
    out
}

fn nyar_from_oak_import(
    decl: &oak_typescript::ast::ImportDeclaration,
    source: &str,
) -> NyarImportDecl {
    let decl_span = ByteSpan { start: decl.span.start, end: decl.span.end };
    let specifier_span =
        specifier_span_in(source, decl.span.start, decl.span.end, &decl.module_specifier)
            .unwrap_or(decl_span);
    let mut specifiers = Vec::new();
    for spec in &decl.specifiers {
        match spec {
            ImportSpecifier::Default(local) => {
                if !is_simple_ident(local) {
                    continue;
                }
                specifiers.push(NyarImportBinding {
                    local: local.clone(),
                    imported: None,
                    binding_kind: NyarBindingKind::Default,
                    name_span: name_byte_span(source, decl.span.start, decl.span.end, local)
                        .unwrap_or(decl_span),
                });
            }
            ImportSpecifier::Namespace(local) => {
                if !is_simple_ident(local) {
                    continue;
                }
                specifiers.push(NyarImportBinding {
                    local: local.clone(),
                    imported: None,
                    binding_kind: NyarBindingKind::Namespace,
                    name_span: name_byte_span(source, decl.span.start, decl.span.end, local)
                        .unwrap_or(decl_span),
                });
            }
            ImportSpecifier::Named { local, imported } => {
                if !is_simple_ident(local) {
                    continue;
                }
                specifiers.push(NyarImportBinding {
                    local: local.clone(),
                    imported: Some(imported.clone()),
                    binding_kind: NyarBindingKind::Named,
                    name_span: name_byte_span(source, decl.span.start, decl.span.end, local)
                        .unwrap_or(decl_span),
                });
            }
        }
    }
    NyarImportDecl {
        kind: NyarImportKind::Static,
        module_specifier: decl.module_specifier.clone(),
        specifiers,
        is_type_only: decl.is_type_only,
        decl_span,
        specifier_span,
    }
}

fn is_simple_ident(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_' || first == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
}

fn specifier_span_in(source: &str, start: usize, end: usize, spec: &str) -> Option<ByteSpan> {
    let end = end.min(source.len());
    let start = start.min(end);
    let slice = &source[start..end];
    let quoted = format!("'{spec}'");
    let dquoted = format!("\"{spec}\"");
    let rel = slice.find(&quoted).or_else(|| slice.find(&dquoted))?;
    let lit_len = if slice[rel..].starts_with('\'') { quoted.len() } else { dquoted.len() };
    Some(ByteSpan { start: start + rel, end: start + rel + lit_len })
}

fn name_byte_span(source: &str, start: usize, end: usize, name: &str) -> Option<ByteSpan> {
    let end = end.min(source.len());
    let start = start.min(end);
    let slice = &source[start..end];
    let rel = slice.find(name)?;
    Some(ByteSpan { start: start + rel, end: start + rel + name.len() })
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
