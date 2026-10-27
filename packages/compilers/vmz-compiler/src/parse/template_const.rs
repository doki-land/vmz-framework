//! Compile-time constant folding for template expressions.
//!
//! Only literals — and operator expressions built purely from literals — fold.
//! Anything that can read the instance (`this.*` / fields / imports), call a
//! function, or throw at runtime stays a runtime expression: a binding that is
//! not definitely constant must keep its subscription.
//!
//! Folding decisions feed the Native View (`static` attr / text, `v-if` branch
//! selection) and the Reactive module (no binding for a constant), so both
//! artifacts agree on one rule set.

use oak_typescript::ast::{Expression, ExpressionKind};
use vmz_oak_frontend_adapter::parse_expression_snippet;

/// Literal value the template compiler can decide at build time.
#[derive(Debug, Clone, PartialEq)]
pub enum ConstValue {
    /// String literal, or a hole-free template literal.
    Str(String),
    /// Numeric literal, or folded arithmetic on numeric literals.
    Num(f64),
    /// Boolean literal, or folded negation / comparison.
    Bool(bool),
    /// `null` literal.
    Null,
}

impl ConstValue {
    /// JS truthiness of the folded literal.
    pub fn truthiness(&self) -> bool {
        match self {
            ConstValue::Str(s) => !s.is_empty(),
            ConstValue::Num(n) => *n != 0.0 && !n.is_nan(),
            ConstValue::Bool(b) => *b,
            ConstValue::Null => false,
        }
    }

    /// Static attribute value; `None` means "no attribute" (JS `null`).
    pub fn attr_text(&self) -> Option<String> {
        match self {
            ConstValue::Null => None,
            _ => Some(self.display()),
        }
    }

    /// Static text content (`{{ expr }}`); JS renders `null` as empty text.
    pub fn text_content(&self) -> String {
        match self {
            ConstValue::Null => String::new(),
            _ => self.display(),
        }
    }

    /// `String(value)` shape for JS literals.
    fn display(&self) -> String {
        match self {
            ConstValue::Str(s) => s.clone(),
            ConstValue::Num(n) => js_number(*n),
            ConstValue::Bool(b) => (*b).to_string(),
            ConstValue::Null => "null".to_string(),
        }
    }

    fn type_name(&self) -> &'static str {
        match self {
            ConstValue::Str(_) => "string",
            ConstValue::Num(_) => "number",
            ConstValue::Bool(_) => "boolean",
            ConstValue::Null => "object",
        }
    }
}

/// `String(n)` for finite numbers (integrals print without `.0`).
fn js_number(n: f64) -> String {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
        return (n as i64).to_string();
    }
    format!("{n}")
}

/// Fold `expr` to a literal value when it is definitely constant.
///
/// `None` (never folded) for identifiers, member access, calls, `new`, object /
/// array literals, assignments, `await` / `yield`, arrows and any operator or
/// callee whose runtime behavior is not a pure literal computation.
pub fn fold_const_expr(expr: &str) -> Option<ConstValue> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return None;
    }
    // A hole-free template literal is a single token, and Oak only lowers the
    // interpolated form to an expression node. Reading the raw literal text is
    // not a second parser: it accepts one self-contained token or nothing.
    if let Some(text) = hole_free_template(trimmed) {
        return Some(ConstValue::Str(text));
    }
    let parsed = parse_expression_snippet(trimmed);
    if !parsed.ok {
        return None;
    }
    eval(trimmed, &parsed.expression?)
}

