//! ExprPlan thin ingress + alias-scope reads fixture (`0.1.19`).

use vmz_compiler::pipeline::expr_plan::plan_template_expr;
use vmz_compiler::{
    TemplateNode, lower_concrete_to_ir, lower_concrete_to_semantic, parse_template_concrete,
    template_parse_to_diagnostic,
};
use vmz_types::DepKey;

#[test]
fn for_alias_scope_captures_alias_prop_not_as_field_read() {
    let fields = vec!["tags".into(), "label".into()];
    let scope = vec!["tag".into(), "index".into()];
    let plan = plan_template_expr("tag.label", &fields, &scope).unwrap();
    assert_eq!(plan.source, "tag.label");
    assert!(plan.snippet_span.is_some());
    assert!(
        plan.alias_prop_paths.iter().any(|(a, props)| a == "tag" && props.as_slice() == ["label"]),
        "expected tag.label alias path, got {:?}",
        plan.alias_prop_paths
    );
    assert!(
        !plan.reads.iter().any(|k| matches!(k, DepKey::Field(n) if n == "tag")),
        "alias root must not appear as field read: {:?}",
        plan.reads
    );
}

#[test]
fn field_read_still_plans_under_empty_alias_scope() {
    let fields = vec!["tags".into()];
    let plan = plan_template_expr("tags.length", &fields, &[]).unwrap();
    assert!(
        plan.reads.iter().any(|k| match k {
            DepKey::Path(p) => p.root == "tags",
            DepKey::Field(n) => n == "tags",
            _ => false,
        }),
        "expected tags.* read, got {:?}",
        plan.reads
    );
}

#[test]
fn invalid_expr_plan_fails_oxc_ingress() {
    let err = plan_template_expr("1 +", &[], &[]).unwrap_err();
    assert!(err.message.contains("invalid template expression"), "{err}");
}

#[test]
fn single_brace_rejection_carries_parse_failed_code() {
    let err = parse_template_concrete("<h2>{user.name}</h2>").unwrap_err();
    let diag = template_parse_to_diagnostic("App.vmz", 11, &err);
    assert_eq!(diag.code_string().as_deref(), Some("vmz::template::parse_failed"));
}

#[test]
fn v_model_semantic_and_ir_follow_vue3_contract() {
    let concrete = parse_template_concrete(r#"<Comp v-model:title="t" />"#).unwrap();
    let ir = lower_concrete_to_ir(&concrete).unwrap();
    match &ir.roots[0] {
        TemplateNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| a.name == "title"));
            assert!(attrs.iter().any(|a| a.name == "@update:title"));
        }
        other => panic!("expected Element, got {other:?}"),
    }
}

#[test]
fn orphan_else_carries_illegal_directive_code() {
    let concrete = parse_template_concrete(r#"<p v-else>x</p>"#).unwrap();
    let err = lower_concrete_to_semantic(&concrete).unwrap_err();
    let diag = template_parse_to_diagnostic("App.vmz", 0, &err);
    assert_eq!(diag.code_string().as_deref(), Some("vmz::template::illegal_directive"));
}
