//! Collect `SecretRequirement` facts from `<script server>` and detect client leaks.
//!
//! Design: `01` Mock/Secret · `03` SecretRequirement · `04` diagnostics.
//! Values are never collected — only binding names and provenance spans.

use std::collections::BTreeSet;
use std::ops::Range;

use oak_typescript::TypeScriptRoot;
use oak_typescript::ast::{
    ClassMember, Expression, ExpressionKind, ImportSpecifier, ObjectProperty, Statement,
};
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};
use vmz_types::SecretRequirement;

/// One hard client-domain secret / mock-provider finding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientBoundaryFinding {
    /// Stable diagnostic code (`vmz::server::…`).
    pub code: &'static str,
    /// Human message (never includes secret values).
    pub message: String,
    /// Source span of the violation for diagnostics.
    pub span: Range<u32>,
}

/// Walk server script for `secret('BINDING')` (optionally imported from `#server/secrets`).
pub fn collect_secret_requirements(source: &str) -> Vec<SecretRequirement> {
    let Some(root) = parse_root(source) else {
        return Vec::new();
    };
    let mut visitor = SecretVisitor {
        source: source.to_string(),
        secret_locals: BTreeSet::new(),
        imported_secrets_module: false,
        requirements: Vec::new(),
        current_method: None,
    };
    visitor.visit_statements(&root.statements);
    visitor.requirements
}

/// Detect client script violations: `#server/secrets` / `secret(` / explicit mock provider APIs.
pub fn collect_client_boundary_findings(source: &str) -> Vec<ClientBoundaryFinding> {
    let Some(root) = parse_root(source) else {
        return Vec::new();
    };
    let mut visitor = ClientBoundaryVisitor {
        source: source.to_string(),
        findings: Vec::new(),
        secret_locals: BTreeSet::new(),
    };
    visitor.visit_statements(&root.statements);
    visitor.findings
}

fn parse_root(source: &str) -> Option<TypeScriptRoot> {
    let parsed = parse_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    });
    let root = parsed.root?;
    if !parsed.diagnostics.is_empty() && root.statements.is_empty() {
        return None;
    }
    Some(root)
}

fn is_secrets_module(source: &str) -> bool {
    source == "#server/secrets" || source.starts_with("#server/secrets/")
}

fn span(range: &oak_core::Range<usize>) -> Range<u32> {
    range.start as u32..range.end as u32
}

fn source_span(range: &oak_core::Range<usize>, source: &str) -> Range<u32> {
    let mut end = range.end;
    while end > range.start && source.as_bytes().get(end - 1).is_some_and(u8::is_ascii_whitespace) {
        end -= 1;
    }
    range.start as u32..end as u32
}

struct SecretVisitor {
    source: String,
    secret_locals: BTreeSet<String>,
    imported_secrets_module: bool,
    requirements: Vec<SecretRequirement>,
    current_method: Option<String>,
}

impl SecretVisitor {
    fn note_binding(&mut self, name: &str) {
        if self.requirements.iter().any(|requirement| requirement.binding_name == name) {
            return;
        }
        self.requirements.push(SecretRequirement {
            binding_name: name.to_string(),
            owner_capability: self.current_method.clone(),
            module_id: None,
        });
    }

    fn visit_statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.visit_statement(statement);
        }
    }

    fn visit_statement(&mut self, statement: &Statement) {
        match statement {
            Statement::ImportDeclaration(declaration) => self.visit_import(declaration),
            Statement::ExportDeclaration(declaration) => {
                if let Some(inner) = &declaration.declaration {
                    self.visit_statement(inner);
                }
            }
            Statement::ClassDeclaration(class) => {
                for decorator in &class.decorators {
                    self.visit_expression(&decorator.expression);
                }
                for member in &class.body {
                    self.visit_class_member(member);
                }
            }
            Statement::ExpressionStatement(statement) => {
                self.visit_expression(&statement.expression)
            }
            Statement::VariableDeclaration(declaration) => {
                for decorator in &declaration.decorators {
                    self.visit_expression(&decorator.expression);
                }
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
            Statement::Interface(_)
            | Statement::TypeAlias(_)
            | Statement::BreakStatement(_)
            | Statement::ContinueStatement(_) => {}
        }
    }

    fn visit_import(&mut self, declaration: &oak_typescript::ast::ImportDeclaration) {
        if !is_secrets_module(&declaration.module_specifier) {
            return;
        }
        self.imported_secrets_module = true;
        for specifier in &declaration.specifiers {
            match specifier {
                ImportSpecifier::Named { local, imported } if imported == "secret" => {
                    self.secret_locals.insert(local.clone());
                }
                ImportSpecifier::Default(local) | ImportSpecifier::Namespace(local) => {
                    self.secret_locals.insert(local.clone());
                }
                ImportSpecifier::Named { .. } => {}
            }
        }
    }

    fn visit_class_member(&mut self, member: &ClassMember) {
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
                for decorator in decorators {
                    self.visit_expression(&decorator.expression);
                }
                let previous = self.current_method.replace(name.clone());
                self.visit_statements(body);
                self.current_method = previous;
            }
        }
    }

    fn visit_expression(&mut self, expression: &Expression) {
        if let ExpressionKind::CallExpression { func, args } = expression.kind.as_ref() {
            if is_secret_callee(func, &self.secret_locals, self.imported_secrets_module) {
                if let Some(name) = first_string_arg(args, &self.source, &expression.span) {
                    self.note_binding(&name);
                }
            }
        }
        walk_expression(expression, &mut |child| self.visit_expression(child));
    }
}

