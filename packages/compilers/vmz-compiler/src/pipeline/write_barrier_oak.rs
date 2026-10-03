//! Oak-backed stride write-barrier lowering.

use std::collections::{HashMap, HashSet};

use oak_typescript::ast::{ClassMember, Expression, ExpressionKind, Statement};
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};

use super::write_barrier::WriteBarrierRewrite;

const ARRAY_MUTATOR_NAMES: &[&str] =
    &["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"];

#[derive(Debug, Clone)]
enum OakBarrierKind {
    Path { operator: String, rhs: std::ops::Range<usize> },
    Update { operator: String },
    Mutator { method: String, args: std::ops::Range<usize> },
}

#[derive(Debug, Clone)]
struct OakBarrierHit {
    span: std::ops::Range<usize>,
    root: String,
    segments: Vec<String>,
    kind: OakBarrierKind,
}

/// Rewrite ordinary owned writes through Oak AST spans.
pub fn rewrite_static_path_writes(
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
    collect_statements(&root.statements, source, owned_fields, &mut aliases, &mut hits);
    hits.sort_by_key(|hit| std::cmp::Reverse(hit.span.start));
    let mut output = source.to_string();
    for hit in &hits {
        let replacement = render_barrier(source, hit);
        output.replace_range(hit.span.clone(), &replacement);
    }
    Some(WriteBarrierRewrite { source: output, rewritten: hits.len() })
}

fn collect_statements(
    statements: &[Statement],
    source: &str,
    owned: &HashSet<String>,
    aliases: &mut HashMap<String, (String, Vec<String>)>,
    hits: &mut Vec<OakBarrierHit>,
) {
    for statement in statements {
        match statement {
            Statement::VariableDeclaration(decl) => {
                if let Some(value) = &decl.value {
                    if let Some(path) = owned_path(value, owned, aliases, source) {
                        aliases.insert(decl.name.clone(), path);
                    }
                    collect_expression(value, source, owned, aliases, hits);
                }
            }
            Statement::ExpressionStatement(expr) => {
                collect_expression(&expr.expression, source, owned, aliases, hits)
            }
            Statement::BlockStatement(block) => {
                collect_statements(&block.statements, source, owned, aliases, hits)
            }
            Statement::ClassDeclaration(class) => {
                for member in &class.body {
                    if let ClassMember::Method { body, .. } = member {
                        collect_statements(body, source, owned, aliases, hits);
                    }
                }
            }
            Statement::FunctionDeclaration(function) => {
                collect_statements(&function.body, source, owned, aliases, hits)
            }
            Statement::ExportDeclaration(export) => {
                if let Some(inner) = export.declaration.as_deref() {
                    collect_statements(std::slice::from_ref(inner), source, owned, aliases, hits);
                }
            }
            Statement::IfStatement(if_stmt) => {
                collect_statement(&if_stmt.consequent, source, owned, aliases, hits);
                if let Some(alternate) = if_stmt.alternate.as_deref() {
                    collect_statement(alternate, source, owned, aliases, hits);
                }
            }
            Statement::ForStatement(for_stmt) => {
                if let Some(initializer) = &for_stmt.initializer {
                    collect_statement(initializer, source, owned, aliases, hits);
                }
                if let Some(test) = &for_stmt.test {
                    collect_expression(test, source, owned, aliases, hits);
                }
                if let Some(incrementor) = &for_stmt.incrementor {
                    collect_expression(incrementor, source, owned, aliases, hits);
                }
                collect_statement(&for_stmt.body, source, owned, aliases, hits);
            }
            _ => {}
        }
    }
}

fn collect_statement(
    statement: &Statement,
    source: &str,
    owned: &HashSet<String>,
    aliases: &mut HashMap<String, (String, Vec<String>)>,
    hits: &mut Vec<OakBarrierHit>,
) {
    collect_statements(std::slice::from_ref(statement), source, owned, aliases, hits);
}

fn collect_expression(
    expression: &Expression,
    source: &str,
    owned: &HashSet<String>,
    aliases: &mut HashMap<String, (String, Vec<String>)>,
    hits: &mut Vec<OakBarrierHit>,
) {
    match expression.kind.as_ref() {
        ExpressionKind::AssignmentExpression { left, operator, right } => {
            if let Some((root, segments)) = owned_path(left, owned, aliases, source)
                && !segments.is_empty()
            {
                hits.push(OakBarrierHit {
                    span: expression.span.clone().into(),
                    root,
                    segments,
                    kind: OakBarrierKind::Path {
                        operator: operator.clone(),
                        rhs: right.span.clone().into(),
                    },
                });
            }
            collect_expression(right, source, owned, aliases, hits);
        }
        ExpressionKind::UpdateExpression { operator, argument, .. } => {
            if let Some((root, segments)) = owned_path(argument, owned, aliases, source) {
                hits.push(OakBarrierHit {
                    span: expression.span.clone().into(),
                    root,
                    segments,
                    kind: OakBarrierKind::Update { operator: operator.clone() },
                });
            }
        }
        ExpressionKind::CallExpression { func, args } => {
            if let Some((object, method)) = static_member(func)
                && ARRAY_MUTATOR_NAMES.contains(&method.as_str())
                && let Some((root, segments)) = owned_path(object, owned, aliases, source)
            {
                let args = if let (Some(first), Some(last)) = (args.first(), args.last()) {
                    first.span.start..last.span.end
                } else {
                    0..0
                };
                hits.push(OakBarrierHit {
                    span: expression.span.clone().into(),
                    root,
                    segments,
                    kind: OakBarrierKind::Mutator { method, args },
                });
            }
            collect_expression(func, source, owned, aliases, hits);
            for arg in args {
                collect_expression(arg, source, owned, aliases, hits);
            }
        }
        ExpressionKind::MemberExpression { object, property, computed, .. } => {
            collect_expression(object, source, owned, aliases, hits);
            if *computed {
                collect_expression(property, source, owned, aliases, hits);
            }
        }
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::ConditionalExpression { test: left, consequent: right, alternate: _ } => {
            collect_expression(left, source, owned, aliases, hits);
            collect_expression(right, source, owned, aliases, hits);
        }
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::AwaitExpression(argument)
        | ExpressionKind::SpreadElement(argument) => {
            collect_expression(argument, source, owned, aliases, hits)
        }
        _ => {}
    }
}

