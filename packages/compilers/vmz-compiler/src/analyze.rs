//! Analyze `<script client|server>` with oxc: default export class ?fields + methods.

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, Class, ClassElement, ExportDefaultDeclarationKind, Expression, PropertyKey,
    Statement, TSAccessibility,
};
use oxc::ast_visit::Visit;
use oxc::parser::Parser;
use oxc::span::{GetSpan, SourceType, Span};

use vmz_types::{
    ComponentDecl, FieldDecl, FieldKind, HttpRoute, InternalClassDecl, MethodDecl, Visibility,
};

use crate::field_rw::{FieldRw, ForbiddenFactory};
use crate::sfc::ScriptKind;

#[derive(Debug, Clone)]
pub struct AnalyzedScript {
    pub kind: ScriptKind,
    pub decl: ComponentDecl,
    pub parse_errors: Vec<String>,
    /// `useX` / `createX` calls found in this script (oxc).
    pub forbidden_factories: Vec<ForbiddenFactory>,
}

pub fn analyze_script(kind: ScriptKind, source: &str) -> AnalyzedScript {
    let allocator = Allocator::default();
    let source_type = SourceType::ts();
    let ret = Parser::new(&allocator, source, source_type).parse();

    let parse_errors: Vec<String> = ret.diagnostics.iter().map(|e| e.to_string()).collect();

    let mut decl = ComponentDecl::new("Anonymous", Span::default());
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
                if let oxc::ast::ast::Declaration::ClassDeclaration(class) = &export.declaration {
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
        internal.push(InternalClassDecl { name: id.name.to_string(), span: class.span });
    }
}

