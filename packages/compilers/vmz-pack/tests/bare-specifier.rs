//! 裸说明符解析失败行为探针：无法解析时必须结构化失败、指明来源与说明符。

use std::fs;
use std::path::PathBuf;

use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, plan_emit};
use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-bare-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    for (path, content) in files {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

#[test]
fn unresolvable_bare_specifier_fails_loudly() {
    let root = temp_tree(
        "ghost",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            ("src/entry.js", "import { ghost } from 'ghost-pkg/sub';\nexport const run = ghost;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Node, &root);
    eprintln!(
        "graph diagnostics: {:?}",
        graph.diagnostics.iter().map(|d| (d.code.clone(), d.message.clone())).collect::<Vec<_>>()
    );
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(
        &graph,
        &link_plan,
        &chunks,
        &EmitOptions { public_base: "/_vmz/".to_string(), minify: false },
    );
    match plan {
        Ok(plan) => {
            let code = &plan.artifacts[0].code;
            eprintln!("EMITTED (unexpectedly):\n{code}");
            panic!("unresolvable bare specifier must not emit silently");
        }
        Err(errors) => {
            for e in &errors {
                eprintln!("ERR {}: {} path={:?}", e.code, e.message, e.path);
            }
            assert!(
                errors.iter().any(|e| e.message.contains("ghost-pkg")),
                "failure must name the specifier: {errors:?}"
            );
        }
    }
}
