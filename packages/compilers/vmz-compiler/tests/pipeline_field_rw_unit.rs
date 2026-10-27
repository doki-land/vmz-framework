//! Oak-backed field read/write and template dependency contracts.

use oak_typescript::ast::{ClassMember, Statement};
use vmz_compiler::ScriptKind;
use vmz_compiler::parse::analyze::analyze_script;
use vmz_compiler::parse::field_rw_oak::OakFieldRw;
use vmz_compiler::pipeline::field_rw::*;
use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, require_script_ast};

#[test]
fn flags_use_and_create_factories() {
    assert!(is_forbidden_factory("useCounter"));
    assert!(is_forbidden_factory("createStore"));
    assert!(!is_forbidden_factory("user"));
    assert!(!is_forbidden_factory("createElement"));
}

#[test]
fn tracks_this_field_write_and_read() {
    let src = "class C { async onMount() { this.user = await f(); this.tags.push(1); let x = this.user.name; this.user.bio = x; } }";
    let mut rw = OakFieldRw::new(["user".into(), "tags".into()]);
    walk_script(&mut rw, src);
    assert!(rw.writes.iter().any(|w| w == "user"), "writes={:?}", rw.writes);
    assert!(rw.writes.iter().any(|w| w == "tags"), "writes={:?}", rw.writes);
    assert!(rw.writes.iter().any(|w| w == "user.bio"), "writes={:?}", rw.writes);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
}

