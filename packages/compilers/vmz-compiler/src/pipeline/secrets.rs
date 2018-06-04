//! Collect `SecretRequirement` facts from `<script server>` and detect client leaks.
//!
//! Design: `01` Mock/Secret · `03` SecretRequirement · `04` diagnostics.
//! Values are never collected — only binding names and provenance spans.

use oxc_allocator::Allocator;
use oxc_ast::ast::{Argument, Expression, ImportDeclarationSpecifier, ModuleExportName};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{SourceType, Span};
use vmz_types::SecretRequirement;

/// One hard client-domain secret / mock-provider finding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClientBoundaryFinding {
    /// Stable diagnostic code (`vmz::server::…`).
    pub code: &'static str,
    /// Human message (never includes secret values).
    pub message: String,
    /// Source span of the violation for diagnostics.
    pub span: Span,
}

/// Walk server script for `secret('BINDING')` (optionally imported from `#server/secrets`).
pub fn collect_secret_requirements(source: &str) -> Vec<SecretRequirement> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, source, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() && ret.program.body.is_empty() {
        return Vec::new();
    }
    let mut v = SecretVisitor {
        secret_locals: Default::default(),
        imported_secrets_module: false,
        requirements: Vec::new(),
        current_method: None,
    };
    v.visit_program(&ret.program);
    v.requirements
}

/// Detect client script violations: `#server/secrets` / `secret(` / explicit mock provider APIs.
pub fn collect_client_boundary_findings(source: &str) -> Vec<ClientBoundaryFinding> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, source, SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() && ret.program.body.is_empty() {
        return Vec::new();
    }
    let mut v = ClientBoundaryVisitor { findings: Vec::new(), secret_locals: Default::default() };
    v.visit_program(&ret.program);
    v.findings
}

struct SecretVisitor {
    /// Local names bound to `secret` from `#server/secrets`.
    secret_locals: std::collections::BTreeSet<String>,
    imported_secrets_module: bool,
    requirements: Vec<SecretRequirement>,
    current_method: Option<String>,
}

impl SecretVisitor {
    fn note_binding(&mut self, name: &str) {
        if self.requirements.iter().any(|r| r.binding_name == name) {
            return;
        }
        self.requirements.push(SecretRequirement {
            binding_name: name.to_string(),
            owner_capability: self.current_method.clone(),
            module_id: None,
        });
    }
}

impl<'a> Visit<'a> for SecretVisitor {
    fn visit_import_declaration(&mut self, decl: &oxc_ast::ast::ImportDeclaration<'a>) {
        let src = decl.source.value.as_str();
        if src == "#server/secrets" || src.starts_with("#server/secrets/") {
            self.imported_secrets_module = true;
            if let Some(specs) = &decl.specifiers {
                for spec in specs {
                    match spec {
                        ImportDeclarationSpecifier::ImportSpecifier(s) => {
                            let imported = match &s.imported {
                                ModuleExportName::IdentifierName(id) => id.name.as_str(),
                                ModuleExportName::IdentifierReference(id) => id.name.as_str(),
                                ModuleExportName::StringLiteral(lit) => lit.value.as_str(),
                            };
                            if imported == "secret" {
                                self.secret_locals.insert(s.local.name.to_string());
                            }
                        }
                        ImportDeclarationSpecifier::ImportDefaultSpecifier(s) => {
                            self.secret_locals.insert(s.local.name.to_string());
                        }
                        ImportDeclarationSpecifier::ImportNamespaceSpecifier(s) => {
                            self.secret_locals.insert(s.local.name.to_string());
                        }
                    }
                }
            }
        }
        walk::walk_import_declaration(self, decl);
    }

    fn visit_class_element(&mut self, el: &oxc_ast::ast::ClassElement<'a>) {
        if let oxc_ast::ast::ClassElement::MethodDefinition(method) = el {
            let name = match &method.key {
                oxc_ast::ast::PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
                oxc_ast::ast::PropertyKey::PrivateIdentifier(id) => Some(format!("#{}", id.name)),
                oxc_ast::ast::PropertyKey::Identifier(id) => Some(id.name.to_string()),
                oxc_ast::ast::PropertyKey::StringLiteral(lit) => Some(lit.value.to_string()),
                _ => None,
            };
            let prev = self.current_method.take();
            self.current_method = name;
            walk::walk_class_element(self, el);
            self.current_method = prev;
            return;
        }
        walk::walk_class_element(self, el);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        if is_secret_callee(&call.callee, &self.secret_locals, self.imported_secrets_module) {
            if let Some(name) = first_string_arg(&call.arguments) {
                self.note_binding(&name);
            }
        }
        walk::walk_call_expression(self, call);
    }
}

