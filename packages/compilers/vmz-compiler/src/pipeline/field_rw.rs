//! oxc visitors: `this.field` reads/writes + forbidden `useX`/`createX` factories.
//!
//! Also tracks local aliases / object destructure so
//! `const u = this.user; u.name = ` and `const { name } = this.user` resolve to
//! path keys (`user.name`).

use std::collections::HashMap;

use oxc_ast::ast::{
    AssignmentTarget, BindingPattern, CallExpression, Expression, IdentifierReference,
    MemberExpression, PropertyKey, SimpleAssignmentTarget, StaticMemberExpression,
    UpdateExpression, VariableDeclarator,
};
use oxc_ast_visit::{Visit, walk};
use oxc_span::Span;
use vmz_types::{DepKey, DepPath, PathSegment};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForbiddenFactory {
    pub name: String,
    pub span: Span,
}

#[derive(Debug, Default)]
pub struct FieldRw {
    pub field_names: Vec<String>,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
    /// Direct `this.method` / `this.#method` callees (not yet filtered to known methods).
    pub calls: Vec<String>,
    /// Dynamic / unresolvable `this[...]` (or similar) — force conservative widen.
    pub opaque_callee: bool,
    /// Provenance for FieldStar widenings: `(field, reason)`.
    pub star_reasons: Vec<(String, String)>,
    pub forbidden: Vec<ForbiddenFactory>,
    /// Local binding → DepKey it aliases (`u` → `user`, `name` → `user.name`).
    pub aliases: HashMap<String, DepKey>,
    writing: bool,
}

impl FieldRw {
    pub fn new(field_names: impl IntoIterator<Item = String>) -> Self {
        Self { field_names: field_names.into_iter().collect(), ..Default::default() }
    }

    fn is_field(&self, name: &str) -> bool {
        self.field_names.iter().any(|f| f == name)
    }

