//! WriteBarrier: rewrite owned path writes so Proxy is not required.
//!
//! Slice 1: `this.field.a.b = rhs` → `__vmzWritePath`
//! Slice 2: alias + array mutator + static index
//! Slice 3: dynamic index + arithmetic compound + shared owners (runtime)
//! Slice 4: logical `||=` / `&&=` / `??=`; cross-component share diagnostics + `__vmzAllowShared` / `__vmzTakeShared`
//! Slice 5: idiomatic `slice` + two-index swap + assign-back → `__vmzListTranspose`
//! Slice 6: stride `for (i=start; i < arr.length; i += step) arr[i].leaf op= rhs`
//!          → `__vmzArrayItemCompoundStride` (update-every-Nth hot path)

use std::collections::HashMap;
use std::collections::HashSet;

use oxc_allocator::Allocator;
use oxc_ast::ast::{
    Argument, AssignmentExpression, AssignmentOperator, AssignmentTarget, CallExpression,
    Expression, ForStatement, SimpleAssignmentTarget, Statement, StaticMemberExpression,
    UpdateExpression, UpdateOperator, VariableDeclaration, VariableDeclarator,
};
use oxc_ast_visit::{Visit, walk};
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType, Span};
use oxc_syntax::operator::BinaryOperator;

/// Result of rewriting owned path / array mutations.
#[derive(Debug, Default, Clone)]
pub struct WriteBarrierRewrite {
    /// Source text after rewrite (or the original when nothing changed).
    pub source: String,
    /// Number of sites rewritten (path assigns + array mutates + compounds + transpose).
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

    let mut out = source.to_string();
    let mut rewritten = 0usize;

    // Stride loops first so the body compound is not rewritten as N individual WritePaths.
    let st = rewrite_array_item_strides(&out, owned_fields);
    out = st.source;
    rewritten += st.rewritten;

    let needs_barrier = out.contains("this.")
        || ARRAY_MUTATOR_NAMES.iter().any(|m| out.contains(&format!(".{m}(")));
    if needs_barrier {
        let allocator = Allocator::default();
        let parsed = Parser::new(&allocator, &out, SourceType::ts()).parse();
        if !parsed.panicked {
            let mut collector =
                BarrierCollector { owned_fields, aliases: HashMap::new(), hits: Vec::new() };
            collector.visit_program(&parsed.program);
            if !collector.hits.is_empty() {
                collector.hits.sort_by_key(|h| std::cmp::Reverse(h.span().start));
                rewritten += collector.hits.len();
                for hit in &collector.hits {
                    let replacement = hit.render(&out);
                    let span = hit.span();
                    let start = span.start as usize;
                    let end = span.end as usize;
                    if start > out.len() || end > out.len() || start > end {
                        continue;
                    }
                    out.replace_range(start..end, &replacement);
                }
            }
        }
    }

    let tp = rewrite_list_transpose(&out, owned_fields);
    out = tp.source;
    rewritten += tp.rewritten;

    WriteBarrierRewrite { source: out, rewritten }
}

