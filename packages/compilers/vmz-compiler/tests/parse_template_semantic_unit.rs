//! Semantic AST fixtures (`IfChain` grouping; emit still via legacy TemplateIr).

use vmz_compiler::{
    ConcreteAttr, Directive, DirectiveArg, SemanticNode, lower_concrete_to_semantic,
    parse_template_concrete,
};

#[test]
fn groups_if_elseif_else_into_one_chain() {
    let src = r#"
<p v-if="a">A</p>
<p v-else-if="b">B</p>
<p v-else>C</p>
"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    assert_eq!(sem.roots.len(), 1);
    match &sem.roots[0] {
        SemanticNode::IfChain { branches, span } => {
            assert_eq!(branches.len(), 3);
            assert_eq!(branches[0].test.as_deref(), Some("a"));
            assert_eq!(branches[1].test.as_deref(), Some("b"));
            assert_eq!(branches[2].test, None);
            assert!(span.end > span.start);
        }
        other => panic!("expected IfChain, got {other:?}"),
    }
}

#[test]
fn orphan_else_is_error() {
    let concrete = parse_template_concrete(r#"<p v-else>x</p>"#).unwrap();
    let err = lower_concrete_to_semantic(&concrete).unwrap_err();
    assert!(err.message.contains("v-else"), "{err}");
}

#[test]
fn orphan_else_if_is_error() {
    let concrete = parse_template_concrete(r#"<p v-else-if="x">y</p>"#).unwrap();
    let err = lower_concrete_to_semantic(&concrete).unwrap_err();
    assert!(err.message.contains("v-else-if"), "{err}");
}

#[test]
fn two_separate_ifs_are_two_chains() {
    let src = r#"<p v-if="a">A</p><p v-if="b">B</p>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    assert_eq!(sem.roots.len(), 2);
    assert!(matches!(sem.roots[0], SemanticNode::IfChain { .. }));
    assert!(matches!(sem.roots[1], SemanticNode::IfChain { .. }));
}

#[test]
fn comment_between_chain_members_still_groups() {
    let src = r#"
<p v-if="a">A</p>
<!-- skip -->
<p v-else>B</p>
"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    assert_eq!(sem.roots.len(), 1);
    match &sem.roots[0] {
        SemanticNode::IfChain { branches, .. } => {
            assert_eq!(branches.len(), 2);
            assert_eq!(branches[0].test.as_deref(), Some("a"));
            assert_eq!(branches[1].test, None);
        }
        other => panic!("expected IfChain, got {other:?}"),
    }
}

#[test]
fn for_node_keeps_aliases_and_key() {
    let src = r#"<li v-for="(item, index) in items" :key="item.id">{{ item }}</li>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    assert_eq!(sem.roots.len(), 1);
    match &sem.roots[0] {
        SemanticNode::ForNode {
            source,
            value_alias,
            key_alias,
            index_alias,
            key,
            body,
            ..
        } => {
            assert_eq!(source, "items");
            assert_eq!(value_alias, "item");
            assert_eq!(key_alias.as_deref(), Some("index"));
            assert!(index_alias.is_none());
            assert_eq!(key.as_deref(), Some("item.id"));
            match body.as_ref() {
                SemanticNode::Element { tag, attrs, .. } => {
                    assert_eq!(tag, "li");
                    assert!(
                        !attrs.iter().any(|a| matches!(
                            a,
                            ConcreteAttr::Directive {
                                dir: Directive::For { .. },
                                ..
                            }
                        )),
                        "v-for must be lifted off body attrs"
                    );
                    assert!(
                        !attrs.iter().any(|a| matches!(
                            a,
                            ConcreteAttr::Directive {
                                dir: Directive::Bind {
                                    arg: DirectiveArg::Static(n),
                                    ..
                                },
                                ..
                            } if n == "key"
                        )),
                        ":key must be lifted off body attrs"
                    );
                }
                other => panic!("expected Element body, got {other:?}"),
            }
        }
        other => panic!("expected ForNode, got {other:?}"),
    }
}

#[test]
fn three_alias_for_retained() {
    let src = r#"<li v-for="(v, k, i) in map" :key="k">{{ v }}</li>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::ForNode {
            value_alias,
            key_alias,
            index_alias,
            key,
            ..
        } => {
            assert_eq!(value_alias, "v");
            assert_eq!(key_alias.as_deref(), Some("k"));
            assert_eq!(index_alias.as_deref(), Some("i"));
            assert_eq!(key.as_deref(), Some("k"));
        }
        other => panic!("expected ForNode, got {other:?}"),
    }
}