    fn push_write(&mut self, name: &str) {
        self.push_write_key(&DepKey::field(name));
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

    /// Nested function / arrow: capture outer aliases, restore after so locals do not leak.
    /// Reads/writes/calls compose into the owner method (stage 02 closure summary v1).
    fn visit_nested_fn_body<F: FnOnce(&mut Self)>(&mut self, f: F) {
        let saved_aliases = self.aliases.clone();
        f(self);
        self.aliases = saved_aliases;
    }

    fn expr_to_key(&self, expr: &Expression<'_>) -> Option<DepKey> {
        match expr {
            Expression::Identifier(id) => self.aliases.get(id.name.as_str()).cloned(),
            Expression::StaticMemberExpression(m) => {
                if let Some(k) = static_this_path(m) {
                    return Some(k);
                }
                let base = self.expr_to_key(&m.object)?;
                Some(extend_key(&base, m.property.name.as_str()))
            }
            Expression::ParenthesizedExpression(p) => self.expr_to_key(&p.expression),
            Expression::TSAsExpression(e) => self.expr_to_key(&e.expression),
            Expression::TSTypeAssertion(e) => self.expr_to_key(&e.expression),
            Expression::TSNonNullExpression(e) => self.expr_to_key(&e.expression),
            Expression::TSSatisfiesExpression(e) => self.expr_to_key(&e.expression),
            Expression::ChainExpression(c) => match &c.expression {
                oxc_ast::ast::ChainElement::StaticMemberExpression(m) => {
                    if let Some(k) = static_this_path(m) {
                        return Some(k);
                    }
                    let base = self.expr_to_key(&m.object)?;
                    Some(extend_key(&base, m.property.name.as_str()))
                }
                _ => None,
            },
            _ => None,
        }
    }

    fn member_alias_path(&self, m: &MemberExpression<'_>) -> Option<DepKey> {
        match m {
            MemberExpression::StaticMemberExpression(s) => {
                let base = self.expr_to_key(&s.object)?;
                Some(extend_key(&base, s.property.name.as_str()))
            }
            MemberExpression::ComputedMemberExpression(c) => {
                // `u[k]` ?cannot prove segment; widen to field star under alias root.
                let base = self.expr_to_key(&c.object)?;
                Some(DepKey::FieldStar(base.root_field().to_string()))
            }
            MemberExpression::PrivateFieldExpression(_) => None,
        }
    }

    fn bind_pattern(&mut self, pat: &BindingPattern<'_>, base: &DepKey) {
        match pat {
            BindingPattern::BindingIdentifier(id) => {
                self.aliases.insert(id.name.to_string(), base.clone());
            }
            BindingPattern::ObjectPattern(obj) => {
                for prop in &obj.properties {
                    match static_prop_name(&prop.key) {
                        Some(name) => {
                            let child = extend_key(base, &name);
                            self.bind_pattern(&prop.value, &child);
                        }
                        None => {
                            // Computed key — cannot prove; widen.
                            let root = base.root_field().to_string();
                            self.note_star_reason(&root, "computed_member");
                            let star = DepKey::FieldStar(root);
                            self.bind_pattern(&prop.value, &star);
                        }
                    }
                }
                if let Some(rest) = &obj.rest {
                    let root = base.root_field().to_string();
                    self.note_star_reason(&root, "rest_destructure");
                    let star = DepKey::FieldStar(root);
                    self.bind_pattern(&rest.argument, &star);
                }
            }
            BindingPattern::ArrayPattern(arr) => {
                // Index precision deferred — conservative FieldStar.
                let root = base.root_field().to_string();
                self.note_star_reason(&root, "array_destructure");
                let star = DepKey::FieldStar(root);
                for el in arr.elements.iter().flatten() {
                    self.bind_pattern(el, &star);
                }
                if let Some(rest) = &arr.rest {
                    self.bind_pattern(&rest.argument, &star);
                }
            }
            BindingPattern::AssignmentPattern(ap) => {
                self.visit_expression(&ap.right);
                self.bind_pattern(&ap.left, base);
            }
        }
    }
}

impl<'a> Visit<'a> for FieldRw {
    fn visit_variable_declarator(&mut self, it: &VariableDeclarator<'a>) {
        if let Some(init) = &it.init {
            self.visit_expression(init);
            if let Some(base) = self.expr_to_key(init) {
                self.bind_pattern(&it.id, &base);
                return;
            }
            // Init is not a known path ?still walk defaults inside patterns.
            walk_binding_defaults(self, &it.id);
            return;
        }
        walk::walk_variable_declarator(self, it);
    }

    fn visit_assignment_expression(&mut self, it: &oxc_ast::ast::AssignmentExpression<'a>) {
        // Destructuring assignment: `({ name } = this.user)` ?right is source.
        if matches!(
            &it.left,
            AssignmentTarget::ObjectAssignmentTarget(_)
                | AssignmentTarget::ArrayAssignmentTarget(_)
        ) {
            self.visit_expression(&it.right);
            if let Some(base) = self.expr_to_key(&it.right) {
                bind_assignment_target_pattern(self, &it.left, &base);
            }
            return;
        }
        self.with_writing(|this| this.visit_assignment_target(&it.left));
        self.visit_expression(&it.right);
    }

    fn visit_update_expression(&mut self, it: &UpdateExpression<'a>) {
        self.with_writing(|this| this.visit_simple_assignment_target(&it.argument));
    }

    fn visit_assignment_target(&mut self, it: &AssignmentTarget<'a>) {
        if let Some(key) = assignment_this_path(it) {
            self.note_key(key);
            // Still walk nested computed keys as reads.
            if let AssignmentTarget::ComputedMemberExpression(m) = it {
                let writing = self.writing;
                self.writing = false;
                self.visit_expression(&m.expression);
                self.writing = writing;
            }
            return;
        }
        if let Some(key) = assignment_alias_path(self, it) {
            self.note_key(key);
            return;
        }
        if let AssignmentTarget::AssignmentTargetIdentifier(id) = it {
            // `name = ` rebinds a local ?clears alias; not a field write.
            if self.writing {
                self.aliases.remove(id.name.as_str());
            } else if let Some(key) = self.aliases.get(id.name.as_str()) {
                self.note_key(key.clone());
            }
            return;
        }
        walk::walk_assignment_target(self, it);
    }

