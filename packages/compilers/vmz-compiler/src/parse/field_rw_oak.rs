//! Oak TypeScript FieldRw: `this.field` reads/writes + sibling calls (method RW peel).
//!
//! Mirrors [`crate::pipeline::field_rw::FieldRw`] for the Oak AST surface.

use std::collections::{HashMap, HashSet};

use oak_typescript::ast::{Expression, ExpressionKind, ObjectProperty, Statement};
use vmz_types::{DepKey, DepPath, PathSegment};

/// Accumulated field reads/writes/calls from an Oak method body walk.
#[derive(Debug, Default)]
pub struct OakFieldRw {
    field_names: Vec<String>,
    /// Stable dep path strings read during the visit.
    pub reads: Vec<String>,
    /// Stable dep path strings written during the visit.
    pub writes: Vec<String>,
    /// Direct `this.method` / `this.#method` callees.
    pub calls: Vec<String>,
    /// Dynamic / unresolvable `this[...]` callee.
    pub opaque_callee: bool,
    /// Provenance for FieldStar widenings: `(field, reason)`.
    pub star_reasons: Vec<(String, String)>,
    aliases: HashMap<String, DepKey>,
    read_only_aliases: HashSet<String>,
    writing: bool,
}

impl OakFieldRw {
    /// Start a visitor scoped to the given component field names.
    pub fn new(field_names: impl IntoIterator<Item = String>) -> Self {
        Self { field_names: field_names.into_iter().collect(), ..Default::default() }
    }

    /// Walk every statement in a method body.
    pub fn walk_body(&mut self, body: &[Statement]) {
        for stmt in body {
            self.walk_stmt(stmt);
        }
    }

    /// Report whether a local alias is currently bound in this visitor scope.
    pub fn has_alias(&self, name: &str) -> bool {
        self.aliases.contains_key(name)
    }

    fn is_field(&self, name: &str) -> bool {
        self.field_names.iter().any(|f| f == name)
    }

    fn push_read_key(&mut self, key: &DepKey) {
        let root = key.root_field();
        if !self.is_field(root) {
            return;
        }
        let s = key.to_stable_string();
        if !self.reads.iter().any(|r| r == &s) {
            self.reads.push(s);
        }
    }

    fn push_write_key(&mut self, key: &DepKey) {
        let root = key.root_field();
        if !self.is_field(root) {
            return;
        }
        let s = key.to_stable_string();
        if !self.writes.iter().any(|w| w == &s) {
            self.writes.push(s);
        }
    }

    fn push_write_root(&mut self, name: &str) {
        self.push_write_key(&DepKey::field(name));
    }

    fn with_writing<F: FnOnce(&mut Self)>(&mut self, f: F) {
        let prev = self.writing;
        self.writing = true;
        f(self);
        self.writing = prev;
    }

    fn note_key(&mut self, key: DepKey) {
        if self.writing {
            self.push_write_key(&key);
        } else {
            self.push_read_key(&key);
        }
    }

    fn note_star_reason(&mut self, field: &str, reason: &str) {
        if !self.star_reasons.iter().any(|(f, _)| f == field) {
            self.star_reasons.push((field.to_string(), reason.to_string()));
        }
    }

    fn bind_pattern(&mut self, pattern: &str, base: DepKey) {
        let pattern = pattern.trim();
        if pattern.starts_with('{') && pattern.ends_with('}') {
            for item in pattern[1..pattern.len() - 1].split(',') {
                let item = item.trim();
                if item.is_empty() || item.starts_with("...") {
                    continue;
                }
                let mut names = item.splitn(2, ':').map(str::trim);
                let property = names.next().unwrap_or_default();
                let local = names.next().unwrap_or(property);
                if property.is_empty() || local.is_empty() {
                    continue;
                }
                let key = extend_key(&base, property);
                self.push_read_key(&key);
                self.aliases.insert(local.to_string(), key);
                self.read_only_aliases.insert(local.to_string());
            }
            return;
        }
        if pattern.starts_with('[') && pattern.ends_with(']') {
            self.note_star_reason(base.root_field(), "array_destructure");
            self.push_read_key(&DepKey::FieldStar(base.root_field().to_string()));
            for (index, local) in pattern[1..pattern.len() - 1].split(',').enumerate() {
                let local = local.trim();
                if local.is_empty() || local.starts_with("...") {
                    continue;
                }
                let key = DepKey::IndexPath {
                    root: base.root_field().to_string(),
                    index: PathSegment::Ident(index.to_string()),
                    segments: Vec::new(),
                };
                self.push_read_key(&key);
                self.aliases.insert(local.to_string(), key);
                self.read_only_aliases.insert(local.to_string());
            }
            return;
        }
        self.aliases.insert(pattern.to_string(), base);
    }

