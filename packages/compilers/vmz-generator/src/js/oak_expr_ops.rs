//! Oak TypeScript walks for template expression deps and `this.` binding.

use std::collections::{HashMap, HashSet};

use oak_typescript::ast::{Expression, ExpressionKind, ObjectProperty, Statement};
use vmz_oak_frontend_adapter::parse_expression_snippet;
use vmz_types::{DepKey, DepPath, PathSegment};

/// Collect template deps via Oak AST; `None` when Oak cannot lower the snippet.
pub fn collect_template_dep_keys_via_oak(
    expr: &str,
    fields: &[String],
    scope: &[String],
) -> Option<Vec<DepKey>> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || fields.is_empty() {
        return Some(Vec::new());
    }
    let parsed = parse_expression_snippet(trimmed);
    if !parsed.ok {
        return None;
    }
    let root = parsed.expression?;
    let mut v = DepCollector {
        fields: fields.iter().map(|s| s.as_str()).collect(),
        scope: scope.iter().map(|s| s.as_str()).collect(),
        deps: Vec::new(),
    };
    v.visit_expr(&root);
    Some(v.deps)
}

/// Each-alias property paths via Oak; `None` when Oak cannot lower the snippet.
pub fn collect_each_alias_prop_paths_via_oak(expr: &str, as_name: &str) -> Option<Vec<Vec<String>>> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || as_name.is_empty() {
        return Some(Vec::new());
    }
    let parsed = parse_expression_snippet(trimmed);
    if !parsed.ok {
        return None;
    }
    let root = parsed.expression?;
    let mut v = AliasPathCollector { as_name, paths: Vec::new() };
    v.visit_expr(&root);
    Some(v.paths)
}

/// Rewrite bare fields/methods to `this.*` via Oak spans; `None` → caller fallback.
pub fn bind_field_idents_via_oak(
    expr: &str,
    fields: &[String],
    methods: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> Option<String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Some(String::new());
    }
    if fields.is_empty() && methods.is_empty() && scope.is_empty() && aliases.is_empty() {
        return Some(trimmed.to_string());
    }
    let parsed = parse_expression_snippet(trimmed);
    if !parsed.ok {
        return None;
    }
    let root = parsed.expression?;
    let field_set: HashSet<&str> = fields.iter().map(|s| s.as_str()).collect();
    let method_set: HashSet<&str> = methods.iter().map(|s| s.as_str()).collect();
    let scope_set: HashSet<&str> = scope.iter().map(|s| s.as_str()).collect();
    let alias_map: HashMap<&str, &str> =
        aliases.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();

    let mut patches = Vec::new();
    collect_bind_rewrites(&root, &field_set, &method_set, &scope_set, &alias_map, &mut patches);
    Some(apply_rewrites(trimmed, &mut patches))
}