struct ClientBoundaryVisitor {
    source: String,
    findings: Vec<ClientBoundaryFinding>,
    secret_locals: BTreeSet<String>,
}

impl ClientBoundaryVisitor {
    fn push(&mut self, code: &'static str, message: impl Into<String>, source_span: Range<u32>) {
        let message = message.into();
        if self.findings.iter().any(|finding| finding.code == code && finding.message == message) {
            return;
        }
        self.findings.push(ClientBoundaryFinding { code, message, span: source_span });
    }

    fn visit_statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.visit_statement(statement);
        }
    }

    fn visit_statement(&mut self, statement: &Statement) {
        match statement {
            Statement::ImportDeclaration(declaration) => self.visit_import(declaration),
            Statement::ExportDeclaration(declaration) => {
                if let Some(inner) = &declaration.declaration {
                    self.visit_statement(inner);
                }
            }
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
                        ClassMember::Method { decorators, body, .. } => {
                            for decorator in decorators {
                                self.visit_expression(&decorator.expression);
                            }
                            self.visit_statements(body);
                        }
                    }
                }
            }
            Statement::ExpressionStatement(statement) => {
                self.visit_expression(&statement.expression)
            }
            Statement::VariableDeclaration(declaration) => {
                for decorator in &declaration.decorators {
                    self.visit_expression(&decorator.expression);
                }
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
            Statement::Interface(_)
            | Statement::TypeAlias(_)
            | Statement::BreakStatement(_)
            | Statement::ContinueStatement(_) => {}
        }
    }

    fn visit_import(&mut self, declaration: &oak_typescript::ast::ImportDeclaration) {
        let source = declaration.module_specifier.as_str();
        if is_secrets_module(source) {
            self.push(
                vmz_protocol::DIAG_SECRET_CLIENT_LEAK,
                "client must not import `#server/secrets` (SecretRequirement is server/build only)",
                source_span(&declaration.span, &self.source),
            );
            for specifier in &declaration.specifiers {
                if let ImportSpecifier::Named { local, imported } = specifier {
                    if imported == "secret" {
                        self.secret_locals.insert(local.clone());
                    }
                }
            }
        }
        if source.starts_with("#server/fixtures") || source.contains("/server/fixtures/") {
            self.push(
                vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN,
                format!("client must not import server-only fixture module `{source}`"),
                source_span(&declaration.span, &self.source),
            );
        }
    }

    fn visit_expression(&mut self, expression: &Expression) {
        if let ExpressionKind::CallExpression { func, .. } = expression.kind.as_ref() {
            if is_secret_callee(func, &self.secret_locals, !self.secret_locals.is_empty()) {
                self.push(
                    vmz_protocol::DIAG_SECRET_CLIENT_LEAK,
                    "client must not call `secret(...)` (SecretRequirement is server/build only)",
                    span(&expression.span),
                );
            }
            if let Some(name) = bare_callee_name(func, &self.source) {
                if name == "registerMockProvider" || name == "overrideCapability" {
                    self.push(
                        vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN,
                        format!(
                            "client must not call `{name}` (explicit mock/capability override)"
                        ),
                        span(&expression.span),
                    );
                }
            }
        }
        walk_expression(expression, &mut |child| self.visit_expression(child));
    }
}

fn walk_expression(expression: &Expression, visit: &mut impl FnMut(&Expression)) {
    match expression.kind.as_ref() {
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::UpdateExpression { argument, .. }
        | ExpressionKind::AsExpression { expression: argument, .. }
        | ExpressionKind::TypeAssertionExpression { expression: argument, .. }
        | ExpressionKind::NonNullExpression(argument)
        | ExpressionKind::SpreadElement(argument)
        | ExpressionKind::AwaitExpression(argument) => visit(argument),
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::AssignmentExpression { left, right, .. } => {
            visit(left);
            visit(right);
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            visit(test);
            visit(consequent);
            visit(alternate);
        }
        ExpressionKind::MemberExpression { object, property, .. } => {
            visit(object);
            visit(property);
        }
        ExpressionKind::CallExpression { func, args }
        | ExpressionKind::NewExpression { func, args } => {
            visit(func);
            for argument in args {
                visit(argument);
            }
        }
        ExpressionKind::ArrowFunction { body, .. } => walk_statement_expression(body, visit),
        ExpressionKind::ObjectLiteral { properties } => {
            for property in properties {
                match property {
                    ObjectProperty::Property { value, .. } | ObjectProperty::Spread(value) => {
                        visit(value)
                    }
                }
            }
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for element in elements {
                visit(element);
            }
        }
        ExpressionKind::YieldExpression(Some(argument)) => visit(argument),
        ExpressionKind::ImportExpression { module_specifier } => visit(module_specifier),
        ExpressionKind::FunctionExpression { body, .. } => {
            for statement in body {
                walk_statement_expression(statement, visit);
            }
        }
        ExpressionKind::TaggedTemplateExpression { tag, template } => {
            visit(tag);
            visit(template);
        }
        ExpressionKind::YieldExpression(None)
        | ExpressionKind::Identifier(_)
        | ExpressionKind::NumericLiteral(_)
        | ExpressionKind::StringLiteral(_)
        | ExpressionKind::BigIntLiteral(_)
        | ExpressionKind::BooleanLiteral(_)
        | ExpressionKind::NullLiteral
        | ExpressionKind::RegexLiteral(_)
        | ExpressionKind::TemplateString(_)
        | ExpressionKind::JsxElement(_)
        | ExpressionKind::JsxFragment(_)
        | ExpressionKind::JsxSelfClosingElement(_) => {}
    }
}