fn eval(src: &str, expr: &Expression) -> Option<ConstValue> {
    match expr.kind.as_ref() {
        ExpressionKind::StringLiteral(s) => Some(ConstValue::Str(s.clone())),
        ExpressionKind::NumericLiteral(n) => Some(ConstValue::Num(*n)),
        ExpressionKind::BooleanLiteral(b) => Some(ConstValue::Bool(*b)),
        ExpressionKind::NullLiteral => Some(ConstValue::Null),
        ExpressionKind::TemplateString(raw) => hole_free_template(raw).map(ConstValue::Str),
        ExpressionKind::UnaryExpression { operator, argument } => {
            let op = unary_operator(src, expr, operator, argument);
            eval_unary(&op, src, argument)
        }
        ExpressionKind::BinaryExpression { left, operator, right } => {
            eval_binary(src, left, operator, right)
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            if eval(src, test)?.truthiness() { eval(src, consequent) } else { eval(src, alternate) }
        }
        ExpressionKind::AsExpression { expression, .. }
        | ExpressionKind::TypeAssertionExpression { expression, .. }
        | ExpressionKind::NonNullExpression(expression) => eval(src, expression),
        _ => None,
    }
}

/// Unary operator token (`!`, `-`, `+`, `typeof`).
///
/// Oak's unary builder takes the text of the *last* leaf, so `typeof 'a'` reports
/// a bare space instead of the keyword. Fall back to the source slice between
/// the expression start and the argument start, which is exactly the operator.
fn unary_operator(src: &str, expr: &Expression, operator: &str, argument: &Expression) -> String {
    let text = operator.trim();
    if !text.is_empty() {
        return text.to_string();
    }
    let start = expr.span.start.min(src.len());
    let end = argument.span.start.clamp(start, src.len());
    src.get(start..end).unwrap_or("").trim().to_string()
}

/// `` `text` `` with no interpolation hole and no escape → its literal text.
fn hole_free_template(raw: &str) -> Option<String> {
    let inner = raw.strip_prefix('`')?.strip_suffix('`')?;
    if inner.contains("${") || inner.contains('\\') || inner.contains('`') {
        return None;
    }
    Some(inner.to_string())
}

fn eval_unary(operator: &str, src: &str, argument: &Expression) -> Option<ConstValue> {
    // `typeof` is an operator (never throws); every other runtime callee is not.
    let value = eval(src, argument)?;
    match operator {
        "!" => Some(ConstValue::Bool(!value.truthiness())),
        "-" => match value {
            ConstValue::Num(n) => Some(ConstValue::Num(-n)),
            _ => None,
        },
        "+" => match value {
            ConstValue::Num(n) => Some(ConstValue::Num(n)),
            _ => None,
        },
        "typeof" => Some(ConstValue::Str(value.type_name().to_string())),
        _ => None,
    }
}

fn eval_binary(
    src: &str,
    left: &Expression,
    operator: &str,
    right: &Expression,
) -> Option<ConstValue> {
    let a = eval(src, left)?;
    let b = eval(src, right)?;
    match operator {
        "+" => {
            if matches!(a, ConstValue::Null) || matches!(b, ConstValue::Null) {
                return None;
            }
            if let (ConstValue::Num(x), ConstValue::Num(y)) = (&a, &b) {
                let sum = x + y;
                return sum.is_finite().then_some(ConstValue::Num(sum));
            }
            if matches!(a, ConstValue::Str(_)) || matches!(b, ConstValue::Str(_)) {
                return Some(ConstValue::Str(format!("{}{}", a.display(), b.display())));
            }
            None
        }
        "-" | "*" | "/" => {
            let (ConstValue::Num(x), ConstValue::Num(y)) = (&a, &b) else {
                return None;
            };
            if operator == "/" && (*y == 0.0 || !y.is_finite()) {
                return None;
            }
            let out = match operator {
                "-" => x - y,
                "*" => x * y,
                _ => x / y,
            };
            out.is_finite().then_some(ConstValue::Num(out))
        }
        "===" | "!==" => {
            let equal = a == b;
            Some(ConstValue::Bool(if operator == "===" { equal } else { !equal }))
        }
        "<" | "<=" | ">" | ">=" => {
            let ordering = match (&a, &b) {
                (ConstValue::Num(x), ConstValue::Num(y)) => x.partial_cmp(y),
                (ConstValue::Str(x), ConstValue::Str(y)) => Some(x.cmp(y)),
                _ => None,
            }?;
            let out = match operator {
                "<" => ordering.is_lt(),
                "<=" => ordering.is_le(),
                ">" => ordering.is_gt(),
                _ => ordering.is_ge(),
            };
            Some(ConstValue::Bool(out))
        }
        _ => None,
    }
}