    fn walk_stmt(&mut self, stmt: &Statement) {
        match stmt {
            Statement::ExpressionStatement(es) => self.walk_expr(&es.expression),
            Statement::VariableDeclaration(v) => {
                if let Some(init) = &v.value {
                    self.walk_expr(init);
                    if !v.name.is_empty() {
                        if let Some(base) = self.expr_to_key(init) {
                            self.bind_pattern(&v.name, base);
                        }
                    }
                }
            }
            Statement::ReturnStatement(r) => {
                if let Some(e) = &r.argument {
                    self.walk_expr(e);
                }
            }
            Statement::IfStatement(i) => {
                self.walk_expr(&i.test);
                self.walk_stmt(&i.consequent);
                if let Some(alt) = &i.alternate {
                    self.walk_stmt(alt);
                }
            }
            Statement::BlockStatement(b) => {
                for s in &b.statements {
                    self.walk_stmt(s);
                }
            }
            Statement::WhileStatement(w) => {
                self.walk_expr(&w.test);
                self.walk_stmt(&w.body);
            }
            Statement::DoWhileStatement(d) => {
                self.walk_stmt(&d.body);
                self.walk_expr(&d.test);
            }
            Statement::ForStatement(f) => {
                if let Some(init) = &f.initializer {
                    self.walk_stmt(init);
                }
                if let Some(test) = &f.test {
                    self.walk_expr(test);
                }
                if let Some(update) = &f.incrementor {
                    self.walk_expr(update);
                }
                self.walk_stmt(&f.body);
            }
            Statement::ForInStatement(f) => {
                self.walk_expr(&f.right);
                self.walk_stmt(&f.body);
            }
            Statement::ForOfStatement(f) => {
                self.walk_expr(&f.right);
                self.walk_stmt(&f.body);
            }
            Statement::TryStatement(t) => {
                for s in &t.block {
                    self.walk_stmt(s);
                }
                if let Some(handler) = &t.handler {
                    for s in &handler.body {
                        self.walk_stmt(s);
                    }
                }
                if let Some(finalizer) = &t.finalizer {
                    for s in finalizer {
                        self.walk_stmt(s);
                    }
                }
            }
            Statement::ThrowStatement(t) => self.walk_expr(&t.argument),
            Statement::SwitchStatement(s) => {
                self.walk_expr(&s.discriminant);
                for c in &s.cases {
                    if let Some(test) = &c.test {
                        self.walk_expr(test);
                    }
                    for st in &c.consequent {
                        self.walk_stmt(st);
                    }
                }
            }
            Statement::FunctionDeclaration(f) => {
                let saved = self.aliases.clone();
                for s in &f.body {
                    self.walk_stmt(s);
                }
                self.aliases = saved;
            }
            _ => {}
        }
    }

