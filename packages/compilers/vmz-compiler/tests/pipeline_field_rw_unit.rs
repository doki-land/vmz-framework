//! Moved from `src/pipeline/field_rw.rs` (cargo-cry: tests next to Cargo.toml).

use oxc_allocator::Allocator;
use oxc_ast_visit::Visit;
use oxc_parser::Parser;
use oxc_span::SourceType;
use vmz_compiler::pipeline::field_rw::*;

#[test]
fn flags_use_and_create_factories() {
    assert!(is_forbidden_factory("useCounter"));
    assert!(is_forbidden_factory("createStore"));
    assert!(!is_forbidden_factory("user"));
    assert!(!is_forbidden_factory("createElement"));
}

#[test]
fn tracks_this_field_write_and_read() {
    let allocator = Allocator::default();
    let src = "class C { async onMount() { this.user = await f(); this.tags.push(1); let x = this.user.name; this.user.bio = x; } }";
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into(), "tags".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.writes.iter().any(|w| w == "user"), "writes={:?}", rw.writes);
    assert!(rw.writes.iter().any(|w| w == "tags"), "writes={:?}", rw.writes);
    assert!(rw.writes.iter().any(|w| w == "user.bio"), "writes={:?}", rw.writes);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
}

#[test]
fn template_deps_oxc_paths_and_scope() {
    let fields = vec!["user".into(), "count".into(), "tags".into()];
    let deps = collect_template_deps("!user || count", &fields, &[]);
    assert!(deps.contains(&"user".into()));
    assert!(deps.contains(&"count".into()));
    let deps2 = collect_template_deps("user.name", &fields, &[]);
    assert_eq!(deps2, vec!["user.name".to_string()]);
    let deps3 = collect_template_deps("tag", &fields, &["tag".into()]);
    assert!(deps3.is_empty());
    let deps4 = collect_template_deps("tags.length", &fields, &[]);
    assert_eq!(deps4, vec!["tags.length".to_string()]);
    let deps5 = collect_template_deps("user?.bio", &fields, &[]);
    assert_eq!(deps5, vec!["user.bio".to_string()]);
}

#[test]
fn tracks_alias_member_read_and_write() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          rename() {
            const u = this.user;
            let x = u.name;
            u.bio = x;
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.reads.iter().any(|r| r == "user" || r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.writes.iter().any(|w| w == "user.bio"), "writes={:?}", rw.writes);
}

#[test]
fn tracks_nested_alias_and_object_destructure() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          label() {
            const profile = this.user.profile;
            const { name } = profile;
            return name;
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.reads.iter().any(|r| r == "user.profile"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.profile.name"), "reads={:?}", rw.reads);
}

#[test]
fn tracks_direct_destructure_from_this() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          label() {
            const { name, bio: b } = this.user;
            return name + b;
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.bio"), "reads={:?}", rw.reads);
}

#[test]
fn local_rebind_does_not_write_field() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          f() {
            const { name } = this.user;
            name = 'local';
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(!rw.writes.iter().any(|w| w == "user.name"), "writes={:?}", rw.writes);
}

#[test]
fn tracks_this_method_calls() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          onClick() {
            this.refresh();
            this.#load();
            this.tags.push(1);
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["tags".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.calls.iter().any(|c| c == "refresh"), "calls={:?}", rw.calls);
    assert!(rw.calls.iter().any(|c| c == "#load"), "calls={:?}", rw.calls);
    assert!(
        !rw.calls.iter().any(|c| c == "push"),
        "array mutators are writes, not calls: {:?}",
        rw.calls
    );
    assert!(rw.writes.iter().any(|w| w == "tags"), "writes={:?}", rw.writes);
}

#[test]
fn marks_dynamic_this_callee_opaque() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          run(name) {
            this[name]();
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(rw.opaque_callee, "this[name]() must set opaque_callee");
    assert!(rw.calls.is_empty());
    assert!(
        rw.star_reasons.iter().any(|(f, r)| f == "user" && r == "opaque_callee"),
        "star_reasons={:?}",
        rw.star_reasons
    );
}

#[test]
fn array_destructure_widens_with_reason() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          f() {
            const [a] = this.tags;
            return a;
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["tags".into()]);
    rw.visit_program(&ret.program);
    assert!(
        rw.star_reasons.iter().any(|(f, r)| f == "tags" && r == "array_destructure"),
        "star_reasons={:?}",
        rw.star_reasons
    );
    assert!(rw.reads.iter().any(|r| r == "tags.*"), "reads={:?}", rw.reads);
}

#[test]
fn nested_arrow_captures_alias_into_owner() {
    let allocator = Allocator::default();
    let src = r#"
        class C {
          onClick() {
            const u = this.user;
            const run = () => {
              u.name = 'Ada';
              const local = 1;
              return local;
            };
            run();
            // outer must not see arrow-local `local` as an alias binding
            local = 2;
          }
        }
    "#;
    let ret = Parser::new(&allocator, src, SourceType::ts()).parse();
    let mut rw = FieldRw::new(["user".into()]);
    rw.visit_program(&ret.program);
    assert!(
        rw.writes.iter().any(|w| w == "user.name"),
        "closure write must compose into owner: writes={:?}",
        rw.writes
    );
    assert!(
        !rw.aliases.contains_key("local"),
        "nested local must not leak: aliases={:?}",
        rw.aliases
    );
}

#[test]
fn each_alias_prop_paths_for_list_item() {
    let paths = collect_each_alias_prop_paths("tag.label", "tag");
    assert_eq!(paths, vec![vec!["label".to_string()]]);
    let whole = collect_each_alias_prop_paths("tag", "tag");
    assert_eq!(whole, vec![Vec::<String>::new()]);
}