    fn visit_simple_assignment_target(&mut self, it: &SimpleAssignmentTarget<'a>) {
        if let Some(key) = simple_assignment_this_path(it) {
            self.note_key(key);
            return;
        }
        if let Some(key) = simple_assignment_alias_path(self, it) {
            self.note_key(key);
            return;
        }
        if let SimpleAssignmentTarget::AssignmentTargetIdentifier(id) = it {
            if self.writing {
                self.aliases.remove(id.name.as_str());
            } else if let Some(key) = self.aliases.get(id.name.as_str()) {
                self.note_key(key.clone());
            }
            return;
        }
        walk::walk_simple_assignment_target(self, it);
    }

    fn visit_member_expression(&mut self, it: &MemberExpression<'a>) {
        if let Some(key) = member_this_path(it) {
            self.note_key(key);
            return;
        }
        if let Some(key) = self.member_alias_path(it) {
            self.note_key(key);
            return;
        }
        walk::walk_member_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if let Some(key) = self.aliases.get(it.name.as_str()) {
            self.note_key(key.clone());
        }
    }

    fn visit_call_expression(&mut self, it: &CallExpression<'a>) {
        if let Some(name) = callee_factory_name(&it.callee) {
            if is_forbidden_factory(&name) {
                self.forbidden.push(ForbiddenFactory { name, span: it.span });
            }
        }
        // this.tags.push(...) / alias.push(...) ?write field root
        if let Expression::StaticMemberExpression(m) = &it.callee {
            let method = m.property.name.as_str();
            if matches!(
                method,
                "push"
                    | "pop"
                    | "shift"
                    | "unshift"
                    | "splice"
                    | "sort"
                    | "reverse"
                    | "fill"
                    | "copyWithin"
            ) {
                if let Some(root) = object_this_root(&m.object) {
                    self.push_write(&root);
                } else if let Some(key) = self.expr_to_key(&m.object) {
                    self.push_write(key.root_field());
                }
            } else if matches!(&m.object, Expression::ThisExpression(_)) {
                // Sibling method call graph edge: `this.refresh`.
                if !self.calls.iter().any(|c| c == method) {
                    self.calls.push(method.to_string());
                }
            }
        } else if let Expression::PrivateFieldExpression(m) = &it.callee {
            // `this.#load`
            if matches!(&m.object, Expression::ThisExpression(_)) {
                let method = format!("#{}", m.field.name.as_str());
                if !self.calls.iter().any(|c| c == &method) {
                    self.calls.push(method);
                }
            }
        } else if let Expression::ComputedMemberExpression(m) = &it.callee {
            // `this[name]` — cannot prove callee; never treat as empty.
            if matches!(&m.object, Expression::ThisExpression(_)) {
                self.opaque_callee = true;
                for f in self.field_names.clone() {
                    self.note_star_reason(&f, "opaque_callee");
                }
            }
        }
        walk::walk_call_expression(self, it);
    }

    fn visit_arrow_function_expression(&mut self, it: &oxc_ast::ast::ArrowFunctionExpression<'a>) {
        // Nested arrows: capture outer aliases; restore so locals do not leak upward.
        // Reads/writes/calls merge into the owner method (stage 02 closure summary v1).
        self.visit_nested_fn_body(|this| {
            walk::walk_arrow_function_expression(this, it);
        });
    }
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

fn static_prop_name(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) => Some(id.name.to_string()),
        PropertyKey::StringLiteral(s) => Some(s.value.as_str().to_string()),
        PropertyKey::NumericLiteral(n) if n.value.fract() == 0.0 && n.value >= 0.0 => {
            Some((n.value as usize).to_string())
        }
        _ => None,
    }
}

