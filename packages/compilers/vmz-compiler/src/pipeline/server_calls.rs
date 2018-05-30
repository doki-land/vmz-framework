//! Discover client ?`#server` class method calls with enclosing client method names.
//!
//! Server view call edges (provenance).

use oxc_allocator::Allocator;
use oxc_ast::ast::{ClassElement, Expression, PropertyKey};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::SourceType;
use vmz_types::ClientServerCall;

/// Walk client script; return `(server_method, from_client_method)` for `ClassName.method(...)`.
pub fn collect_server_class_calls(source: &str, class_name: &str) -> Vec<ClientServerCall> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, source, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() && ret.program.body.is_empty() {
        return Vec::new();
    }
    let mut v = ServerCallVisitor {
        class_name: class_name.to_string(),
        current_method: None,
        calls: Vec::new(),
    };
    v.visit_program(&ret.program);
    v.calls
}

struct ServerCallVisitor {
    class_name: String,
    current_method: Option<String>,
    calls: Vec<ClientServerCall>,
}

impl ServerCallVisitor {
    fn note_call(&mut self, server_method: &str) {
        let from = self.current_method.clone();
        if self
            .calls
            .iter()
            .any(|c| c.server_method == server_method && c.from_client_method == from)
        {
            return;
        }
        self.calls.push(ClientServerCall {
            server_method: server_method.to_string(),
            from_client_method: from,
        });
    }
}

impl<'a> Visit<'a> for ServerCallVisitor {
    fn visit_class_element(&mut self, el: &ClassElement<'a>) {
        if let ClassElement::MethodDefinition(method) = el {
            let name = prop_key_name(&method.key);
            let prev = self.current_method.take();
            self.current_method = name;
            walk::walk_class_element(self, el);
            self.current_method = prev;
            return;
        }
        walk::walk_class_element(self, el);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        if let Some(method) = static_member_on_ident(&call.callee, &self.class_name) {
            self.note_call(&method);
        }
        walk::walk_call_expression(self, call);
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

fn static_member_on_ident(expr: &Expression<'_>, object_name: &str) -> Option<String> {
    let mut cur = expr;
    while let Expression::ParenthesizedExpression(p) = cur {
        cur = &p.expression;
    }
    match cur {
        Expression::StaticMemberExpression(mem) => match &mem.object {
            Expression::Identifier(id) if id.name.as_str() == object_name => {
                Some(mem.property.name.to_string())
            }
            _ => None,
        },
        _ => None,
    }
}
