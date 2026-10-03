//! Template expression dependencies through Oak, with a conservative lexical fallback.

use vmz_types::DepKey;

/// Template expression deps as stable `DepKey` strings.
pub fn collect_template_deps(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    collect_template_dep_keys(expr, fields, scope)
        .into_iter()
        .map(|key| key.to_stable_string())
        .collect()
}

/// Collect structured dependencies without a legacy parser fallback.
pub fn collect_template_dep_keys(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let trimmed = expr.trim();
    if trimmed.is_empty() || fields.is_empty() {
        return Vec::new();
    }
    super::oak_expr_ops::collect_template_dep_keys_via_oak(trimmed, fields, scope)
        .unwrap_or_else(|| collect_template_deps_scan(trimmed, fields, scope))
}

fn collect_template_deps_scan(expr: &str, fields: &[String], scope: &[String]) -> Vec<DepKey> {
    let mut deps: Vec<DepKey> = Vec::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut index = 0;
    while index < chars.len() {
        let ch = chars[index];
        if ch.is_ascii_alphabetic() || ch == '_' || ch == '$' {
            let start = index;
            index += 1;
            while index < chars.len()
                && (chars[index].is_ascii_alphanumeric() || chars[index] == '_' || chars[index] == '$')
            {
                index += 1;
            }
            let ident: String = chars[start..index].iter().collect();
            let preceded_by_dot = start > 0 && chars[start - 1] == '.';
            if preceded_by_dot
                || scope.iter().any(|name| name == &ident)
                || !fields.iter().any(|field| field == &ident)
            {
                continue;
            }
            let key = DepKey::field(&ident);
            if !deps.iter().any(|dep| dep.to_stable_string() == key.to_stable_string()) {
                deps.push(key);
            }
        } else {
            index += 1;
        }
    }
    deps
}