/// `for (let i = start; i < arr.length; i += step) arr[i].leaf += rhs`
/// → `__vmzArrayItemCompoundStride(this, "arrRoot", "leaf", "+", rhs, start, step)`
pub fn rewrite_array_item_strides(
    source: &str,
    owned_fields: &HashSet<String>,
) -> WriteBarrierRewrite {
    if owned_fields.is_empty() {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    if parsed.panicked {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let mut collector =
        StrideCollector { owned_fields, aliases: HashMap::new(), source, hits: Vec::new() };
    collector.visit_program(&parsed.program);
    if collector.hits.is_empty() {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    collector.hits.sort_by_key(|h| std::cmp::Reverse(h.full.start));
    let mut out = source.to_string();
    let rewritten = collector.hits.len();
    for hit in &collector.hits {
        let replacement = hit.render();
        let start = hit.full.start as usize;
        let end = hit.full.end as usize;
        if start > out.len() || end > out.len() || start > end {
            continue;
        }
        out.replace_range(start..end, &replacement);
    }

    WriteBarrierRewrite { source: out, rewritten }
}

struct StrideHit {
    full: Span,
    root: String,
    leaf: String,
    binop: &'static str,
    rhs: String,
    start: String,
    step: String,
}

impl StrideHit {
    fn render(&self) -> String {
        format!(
            "this.constructor.__vmzArrayItemCompoundStride(this, {root:?}, {leaf:?}, {binop:?}, {rhs}, {start}, {step})",
            root = self.root,
            leaf = self.leaf,
            binop = self.binop,
            rhs = self.rhs,
            start = self.start,
            step = self.step,
        )
    }
}

struct StrideCollector<'a> {
    owned_fields: &'a HashSet<String>,
    aliases: HashMap<String, (String, Vec<SegPart>)>,
    source: &'a str,
    hits: Vec<StrideHit>,
}

impl<'a> Visit<'a> for StrideCollector<'a> {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(id) = it.id.get_binding_identifier() {
            if let Some(init) = &it.init {
                if let Some((root, segs)) = expr_owned_path(init, self.owned_fields, &self.aliases)
                {
                    self.aliases.insert(id.name.to_string(), (root, segs));
                }
            }
        }
        if let Some(init) = &it.init {
            self.visit_expression(init);
        }
    }

    fn visit_statements(&mut self, it: &oxc_allocator::Vec<'a, Statement<'a>>) {
        let mut i = 0usize;
        while i < it.len() {
            // `const rows = this.rows; for (...)` → one stride call (drop dead alias).
            if i + 1 < it.len() {
                if let Some(hit) = match_alias_then_stride(
                    &it[i],
                    &it[i + 1],
                    self.owned_fields,
                    &self.aliases,
                    self.source,
                ) {
                    self.hits.push(hit);
                    i += 2;
                    continue;
                }
            }
            if let Statement::ForStatement(f) = &it[i] {
                if let Some(hit) =
                    match_stride_for(f, self.owned_fields, &self.aliases, self.source)
                {
                    self.hits.push(hit);
                    i += 1;
                    continue;
                }
            }
            walk::walk_statement(self, &it[i]);
            i += 1;
        }
    }
}

fn match_alias_then_stride(
    first: &Statement<'_>,
    second: &Statement<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
    source: &str,
) -> Option<StrideHit> {
    let Statement::VariableDeclaration(decl) = first else {
        return None;
    };
    if decl.declarations.len() != 1 {
        return None;
    }
    let d = &decl.declarations[0];
    let id = d.id.get_binding_identifier()?;
    let init = d.init.as_ref()?;
    let (root, segs) = expr_owned_path(init, owned, aliases)?;
    if !segs.is_empty() {
        return None;
    }
    let local = id.name.as_str();
    let mut local_aliases = aliases.clone();
    local_aliases.insert(local.to_string(), (root.clone(), segs));
    let Statement::ForStatement(for_stmt) = second else {
        return None;
    };
    // Length object must be the alias we are about to drop.
    let idx_probe = match_for_init_index(for_stmt, source)?.0;
    let len_obj = match_for_test_lt_length(for_stmt, &idx_probe)?;
    if len_obj != local {
        return None;
    }
    let mut hit = match_stride_for(for_stmt, owned, &local_aliases, source)?;
    if hit.root != root {
        return None;
    }
    hit.full = Span::new(decl.span.start, for_stmt.span.end);
    Some(hit)
}

