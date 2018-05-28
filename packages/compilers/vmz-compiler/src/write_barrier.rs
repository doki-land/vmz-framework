//! L4 WriteBarrier: rewrite owned path writes so Proxy is not required.
//!
//! Slice 1: `this.field.a.b = rhs` → `__vmzWritePath`
//! Slice 2: alias + array mutator + static index
//! Slice 3: dynamic index + arithmetic compound + shared owners (runtime)
//! Slice 4: logical `||=` / `&&=` / `??=`；跨组件共享诊断 + `__vmzAllowShared` / `__vmzTakeShared`

use std::collections::HashMap;
use std::collections::HashSet;

use oxc::allocator::Allocator;
use oxc::ast::ast::{
    Argument, AssignmentExpression, AssignmentOperator, AssignmentTarget, CallExpression,
    Expression, SimpleAssignmentTarget, Statement, StaticMemberExpression, UpdateExpression,
    UpdateOperator, VariableDeclaration, VariableDeclarator,
};
use oxc::ast_visit::{Visit, walk};
use oxc::parser::Parser;
use oxc::span::{GetSpan, SourceType, Span};

/// Result of rewriting owned path / array mutations.
#[derive(Debug, Default, Clone)]
pub struct WriteBarrierRewrite {
    pub source: String,
    /// Number of sites rewritten (path assigns + array mutates + compounds).
    pub rewritten: usize,
}