enum Patch {
    InsertPrefix { at: usize, prefix: &'static str },
    Replace { start: usize, end: usize, text: String },
}

fn collect_bind_rewrites(
    expr: &Expression,
    fields: &HashSet<&str>,
    methods: &HashSet<&str>,
    scope: &HashSet<&str>,
    aliases: &HashMap<&str, &str>,
    out: &mut Vec<Patch>,
) {
    match expr.kind.as_ref() {
        ExpressionKind::Identifier(name) => {
            if let Some(to) = aliases.get(name.as_str()) {
                out.push(Patch::Replace {
                    start: expr.span.start,
                    end: expr.span.end,
                    text: (*to).to_string(),
                });
                return;
            }
            if fields.contains(name.as_str()) && !scope.contains(name.as_str()) {
                out.push(Patch::InsertPrefix { at: expr.span.start, prefix: "this." });
            }
        }
        ExpressionKind::CallExpression { func, args } => {
            if let ExpressionKind::Identifier(name) = func.kind.as_ref() {
                if methods.contains(name.as_str()) && !scope.contains(name.as_str()) {
                    out.push(Patch::InsertPrefix { at: func.span.start, prefix: "this." });
                } else {
                    collect_bind_rewrites(func, fields, methods, scope, aliases, out);
                }
            } else {
                collect_bind_rewrites(func, fields, methods, scope, aliases, out);
            }
            for a in args {
                collect_bind_rewrites(a, fields, methods, scope, aliases, out);
            }
        }
        ExpressionKind::MemberExpression { object, property, computed, .. } => {
            collect_bind_rewrites(object, fields, methods, scope, aliases, out);
            if *computed {
                collect_bind_rewrites(property, fields, methods, scope, aliases, out);
            }
        }
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::UpdateExpression { argument, .. }
        | ExpressionKind::AwaitExpression(argument)
        | ExpressionKind::SpreadElement(argument)
        | ExpressionKind::NonNullExpression(argument)
        | ExpressionKind::AsExpression { expression: argument, .. }
        | ExpressionKind::TypeAssertionExpression { expression: argument, .. } => {
            collect_bind_rewrites(argument, fields, methods, scope, aliases, out);
        }
        ExpressionKind::YieldExpression(Some(argument)) => {
            collect_bind_rewrites(argument, fields, methods, scope, aliases, out);
        }
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::AssignmentExpression { left, right, .. } => {
            collect_bind_rewrites(left, fields, methods, scope, aliases, out);
            collect_bind_rewrites(right, fields, methods, scope, aliases, out);
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            collect_bind_rewrites(test, fields, methods, scope, aliases, out);
            collect_bind_rewrites(consequent, fields, methods, scope, aliases, out);
            collect_bind_rewrites(alternate, fields, methods, scope, aliases, out);
        }
        ExpressionKind::NewExpression { func, args } => {
            collect_bind_rewrites(func, fields, methods, scope, aliases, out);
            for a in args {
                collect_bind_rewrites(a, fields, methods, scope, aliases, out);
            }
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for e in elements {
                collect_bind_rewrites(e, fields, methods, scope, aliases, out);
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for p in properties {
                match p {
                    ObjectProperty::Property { value, shorthand, name, span, .. } => {
                        if *shorthand {
                            if let Some(to) = aliases.get(name.as_str()) {
                                out.push(Patch::Replace {
                                    start: span.start,
                                    end: span.end,
                                    text: format!("{name}: {to}"),
                                });
                            } else if fields.contains(name.as_str()) && !scope.contains(name.as_str())
                            {
                                out.push(Patch::Replace {
                                    start: span.start,
                                    end: span.end,
                                    text: format!("{name}: this.{name}"),
                                });
                            }
                        } else {
                            collect_bind_rewrites(value, fields, methods, scope, aliases, out);
                        }
                    }
                    ObjectProperty::Spread(e) => {
                        collect_bind_rewrites(e, fields, methods, scope, aliases, out);
                    }
                }
            }
        }
        ExpressionKind::ArrowFunction { body, .. } => {
            walk_stmt_for_bind(body, fields, methods, scope, aliases, out);
        }
        ExpressionKind::TaggedTemplateExpression { tag, template } => {
            collect_bind_rewrites(tag, fields, methods, scope, aliases, out);
            collect_bind_rewrites(template, fields, methods, scope, aliases, out);
        }
        ExpressionKind::ImportExpression { module_specifier } => {
            collect_bind_rewrites(module_specifier, fields, methods, scope, aliases, out);
        }
        _ => {}
    }
}

fn walk_stmt_for_bind(
    stmt: &Statement,
    fields: &HashSet<&str>,
    methods: &HashSet<&str>,
    scope: &HashSet<&str>,
    aliases: &HashMap<&str, &str>,
    out: &mut Vec<Patch>,
) {
    match stmt {
        Statement::ExpressionStatement(es) => {
            collect_bind_rewrites(&es.expression, fields, methods, scope, aliases, out);
        }
        Statement::BlockStatement(block) => {
            for s in &block.statements {
                walk_stmt_for_bind(s, fields, methods, scope, aliases, out);
            }
        }
        Statement::ReturnStatement(rs) => {
            if let Some(e) = &rs.argument {
                collect_bind_rewrites(e, fields, methods, scope, aliases, out);
            }
        }
        _ => {}
    }
}

fn apply_rewrites(src: &str, patches: &mut [Patch]) -> String {
    patches.sort_by(|a, b| {
        let ka = match a {
            Patch::InsertPrefix { at, .. } => *at,
            Patch::Replace { start, .. } => *start,
        };
        let kb = match b {
            Patch::InsertPrefix { at, .. } => *at,
            Patch::Replace { start, .. } => *start,
        };
        kb.cmp(&ka)
    });
    let mut out = src.to_string();
    for p in patches.iter() {
        match p {
            Patch::InsertPrefix { at, prefix } => {
                if *at <= out.len() {
                    out.insert_str(*at, prefix);
                }
            }
            Patch::Replace { start, end, text } => {
                if *start <= *end && *end <= out.len() {
                    out.replace_range(*start..*end, text);
                }
            }
        }
    }
    out
}

struct DepCollector<'a> {
    fields: HashSet<&'a str>,
    scope: HashSet<&'a str>,
    deps: Vec<DepKey>,
}

impl DepCollector<'_> {
    fn push(&mut self, key: DepKey) {
        let s = key.to_stable_string();
        if !self.deps.iter().any(|d| d.to_stable_string() == s) {
            self.deps.push(key);
        }
    }