fn match_stride_for(
    it: &ForStatement<'_>,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
    source: &str,
) -> Option<StrideHit> {
    let (idx_name, start) = match_for_init_index(it, source)?;
    let step = match_for_update_step(it, &idx_name, source)?;
    let len_obj = match_for_test_lt_length(it, &idx_name)?;
    let (root_from_len, segs_from_len) = resolve_local_or_this(&len_obj, owned, aliases)?;
    if !segs_from_len.is_empty() {
        return None; // only root arrays: `rows.length`, not `obj.rows.length`
    }

    let Statement::BlockStatement(body) = &it.body else {
        return None;
    };
    if body.body.len() != 1 {
        return None;
    }
    let Statement::ExpressionStatement(es) = &body.body[0] else {
        return None;
    };
    let Expression::AssignmentExpression(assign) = &es.expression else {
        return None;
    };
    let binop = compound_binop(assign.operator)?;
    let (root, segs) = assignment_owned_path(&assign.left, owned, aliases)?;
    if root != root_from_len || segs.len() != 2 {
        return None;
    }
    // segs: [Dyn(idx_name) | Static digit, Static(leaf)]
    let leaf = match &segs[1] {
        SegPart::Static(s) => s.clone(),
        _ => return None,
    };
    match &segs[0] {
        SegPart::Dyn(span) => {
            let t = span_slice(source, *span).trim();
            if t != idx_name {
                return None;
            }
        }
        SegPart::Static(_) => return None,
        // only dynamic index matching the for-loop variable
    }

    Some(StrideHit {
        full: it.span,
        root,
        leaf,
        binop,
        rhs: span_slice(source, assign.right.span()).to_string(),
        start,
        step,
    })
}

fn resolve_local_or_this(
    name: &str,
    owned: &HashSet<String>,
    aliases: &HashMap<String, (String, Vec<SegPart>)>,
) -> Option<(String, Vec<SegPart>)> {
    if let Some((root, segs)) = aliases.get(name) {
        return Some((root.clone(), segs.clone()));
    }
    if owned.contains(name) {
        // bare `rows` without this. — not supported; length obj is always Ident
        return None;
    }
    None
}

fn match_for_init_index(it: &ForStatement<'_>, source: &str) -> Option<(String, String)> {
    let init = it.init.as_ref()?;
    // for (let i = 0; …)
    let oxc_ast::ast::ForStatementInit::VariableDeclaration(decl) = init else {
        return None;
    };
    if decl.declarations.len() != 1 {
        return None;
    }
    let d = &decl.declarations[0];
    let id = d.id.get_binding_identifier()?;
    let init_e = d.init.as_ref()?;
    Some((id.name.to_string(), span_slice(source, init_e.span()).to_string()))
}

fn match_for_update_step(it: &ForStatement<'_>, idx: &str, source: &str) -> Option<String> {
    let update = it.update.as_ref()?;
    match update {
        Expression::UpdateExpression(u) => {
            if !matches!(u.operator, UpdateOperator::Increment) {
                return None;
            }
            let SimpleAssignmentTarget::AssignmentTargetIdentifier(id) = &u.argument else {
                return None;
            };
            if id.name.as_str() != idx {
                return None;
            }
            Some("1".into())
        }
        Expression::AssignmentExpression(a) => {
            let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left else {
                return None;
            };
            if id.name.as_str() != idx {
                return None;
            }
            match a.operator {
                AssignmentOperator::Addition => {
                    Some(span_slice(source, a.right.span()).trim().to_string())
                }
                AssignmentOperator::Assign => {
                    // i = i + N
                    let Expression::BinaryExpression(bin) = &a.right else {
                        return None;
                    };
                    if !matches!(bin.operator, BinaryOperator::Addition) {
                        return None;
                    }
                    let Expression::Identifier(left) = &bin.left else {
                        return None;
                    };
                    if left.name.as_str() != idx {
                        return None;
                    }
                    Some(span_slice(source, bin.right.span()).trim().to_string())
                }
                _ => None,
            }
        }
        _ => None,
    }
}