/// Rewrite owned path writes / array mutators / compounds (before transpile).
pub fn rewrite_static_path_writes(
    source: &str,
    owned_fields: &HashSet<String>,
) -> WriteBarrierRewrite {
    if owned_fields.is_empty() {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }
    if !source.contains("this.")
        && !ARRAY_MUTATOR_NAMES.iter().any(|m| source.contains(&format!(".{m}(")))
    {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    if parsed.panicked {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let mut collector =
        BarrierCollector { owned_fields, aliases: HashMap::new(), hits: Vec::new() };
    collector.visit_program(&parsed.program);

    if collector.hits.is_empty() {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    collector.hits.sort_by_key(|h| std::cmp::Reverse(h.span().start));
    let mut out = source.to_string();
    let rewritten = collector.hits.len();
    for hit in &collector.hits {
        let replacement = hit.render(source);
        let span = hit.span();
        let start = span.start as usize;
        let end = span.end as usize;
        if start > out.len() || end > out.len() || start > end {
            continue;
        }
        out.replace_range(start..end, &replacement);
    }

    WriteBarrierRewrite { source: out, rewritten }
}

const ARRAY_MUTATOR_NAMES: &[&str] =
    &["push", "pop", "shift", "unshift", "splice", "sort", "reverse", "fill", "copyWithin"];

/// One path segment: static string or runtime expression (dynamic index).
#[derive(Debug, Clone)]
enum SegPart {
    Static(String),
    Dyn(Span),
}

impl SegPart {
    fn render(&self, source: &str) -> String {
        match self {
            Self::Static(s) => format!("{s:?}"),
            Self::Dyn(span) => format!("String({})", span_slice(source, *span)),
        }
    }
}

enum ValueExpr {
    /// Plain RHS span (`=`).
    Rhs(Span),
    /// `read <binop> rhs` for compound assign.
    Compound { binop: &'static str, rhs: Span },
    /// `read + 1` / `read - 1` for update expressions.
    Update { binop: &'static str },
    /// Short-circuit logical assign (`||=` / `&&=` / `??=`).
    Logical { kind: &'static str, rhs: Span },
}

enum BarrierHit {
    Path {
        full: Span,
        root: String,
        segs: Vec<SegPart>,
        value: ValueExpr,
    },
    ArrayMutate {
        full: Span,
        root: String,
        segs: Vec<SegPart>,
        method: String,
        args_inner: Span,
        has_args: bool,
    },
}

impl BarrierHit {
    fn span(&self) -> Span {
        match self {
            Self::Path { full, .. } | Self::ArrayMutate { full, .. } => *full,
        }
    }

    fn render(&self, source: &str) -> String {
        match self {
            Self::Path { root, segs, value, .. } => {
                let segs_lit = segs_parts_literal(segs, source);
                match value {
                    ValueExpr::Logical { kind, rhs } => {
                        let rhs = span_slice(source, *rhs);
                        format!(
                            "this.constructor.__vmzWritePathLogical(this, {root:?}, [{segs_lit}], {kind:?}, {rhs})"
                        )
                    }
                    other => {
                        let read = read_path_expr(root, segs, source);
                        let value_expr = match other {
                            ValueExpr::Rhs(span) => span_slice(source, *span).to_string(),
                            ValueExpr::Compound { binop, rhs } => {
                                format!("{read} {binop} {}", span_slice(source, *rhs))
                            }
                            ValueExpr::Update { binop } => {
                                format!("{read} {binop} 1")
                            }
                            ValueExpr::Logical { .. } => unreachable!(),
                        };
                        format!(
                            "this.constructor.__vmzWritePath(this, {root:?}, [{segs_lit}], {value_expr})"
                        )
                    }
                }
            }
            Self::ArrayMutate { root, segs, method, args_inner, has_args, .. } => {
                let segs_lit = segs_parts_literal(segs, source);
                let args = if *has_args {
                    format!("[{}]", span_slice(source, *args_inner))
                } else {
                    "[]".to_string()
                };
                format!(
                    "this.constructor.__vmzArrayMutate(this, {root:?}, [{segs_lit}], {method:?}, {args})"
                )
            }
        }
    }
}

fn segs_parts_literal(segs: &[SegPart], source: &str) -> String {
    segs.iter().map(|s| s.render(source)).collect::<Vec<_>>().join(", ")
}

fn read_path_expr(root: &str, segs: &[SegPart], source: &str) -> String {
    let segs_lit = segs_parts_literal(segs, source);
    format!("this.constructor.__vmzReadPath(this, {root:?}, [{segs_lit}])")
}

fn compound_binop(op: AssignmentOperator) -> Option<&'static str> {
    Some(match op {
        AssignmentOperator::Addition => "+",
        AssignmentOperator::Subtraction => "-",
        AssignmentOperator::Multiplication => "*",
        AssignmentOperator::Division => "/",
        AssignmentOperator::Remainder => "%",
        AssignmentOperator::Exponential => "**",
        AssignmentOperator::ShiftLeft => "<<",
        AssignmentOperator::ShiftRight => ">>",
        AssignmentOperator::ShiftRightZeroFill => ">>>",
        AssignmentOperator::BitwiseOR => "|",
        AssignmentOperator::BitwiseXOR => "^",
        AssignmentOperator::BitwiseAnd => "&",
        _ => return None,
    })
}

fn logical_kind(op: AssignmentOperator) -> Option<&'static str> {
    match op {
        AssignmentOperator::LogicalOr => Some("||"),
        AssignmentOperator::LogicalAnd => Some("&&"),
        AssignmentOperator::LogicalNullish => Some("??"),
        _ => None,
    }
}

struct BarrierCollector<'a> {
    owned_fields: &'a HashSet<String>,
    aliases: HashMap<String, (String, Vec<SegPart>)>,
    hits: Vec<BarrierHit>,
}

impl<'a> BarrierCollector<'a> {
    fn push_path(&mut self, full: Span, root: String, segs: Vec<SegPart>, value: ValueExpr) {
        if segs.is_empty() {
            return;
        }
        if !self.owned_fields.contains(&root) {
            return;
        }
        self.hits.push(BarrierHit::Path { full, root, segs, value });
    }

    fn push_mutate(
        &mut self,
        full: Span,
        root: String,
        segs: Vec<SegPart>,
        method: String,
        args_inner: Span,
        has_args: bool,
    ) {
        if !self.owned_fields.contains(&root) {
            return;
        }
        self.hits.push(BarrierHit::ArrayMutate { full, root, segs, method, args_inner, has_args });
    }

    fn with_nested_scope<F: FnOnce(&mut Self)>(&mut self, f: F) {
        let saved = self.aliases.clone();
        f(self);
        self.aliases = saved;
    }

    fn bind_alias_from_init(&mut self, name: &str, init: &Expression<'_>) {
        if let Some((root, segs)) = expr_owned_path(init, self.owned_fields, &self.aliases) {
            self.aliases.insert(name.to_string(), (root, segs));
        }
    }
}

impl<'a> Visit<'a> for BarrierCollector<'a> {
    fn visit_variable_declaration(&mut self, it: &VariableDeclaration<'a>) {
        for decl in &it.declarations {
            self.visit_variable_declarator(decl);
        }
    }

    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(id) = it.id.get_binding_identifier() {
            if let Some(init) = &it.init {
                self.bind_alias_from_init(id.name.as_str(), init);
            }
        }
        if let Some(init) = &it.init {
            self.visit_expression(init);
        }
    }

    fn visit_assignment_expression(&mut self, it: &AssignmentExpression<'a>) {
        if let AssignmentTarget::AssignmentTargetIdentifier(id) = &it.left {
            if it.operator == AssignmentOperator::Assign {
                self.aliases.remove(id.name.as_str());
            }
            walk::walk_assignment_expression(self, it);
            return;
        }

        if let Some((root, segs)) =
            assignment_owned_path(&it.left, self.owned_fields, &self.aliases)
        {
            match it.operator {
                AssignmentOperator::Assign => {
                    self.push_path(it.span, root, segs, ValueExpr::Rhs(it.right.span()));
                }
                op => {
                    if let Some(kind) = logical_kind(op) {
                        self.push_path(
                            it.span,
                            root,
                            segs,
                            ValueExpr::Logical { kind, rhs: it.right.span() },
                        );
                    } else if let Some(binop) = compound_binop(op) {
                        self.push_path(
                            it.span,
                            root,
                            segs,
                            ValueExpr::Compound { binop, rhs: it.right.span() },
                        );
                    }
                }
            }
        }
        walk::walk_assignment_expression(self, it);
    }

    fn visit_update_expression(&mut self, it: &UpdateExpression<'a>) {
        if let Some((root, segs)) =
            simple_assignment_owned_path(&it.argument, self.owned_fields, &self.aliases)
        {
            let binop = match it.operator {
                UpdateOperator::Increment => "+",
                UpdateOperator::Decrement => "-",
            };
            self.push_path(it.span, root, segs, ValueExpr::Update { binop });
        }
        walk::walk_update_expression(self, it);
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Expression::StaticMemberExpression(m) = &it.callee {
            let method = m.property.name.as_str();
            if ARRAY_MUTATOR_NAMES.contains(&method) {
                if let Some((root, segs)) =
                    expr_owned_path(&m.object, self.owned_fields, &self.aliases)
                {
                    let (args_inner, has_args) = args_inner_span(it);
                    self.push_mutate(it.span, root, segs, method.to_string(), args_inner, has_args);
                }
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_function(
        &mut self,
        it: &oxc::ast::ast::Function<'a>,
        flags: oxc::syntax::scope::ScopeFlags,
    ) {
        self.with_nested_scope(|this| {
            walk::walk_function(this, it, flags);
        });
    }

    fn visit_arrow_function_expression(&mut self, it: &oxc::ast::ast::ArrowFunctionExpression<'a>) {
        self.with_nested_scope(|this| {
            walk::walk_arrow_function_expression(this, it);
        });
    }

    fn visit_block_statement(&mut self, it: &oxc::ast::ast::BlockStatement<'a>) {
        walk::walk_block_statement(self, it);
    }

    fn visit_statements(&mut self, it: &oxc::allocator::Vec<'a, Statement<'a>>) {
        walk::walk_statements(self, it);
    }
}

fn args_inner_span(call: &CallExpression<'_>) -> (Span, bool) {
    if call.arguments.is_empty() {
        return (Span::new(0, 0), false);
    }
    let first = match &call.arguments[0] {
        Argument::SpreadElement(s) => s.span(),
        other => other.span(),
    };
    let last = match call.arguments.last().unwrap() {
        Argument::SpreadElement(s) => s.span(),
        other => other.span(),
    };
    (Span::new(first.start, last.end), true)
}

/// Resolve `this.user`, `this.tags[i]`, `u`, `u.profile` to (root, segs).
fn expr_owned_path(
    expr: &Expression<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
) -> Option<(String, Vec<SegPart>)> {
    match expr {
        Expression::ThisExpression(_) => None,
        Expression::Identifier(id) => aliases.get(id.name.as_str()).cloned(),
        Expression::StaticMemberExpression(m) => static_member_owned_path(m, owned, aliases),
        Expression::ComputedMemberExpression(c) => {
            let idx = index_seg(&c.expression)?;
            let (root, mut segs) = expr_owned_path(&c.object, owned, aliases)?;
            segs.push(idx);
            Some((root, segs))
        }
        _ => None,
    }
}

fn static_member_owned_path(
    m: &StaticMemberExpression<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
) -> Option<(String, Vec<SegPart>)> {
    match &m.object {
        Expression::ThisExpression(_) => {
            let root = m.property.name.to_string();
            if owned.contains(&root) { Some((root, Vec::new())) } else { None }
        }
        _ => {
            let (root, mut segs) = expr_owned_path(&m.object, owned, aliases)?;
            segs.push(SegPart::Static(m.property.name.to_string()));
            Some((root, segs))
        }
    }
}

fn assignment_owned_path(
    target: &AssignmentTarget<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
) -> Option<(String, Vec<SegPart>)> {
    match target {
        AssignmentTarget::StaticMemberExpression(m) => static_member_owned_path(m, owned, aliases),
        AssignmentTarget::ComputedMemberExpression(c) => {
            let idx = index_seg(&c.expression)?;
            let (root, mut segs) = expr_owned_path(&c.object, owned, aliases)?;
            segs.push(idx);
            Some((root, segs))
        }
        _ => None,
    }
}

fn simple_assignment_owned_path(
    target: &SimpleAssignmentTarget<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
) -> Option<(String, Vec<SegPart>)> {
    match target {
        SimpleAssignmentTarget::StaticMemberExpression(m) => {
            static_member_owned_path(m, owned, aliases)
        }
        SimpleAssignmentTarget::ComputedMemberExpression(c) => {
            let idx = index_seg(&c.expression)?;
            let (root, mut segs) = expr_owned_path(&c.object, owned, aliases)?;
            segs.push(idx);
            Some((root, segs))
        }
        _ => None,
    }
}

/// Static numeric / digit-string → Static; otherwise Dyn(expr span) for `tags[i]`.
fn index_seg(expr: &Expression<'_>) -> Option<SegPart> {
    match expr {
        Expression::NumericLiteral(n) => {
            if n.value.fract() == 0.0 && n.value >= 0.0 && n.value < (u32::MAX as f64) {
                Some(SegPart::Static((n.value as u32).to_string()))
            } else {
                None
            }
        }
        Expression::StringLiteral(s) => {
            let t = s.value.as_str();
            if !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()) {
                Some(SegPart::Static(t.to_string()))
            } else {
                // Non-digit string key — treat as dynamic segment via String(literal).
                Some(SegPart::Dyn(s.span))
            }
        }
        // Dynamic index: identifier / member / this.field — any other expr span.
        Expression::Identifier(id) => Some(SegPart::Dyn(id.span)),
        Expression::StaticMemberExpression(m) => Some(SegPart::Dyn(m.span)),
        Expression::ComputedMemberExpression(c) => Some(SegPart::Dyn(c.span)),
        Expression::CallExpression(c) => Some(SegPart::Dyn(c.span)),
        Expression::ParenthesizedExpression(p) => index_seg(&p.expression),
        _ => Some(SegPart::Dyn(expr.span())),
    }
}

fn span_slice(source: &str, span: Span) -> &str {
    let start = span.start as usize;
    let end = span.end as usize;
    if start <= end && end <= source.len() { &source[start..end] } else { "" }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owned(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn rewrites_nested_static_assign() {
        let src = r#"
export default class Demo {
  user = { name: "a", bio: "b" };
  setName(n: string) {
    this.user.name = n;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzWritePath(this, \"user\", [\"name\"]"));
        assert!(!out.source.contains("this.user.name ="));
    }

    #[test]
    fn leaves_field_root_assign() {
        let src = r#"
export default class Demo {
  user = null;
  load() {
    this.user = { name: "x" };
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 0);
        assert!(out.source.contains("this.user = { name: \"x\" }"));
    }

    #[test]
    fn rewrites_alias_path_assign() {
        let src = r#"
export default class Demo {
  user = { name: "a", bio: "b" };
  setViaAlias(n: string) {
    const u = this.user;
    u.name = n;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzWritePath(this, \"user\", [\"name\"]"));
        assert!(!out.source.contains("u.name ="));
    }

    #[test]
    fn rewrites_array_push() {
        let src = r#"
export default class Demo {
  tags = [];
  add(tag: { id: string; label: string }) {
    this.tags.push(tag);
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["tags"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzArrayMutate(this, \"tags\", [], \"push\""));
    }

    #[test]
    fn rewrites_static_index_leaf() {
        let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  setLabel(n: string) {
    this.tags[0].label = n;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["tags"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzWritePath(this, \"tags\", [\"0\", \"label\"]"));
    }

    #[test]
    fn rewrites_dynamic_index_leaf() {
        let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  selected = 0;
  setLabel(n: string) {
    this.tags[this.selected].label = n;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["tags", "selected"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("String(this.selected)"));
        assert!(out.source.contains("__vmzWritePath(this, \"tags\""));
        assert!(!out.source.contains("this.tags[this.selected].label ="));
    }

    #[test]
    fn rewrites_dynamic_index_ident() {
        let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  setAt(i: number, n: string) {
    this.tags[i].label = n;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["tags"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("String(i)"));
        assert!(out.source.contains("\"label\""));
    }

    #[test]
    fn rewrites_compound_assign() {
        let src = r#"
export default class Demo {
  user = { count: 0 };
  bump() {
    this.user.count += 1;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzReadPath(this, \"user\", [\"count\"])"));
        assert!(out.source.contains("+ 1"));
        assert!(!out.source.contains("this.user.count +="));
    }

    #[test]
    fn rewrites_update_expression() {
        let src = r#"
export default class Demo {
  user = { count: 0 };
  bump() {
    this.user.count++;
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzReadPath(this, \"user\", [\"count\"]) + 1"));
        assert!(!out.source.contains("this.user.count++"));
    }

    #[test]
    fn rewrites_logical_or_assign() {
        let src = r#"
export default class Demo {
  user = { flag: "" };
  ensure() {
    this.user.flag ||= "on";
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzWritePathLogical(this, \"user\", [\"flag\"], \"||\""));
        assert!(!out.source.contains("this.user.flag ||="));
    }

    #[test]
    fn rewrites_nullish_assign() {
        let src = r#"
export default class Demo {
  user = { name: null as string | null };
  ensure() {
    this.user.name ??= "anon";
  }
}
"#;
        let out = rewrite_static_path_writes(src, &owned(&["user"]));
        assert_eq!(out.rewritten, 1);
        assert!(out.source.contains("__vmzWritePathLogical(this, \"user\", [\"name\"], \"??\""));
    }
}