    fn visit_expr(&mut self, expr: &Expression) {
        match expr.kind.as_ref() {
            ExpressionKind::Identifier(name) => {
                if !self.scope.contains(name.as_str()) && self.fields.contains(name.as_str()) {
                    self.push(DepKey::field(name));
                }
            }
            ExpressionKind::MemberExpression { object, property, computed, .. } => {
                if let Some((root, segs)) = path_from_member(expr) {
                    if !self.scope.contains(root.as_str()) && self.fields.contains(root.as_str()) {
                        self.push(DepKey::path(DepPath { root, segments: segs }));
                        if *computed {
                            self.visit_expr(property);
                        }
                        return;
                    }
                }
                self.visit_expr(object);
                if *computed {
                    self.visit_expr(property);
                }
            }
            ExpressionKind::UnaryExpression { argument, .. }
            | ExpressionKind::UpdateExpression { argument, .. }
            | ExpressionKind::AwaitExpression(argument)
            | ExpressionKind::SpreadElement(argument)
            | ExpressionKind::NonNullExpression(argument)
            | ExpressionKind::AsExpression { expression: argument, .. }
            | ExpressionKind::TypeAssertionExpression { expression: argument, .. } => {
                self.visit_expr(argument);
            }
            ExpressionKind::YieldExpression(Some(argument)) => self.visit_expr(argument),
            ExpressionKind::BinaryExpression { left, right, .. }
            | ExpressionKind::AssignmentExpression { left, right, .. } => {
                self.visit_expr(left);
                self.visit_expr(right);
            }
            ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
                self.visit_expr(test);
                self.visit_expr(consequent);
                self.visit_expr(alternate);
            }
            ExpressionKind::CallExpression { func, args }
            | ExpressionKind::NewExpression { func, args } => {
                self.visit_expr(func);
                for a in args {
                    self.visit_expr(a);
                }
            }
            ExpressionKind::ArrayLiteral { elements } => {
                for e in elements {
                    self.visit_expr(e);
                }
            }
            ExpressionKind::ObjectLiteral { properties } => {
                for p in properties {
                    match p {
                        ObjectProperty::Property { value, .. } => self.visit_expr(value),
                        ObjectProperty::Spread(e) => self.visit_expr(e),
                    }
                }
            }
            ExpressionKind::ArrowFunction { body, .. } => self.visit_stmt(body),
            ExpressionKind::TaggedTemplateExpression { tag, template } => {
                self.visit_expr(tag);
                self.visit_expr(template);
            }
            ExpressionKind::ImportExpression { module_specifier } => {
                self.visit_expr(module_specifier);
            }
            _ => {}
        }
    }

    fn visit_stmt(&mut self, stmt: &Statement) {
        match stmt {
            Statement::ExpressionStatement(es) => self.visit_expr(&es.expression),
            Statement::BlockStatement(block) => {
                for s in &block.statements {
                    self.visit_stmt(s);
                }
            }
            Statement::ReturnStatement(rs) => {
                if let Some(e) = &rs.argument {
                    self.visit_expr(e);
                }
            }
            _ => {}
        }
    }
}

struct AliasPathCollector<'a> {
    as_name: &'a str,
    paths: Vec<Vec<String>>,
}