fn match_for_test_lt_length(it: &ForStatement<'_>, idx: &str) -> Option<String> {
    let test = it.test.as_ref()?;
    let Expression::BinaryExpression(bin) = test else {
        return None;
    };
    if !matches!(bin.operator, BinaryOperator::LessThan) {
        return None;
    }
    let Expression::Identifier(left) = &bin.left else {
        return None;
    };
    if left.name.as_str() != idx {
        return None;
    }
    let Expression::StaticMemberExpression(m) = &bin.right else {
        return None;
    };
    if m.property.name.as_str() != "length" {
        return None;
    }
    let Expression::Identifier(obj) = &m.object else {
        return None;
    };
    Some(obj.name.to_string())
}

/// Idiomatic list swap: `const x = this.f.slice(); if (x.length …) { swap x[i]/x[j]; this.f = x; }`
/// → `if (this.f.length …) { this.constructor.__vmzListTranspose(this, "f", i, j); }`
pub fn rewrite_list_transpose(source: &str, owned_fields: &HashSet<String>) -> WriteBarrierRewrite {
    if owned_fields.is_empty() || !source.contains(".slice()") {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, source, SourceType::ts()).parse();
    if parsed.panicked {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    let mut collector = TransposeCollector { owned_fields, source, hits: Vec::new() };
    collector.visit_program(&parsed.program);
    if collector.hits.is_empty() {
        return WriteBarrierRewrite { source: source.to_string(), rewritten: 0 };
    }

    collector.hits.sort_by_key(|h| std::cmp::Reverse(h.full.start));
    let mut out = source.to_string();
    let rewritten = collector.hits.len();
    for hit in &collector.hits {
        let replacement = hit.render();
        let start = hit.full.start as usize;
        let end = hit.full.end as usize;
        if start > out.len() || end > out.len() || start > end {
            continue;
        }
        out.replace_range(start..end, &replacement);
    }

    WriteBarrierRewrite { source: out, rewritten }
}

struct TransposeHit {
    full: Span,
    field: String,
    idx_a: String,
    idx_b: String,
    op: &'static str,
    rhs: String,
}

impl TransposeHit {
    fn render(&self) -> String {
        format!(
            "if (this.{field}.length {op} {rhs}) {{\n      this.constructor.__vmzListTranspose(this, {field:?}, {a}, {b});\n    }}",
            field = self.field,
            op = self.op,
            rhs = self.rhs,
            a = self.idx_a,
            b = self.idx_b,
        )
    }
}

struct TransposeCollector<'a> {
    owned_fields: &'a HashSet<String>,
    source: &'a str,
    hits: Vec<TransposeHit>,
}

impl<'a> Visit<'a> for TransposeCollector<'a> {
    fn visit_statements(&mut self, it: &oxc_allocator::Vec<'a, Statement<'a>>) {
        let mut i = 0usize;
        while i < it.len() {
            if i + 1 < it.len() {
                if let Some(hit) =
                    match_transpose_pair(&it[i], &it[i + 1], self.owned_fields, self.source)
                {
                    self.hits.push(hit);
                    i += 2;
                    continue;
                }
            }
            walk::walk_statement(self, &it[i]);
            i += 1;
        }
    }
}

fn match_transpose_pair(
    first: &Statement<'_>,
    second: &Statement<'_>,
    owned: &HashSet<String>,
    source: &str,
) -> Option<TransposeHit> {
    let (local, field, slice_span) = match_slice_local(first, owned)?;
    let (if_span, idx_a, idx_b, op, rhs) = match_transpose_if(second, &local, &field, source)?;
    Some(TransposeHit {
        full: Span::new(slice_span.start, if_span.end),
        field,
        idx_a,
        idx_b,
        op,
        rhs,
    })
}