#[test]
fn template_deps_oak_paths_and_scope() {
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
    let src = r#"
        class C {
          rename() {
            const u = this.user;
            let x = u.name;
            u.bio = x;
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
    assert!(rw.reads.iter().any(|r| r == "user" || r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.writes.iter().any(|w| w == "user.bio"), "writes={:?}", rw.writes);
}

#[test]
fn tracks_nested_alias_and_object_destructure() {
    let src = r#"
        class C {
          label() {
            const profile = this.user.profile;
            const { name } = profile;
            return name;
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
    assert!(rw.reads.iter().any(|r| r == "user.profile"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.profile.name"), "reads={:?}", rw.reads);
}

#[test]
fn tracks_direct_destructure_from_this() {
    let src = r#"
        class C {
          label() {
            const { name, bio: b } = this.user;
            return name + b;
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
    assert!(rw.reads.iter().any(|r| r == "user.name"), "reads={:?}", rw.reads);
    assert!(rw.reads.iter().any(|r| r == "user.bio"), "reads={:?}", rw.reads);
}

#[test]
fn local_rebind_does_not_write_field() {
    let src = r#"
        class C {
          f() {
            const { name } = this.user;
            name = 'local';
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
    assert!(!rw.writes.iter().any(|w| w == "user.name"), "writes={:?}", rw.writes);
}

#[test]
fn tracks_this_method_calls() {
    let src = r#"
        class C {
          onClick() {
            this.refresh();
            this.#load();
            this.tags.push(1);
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["tags".into()]);
    walk_script(&mut rw, src);
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
    let src = r#"
        class C {
          run(name) {
            this[name]();
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
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
    let src = r#"
        class C {
          f() {
            const [a] = this.tags;
            return a;
          }
        }
    "#;
    let mut rw = OakFieldRw::new(["tags".into()]);
    walk_script(&mut rw, src);
    assert!(
        rw.star_reasons.iter().any(|(f, r)| f == "tags" && r == "array_destructure"),
        "star_reasons={:?}",
        rw.star_reasons
    );
    assert!(rw.reads.iter().any(|r| r == "tags.*"), "reads={:?}", rw.reads);
}

#[test]
fn nested_arrow_captures_alias_into_owner() {
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
    let mut rw = OakFieldRw::new(["user".into()]);
    walk_script(&mut rw, src);
    assert!(
        rw.writes.iter().any(|w| w == "user.name"),
        "closure write must compose into owner: writes={:?}",
        rw.writes
    );
    assert!(!rw.has_alias("local"), "nested local must not leak: aliases={:?}", rw);
}

#[test]
fn each_alias_prop_paths_for_list_item() {
    let paths = collect_each_alias_prop_paths("tag.label", "tag");
    assert_eq!(paths, vec![vec!["label".to_string()]]);
    let whole = collect_each_alias_prop_paths("tag", "tag");
    assert_eq!(whole, vec![Vec::<String>::new()]);
}

#[test]
fn records_getter_member_read_by_name() {
    let src = r#"
        class C {
          render() {
            return this.markup;
          }
        }
    "#;
    let mut rw = OakFieldRw::with_methods(["spec".into()], ["markup".into()]);
    walk_named_method(&mut rw, src, "render");
    assert_eq!(rw.member_reads, vec!["markup".to_string()]);
    assert!(rw.calls.is_empty(), "value read is not a call: {:?}", rw.calls);
    assert!(rw.reads.is_empty(), "member read is not a field read: {:?}", rw.reads);
}

#[test]
fn reads_fields_inside_template_string_holes() {
    // Oak's builder drops template-literal expressions (`argument: None`), so the
    // walker recovers the `${...}` holes from the statement source slice.
    let src = r#"
        export default class C {
          width = 0;
          height = 0;
          hostStyle() {
            return `width:${this.width}px;height:${this.height}px`;
          }
        }
    "#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let host = analyzed.decl.methods.iter().find(|m| m.name == "hostStyle").expect("hostStyle");
    assert!(host.reads.iter().any(|r| r == "width"), "reads={:?}", host.reads);
    assert!(host.reads.iter().any(|r| r == "height"), "reads={:?}", host.reads);
}

#[test]
fn dynamic_member_access_stays_conservative() {
    // `this[expr]` resolves no member and reads no field.
    let src = r#"
        class C {
          pick(key) {
            return this[key];
          }
        }
    "#;
    let mut rw = OakFieldRw::with_methods(["spec".into()], ["markup".into()]);
    walk_named_method(&mut rw, src, "pick");
    assert!(rw.member_reads.is_empty(), "this[key] must not resolve a member");
    assert!(rw.reads.is_empty(), "this[key] must not read a field: {:?}", rw.reads);
    // A dynamic index on a field widens that field and still no member.
    let src2 = r#"
        class C {
          pick(name) {
            return this.spec[name];
          }
        }
    "#;
    let mut rw2 = OakFieldRw::with_methods(["spec".into()], ["markup".into()]);
    walk_named_method(&mut rw2, src2, "pick");
    assert!(rw2.member_reads.is_empty(), "reads={:?}", rw2.member_reads);
    assert!(rw2.reads.iter().any(|r| r == "spec.*"), "reads={:?}", rw2.reads);
}

#[test]
fn getter_chain_composes_reads_and_terminates() {
    let src = r#"
        export default class Chart {
          spec = null;
          data = [];
          get x() { return this.y + this.spec; }
          get y() { return this.x + this.data; }
          markup() { return this.x; }
        }
    "#;
    let analyzed = analyze_script(ScriptKind::Client, src);
    let markup = analyzed.decl.methods.iter().find(|m| m.name == "markup").expect("markup");
    assert!(markup.reads.iter().any(|r| r == "spec"), "reads={:?}", markup.reads);
    assert!(markup.reads.iter().any(|r| r == "data"), "reads={:?}", markup.reads);
}

fn walk_named_method(visitor: &mut OakFieldRw, source: &str, name: &str) {
    let root = require_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    })
    .expect("Oak must parse the method fixture");
    for statement in &root.statements {
        if let Statement::ClassDeclaration(class) = statement {
            for member in &class.body {
                if let ClassMember::Method { name: member_name, body, .. } = member {
                    if member_name == name {
                        visitor.walk_body(body);
                    }
                }
            }
        }
    }
}

fn walk_script(visitor: &mut OakFieldRw, source: &str) {
    let root = require_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    })
    .expect("Oak must parse the original read/write fixture");
    for statement in &root.statements {
        if let Statement::ClassDeclaration(class) = statement {
            for member in &class.body {
                if let ClassMember::Method { body, .. } = member {
                    visitor.walk_body(body);
                }
            }
        }
    }
}