fn walk_binding_defaults(v: &mut FieldRw, pat: &BindingPattern<'_>) {
    match pat {
        BindingPattern::AssignmentPattern(ap) => {
            v.visit_expression(&ap.right);
            walk_binding_defaults(v, &ap.left);
        }
        BindingPattern::ObjectPattern(obj) => {
            for prop in &obj.properties {
                walk_binding_defaults(v, &prop.value);
            }
            if let Some(rest) = &obj.rest {
                walk_binding_defaults(v, &rest.argument);
            }
        }
        BindingPattern::ArrayPattern(arr) => {
            for el in arr.elements.iter().flatten() {
                walk_binding_defaults(v, el);
            }
            if let Some(rest) = &arr.rest {
                walk_binding_defaults(v, &rest.argument);
            }
        }
        BindingPattern::BindingIdentifier(_) => {}
    }
}

fn bind_assignment_target_pattern(v: &mut FieldRw, target: &AssignmentTarget<'_>, base: &DepKey) {
    match target {
        AssignmentTarget::AssignmentTargetIdentifier(id) => {
            v.aliases.insert(id.name.to_string(), base.clone());
        }
        AssignmentTarget::ObjectAssignmentTarget(obj) => {
            bind_object_assignment_target(v, obj, base);
        }
        AssignmentTarget::ArrayAssignmentTarget(arr) => {
            bind_array_assignment_target(v, arr, base);
        }
        _ => {}
    }
}

fn bind_object_assignment_target(
    v: &mut FieldRw,
    obj: &oxc_ast::ast::ObjectAssignmentTarget<'_>,
    base: &DepKey,
) {
    use oxc_ast::ast::AssignmentTargetProperty as P;
    for prop in &obj.properties {
        match prop {
            P::AssignmentTargetPropertyIdentifier(p) => {
                let child = extend_key(base, p.binding.name.as_str());
                v.aliases.insert(p.binding.name.to_string(), child);
                if let Some(init) = &p.init {
                    v.visit_expression(init);
                }
            }
            P::AssignmentTargetPropertyProperty(p) => {
                let child = match static_prop_name(&p.name) {
                    Some(name) => extend_key(base, &name),
                    None => {
                        let root = base.root_field().to_string();
                        v.note_star_reason(&root, "computed_member");
                        DepKey::FieldStar(root)
                    }
                };
                bind_assignment_maybe(v, &p.binding, &child);
            }
        }
    }
    if let Some(rest) = &obj.rest {
        let root = base.root_field().to_string();
        v.note_star_reason(&root, "rest_destructure");
        let star = DepKey::FieldStar(root);
        bind_assignment_target_pattern(v, &rest.target, &star);
    }
}

fn bind_array_assignment_target(
    v: &mut FieldRw,
    arr: &oxc_ast::ast::ArrayAssignmentTarget<'_>,
    base: &DepKey,
) {
    let root = base.root_field().to_string();
    v.note_star_reason(&root, "array_destructure");
    let star = DepKey::FieldStar(root);
    for el in arr.elements.iter().flatten() {
        bind_assignment_maybe(v, el, &star);
    }
    if let Some(rest) = &arr.rest {
        bind_assignment_target_pattern(v, &rest.target, &star);
    }
}