    fn walk_expr(&mut self, expr: &Expression) {
        match expr.kind.as_ref() {
            ExpressionKind::Identifier(name) => {
                if let Some(key) = self.aliases.get(name) {
                    self.note_key(key.clone());
                }
            }
            ExpressionKind::MemberExpression { object, property, computed, .. } => {
                if *computed {
                    self.walk_expr(object);
                    self.walk_expr(property);
                    if !is_this(object) {
                        if let Some(base) = self.expr_to_key(object) {
                            self.note_key(DepKey::FieldStar(base.root_field().to_string()));
                        }
                    }
                    return;
                }
                if let Some(key) = member_this_path(object, property) {
                    self.note_key(key);
                    return;
                }
                if let Some(base) = self.expr_to_key(object) {
                    if let ExpressionKind::Identifier(prop) = property.kind.as_ref() {
                        self.note_key(extend_key(&base, prop));
                        return;
                    }
                }
                self.walk_expr(object);
                self.walk_expr(property);
            }
            ExpressionKind::AssignmentExpression { left, right, .. } => {
                self.with_writing(|this| this.walk_assign_target(left));
                self.walk_expr(right);
            }
            ExpressionKind::UpdateExpression { argument, .. } => {
                self.with_writing(|this| this.walk_assign_target(argument));
            }
            ExpressionKind::CallExpression { func, args } => {
                self.note_call_callee(func);
                self.walk_expr(func);
                for a in args {
                    self.walk_expr(a);
                }
            }
            ExpressionKind::NewExpression { func, args } => {
                self.walk_expr(func);
                for a in args {
                    self.walk_expr(a);
                }
            }
            ExpressionKind::BinaryExpression { left, right, .. } => {
                self.walk_expr(left);
                self.walk_expr(right);
            }
            ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
                self.walk_expr(test);
                self.walk_expr(consequent);
                self.walk_expr(alternate);
            }
            ExpressionKind::UnaryExpression { argument, .. }
            | ExpressionKind::AsExpression { expression: argument, .. }
            | ExpressionKind::TypeAssertionExpression { expression: argument, .. }
            | ExpressionKind::NonNullExpression(argument)
            | ExpressionKind::AwaitExpression(argument)
            | ExpressionKind::SpreadElement(argument) => self.walk_expr(argument),
            ExpressionKind::YieldExpression(Some(inner)) => self.walk_expr(inner),
            ExpressionKind::ArrayLiteral { elements } => {
                for e in elements {
                    self.walk_expr(e);
                }
            }
            ExpressionKind::ObjectLiteral { properties } => {
                for p in properties {
                    match p {
                        ObjectProperty::Property { value, .. } => self.walk_expr(value),
                        ObjectProperty::Spread(e) => self.walk_expr(e),
                    }
                }
            }
            ExpressionKind::ArrowFunction { body, .. } => {
                let saved = self.aliases.clone();
                self.walk_stmt(body);
                self.aliases = saved;
            }
            ExpressionKind::FunctionExpression { body, .. } => {
                let saved = self.aliases.clone();
                for s in body {
                    self.walk_stmt(s);
                }
                self.aliases = saved;
            }
            ExpressionKind::TaggedTemplateExpression { tag, template } => {
                self.walk_expr(tag);
                self.walk_expr(template);
            }
            ExpressionKind::ImportExpression { module_specifier } => {
                self.walk_expr(module_specifier);
            }
            _ => {}
        }
    }

    fn walk_assign_target(&mut self, expr: &Expression) {
        match expr.kind.as_ref() {
            ExpressionKind::MemberExpression { object, property, computed, .. } => {
                if *computed {
                    self.walk_expr(property);
                    if let Some(base) = self.expr_to_key(object) {
                        self.note_key(DepKey::FieldStar(base.root_field().to_string()));
                    } else if let Some(key) = static_this_path_from_object(object) {
                        self.note_key(DepKey::field(key.root_field()));
                    }
                    return;
                }
                if let Some(key) = member_this_path(object, property) {
                    self.note_key(key);
                    return;
                }
                if let Some(base) = self.expr_to_key(object) {
                    if let ExpressionKind::Identifier(prop) = property.kind.as_ref() {
                        self.note_key(extend_key(&base, prop));
                        return;
                    }
                }
                self.walk_expr(object);
                self.walk_expr(property);
            }
            ExpressionKind::Identifier(name) => {
                if self.writing {
                    if self.read_only_aliases.contains(name) {
                        return;
                    }
                    if let Some(key) = self.aliases.get(name).cloned() {
                        self.note_key(key);
                    } else {
                        self.aliases.remove(name);
                    }
                } else if let Some(key) = self.aliases.get(name) {
                    self.note_key(key.clone());
                }
            }
            ExpressionKind::AsExpression { expression, .. }
            | ExpressionKind::TypeAssertionExpression { expression, .. }
            | ExpressionKind::NonNullExpression(expression) => {
                self.walk_assign_target(expression);
            }
            _ => self.walk_expr(expr),
        }
    }

    fn note_call_callee(&mut self, func: &Expression) {
        match func.kind.as_ref() {
            ExpressionKind::MemberExpression { object, property, computed: false, .. } => {
                if let ExpressionKind::Identifier(method) = property.kind.as_ref() {
                    if is_array_mutator(method) {
                        if let Some(root) = object_this_root(object) {
                            self.push_write_root(&root);
                        } else if let Some(key) = self.expr_to_key(object) {
                            self.push_write_root(key.root_field());
                        }
                    } else if is_this(object) {
                        if !self.calls.iter().any(|c| c == method) {
                            self.calls.push(method.clone());
                        }
                    }
                }
            }
            ExpressionKind::MemberExpression { object, computed: true, .. } => {
                if is_this(object) {
                    self.opaque_callee = true;
                    for f in self.field_names.clone() {
                        self.note_star_reason(&f, "opaque_callee");
                    }
                }
            }
            _ => {}
        }
    }

    fn expr_to_key(&self, expr: &Expression) -> Option<DepKey> {
        match expr.kind.as_ref() {
            ExpressionKind::Identifier(id) => self.aliases.get(id).cloned(),
            ExpressionKind::MemberExpression { object, property, computed: false, .. } => {
                if let Some(k) = member_this_path(object, property) {
                    return Some(k);
                }
                let base = self.expr_to_key(object)?;
                let ExpressionKind::Identifier(prop) = property.kind.as_ref() else {
                    return None;
                };
                Some(extend_key(&base, prop))
            }
            ExpressionKind::AsExpression { expression, .. }
            | ExpressionKind::TypeAssertionExpression { expression, .. }
            | ExpressionKind::NonNullExpression(expression) => self.expr_to_key(expression),
            _ => None,
        }
    }
}