fn walk_statement_expression(statement: &Statement, visit: &mut impl FnMut(&Expression)) {
    match statement {
        Statement::ExpressionStatement(statement) => visit(&statement.expression),
        Statement::VariableDeclaration(statement) => {
            if let Some(value) = &statement.value {
                visit(value);
            }
        }
        Statement::ReturnStatement(statement) => {
            if let Some(argument) = &statement.argument {
                visit(argument);
            }
        }
        Statement::IfStatement(statement) => {
            visit(&statement.test);
            walk_statement_expression(&statement.consequent, visit);
            if let Some(alternate) = &statement.alternate {
                walk_statement_expression(alternate, visit);
            }
        }
        Statement::BlockStatement(block) => {
            for statement in &block.statements {
                walk_statement_expression(statement, visit);
            }
        }
        _ => {}
    }
}

fn is_secret_callee(
    expression: &Expression,
    secret_locals: &BTreeSet<String>,
    allow_bare_secret: bool,
) -> bool {
    match expression.kind.as_ref() {
        ExpressionKind::Identifier(name) => {
            secret_locals.contains(name) || (allow_bare_secret && name == "secret")
        }
        ExpressionKind::MemberExpression { object, property, computed: false, .. } => {
            matches!((object.kind.as_ref(), property.kind.as_ref()),
                (ExpressionKind::Identifier(object), ExpressionKind::Identifier(property))
                    if secret_locals.contains(object) && property == "secret")
        }
        _ => false,
    }
}

fn bare_callee_name(expression: &Expression, source: &str) -> Option<String> {
    match expression.kind.as_ref() {
        ExpressionKind::Identifier(name)
            if source.get(expression.span.start..expression.span.end).map(str::trim)
                == Some(name.as_str()) =>
        {
            let prefix = source[..expression.span.start].trim_end();
            if prefix.ends_with('.') || prefix.ends_with("?.") {
                return None;
            }
            Some(name.clone())
        }
        _ => None,
    }
}

fn first_string_arg(
    args: &[Expression],
    source: &str,
    call_span: &oak_core::Range<usize>,
) -> Option<String> {
    let raw = if let Some(expression) = args.first() {
        source.get(expression.span.start..expression.span.end)?.trim().to_string()
    } else {
        let call = source.get(call_span.start..call_span.end)?.trim();
        let open = call.find('(')?;
        call[open + 1..].strip_suffix(')')?.trim().to_string()
    };
    let raw = raw.as_str();
    let mut literal = raw;
    while literal.starts_with('(') && literal.ends_with(')') {
        literal = literal[1..literal.len() - 1].trim();
    }
    let bytes = literal.as_bytes();
    if bytes.len() >= 2 && bytes[0] == *bytes.last()? && matches!(bytes[0], b'\'' | b'"' | b'`') {
        if bytes[0] == b'`' && literal.contains("${") {
            return None;
        }
        return Some(decode_string_literal(&literal[1..literal.len() - 1]));
    }
    match args.first()?.kind.as_ref() {
        ExpressionKind::StringLiteral(value) => Some(value.clone()),
        ExpressionKind::TemplateString(value) if !value.contains("${") => Some(value.clone()),
        _ => None,
    }
}

fn decode_string_literal(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            decoded.push(ch);
            continue;
        }
        match chars.next() {
            Some('n') => decoded.push('\n'),
            Some('r') => decoded.push('\r'),
            Some('t') => decoded.push('\t'),
            Some('\\') => decoded.push('\\'),
            Some('\'') => decoded.push('\''),
            Some('"') => decoded.push('"'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(code) = u32::from_str_radix(&hex, 16) {
                    if let Some(decoded_char) = char::from_u32(code) {
                        decoded.push(decoded_char);
                    }
                }
            }
            Some(other) => decoded.push(other),
            None => decoded.push('\\'),
        }
    }
    decoded
}