fn match_slice_local(
    stmt: &Statement<'_>,
    owned: &HashSet<String>,
) -> Option<(String, String, Span)> {
    let Statement::VariableDeclaration(decl) = stmt else {
        return None;
    };
    if decl.declarations.len() != 1 {
        return None;
    }
    let d = &decl.declarations[0];
    let id = d.id.get_binding_identifier()?;
    let local = id.name.to_string();
    let init = d.init.as_ref()?;
    let Expression::CallExpression(call) = init else {
        return None;
    };
    if !call.arguments.is_empty() {
        return None;
    }
    let Expression::StaticMemberExpression(mem) = &call.callee else {
        return None;
    };
    if mem.property.name.as_str() != "slice" {
        return None;
    }
    let Expression::StaticMemberExpression(inner) = &mem.object else {
        return None;
    };
    if !matches!(&inner.object, Expression::ThisExpression(_)) {
        return None;
    }
    let field = inner.property.name.to_string();
    if !owned.contains(&field) {
        return None;
    }
    Some((local, field, decl.span))
}

fn match_transpose_if(
    stmt: &Statement<'_>,
    local: &str,
    field: &str,
    source: &str,
) -> Option<(Span, String, String, &'static str, String)> {
    let Statement::IfStatement(if_stmt) = stmt else {
        return None;
    };
    let (op, rhs) = match_length_test(&if_stmt.test, local, source)?;
    let Statement::BlockStatement(body) = &if_stmt.consequent else {
        return None;
    };
    if body.body.len() != 4 {
        return None;
    }
    let (tmp, idx_a) = match_tmp_from_index(&body.body[0], local, source)?;
    let idx_b = match_index_assign(&body.body[1], local, &idx_a, local, source)?;
    if !match_index_assign_tmp(&body.body[2], local, &idx_b, &tmp) {
        return None;
    }
    if !match_field_assign_back(&body.body[3], field, local) {
        return None;
    }
    // Ensure swap is a true exchange: stmt1 writes local[a]=local[b].
    if idx_a == idx_b {
        return None;
    }
    Some((if_stmt.span, idx_a, idx_b, op, rhs))
}

fn match_length_test(
    test: &Expression<'_>,
    local: &str,
    source: &str,
) -> Option<(&'static str, String)> {
    let Expression::BinaryExpression(bin) = test else {
        return None;
    };
    let op = match bin.operator {
        BinaryOperator::GreaterThan => ">",
        BinaryOperator::GreaterEqualThan => ">=",
        BinaryOperator::StrictInequality | BinaryOperator::Inequality => return None,
        _ => return None,
    };
    let Expression::StaticMemberExpression(left) = &bin.left else {
        return None;
    };
    if left.property.name.as_str() != "length" {
        return None;
    }
    let Expression::Identifier(obj) = &left.object else {
        return None;
    };
    if obj.name.as_str() != local {
        return None;
    }
    Some((op, span_slice(source, bin.right.span()).to_string()))
}

fn match_tmp_from_index(
    stmt: &Statement<'_>,
    local: &str,
    source: &str,
) -> Option<(String, String)> {
    let Statement::VariableDeclaration(decl) = stmt else {
        return None;
    };
    if decl.declarations.len() != 1 {
        return None;
    }
    let d = &decl.declarations[0];
    let id = d.id.get_binding_identifier()?;
    let tmp = id.name.to_string();
    let init = d.init.as_ref()?;
    let idx = match_computed_local_index(init, local, source)?;
    Some((tmp, idx))
}

fn match_index_assign(
    stmt: &Statement<'_>,
    local_l: &str,
    expect_idx_l: &str,
    local_r: &str,
    source: &str,
) -> Option<String> {
    let Statement::ExpressionStatement(es) = stmt else {
        return None;
    };
    let Expression::AssignmentExpression(assign) = &es.expression else {
        return None;
    };
    if !matches!(assign.operator, AssignmentOperator::Assign) {
        return None;
    }
    let left_idx = match_assign_computed_index(&assign.left, local_l, source)?;
    if left_idx != expect_idx_l {
        return None;
    }
    match_computed_local_index(&assign.right, local_r, source)
}