fn bind_assignment_maybe(
    v: &mut FieldRw,
    el: &oxc_ast::ast::AssignmentTargetMaybeDefault<'_>,
    base: &DepKey,
) {
    use oxc_ast::ast::AssignmentTargetMaybeDefault as M;
    match el {
        M::AssignmentTargetWithDefault(d) => {
            v.visit_expression(&d.init);
            bind_assignment_target_pattern(v, &d.binding, base);
        }
        M::AssignmentTargetIdentifier(id) => {
            v.aliases.insert(id.name.to_string(), base.clone());
        }
        M::ObjectAssignmentTarget(obj) => bind_object_assignment_target(v, obj, base),
        M::ArrayAssignmentTarget(arr) => bind_array_assignment_target(v, arr, base),
        _ => {}
    }
}

fn assignment_alias_path(v: &FieldRw, it: &AssignmentTarget<'_>) -> Option<DepKey> {
    match it {
        AssignmentTarget::StaticMemberExpression(m) => {
            let base = v.expr_to_key(&m.object)?;
            Some(extend_key(&base, m.property.name.as_str()))
        }
        AssignmentTarget::ComputedMemberExpression(m) => {
            let base = v.expr_to_key(&m.object)?;
            Some(DepKey::FieldStar(base.root_field().to_string()))
        }
        _ => None,
    }
}

fn simple_assignment_alias_path(v: &FieldRw, it: &SimpleAssignmentTarget<'_>) -> Option<DepKey> {
    match it {
        SimpleAssignmentTarget::StaticMemberExpression(m) => {
            let base = v.expr_to_key(&m.object)?;
            Some(extend_key(&base, m.property.name.as_str()))
        }
        SimpleAssignmentTarget::ComputedMemberExpression(m) => {
            let base = v.expr_to_key(&m.object)?;
            Some(DepKey::FieldStar(base.root_field().to_string()))
        }
        _ => None,
    }
}

fn object_this_root(expr: &Expression<'_>) -> Option<String> {
    match expr {
        Expression::StaticMemberExpression(m) => static_this_root(m),
        Expression::ComputedMemberExpression(m) => match &m.object {
            Expression::StaticMemberExpression(s) => static_this_root(s),
            _ => None,
        },
        _ => None,
    }
}

fn assignment_this_path(it: &AssignmentTarget<'_>) -> Option<DepKey> {
    match it {
        AssignmentTarget::StaticMemberExpression(m) => static_this_path(m),
        AssignmentTarget::ComputedMemberExpression(m) => match &m.object {
            Expression::StaticMemberExpression(inner) => static_this_path(inner),
            Expression::ThisExpression(_) => None,
            _ => None,
        },
        _ => None,
    }
}

fn simple_assignment_this_path(it: &SimpleAssignmentTarget<'_>) -> Option<DepKey> {
    match it {
        SimpleAssignmentTarget::StaticMemberExpression(m) => static_this_path(m),
        SimpleAssignmentTarget::ComputedMemberExpression(m) => match &m.object {
            Expression::StaticMemberExpression(inner) => static_this_path(inner),
            _ => None,
        },
        _ => None,
    }
}

/// `this.user.name` ?Path(user, [name]); `this.count` ?Field(count).
fn static_this_path(m: &StaticMemberExpression<'_>) -> Option<DepKey> {
    let mut segs: Vec<PathSegment> = Vec::new();
    let mut cur = m;
    loop {
        match &cur.object {
            Expression::ThisExpression(_) => {
                let root = cur.property.name.to_string();
                segs.reverse();
                return Some(if segs.is_empty() {
                    DepKey::field(root)
                } else {
                    DepKey::path(DepPath { root, segments: segs })
                });
            }
            Expression::StaticMemberExpression(inner) => {
                segs.push(PathSegment::Ident(cur.property.name.to_string()));
                cur = inner;
            }
            Expression::ComputedMemberExpression(_) => {
                // Dynamic segment ?fall back to field root only.
                return static_this_root(m).map(DepKey::field);
            }
            _ => return None,
        }
    }
}

