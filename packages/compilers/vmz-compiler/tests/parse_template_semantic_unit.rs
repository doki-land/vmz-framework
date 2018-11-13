//! Semantic AST fixtures (`IfChain` grouping; emit still via legacy TemplateIr).

use vmz_compiler::{
    DirectiveArg, EventTarget, SemanticNode, SemanticProp, lower_concrete_to_semantic,
    parse_template, parse_template_asts, parse_template_concrete, semantic_ast_stats,
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
                SemanticNode::Element { tag, props, .. } => {
                    assert_eq!(tag, "li");
                    assert!(
                        !props.iter().any(|p| matches!(
                            p,
                            SemanticProp::Directive {
                                dir: vmz_compiler::Directive::For { .. },
                                ..
                            }
                        )),
                        "v-for must be lifted off body props"
                    );
                    assert!(
                        !props.iter().any(|p| matches!(
                            p,
                            SemanticProp::Bind {
                                arg: DirectiveArg::Static(n),
                                ..
                            } if n == "key"
                        )),
                        ":key must be lifted off body props"
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

#[test]
fn on_modifiers_survive_semantic_event_plan() {
    let src = r#"<button @click.stop.prevent="save">x</button>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { props, .. } => match &props[0] {
            SemanticProp::On {
                arg: DirectiveArg::Static(ev),
                handler,
                modifiers,
                target,
                ..
            } => {
                assert_eq!(ev, "click");
                assert_eq!(handler, "save");
                assert_eq!(modifiers, &["stop".to_string(), "prevent".to_string()]);
                assert_eq!(*target, EventTarget::Dom);
            }
            other => panic!("expected On, got {other:?}"),
        },
        other => panic!("expected Element, got {other:?}"),
    }
    // Legacy IR still strips modifiers (transition).
    let ir = parse_template(src).unwrap();
    match &ir.roots[0] {
        vmz_compiler::TemplateNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| a.name == "@click"));
            assert!(!attrs.iter().any(|a| a.name.contains("stop")));
        }
        other => panic!("expected IR element, got {other:?}"),
    }
}

#[test]
fn component_on_targets_component_event() {
    let src = r#"<Counter @bump.stop="onBump" />"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { props, .. } => match &props[0] {
            SemanticProp::On { target, modifiers, .. } => {
                assert_eq!(*target, EventTarget::Component);
                assert_eq!(modifiers, &["stop".to_string()]);
            }
            other => panic!("expected On, got {other:?}"),
        },
        other => panic!("expected Element, got {other:?}"),
    }
}

#[test]
fn bind_plan_keeps_modifiers() {
    let src = r#"<input :value.sync="q" />"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { props, .. } => match &props[0] {
            SemanticProp::Bind {
                arg: DirectiveArg::Static(name),
                expr,
                modifiers,
                ..
            } => {
                assert_eq!(name, "value");
                assert_eq!(expr, "q");
                assert_eq!(modifiers, &["sync".to_string()]);
            }
            other => panic!("expected Bind, got {other:?}"),
        },
        other => panic!("expected Element, got {other:?}"),
    }
}

#[test]
fn tooling_and_parse_share_semantic_ast_stats() {
    let src = r#"
<p v-if="a">A</p>
<p v-else>B</p>
<li v-for="(item, i) in items" :key="item.id">{{ item }}</li>
"#;
    let (semantic, _ir) = parse_template_asts(src).unwrap();
    let stats = semantic_ast_stats(&semantic);
    assert_eq!(stats.if_chains, 1);
    assert_eq!(stats.if_branches, 2);
    assert_eq!(stats.for_nodes, 1);
}

#[test]
fn slot_outlet_and_named_fallback() {
    let src = r#"
<button>
  <slot name="icon">fallback</slot>
  <slot />
</button>
"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { tag, children, .. } => {
            assert_eq!(tag, "button");
            assert_eq!(children.len(), 2);
            match &children[0] {
                SemanticNode::SlotOutlet { name, children, .. } => {
                    assert_eq!(name.as_deref(), Some("icon"));
                    assert!(!children.is_empty());
                }
                other => panic!("expected SlotOutlet, got {other:?}"),
            }
            match &children[1] {
                SemanticNode::SlotOutlet { name, .. } => assert_eq!(name, &None),
                other => panic!("expected default SlotOutlet, got {other:?}"),
            }
        }
        other => panic!("expected Element, got {other:?}"),
    }
    assert_eq!(semantic_ast_stats(&sem).slot_outlets, 2);
}