impl AliasPathCollector<'_> {
    fn push_path(&mut self, segs: Vec<String>) {
        if !self.paths.iter().any(|p| p == &segs) {
            self.paths.push(segs);
        }
    }

    fn visit_expr(&mut self, expr: &Expression) {
        match expr.kind.as_ref() {
            ExpressionKind::Identifier(name) if name == self.as_name => {
                self.push_path(Vec::new());
            }
            ExpressionKind::MemberExpression { object, property, computed, .. } => {
                if let Some((root, segs)) = path_from_member(expr) {
                    if root == self.as_name {
                        let dynamic = segs.iter().any(|s| matches!(s, PathSegment::DynamicIndex(_)));
                        if dynamic {
                            self.push_path(Vec::new());
                        } else {
                            let props: Vec<String> = segs
                                .into_iter()
                                .filter_map(|s| match s {
                                    PathSegment::Ident(n) => Some(n),
                                    PathSegment::StaticIndex(n) => Some(n.to_string()),
                                    PathSegment::DynamicIndex(_) => None,
                                })
                                .collect();
                            self.push_path(props);
                        }
                        return;
                    }
                }
                self.visit_expr(object);
                if *computed {
                    self.visit_expr(property);
                }
            }
            ExpressionKind::UnaryExpression { argument, .. }
            | ExpressionKind::UpdateExpression { argument, .. }
            | ExpressionKind::AwaitExpression(argument)
            | ExpressionKind::SpreadElement(argument)
            | ExpressionKind::NonNullExpression(argument)
            | ExpressionKind::AsExpression { expression: argument, .. }
            | ExpressionKind::TypeAssertionExpression { expression: argument, .. } => {
                self.visit_expr(argument);
            }
            ExpressionKind::YieldExpression(Some(argument)) => self.visit_expr(argument),
            ExpressionKind::BinaryExpression { left, right, .. }
            | ExpressionKind::AssignmentExpression { left, right, .. } => {
                self.visit_expr(left);
                self.visit_expr(right);
            }
            ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
                self.visit_expr(test);
                self.visit_expr(consequent);
                self.visit_expr(alternate);
            }
            ExpressionKind::CallExpression { func, args }
            | ExpressionKind::NewExpression { func, args } => {
                self.visit_expr(func);
                for a in args {
                    self.visit_expr(a);
                }
            }
            ExpressionKind::ArrayLiteral { elements } => {
                for e in elements {
                    self.visit_expr(e);
                }
            }
            ExpressionKind::ObjectLiteral { properties } => {
                for p in properties {
                    match p {
                        ObjectProperty::Property { value, .. } => self.visit_expr(value),
                        ObjectProperty::Spread(e) => self.visit_expr(e),
                    }
                }
            }
            ExpressionKind::ArrowFunction { body, .. } => self.visit_stmt(body),
            _ => {}
        }
    }

    fn visit_stmt(&mut self, stmt: &Statement) {
        match stmt {
            Statement::ExpressionStatement(es) => self.visit_expr(&es.expression),
            Statement::BlockStatement(block) => {
                for s in &block.statements {
                    self.visit_stmt(s);
                }
            }
            Statement::ReturnStatement(rs) => {
                if let Some(e) = &rs.argument {
                    self.visit_expr(e);
                }
            }
            _ => {}
        }
    }
}

fn path_from_member(expr: &Expression) -> Option<(String, Vec<PathSegment>)> {
    match expr.kind.as_ref() {
        ExpressionKind::Identifier(name) => Some((name.clone(), Vec::new())),
        ExpressionKind::MemberExpression { object, property, computed, .. } => {
            let (root, mut segs) = path_from_member(object)?;
            if *computed {
                segs.push(path_seg_from_index(property)?);
            } else if let ExpressionKind::Identifier(name) = property.kind.as_ref() {
                segs.push(PathSegment::Ident(name.clone()));
            } else {
                return None;
            }
            Some((root, segs))
        }
        _ => None,
    }
}

fn path_seg_from_index(expr: &Expression) -> Option<PathSegment> {
    match expr.kind.as_ref() {
        ExpressionKind::NumericLiteral(n) if n.fract() == 0.0 && *n >= 0.0 => {
            Some(PathSegment::StaticIndex(*n as usize))
        }
        ExpressionKind::StringLiteral(s) => Some(PathSegment::Ident(s.clone())),
        ExpressionKind::Identifier(id) => Some(PathSegment::DynamicIndex(id.clone())),
        _ => None,
    }
}