/// `this.user.name` / `this.count` ?root field `user` / `count`.
fn static_this_root(m: &StaticMemberExpression<'_>) -> Option<String> {
    match &m.object {
        Expression::ThisExpression(_) => Some(m.property.name.to_string()),
        Expression::StaticMemberExpression(inner) => static_this_root(inner),
        Expression::ComputedMemberExpression(inner) => match &inner.object {
            Expression::StaticMemberExpression(s) => static_this_root(s),
            Expression::ThisExpression(_) => None,
            _ => None,
        },
        _ => None,
    }
}

fn member_this_path(m: &MemberExpression<'_>) -> Option<DepKey> {
    match m {
        MemberExpression::StaticMemberExpression(s) => static_this_path(s),
        MemberExpression::ComputedMemberExpression(c) => match &c.object {
            Expression::StaticMemberExpression(s) => static_this_path(s),
            _ => None,
        },
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn callee_factory_name(callee: &Expression<'_>) -> Option<String> {
    match callee {
        Expression::Identifier(id) => Some(id.name.to_string()),
        Expression::StaticMemberExpression(m) => Some(m.property.name.to_string()),
        _ => None,
    }
}

/// `useX` / a closed set of `createX` state-factory names (Vue/React-ish state APIs).
/// Domain constructors like `createAnimator` / `createElement` are not state factories.
pub fn is_forbidden_factory(name: &str) -> bool {
    const ALLOW_CREATE: &[&str] = &[
        "createElement",
        "createDocumentFragment",
        "createTextNode",
        "createComment",
        "createRange",
    ];
    if ALLOW_CREATE.iter().any(|a| *a == name) {
        return false;
    }
    // `useX` — always forbidden as a state API surface.
    if let Some(rest) = name.strip_prefix("use")
        && let Some(c) = rest.chars().next()
        && c.is_ascii_uppercase()
    {
        return true;
    }
    // `createX` — only known state/store factories (not domain constructors).
    const FORBIDDEN_CREATE: &[&str] = &[
        "createStore",
        "createSignal",
        "createReactive",
        "createState",
        "createApp",
        "createRoot",
        "createContext",
        "createMemo",
        "createEffect",
        "createReducer",
        "createSlice",
        "createModel",
        "createSharedState",
        "createGlobalState",
    ];
    FORBIDDEN_CREATE.iter().any(|a| *a == name)
}

/// Collect reads of `this.<field>` from an expression (e.g. field initializer).
#[allow(dead_code)]
pub fn analyze_expr_reads(expr: &Expression<'_>, field_names: &[String]) -> Vec<String> {
    let mut rw = FieldRw::new(field_names.iter().cloned());
    rw.visit_expression(expr);
    rw.reads
}

/// Template expression deps via oxc.
/// Emits stable DepKey strings: `user.name` (path) or `user` (field root).
/// Falls back to a simple scan if the snippet does not parse.
pub fn collect_template_deps(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    collect_template_dep_keys(expr, fields, scope)
        .into_iter()
        .map(|k| k.to_stable_string())
        .collect()
}

/// Property paths rooted at an `each` alias (`tag` / `tag.label` ?`[]` / `["label"]`).
/// Used by Reactive IR build to emit [`vmz_types::IrDepPath::ListItem`] (8.9).
pub fn collect_each_alias_prop_paths(expr: &str, as_name: &str) -> Vec<Vec<String>> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || as_name.is_empty() {
        return Vec::new();
    }
    let src = format!("({trimmed})");
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
        return collect_each_alias_prop_paths_scan(trimmed, as_name);
    }
    let mut v = EachAliasPathVisitor { as_name: as_name.to_string(), paths: Vec::new() };
    v.visit_program(&ret.program);
    v.paths
}

