//! Oak-backed stride write-barrier lowering.

use std::collections::{HashMap, HashSet};

use oak_typescript::ast::{ClassMember, Expression, ExpressionKind, Statement};
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};

use super::write_barrier::WriteBarrierRewrite;

#[derive(Debug, Clone)]
struct StrideHit {
    full: std::ops::Range<usize>,
    root: String,
    leaf: String,
    operator: String,
    rhs: String,
    start: String,
    step: String,
}

/// Rewrite stride loops through Oak AST spans.
pub fn rewrite_array_item_strides(
    source: &str,
    owned_fields: &HashSet<String>,
) -> Option<WriteBarrierRewrite> {
    if owned_fields.is_empty() {
        return Some(WriteBarrierRewrite { source: source.to_string(), rewritten: 0 });
    }
    let parsed = parse_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    });
    let root = parsed.root.as_ref().filter(|_| parsed.ok)?;
    let mut aliases = HashMap::new();
    let mut hits = Vec::new();
    walk_statements(&root.statements, source, owned_fields, &mut aliases, &mut hits);
    hits.sort_by_key(|hit| std::cmp::Reverse(hit.full.start));
    let mut output = source.to_string();
    for hit in &hits {
        let replacement = format!(
            "this.constructor.__vmzArrayItemCompoundStride(this, {root:?}, {leaf:?}, {operator:?}, {rhs}, {start}, {step})",
            root = hit.root,
            leaf = hit.leaf,
            operator = hit.operator,
            rhs = hit.rhs,
            start = hit.start,
            step = hit.step,
        );
        output.replace_range(hit.full.clone(), &replacement);
    }
    Some(WriteBarrierRewrite { source: output, rewritten: hits.len() })
}

fn walk_statements(
    statements: &[Statement],
    source: &str,
    owned: &HashSet<String>,
    aliases: &mut HashMap<String, String>,
    hits: &mut Vec<StrideHit>,
) {
    let mut index = 0;
    while index < statements.len() {
        if index + 1 < statements.len()
            && let Statement::VariableDeclaration(decl) = &statements[index]
            && let Some(root) = decl.value.as_ref().and_then(this_root)
            && owned.contains(&root)
            && let Statement::ForStatement(for_stmt) = &statements[index + 1]
            && let Some(mut hit) = match_for(for_stmt, source, owned, aliases)
            && hit.root == root
        {
            hit.full.start = decl.span.start;
            hits.push(hit);
            index += 2;
            continue;
        }
        match &statements[index] {
            Statement::VariableDeclaration(decl) => {
                if let Some(root) = decl.value.as_ref().and_then(this_root)
                    && owned.contains(&root)
                {
                    aliases.insert(decl.name.clone(), root);
                }
            }
            Statement::ForStatement(for_stmt) => {
                if let Some(hit) = match_for(for_stmt, source, owned, aliases) {
                    hits.push(hit);
                }
                walk_statement(&for_stmt.body, source, owned, aliases, hits);
            }
            _ => walk_statement(&statements[index], source, owned, aliases, hits),
        }
        index += 1;
    }
}

fn walk_statement(
    statement: &Statement,
    source: &str,
    owned: &HashSet<String>,
    aliases: &mut HashMap<String, String>,
    hits: &mut Vec<StrideHit>,
) {
    match statement {
        Statement::BlockStatement(block) => walk_statements(&block.statements, source, owned, aliases, hits),
        Statement::ClassDeclaration(class) => {
            for member in &class.body {
                if let ClassMember::Method { body, .. } = member {
                    walk_statements(body, source, owned, aliases, hits);
                }
            }
        }
        Statement::ExportDeclaration(export) => {
            if let Some(inner) = export.declaration.as_deref() {
                walk_statement(inner, source, owned, aliases, hits);
            }
        }
        Statement::FunctionDeclaration(function) => walk_statements(&function.body, source, owned, aliases, hits),
        Statement::IfStatement(if_stmt) => {
            walk_statement(&if_stmt.consequent, source, owned, aliases, hits);
            if let Some(alternate) = if_stmt.alternate.as_deref() {
                walk_statement(alternate, source, owned, aliases, hits);
            }
        }
        _ => {}
    }
}

fn match_for(
    statement: &oak_typescript::ast::ForStatement,
    source: &str,
    owned: &HashSet<String>,
    aliases: &HashMap<String, String>,
) -> Option<StrideHit> {
    let Statement::VariableDeclaration(init) = statement.initializer.as_deref()? else { return None };
    let index_name = init.name.clone();
    let start = init.value.as_ref().map(|expr| text(source, expr)).unwrap_or_default();
    let ExpressionKind::BinaryExpression { left, operator, right } = statement.test.as_ref()?.kind.as_ref() else { return None };
    if operator != "<" || ident(left)? != index_name { return None }
    let (length_object, length_property) = member(right)?;
    if length_property != "length" { return None }
    let root = resolve_root(length_object, aliases, owned)?;
    let step = match statement.incrementor.as_ref()?.kind.as_ref() {
        ExpressionKind::UpdateExpression { operator, argument, .. } if operator == "++" && ident(argument) == Some(index_name.as_str()) => "1".to_string(),
        ExpressionKind::AssignmentExpression { left, operator, right } if operator == "+=" && ident(left) == Some(index_name.as_str()) => text(source, right),
        _ => return None,
    };
    let Statement::BlockStatement(body) = statement.body.as_ref() else { return None };
    if body.statements.len() != 1 { return None }
    let Statement::ExpressionStatement(expr_stmt) = &body.statements[0] else { return None };
    let ExpressionKind::AssignmentExpression { left, operator, right } = expr_stmt.expression.kind.as_ref() else { return None };
    let operation = operator.strip_suffix('=')?;
    if !matches!(operation, "+" | "-" | "*" | "/" | "%") { return None }
    let (indexed, leaf) = member(left)?;
    let (array, index_name_from_path) = member(indexed)?;
    if index_name_from_path != index_name { return None }
    if resolve_root(array, aliases, owned)? != root { return None }
    Some(StrideHit {
        full: statement.span.clone().into(),
        root,
        leaf,
        operator: operation.to_string(),
        rhs: text(source, right),
        start,
        step,
    })
}

fn ident(expr: &Expression) -> Option<&str> {
    match expr.kind.as_ref() {
        ExpressionKind::Identifier(name) => Some(name),
        _ => None,
    }
}

fn member(expr: &Expression) -> Option<(&Expression, String)> {
    let ExpressionKind::MemberExpression { object, property, computed: false, .. } = expr.kind.as_ref() else { return None };
    Some((object, ident(property)?.to_string()))
}

fn this_root(expr: &Expression) -> Option<String> {
    let (object, property) = member(expr)?;
    (ident(object) == Some("this")).then_some(property)
}

fn resolve_root(
    expr: &Expression,
    aliases: &HashMap<String, String>,
    owned: &HashSet<String>,
) -> Option<String> {
    if let Some(name) = ident(expr) {
        return aliases.get(name).cloned().or_else(|| owned.contains(name).then(|| name.to_string()));
    }
    this_root(expr)
}

fn text(source: &str, expr: &Expression) -> String {
    source.get(expr.span.clone()).unwrap_or_default().trim().to_string()
}