fn match_index_assign_tmp(stmt: &Statement<'_>, local: &str, expect_idx: &str, tmp: &str) -> bool {
    let Statement::ExpressionStatement(es) = stmt else {
        return false;
    };
    let Expression::AssignmentExpression(assign) = &es.expression else {
        return false;
    };
    if !matches!(assign.operator, AssignmentOperator::Assign) {
        return false;
    }
    // Re-check left index via source-less path: reuse match_assign with dummy source only for idx
    // equality — call match_assign_computed_index with empty source fails for non-empty idx text.
    // Instead parse left as computed member.
    let Some(left_idx) = assignment_computed_index_text(&assign.left) else {
        return false;
    };
    if left_idx != expect_idx {
        return false;
    }
    let Expression::Identifier(id) = &assign.right else {
        return false;
    };
    let _ = local; // left must be local[idx]; verified via text equality of idx from same parse.
    if let AssignmentTarget::ComputedMemberExpression(c) = &assign.left {
        if let Expression::Identifier(obj) = &c.object {
            if obj.name.as_str() != local {
                return false;
            }
        } else {
            return false;
        }
    } else {
        return false;
    }
    id.name.as_str() == tmp
}

fn match_field_assign_back(stmt: &Statement<'_>, field: &str, local: &str) -> bool {
    let Statement::ExpressionStatement(es) = stmt else {
        return false;
    };
    let Expression::AssignmentExpression(assign) = &es.expression else {
        return false;
    };
    if !matches!(assign.operator, AssignmentOperator::Assign) {
        return false;
    }
    let AssignmentTarget::StaticMemberExpression(left) = &assign.left else {
        return false;
    };
    if !matches!(&left.object, Expression::ThisExpression(_)) {
        return false;
    }
    if left.property.name.as_str() != field {
        return false;
    }
    let Expression::Identifier(id) = &assign.right else {
        return false;
    };
    id.name.as_str() == local
}

fn match_computed_local_index(expr: &Expression<'_>, local: &str, source: &str) -> Option<String> {
    let Expression::ComputedMemberExpression(c) = expr else {
        return None;
    };
    let Expression::Identifier(obj) = &c.object else {
        return None;
    };
    if obj.name.as_str() != local {
        return None;
    }
    Some(span_slice(source, c.expression.span()).to_string())
}

fn match_assign_computed_index(
    target: &AssignmentTarget<'_>,
    local: &str,
    source: &str,
) -> Option<String> {
    let AssignmentTarget::ComputedMemberExpression(c) = target else {
        return None;
    };
    let Expression::Identifier(obj) = &c.object else {
        return None;
    };
    if obj.name.as_str() != local {
        return None;
    }
    Some(span_slice(source, c.expression.span()).to_string())
}

fn assignment_computed_index_text(target: &AssignmentTarget<'_>) -> Option<String> {
    let AssignmentTarget::ComputedMemberExpression(c) = target else {
        return None;
    };
    // Prefer numeric literal text without needing source.
    match &c.expression {
        Expression::NumericLiteral(n) if n.value.fract() == 0.0 => {
            Some(format!("{}", n.value as i64))
        }
        Expression::Identifier(id) => Some(id.name.to_string()),
        _ => None,
    }
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
            // Prefer bare index exprs (`i`, `0`, `this.selected`) — arrays coerce keys;
            // skip `String()` when the span is a simple Ident / ThisMember / integer literal.
            Self::Dyn(span) => {
                let t = span_slice(source, *span).trim();
                if is_simple_index_expr(t) { t.to_string() } else { format!("String({})", t) }
            }
        }
    }
}