fn is_this(expr: &Expression) -> bool {
    matches!(expr.kind.as_ref(), ExpressionKind::Identifier(n) if n == "this")
}

fn is_array_mutator(name: &str) -> bool {
    matches!(
        name,
        "push" | "pop" | "shift" | "unshift" | "splice" | "sort" | "reverse" | "fill" | "copyWithin"
    )
}

fn extend_key(base: &DepKey, prop: &str) -> DepKey {
    match base {
        DepKey::Field(root) => DepKey::path(DepPath::prop(root.clone(), prop)),
        DepKey::Path(p) => {
            let mut segs = p.segments.clone();
            segs.push(PathSegment::Ident(prop.to_string()));
            DepKey::path(DepPath { root: p.root.clone(), segments: segs })
        }
        DepKey::FieldStar(root) => DepKey::FieldStar(root.clone()),
        DepKey::IndexPath { root, index, segments: segs } => {
            let mut segs = segs.clone();
            segs.push(PathSegment::Ident(prop.to_string()));
            DepKey::IndexPath { root: root.clone(), index: index.clone(), segments: segs }
        }
    }
}

fn member_this_path(object: &Expression, property: &Expression) -> Option<DepKey> {
    let ExpressionKind::Identifier(prop) = property.kind.as_ref() else {
        return None;
    };
    if is_this(object) {
        return Some(DepKey::field(prop.clone()));
    }
    let ExpressionKind::MemberExpression {
        object: inner_obj,
        property: inner_prop,
        computed: false,
        ..
    } = object.kind.as_ref()
    else {
        return None;
    };
    let base = member_this_path(inner_obj, inner_prop)?;
    Some(extend_key(&base, prop))
}

fn static_this_path_from_object(object: &Expression) -> Option<DepKey> {
    match object.kind.as_ref() {
        ExpressionKind::MemberExpression { object, property, computed: false, .. } => {
            member_this_path(object, property)
        }
        _ => None,
    }
}

fn object_this_root(expr: &Expression) -> Option<String> {
    match expr.kind.as_ref() {
        ExpressionKind::MemberExpression { object, property, computed: false, .. } => {
            if is_this(object) {
                if let ExpressionKind::Identifier(n) = property.kind.as_ref() {
                    return Some(n.clone());
                }
            }
            object_this_root(object)
        }
        _ => None,
    }
}
