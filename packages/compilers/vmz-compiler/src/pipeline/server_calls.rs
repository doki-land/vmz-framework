//! Discover client ?`#server` class method calls with enclosing client method names.
//!
//! Server view call edges (provenance).

use oak_typescript::ast::{ClassMember, Expression, ExpressionKind, ObjectProperty, Statement};
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};
use vmz_types::ClientServerCall;

/// Walk client script; return `(server_method, from_client_method)` for `ClassName.method(...)`.
pub fn collect_server_class_calls(source: &str, class_name: &str) -> Vec<ClientServerCall> {
    let parsed = parse_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    });
    let Some(root) = parsed.root else {
        return Vec::new();
    };
    let mut visitor = ServerCallVisitor {
        class_name: class_name.to_string(),
        current_method: None,
        calls: Vec::new(),
    };
    visitor.visit_statements(&root.statements);
    visitor.calls
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

impl ServerCallVisitor {
    fn visit_statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.visit_statement(statement);
        }
    }

    fn visit_statement(&mut self, statement: &Statement) {
        match statement {
            Statement::ClassDeclaration(class) => {
                for decorator in &class.decorators {
                    self.visit_expression(&decorator.expression);
                }
                for member in &class.body {
                    match member {
                        ClassMember::Property { decorators, initializer, .. } => {
                            for decorator in decorators {
                                self.visit_expression(&decorator.expression);
                            }
                            if let Some(initializer) = initializer {
                                self.visit_expression(initializer);
                            }
                        }
                        ClassMember::Method { decorators, name, body, .. } => {
                            let previous = self.current_method.replace(name.clone());
                            for decorator in decorators {
                                self.visit_expression(&decorator.expression);
                            }
                            self.visit_statements(body);
                            self.current_method = previous;
                        }
                    }
                }
            }
            Statement::ExportDeclaration(export) => {
                if let Some(declaration) = &export.declaration {
                    self.visit_statement(declaration);
                }
            }
            Statement::ExpressionStatement(statement) => {
                self.visit_expression(&statement.expression)
            }
            Statement::VariableDeclaration(declaration) => {
                if let Some(value) = &declaration.value {
                    self.visit_expression(value);
                }
            }
            Statement::FunctionDeclaration(function) => self.visit_statements(&function.body),
            Statement::ReturnStatement(statement) => {
                if let Some(argument) = &statement.argument {
                    self.visit_expression(argument);
                }
            }
            Statement::ThrowStatement(statement) => self.visit_expression(&statement.argument),
            Statement::IfStatement(statement) => {
                self.visit_expression(&statement.test);
                self.visit_statement(&statement.consequent);
                if let Some(alternate) = &statement.alternate {
                    self.visit_statement(alternate);
                }
            }
            Statement::BlockStatement(block) => self.visit_statements(&block.statements),
            Statement::WhileStatement(statement) => {
                self.visit_expression(&statement.test);
                self.visit_statement(&statement.body);
            }
            Statement::DoWhileStatement(statement) => {
                self.visit_statement(&statement.body);
                self.visit_expression(&statement.test);
            }
            Statement::ForStatement(statement) => {
                if let Some(initializer) = &statement.initializer {
                    self.visit_statement(initializer);
                }
                if let Some(test) = &statement.test {
                    self.visit_expression(test);
                }
                if let Some(incrementor) = &statement.incrementor {
                    self.visit_expression(incrementor);
                }
                self.visit_statement(&statement.body);
            }
            Statement::ForInStatement(statement) => {
                self.visit_statement(&statement.left);
                self.visit_expression(&statement.right);
                self.visit_statement(&statement.body);
            }
            Statement::ForOfStatement(statement) => {
                self.visit_statement(&statement.left);
                self.visit_expression(&statement.right);
                self.visit_statement(&statement.body);
            }
            Statement::SwitchStatement(statement) => {
                self.visit_expression(&statement.discriminant);
                for case in &statement.cases {
                    if let Some(test) = &case.test {
                        self.visit_expression(test);
                    }
                    self.visit_statements(&case.consequent);
                }
            }
            Statement::TryStatement(statement) => {
                self.visit_statements(&statement.block);
                if let Some(handler) = &statement.handler {
                    self.visit_statements(&handler.body);
                }
                if let Some(finalizer) = &statement.finalizer {
                    self.visit_statements(finalizer);
                }
            }
            Statement::Namespace(namespace) => self.visit_statements(&namespace.body),
            Statement::Enum(declaration) => {
                for member in &declaration.members {
                    if let Some(initializer) = &member.initializer {
                        self.visit_expression(initializer);
                    }
                }
            }
            Statement::ImportDeclaration(_)
            | Statement::Interface(_)
            | Statement::TypeAlias(_)
            | Statement::BreakStatement(_)
            | Statement::ContinueStatement(_) => {}
        }
    }

    fn visit_expression(&mut self, expression: &Expression) {
        match expression.kind.as_ref() {
            ExpressionKind::CallExpression { func, args } => {
                if let Some(method) = static_member_on_ident(func, &self.class_name) {
                    self.note_call(&method);
                }
                self.visit_expression(func);
                for argument in args {
                    self.visit_expression(argument);
                }
            }
            ExpressionKind::NewExpression { func, args } => {
                self.visit_expression(func);
                for argument in args {
                    self.visit_expression(argument);
                }
            }
            ExpressionKind::MemberExpression { object, property, .. } => {
                self.visit_expression(object);
                self.visit_expression(property);
            }
            ExpressionKind::BinaryExpression { left, right, .. }
            | ExpressionKind::AssignmentExpression { left, right, .. } => {
                self.visit_expression(left);
                self.visit_expression(right);
            }
            ExpressionKind::UnaryExpression { argument, .. }
            | ExpressionKind::UpdateExpression { argument, .. }
            | ExpressionKind::AsExpression { expression: argument, .. }
            | ExpressionKind::TypeAssertionExpression { expression: argument, .. }
            | ExpressionKind::NonNullExpression(argument)
            | ExpressionKind::SpreadElement(argument)
            | ExpressionKind::AwaitExpression(argument) => self.visit_expression(argument),
            ExpressionKind::YieldExpression(Some(argument)) => self.visit_expression(argument),
            ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
                self.visit_expression(test);
                self.visit_expression(consequent);
                self.visit_expression(alternate);
            }
            ExpressionKind::ArrayLiteral { elements } => {
                for element in elements {
                    self.visit_expression(element);
                }
            }
            ExpressionKind::ObjectLiteral { properties } => {
                for property in properties {
                    match property {
                        ObjectProperty::Property { value, .. } | ObjectProperty::Spread(value) => {
                            self.visit_expression(value);
                        }
                    }
                }
            }
            ExpressionKind::ArrowFunction { body, .. } => self.visit_statement(body),
            ExpressionKind::FunctionExpression { body, .. } => self.visit_statements(body),
            ExpressionKind::ImportExpression { module_specifier } => {
                self.visit_expression(module_specifier);
            }
            ExpressionKind::TaggedTemplateExpression { tag, template } => {
                self.visit_expression(tag);
                self.visit_expression(template);
            }
            _ => {}
        }
    }
}

fn static_member_on_ident(expression: &Expression, object_name: &str) -> Option<String> {
    let ExpressionKind::MemberExpression { object, property, computed: false, .. } =
        expression.kind.as_ref()
    else {
        return None;
    };
    match (object.kind.as_ref(), property.kind.as_ref()) {
        (ExpressionKind::Identifier(object), ExpressionKind::Identifier(method))
            if object == object_name =>
        {
            Some(method.clone())
        }
        _ => None,
    }
}