#[test]
fn template_hash_slot_becomes_slot_template() {
    let src = r#"
<Card>
  <template #header="slotProps">
    <h1>{{ slotProps.title }}</h1>
  </template>
  <template v-slot:footer>
    <p>f</p>
  </template>
</Card>
"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { tag, children, .. } => {
            assert_eq!(tag, "Card");
            assert_eq!(children.len(), 2);
            match &children[0] {
                SemanticNode::SlotTemplate {
                    name: DirectiveArg::Static(n),
                    slot_props,
                    body,
                    ..
                } => {
                    assert_eq!(n, "header");
                    assert_eq!(slot_props.as_deref(), Some("slotProps"));
                    match body.as_ref() {
                        SemanticNode::Element { tag, children, .. } => {
                            assert_eq!(tag, "template");
                            assert!(!children.is_empty());
                        }
                        other => panic!("expected template fragment body, got {other:?}"),
                    }
                }
                other => panic!("expected SlotTemplate, got {other:?}"),
            }
            match &children[1] {
                SemanticNode::SlotTemplate {
                    name: DirectiveArg::Static(n),
                    slot_props,
                    ..
                } => {
                    assert_eq!(n, "footer");
                    assert_eq!(slot_props, &None);
                }
                other => panic!("expected footer SlotTemplate, got {other:?}"),
            }
        }
        other => panic!("expected Card element, got {other:?}"),
    }
    assert_eq!(semantic_ast_stats(&sem).slot_templates, 2);
}

#[test]
fn dynamic_slot_arg_is_structured_error() {
    let concrete = parse_template_concrete(r#"<Comp v-slot:[name]>x</Comp>"#).unwrap();
    let err = lower_concrete_to_semantic(&concrete).unwrap_err();
    assert!(
        err.message.contains("dynamic") && err.message.contains("slot"),
        "{err}"
    );
}

#[test]
fn v_model_becomes_semantic_model_plan() {
    let concrete = parse_template_concrete(r#"<input v-model.number="q" />"#).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { props, .. } => match &props[0] {
            SemanticProp::Model {
                arg,
                expr,
                modifiers,
                ..
            } => {
                assert_eq!(arg, &None);
                assert_eq!(expr, "q");
                assert_eq!(modifiers, &["number".to_string()]);
            }
            other => panic!("expected Model, got {other:?}"),
        },
        other => panic!("expected Element, got {other:?}"),
    }
}

#[test]
fn v_model_arg_lower_uses_named_prop() {
    let ir = parse_template(r#"<Comp v-model:title="t" />"#).unwrap();
    match &ir.roots[0] {
        vmz_compiler::TemplateNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| a.name == "title"));
            assert!(attrs.iter().any(|a| a.name == "@update:title"));
        }
        other => panic!("expected Element, got {other:?}"),
    }
}

#[test]
fn dynamic_bind_and_on_args_survive_semantic_and_ir() {
    let src = r#"<button :[attrName]="val" @[eventName]="onEv">x</button>"#;
    let concrete = parse_template_concrete(src).unwrap();
    let sem = lower_concrete_to_semantic(&concrete).unwrap();
    match &sem.roots[0] {
        SemanticNode::Element { props, .. } => {
            assert!(props.iter().any(|p| matches!(
                p,
                SemanticProp::Bind { arg: DirectiveArg::Dynamic(e), .. } if e == "attrName"
            )));
            assert!(props.iter().any(|p| matches!(
                p,
                SemanticProp::On { arg: DirectiveArg::Dynamic(e), .. } if e == "eventName"
            )));
        }
        other => panic!("expected Element, got {other:?}"),
    }
    let ir = parse_template(src).unwrap();
    match &ir.roots[0] {
        vmz_compiler::TemplateNode::Element { attrs, .. } => {
            assert!(attrs.iter().any(|a| a.name == "[attrName]"));
            assert!(attrs.iter().any(|a| a.name == "@[eventName]"));
        }
        other => panic!("expected Element, got {other:?}"),
    }
}
