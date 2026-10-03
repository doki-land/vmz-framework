//! Component factory restrictions and Oak template dependency collection.

use vmz_types::{DepKey, SourceRange};

/// A call to a forbidden `useX` / `createX`-style factory in component script.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForbiddenFactory {
    /// Callee identifier as written (e.g. `useState`).
    pub name: String,
    /// Source span of the call for diagnostics.
    pub span: SourceRange,
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
    if ALLOW_CREATE.contains(&name) {
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
    FORBIDDEN_CREATE.contains(&name)
}

/// Template expression deps (Oak primary via generator).
/// Emits stable DepKey strings: `user.name` (path) or `user` (field root).
pub fn collect_template_deps(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    vmz_generator::js::collect_template_deps(expr, fields, scope)
}

/// Property paths rooted at an `each` alias (`tag` / `tag.label` → `[]` / `["label"]`).
/// Used by Reactive IR build to emit [`vmz_types::IrDepPath::ListItem`] (8.9).
pub fn collect_each_alias_prop_paths(expr: &str, as_name: &str) -> Vec<Vec<String>> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || as_name.is_empty() {
        return Vec::new();
    }
    vmz_generator::js::collect_each_alias_prop_paths_via_oak(trimmed, as_name).unwrap_or_default()
}

/// Same as [`collect_template_deps`] but returns structured [`DepKey`]s.
pub fn collect_template_dep_keys(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    vmz_generator::js::collect_template_dep_keys(expr, fields, scope)
}