fn class_to_decl(class: &Class<'_>, source: &str) -> (ComponentDecl, Vec<ForbiddenFactory>) {
    let name =
        class.id.as_ref().map(|id| id.name.to_string()).unwrap_or_else(|| "Default".to_string());
    let mut decl = ComponentDecl::new(name, class.span);
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
                let Some(name) = prop_key_name(&prop.key) else {
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

                let field =
                    FieldDecl { name, type_text, init_text, kind, visibility, span: prop.span };

                match kind {
                    FieldKind::Prop => decl.props.push(field),
                    FieldKind::State => decl.fields.push(field),
                }
            }
            ClassElement::MethodDefinition(method) => {
                let Some(name) = prop_key_name(&method.key) else {
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
                });
            }
            _ => {}
        }
    }

    // Keep only callees that are known methods on this class (call graph, not DOM/helpers).
    // Unresolved `this.foo()` (not a method) → opaque, never silently empty.
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
    // Compose callee reads/writes into callers (transitive; opaque ?field.* widen).
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
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::PrivateIdentifier(id) => Some(format!("#{}", id.name)),
        PropertyKey::Identifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(lit) => Some(lit.value.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_is_prop() {
        let src = r#"
export default class Card {
  public title: string;
  count = 0;
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        assert_eq!(analyzed.decl.name, "Card");
        assert_eq!(analyzed.decl.props.len(), 1);
        assert_eq!(analyzed.decl.props[0].name, "title");
        assert_eq!(analyzed.decl.fields.len(), 1);
        assert_eq!(analyzed.decl.fields[0].name, "count");
        assert_eq!(analyzed.decl.fields[0].init_text.as_deref(), Some("0"));
    }

    #[test]
    fn captures_prop_default_init() {
        let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        assert_eq!(analyzed.decl.props[0].init_text.as_deref(), Some("0"));
        assert_eq!(analyzed.decl.fields[0].init_text.as_deref(), Some("this.initial"));
    }

    #[test]
    fn collects_server_methods() {
        let src = r#"
export default class UserCardServer {
  #users = null;
  async fetchUser() { return null; }
  async getMe() { return this.fetchUser(); }
}
"#;
        let analyzed = analyze_script(ScriptKind::Server, src);
        let names: Vec<_> = analyzed.decl.methods.iter().map(|m| m.name.as_str()).collect();
        assert!(names.contains(&"fetchUser"));
        assert!(names.contains(&"getMe"));
        assert!(analyzed.decl.methods.iter().any(|m| m.name == "fetchUser" && m.is_async));
    }

    #[test]
    fn tracks_method_field_writes() {
        let src = r#"
export default class UserCard {
  user = null;
  tags = [];
  async onMount() {
    this.user = await fetchUser();
    this.tags = ['a'];
  }
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        let m = analyzed.decl.methods.iter().find(|m| m.name == "onMount").expect("onMount");
        assert!(m.writes.iter().any(|w| w == "user"), "{:?}", m.writes);
        assert!(m.writes.iter().any(|w| w == "tags"), "{:?}", m.writes);
    }

    #[test]
    fn tracks_alias_and_destructure_paths_in_methods() {
        let src = r#"
export default class UserCard {
  user = { name: '', bio: '', profile: { name: '' } };
  rename() {
    const u = this.user;
    u.name = 'Ada';
    const profile = this.user.profile;
    const { name } = profile;
    return name;
  }
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        let m = analyzed.decl.methods.iter().find(|m| m.name == "rename").expect("rename");
        assert!(m.writes.iter().any(|w| w == "user.name"), "writes={:?}", m.writes);
        assert!(m.reads.iter().any(|r| r == "user.profile.name"), "reads={:?}", m.reads);
    }

    #[test]
    fn tracks_sibling_method_calls() {
        let src = r#"
export default class Card {
  user = { name: '' };
  onClick() {
    this.refresh();
    this.#load();
  }
  refresh() {
    this.user.name = 'x';
  }
  #load() {
    return this.user;
  }
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        let m = analyzed.decl.methods.iter().find(|m| m.name == "onClick").expect("onClick");
        assert_eq!(m.calls, vec!["refresh".to_string(), "#load".to_string()]);
        assert!(
            m.writes.iter().any(|w| w == "user.name"),
            "composed writes from refresh: {:?}",
            m.writes
        );
        assert!(m.reads.iter().any(|r| r == "user"), "composed reads from #load: {:?}", m.reads);
        let refresh = analyzed.decl.methods.iter().find(|m| m.name == "refresh").expect("refresh");
        assert!(refresh.calls.is_empty());
        assert!(refresh.writes.iter().any(|w| w == "user.name"), "{:?}", refresh.writes);
    }

    #[test]
    fn opaque_dynamic_callee_widens_field_stars() {
        let src = r#"
export default class Card {
  user = { name: '' };
  count = 0;
  run(name) {
    this[name]();
  }
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        let m = analyzed.decl.methods.iter().find(|m| m.name == "run").expect("run");
        assert!(m.opaque_callee, "dynamic this[name]() must be opaque");
        assert!(m.reads.iter().any(|r| r == "user.*"), "reads={:?}", m.reads);
        assert!(m.writes.iter().any(|w| w == "count.*"), "writes={:?}", m.writes);
    }

    #[test]
    fn unresolved_this_method_is_opaque_not_silent() {
        let src = r#"
export default class Card {
  user = { name: '' };
  onClick() {
    this.maybeHelper();
  }
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        let m = analyzed.decl.methods.iter().find(|m| m.name == "onClick").expect("onClick");
        assert!(m.calls.is_empty(), "unknown callee must not stay as edge");
        assert!(m.opaque_callee, "unresolved this.maybeHelper() must widen");
        assert!(m.writes.iter().any(|w| w == "user.*"), "writes={:?}", m.writes);
    }

    #[test]
    fn rejects_use_factory() {
        let src = r#"
export default class Bad {
  count = useCounter(0);
}
"#;
        let analyzed = analyze_script(ScriptKind::Client, src);
        assert!(
            analyzed.forbidden_factories.iter().any(|f| f.name == "useCounter"),
            "{:?}",
            analyzed.forbidden_factories
        );
    }

    #[test]
    fn collects_http_decorators() {
        let src = r#"
import { Get } from "vmz:http";
export default class UserCardServer {
  @Get("/api/users/me")
  async getMe() { return null; }
}
"#;
        let analyzed = analyze_script(ScriptKind::Server, src);
        let me = analyzed.decl.methods.iter().find(|m| m.name == "getMe").expect("getMe");
        let http = me.http.as_ref().expect("http route");
        assert_eq!(http.verb, "GET");
        assert_eq!(http.path, "/api/users/me");
    }
}