/// Reachable branches of a `v-if` / `v-else-if` / `v-else` chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IfFold {
    /// Branch indices still reachable, in source order.
    pub kept: Vec<usize>,
    /// Single unconditional survivor (constant-true test or `v-else`); the whole
    /// chain can be replaced by this branch body.
    pub resolved: Option<usize>,
}

/// Resolve constant conditions of an `if` chain (`None` = `v-else`).
///
/// Constant-false branches are dead. A constant-true branch ends the chain: the
/// remaining branches can never be selected. Unknown conditions stay runtime.
pub fn fold_if_chain(conds: &[Option<String>]) -> IfFold {
    let mut kept: Vec<usize> = Vec::new();
    let mut resolved = None;
    for (idx, cond) in conds.iter().enumerate() {
        match cond {
            None => {
                kept.push(idx);
                if kept.len() == 1 {
                    resolved = Some(idx);
                }
                break;
            }
            Some(expr) => match fold_const_expr(expr).map(|v| v.truthiness()) {
                Some(false) => {}
                Some(true) => {
                    kept.push(idx);
                    if kept.len() == 1 {
                        resolved = Some(idx);
                    }
                    break;
                }
                None => kept.push(idx),
            },
        }
    }
    IfFold { kept, resolved }
}

#[cfg(test)]
mod tests {
    use super::{ConstValue, fold_const_expr, fold_if_chain};

    fn s(v: &str) -> Option<String> {
        fold_const_expr(v).and_then(|c| c.attr_text())
    }

    #[test]
    fn folds_literal_and_simple_operator_exprs() {
        assert_eq!(s("'a' + 'b'"), Some("ab".into()));
        assert_eq!(s("1 + 2"), Some("3".into()));
        assert_eq!(s("!false"), Some("true".into()));
        assert_eq!(s("`x${1}`"), None, "interpolated template literal is not constant");
        assert_eq!(s("`plain`"), Some("plain".into()));
        assert_eq!(s("null"), None, "null means no attribute");
        assert_eq!(fold_const_expr("null"), Some(ConstValue::Null));
        assert_eq!(fold_const_expr("{{ 'a' }}"), None, "braces are not an expression");
        assert_eq!(s("true ? 'x' : 'y'"), Some("x".into()));
        assert_eq!(s("typeof 'a'"), Some("string".into()));
    }

    #[test]
    fn refuses_runtime_shaped_exprs() {
        for expr in [
            "count",
            "this.title",
            "this.titleOf()",
            "format('a')",
            "Math.max(1, 2)",
            "1 / 0",
            "new Foo()",
            "[1, 2]",
            "{ a: 1 }",
            "`${count}`",
            "count ? 'a' : 'b'",
            "await load()",
        ] {
            assert_eq!(fold_const_expr(expr), None, "must not fold `{expr}`");
        }
    }

    #[test]
    fn if_chain_drops_dead_branches() {
        let cond = |v: &str| Some(v.to_string());
        assert_eq!(fold_if_chain(&[cond("false"), None]).resolved, Some(1));
        assert_eq!(fold_if_chain(&[cond("false"), None]).kept, vec![1]);
        assert_eq!(fold_if_chain(&[cond("true"), None]).kept, vec![0]);
        assert_eq!(fold_if_chain(&[cond("true"), None]).resolved, Some(0));
        let unknown = fold_if_chain(&[cond("flag"), cond("false"), None]);
        assert_eq!(unknown.kept, vec![0, 2]);
        assert_eq!(unknown.resolved, None);
        assert_eq!(fold_if_chain(&[cond("false"), cond("false")]).kept, Vec::<usize>::new());
    }
}