fn collect_each_alias_prop_paths_scan(expr: &str, as_name: &str) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            let preceded_by_dot = start > 0 && chars[start - 1] == '.';
            if preceded_by_dot || ident != as_name {
                continue;
            }
            let mut segs = Vec::new();
            let mut j = i;
            loop {
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < chars.len() && chars[j] == '?' && j + 1 < chars.len() && chars[j + 1] == '.'
                {
                    j += 2;
                } else if j < chars.len() && chars[j] == '.' {
                    j += 1;
                } else {
                    break;
                }
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j >= chars.len()
                    || !(chars[j].is_ascii_alphabetic() || chars[j] == '_' || chars[j] == '$')
                {
                    break;
                }
                let ps = j;
                j += 1;
                while j < chars.len()
                    && (chars[j].is_ascii_alphanumeric() || chars[j] == '_' || chars[j] == '$')
                {
                    j += 1;
                }
                segs.push(chars[ps..j].iter().collect());
                i = j;
            }
            if !out.iter().any(|p| p == &segs) {
                out.push(segs);
            }
        } else {
            i += 1;
        }
    }
    out
}

struct EachAliasPathVisitor {
    as_name: String,
    paths: Vec<Vec<String>>,
}

impl EachAliasPathVisitor {
    fn push_path(&mut self, segs: Vec<String>) {
        if !self.paths.iter().any(|p| p == &segs) {
            self.paths.push(segs);
        }
    }
}

impl<'a> Visit<'a> for EachAliasPathVisitor {
    fn visit_member_expression(&mut self, it: &MemberExpression<'a>) {
        if let Some((root, segs)) = path_from_member(it) {
            if root == self.as_name {
                if segs.iter().any(|s| matches!(s, PathSegment::DynamicIndex(_))) {
                    // Dynamic item sub-path ?keep whole-item ListItem, not a false static leaf.
                    self.push_path(Vec::new());
                    return;
                }
                let props: Vec<String> = segs
                    .into_iter()
                    .filter_map(|s| match s {
                        PathSegment::Ident(n) => Some(n),
                        PathSegment::StaticIndex(n) => Some(n.to_string()),
                        PathSegment::DynamicIndex(_) => None,
                    })
                    .collect();
                self.push_path(props);
                return;
            }
        }
        walk::walk_member_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if it.name.as_str() == self.as_name {
            self.push_path(Vec::new());
        }
    }
}

/// Same as [`collect_template_deps`] but returns structured [`DepKey`]s.
pub fn collect_template_dep_keys(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || fields.is_empty() {
        return Vec::new();
    }
    let src = format!("({trimmed})");
    let allocator = oxc_allocator::Allocator::default();
    let ret = oxc_parser::Parser::new(&allocator, &src, oxc_span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
        return collect_template_deps_scan(trimmed, fields, scope);
    }
    let mut v =
        TemplateDepVisitor { fields: fields.to_vec(), scope: scope.to_vec(), deps: Vec::new() };
    v.visit_program(&ret.program);
    v.deps
}

struct TemplateDepVisitor {
    fields: Vec<String>,
    scope: Vec<String>,
    deps: Vec<DepKey>,
}

impl TemplateDepVisitor {
    fn push(&mut self, key: DepKey) {
        let s = key.to_stable_string();
        if !self.deps.iter().any(|d| d.to_stable_string() == s) {
            self.deps.push(key);
        }
    }

    fn is_field(&self, name: &str) -> bool {
        self.fields.iter().any(|f| f == name)
    }

    fn in_scope(&self, name: &str) -> bool {
        self.scope.iter().any(|s| s == name)
    }

    fn member_to_dep(&self, me: &MemberExpression<'_>) -> Option<DepKey> {
        let (root, segs) = path_from_member(me)?;
        if self.in_scope(&root) || !self.is_field(&root) {
            return None;
        }
        Some(DepKey::path(DepPath { root, segments: segs }))
    }
}

impl<'a> Visit<'a> for TemplateDepVisitor {
    fn visit_member_expression(&mut self, it: &MemberExpression<'a>) {
        if let Some(key) = self.member_to_dep(it) {
            self.push(key);
            if let MemberExpression::ComputedMemberExpression(c) = it {
                // `items[selected].label` ?also depend on `selected` if it is a field.
                self.visit_expression(&c.expression);
            }
            return;
        }
        walk::walk_member_expression(self, it);
    }