struct ClientBoundaryVisitor {
    findings: Vec<ClientBoundaryFinding>,
    secret_locals: std::collections::BTreeSet<String>,
}

impl ClientBoundaryVisitor {
    fn push(&mut self, code: &'static str, message: impl Into<String>, span: Span) {
        let message = message.into();
        if self.findings.iter().any(|f| f.code == code && f.message == message) {
            return;
        }
        self.findings.push(ClientBoundaryFinding { code, message, span });
    }
}

impl<'a> Visit<'a> for ClientBoundaryVisitor {
    fn visit_import_declaration(&mut self, decl: &oxc_ast::ast::ImportDeclaration<'a>) {
        let src = decl.source.value.as_str();
        if src == "#server/secrets" || src.starts_with("#server/secrets/") {
            self.push(
                vmz_protocol::DIAG_SECRET_CLIENT_LEAK,
                "client must not import `#server/secrets` (SecretRequirement is server/build only)",
                decl.span,
            );
            if let Some(specs) = &decl.specifiers {
                for spec in specs {
                    if let ImportDeclarationSpecifier::ImportSpecifier(s) = spec {
                        let imported = match &s.imported {
                            ModuleExportName::IdentifierName(id) => id.name.as_str(),
                            ModuleExportName::IdentifierReference(id) => id.name.as_str(),
                            ModuleExportName::StringLiteral(lit) => lit.value.as_str(),
                        };
                        if imported == "secret" {
                            self.secret_locals.insert(s.local.name.to_string());
                        }
                    }
                }
            }
        }
        if src.starts_with("#server/fixtures") || src.contains("/server/fixtures/") {
            self.push(
                vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN,
                format!("client must not import server-only fixture module `{src}`"),
                decl.span,
            );
        }
        walk::walk_import_declaration(self, decl);
    }

    fn visit_call_expression(&mut self, call: &oxc_ast::ast::CallExpression<'a>) {
        if is_secret_callee(&call.callee, &self.secret_locals, !self.secret_locals.is_empty()) {
            self.push(
                vmz_protocol::DIAG_SECRET_CLIENT_LEAK,
                "client must not call `secret(...)` (SecretRequirement is server/build only)",
                call.span,
            );
        }
        if let Some(name) = bare_callee_name(&call.callee) {
            if name == "registerMockProvider" || name == "overrideCapability" {
                self.push(
                    vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN,
                    format!("client must not call `{name}` (explicit mock/capability override)"),
                    call.span,
                );
            }
        }
        walk::walk_call_expression(self, call);
    }
}

fn is_secret_callee(
    expr: &Expression<'_>,
    secret_locals: &std::collections::BTreeSet<String>,
    allow_bare_secret: bool,
) -> bool {
    let mut cur = expr;
    while let Expression::ParenthesizedExpression(p) = cur {
        cur = &p.expression;
    }
    match cur {
        Expression::Identifier(id) => {
            secret_locals.contains(id.name.as_str())
                || (allow_bare_secret && id.name.as_str() == "secret")
        }
        Expression::StaticMemberExpression(mem) => {
            if let Expression::Identifier(obj) = &mem.object {
                secret_locals.contains(obj.name.as_str()) && mem.property.name.as_str() == "secret"
            } else {
                false
            }
        }
        _ => false,
    }
}

fn bare_callee_name(expr: &Expression<'_>) -> Option<String> {
    let mut cur = expr;
    while let Expression::ParenthesizedExpression(p) = cur {
        cur = &p.expression;
    }
    match cur {
        Expression::Identifier(id) => Some(id.name.to_string()),
        _ => None,
    }
}

fn first_string_arg(args: &[Argument<'_>]) -> Option<String> {
    let expr = args.first()?.as_expression()?;
    let mut cur = expr;
    while let Expression::ParenthesizedExpression(p) = cur {
        cur = &p.expression;
    }
    match cur {
        Expression::StringLiteral(lit) => Some(lit.value.to_string()),
        Expression::TemplateLiteral(t) if t.expressions.is_empty() && t.quasis.len() == 1 => Some(
            t.quasis[0]
                .value
                .cooked
                .as_ref()
                .map(|s| s.as_str())
                .unwrap_or(t.quasis[0].value.raw.as_str())
                .to_string(),
        ),
        _ => None,
    }
}