fn static_member(expression: &Expression) -> Option<(&Expression, String)> {
    let ExpressionKind::MemberExpression { object, property, computed: false, .. } = expression.kind.as_ref() else {
        return None;
    };
    Some((object, ident(property)?.to_string()))
}

fn owned_path(
    expression: &Expression,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<String>)>,
    source: &str,
) -> Option<(String, Vec<String>)> {
    match expression.kind.as_ref() {
        ExpressionKind::Identifier(name) => aliases.get(name).cloned(),
        ExpressionKind::MemberExpression { object, property, computed, .. } => {
            let (root, mut segments) = if let Some(path) = owned_path(object, owned, aliases, source) {
                path
            } else if ident(object) == Some("this")
                && !*computed
                && let Some(field) = ident(property)
                && owned.contains(field)
            {
                return Some((field.to_string(), Vec::new()));
            } else {
                return None;
            };
            let segment = if *computed {
                source.get(property.span.clone())?.trim().to_string()
            } else {
                ident(property)?.to_string()
            };
            segments.push(segment);
            Some((root, segments))
        }
        _ => None,
    }
}

fn render_barrier(source: &str, hit: &OakBarrierHit) -> String {
    let path = hit.segments.iter().map(|segment| format!("{segment:?}")).collect::<Vec<_>>().join(", ");
    match &hit.kind {
        OakBarrierKind::Path { operator, rhs } => {
            let rhs = source.get(rhs.clone()).unwrap_or_default().trim();
            if hit.segments.len() == 2 && is_simple_index(&hit.segments[0]) {
                let index = &hit.segments[0];
                let leaf = &hit.segments[1];
                let item = match operator.as_str() {
                    "=" => Some(format!("this.constructor.__vmzWritePathItem(this, {:?}, {}, {:?}, {})", hit.root, index, leaf, rhs)),
                    "+=" | "-=" | "*=" | "/=" | "%=" => Some(format!(
                        "this.constructor.__vmzWritePathCompoundItem(this, {:?}, {}, {:?}, {:?}, {})",
                        hit.root, index, leaf, &operator[..operator.len() - 1], rhs
                    )),
                    _ => None,
                };
                if let Some(item) = item {
                    return item;
                }
            }
            match operator.as_str() {
                "=" => format!("this.constructor.__vmzWritePath(this, {:?}, [{}], {})", hit.root, path, rhs),
                "+=" | "-=" | "*=" | "/=" | "%=" => format!(
                    "this.constructor.__vmzWritePathCompound(this, {:?}, [{}], {:?}, {})",
                    hit.root, path, &operator[..operator.len() - 1], rhs
                ),
                "||=" | "&&=" | "??=" => format!(
                    "this.constructor.__vmzWritePathLogical(this, {:?}, [{}], {:?}, {})",
                    hit.root, path, &operator[..operator.len() - 1], rhs
                ),
                _ => source.get(hit.span.clone()).unwrap_or_default().to_string(),
            }
        }
        OakBarrierKind::Update { operator } => format!(
            "this.constructor.__vmzWritePathCompound(this, {:?}, [{}], {:?}, 1)",
            hit.root,
            path,
            if operator == "++" { "+" } else { "-" }
        ),
        OakBarrierKind::Mutator { method, args } => {
            let args = if args.is_empty() { String::new() } else { source.get(args.clone()).unwrap_or_default().trim().to_string() };
            format!("this.constructor.__vmzArrayMutate(this, {:?}, [{}], {:?}{})", hit.root, path, method, if args.is_empty() { String::new() } else { format!(", {args}") })
        }
    }
}

fn is_simple_index(value: &str) -> bool {
    !value.is_empty()
        && (value.chars().all(|c| c.is_ascii_digit())
            || value.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '.'))
}

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
    let (array, index_name_from_path) = indexed_member(indexed)?;
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

fn indexed_member(expr: &Expression) -> Option<(&Expression, String)> {
    let ExpressionKind::MemberExpression { object, property, computed: true, .. } = expr.kind.as_ref() else { return None };
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

#[cfg(test)]
mod tests {
    use super::rewrite_array_item_strides;
    use std::collections::HashSet;

    #[test]
    fn lowers_alias_stride_loop_without_oxc() {
        let source = r#"
export default class Demo {
  rows = [];
  update() {
    const rows = this.rows;
    for (let i = 0; i < rows.length; i += 10) {
      rows[i].label += " !!!";
    }
  }
}
"#;
        let owned = HashSet::from([String::from("rows")]);
        let result = rewrite_array_item_strides(source, &owned).expect("Oak parse");
        assert_eq!(result.rewritten, 1);
        assert!(result.source.contains(
            "__vmzArrayItemCompoundStride(this, \"rows\", \"label\", \"+\", \" !!!\", 0, 10)"
        ));
        assert!(!result.source.contains("for ("));
    }
}