    fn visit_identifier_reference(&mut self, it: &oxc_ast::ast::IdentifierReference<'a>) {
        let name = it.name.as_str();
        if self.in_scope(name) || !self.is_field(name) {
            return;
        }
        self.push(DepKey::field(name));
    }
}

fn path_from_member(me: &MemberExpression<'_>) -> Option<(String, Vec<PathSegment>)> {
    match me {
        MemberExpression::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        MemberExpression::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        MemberExpression::PrivateFieldExpression(_) => None,
    }
}

fn path_from_object(expr: &Expression<'_>) -> Option<(String, Vec<PathSegment>)> {
    match expr {
        Expression::Identifier(id) => Some((id.name.to_string(), Vec::new())),
        Expression::ParenthesizedExpression(p) => path_from_object(&p.expression),
        Expression::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        Expression::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        Expression::ChainExpression(c) => path_from_chain_element(&c.expression),
        _ => None,
    }
}

fn path_from_chain_element(
    el: &oxc_ast::ast::ChainElement<'_>,
) -> Option<(String, Vec<PathSegment>)> {
    match el {
        oxc_ast::ast::ChainElement::StaticMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(PathSegment::Ident(m.property.name.to_string()));
            Some((root, segs))
        }
        oxc_ast::ast::ChainElement::ComputedMemberExpression(m) => {
            let (root, mut segs) = path_from_object(&m.object)?;
            segs.push(path_seg_from_index_expr(&m.expression)?);
            Some((root, segs))
        }
        _ => None,
    }
}

fn path_seg_from_index_expr(expr: &Expression<'_>) -> Option<PathSegment> {
    match expr {
        Expression::NumericLiteral(n) if n.value.fract() == 0.0 && n.value >= 0.0 => {
            Some(PathSegment::StaticIndex(n.value as usize))
        }
        Expression::StringLiteral(s) => Some(PathSegment::Ident(s.value.as_str().to_string())),
        Expression::Identifier(id) => Some(PathSegment::DynamicIndex(id.name.to_string())),
        Expression::ParenthesizedExpression(p) => path_seg_from_index_expr(&p.expression),
        _ => None,
    }
}

fn collect_template_deps_scan(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let mut deps: Vec<DepKey> = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            if scope.iter().any(|s| s == &ident) {
                continue;
            }
            let preceded_by_dot = start > 0 && chars[start - 1] == '.';
            if preceded_by_dot {
                continue;
            }
            if !fields.iter().any(|f| f == &ident) {
                continue;
            }
            // Extend `ident.prop.prop` into a path when possible.
            let mut segs = Vec::new();
            let mut j = i;
            loop {
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < chars.len() && chars[j] == '?' && j + 1 < chars.len() && chars[j + 1] == '.'
                {
                    j += 2;
                } else if j < chars.len() && chars[j] == '.' {
                    j += 1;
                } else {
                    break;
                }
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j >= chars.len()
                    || !(chars[j].is_ascii_alphabetic() || chars[j] == '_' || chars[j] == '$')
                {
                    break;
                }
                let ps = j;
                j += 1;
                while j < chars.len()
                    && (chars[j].is_ascii_alphanumeric() || chars[j] == '_' || chars[j] == '$')
                {
                    j += 1;
                }
                let prop: String = chars[ps..j].iter().collect();
                segs.push(PathSegment::Ident(prop));
                i = j;
            }
            let key = if segs.is_empty() {
                DepKey::field(ident)
            } else {
                DepKey::path(DepPath { root: ident, segments: segs })
            };
            let s = key.to_stable_string();
            if !deps.iter().any(|d| d.to_stable_string() == s) {
                deps.push(key);
            }
        } else {
            i += 1;
        }
    }
    deps
}
