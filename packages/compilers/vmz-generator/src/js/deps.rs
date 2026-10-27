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
    collect_template_dep_ctx(expr, fields, scope, &[]).0
}

/// Collect structured deps plus sibling class method / getter references.
///
/// Expanding a referenced method's body reads stays with the caller: this layer
/// only reports names. When Oak cannot lower the snippet the lexical fallback
/// still reports field keys but deliberately reports no method names, because
/// the scanner cannot tell a method from a global.
pub fn collect_template_dep_ctx(
    expr: &str,
    fields: &[String],
    scope: &[String],
    methods: &[String],
) -> (Vec<DepKey>, Vec<String>) {
    let trimmed = expr.trim();
    if trimmed.is_empty() || (fields.is_empty() && methods.is_empty()) {
        return (Vec::new(), Vec::new());
    }
    match super::oak_expr_ops::collect_template_deps_via_oak(trimmed, fields, scope, methods) {
        Some(deps) => (deps.keys, deps.methods),
        None => {
            if fields.is_empty() {
                (Vec::new(), Vec::new())
            } else {
                (collect_template_deps_scan(trimmed, fields, scope), Vec::new())
            }
        }
    }
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
                && (chars[index].is_ascii_alphanumeric()
                    || chars[index] == '_'
                    || chars[index] == '$')
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

#[cfg(test)]
mod tests {
    use super::collect_template_dep_ctx;

    fn stable(keys: &[vmz_types::DepKey]) -> Vec<String> {
        keys.iter().map(|k| k.to_stable_string()).collect()
    }

    #[test]
    fn reports_member_refs_without_expanding_them() {
        let fields = vec!["data".to_string()];
        let members = vec!["markup".to_string(), "scene".to_string()];
        let (keys, refs) = collect_template_dep_ctx("markup()", &fields, &[], &members);
        assert!(keys.is_empty(), "{keys:?}");
        assert_eq!(refs, vec!["markup".to_string()]);
        let (keys, refs) = collect_template_dep_ctx("this.markup(data)", &fields, &[], &members);
        assert_eq!(stable(&keys), vec!["data".to_string()]);
        assert_eq!(refs, vec!["markup".to_string()]);
    }

    #[test]
    fn unknown_callee_and_dynamic_member_stay_conservative() {
        let fields = vec!["data".to_string(), "keyName".to_string()];
        let members = vec!["markup".to_string()];
        // External import / global: no member dep is invented.
        let (keys, refs) = collect_template_dep_ctx("format(data)", &fields, &[], &members);
        assert!(refs.is_empty(), "{refs:?}");
        assert_eq!(stable(&keys), vec!["data".to_string()]);
        // Dynamic member access resolves no member and guesses no field.
        let (keys, refs) = collect_template_dep_ctx("this[keyName]", &fields, &[], &members);
        assert!(refs.is_empty(), "{refs:?}");
        assert_eq!(stable(&keys), vec!["keyName".to_string()]);
    }

    #[test]
    fn each_alias_shadows_member_name() {
        let (keys, refs) = collect_template_dep_ctx(
            "markup",
            &[],
            &["markup".to_string()],
            &["markup".to_string()],
        );
        assert!(keys.is_empty(), "{keys:?}");
        assert!(refs.is_empty(), "{refs:?}");
    }
}