fn is_simple_index_expr(t: &str) -> bool {
    if t.is_empty() {
        return false;
    }
    if t.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // ident or this.prop (no spaces / calls / brackets)
    let mut chars = t.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == '_' || first == '$') {
        return false;
    }
    t.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$' || c == '.')
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
                if let Some((idx, leaf)) = item_idx_leaf(segs, source) {
                    return match value {
                        ValueExpr::Rhs(span) => {
                            let value_expr = span_slice(source, *span).to_string();
                            format!(
                                "this.constructor.__vmzWritePathItem(this, {root:?}, {idx}, {leaf:?}, {value_expr})"
                            )
                        }
                        ValueExpr::Compound { binop, rhs } => {
                            let rhs = span_slice(source, *rhs);
                            format!(
                                "this.constructor.__vmzWritePathCompoundItem(this, {root:?}, {idx}, {leaf:?}, {binop:?}, {rhs})"
                            )
                        }
                        ValueExpr::Update { binop } => {
                            format!(
                                "this.constructor.__vmzWritePathCompoundItem(this, {root:?}, {idx}, {leaf:?}, {binop:?}, 1)"
                            )
                        }
                        ValueExpr::Logical { kind, rhs } => {
                            let rhs = span_slice(source, *rhs);
                            let segs_lit = segs_parts_literal(segs, source);
                            format!(
                                "this.constructor.__vmzWritePathLogical(this, {root:?}, [{segs_lit}], {kind:?}, {rhs})"
                            )
                        }
                    };
                }
                let segs_lit = segs_parts_literal(segs, source);
                match value {
                    ValueExpr::Logical { kind, rhs } => {
                        let rhs = span_slice(source, *rhs);
                        format!(
                            "this.constructor.__vmzWritePathLogical(this, {root:?}, [{segs_lit}], {kind:?}, {rhs})"
                        )
                    }
                    other => match other {
                        ValueExpr::Rhs(span) => {
                            let value_expr = span_slice(source, *span).to_string();
                            format!(
                                "this.constructor.__vmzWritePath(this, {root:?}, [{segs_lit}], {value_expr})"
                            )
                        }
                        ValueExpr::Compound { binop, rhs } => {
                            let rhs = span_slice(source, *rhs);
                            format!(
                                "this.constructor.__vmzWritePathCompound(this, {root:?}, [{segs_lit}], {binop:?}, {rhs})"
                            )
                        }
                        ValueExpr::Update { binop } => {
                            format!(
                                "this.constructor.__vmzWritePathCompound(this, {root:?}, [{segs_lit}], {binop:?}, 1)"
                            )
                        }
                        ValueExpr::Logical { .. } => unreachable!(),
                    },
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

/// `[idx, "leaf"]` → Item helpers (no per-call segs array alloc).
fn item_idx_leaf(segs: &[SegPart], source: &str) -> Option<(String, String)> {
    if segs.len() != 2 {
        return None;
    }
    let leaf = match &segs[1] {
        SegPart::Static(s) => s.clone(),
        _ => return None,
    };
    let idx = match &segs[0] {
        SegPart::Dyn(span) => span_slice(source, *span).trim().to_string(),
        SegPart::Static(s) if s.chars().all(|c| c.is_ascii_digit()) => s.clone(),
        _ => return None,
    };
    Some((idx, leaf))
}

fn segs_parts_literal(segs: &[SegPart], source: &str) -> String {
    segs.iter().map(|s| s.render(source)).collect::<Vec<_>>().join(", ")
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
        it: &oxc_ast::ast::Function<'a>,
        flags: oxc_syntax::scope::ScopeFlags,
    ) {
        self.with_nested_scope(|this| {
            walk::walk_function(this, it, flags);
        });
    }

    fn visit_arrow_function_expression(&mut self, it: &oxc_ast::ast::ArrowFunctionExpression<'a>) {
        self.with_nested_scope(|this| {
            walk::walk_arrow_function_expression(this, it);
        });
    }

    fn visit_block_statement(&mut self, it: &oxc_ast::ast::BlockStatement<'a>) {
        walk::walk_block_statement(self, it);
    }

    fn visit_statements(&mut self, it: &oxc_allocator::Vec<'a, Statement<'a>>) {
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
