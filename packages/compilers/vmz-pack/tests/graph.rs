//! 图组装验收：入口可达、边形态、类型导入不建边、解析失败保留诊断。

use std::fs;
use std::path::PathBuf;

use vmz_pack::graph::{EdgeKind, build_graph};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-graph-{name}-{}", std::process::id()));
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
fn entry_closure_is_collected_with_edge_kinds() {
    let root = temp_tree(
        "closure",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { helper } from './lib.js';\nimport './styles.css';\nexport { re } from './lib.js';\nconst later = () => import('./lazy.js');\n",
            ),
            ("src/lib.js", "export const helper = 1;\nexport const re = 2;\n"),
            ("src/styles.css", "body { margin: 0; }\n"),
            ("src/lazy.js", "export default 3;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.entries.len(), 1);
    // entry + lib + css + lazy = 4 节点。
    assert_eq!(graph.nodes.len(), 4);

    let entry_node = &graph.nodes[graph.index_of(&entry).unwrap()];
    let static_kinds: Vec<_> = entry_node
        .static_edges
        .iter()
        .map(|e| (e.specifier.as_str(), e.kind.clone(), e.target.is_ok()))
        .collect();
    assert_eq!(
        static_kinds,
        vec![
            ("./lib.js", EdgeKind::Static, true),
            ("./styles.css", EdgeKind::SideEffect, true),
            ("./lib.js", EdgeKind::ReexportNamed, true),
        ]
    );
    assert_eq!(entry_node.dynamic_edges.len(), 1);
    assert_eq!(entry_node.dynamic_edges[0].specifier, "./lazy.js");
    assert!(entry_node.dynamic_edges[0].target.is_ok());
}

#[test]
fn type_only_imports_do_not_create_edges() {
    let root = temp_tree(
        "typeonly",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import type { T } from './types.js';\nimport { type U } from './types.js';\nexport const x: never = undefined as any;\n",
            ),
            ("src/types.js", "export type T = number;\nexport type U = string;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    // 只有 entry 自己：types.js 不进入运行时图。
    assert_eq!(graph.nodes.len(), 1);
    assert!(graph.nodes[0].static_edges.is_empty());
}

#[test]
fn unresolved_specifier_keeps_diagnostic_edge() {
    let root = temp_tree(
        "unresolved",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { x } from 'missing-pkg';\nexport const x = 1;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert_eq!(graph.nodes.len(), 1);
    let edge = &graph.nodes[0].static_edges[0];
    assert_eq!(edge.specifier, "missing-pkg");
    let diagnostic = edge.target.as_ref().err().unwrap();
    assert_eq!(diagnostic.code, "vmz::pack::resolve::not_found");
}

#[test]
fn shared_dependency_is_a_single_node() {
    let root = temp_tree(
        "shared",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/a.js", "export { helper } from './shared.js';\n"),
            ("src/b.js", "import { helper } from './shared.js';\nexport const use = helper;\n"),
            ("src/shared.js", "export const helper = 1;\n"),
        ],
    );
    let graph = build_graph(
        &[("a".to_string(), root.join("src/a.js")), ("b".to_string(), root.join("src/b.js"))],
        Target::Browser,
        &root,
    );
    // a + b + shared（只一份）= 3 节点。
    assert_eq!(graph.nodes.len(), 3);
    let shared_index =
        graph.index_of(&fs::canonicalize(root.join("src/shared.js")).unwrap()).unwrap();
    let shared = &graph.nodes[shared_index];
    assert!(shared.resolved.package.as_ref().unwrap().name == "app");
}

#[test]
fn parse_failure_keeps_node_with_diagnostics() {
    let root = temp_tree(
        "badparse",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { ok } from './good.js';\n"),
            ("src/good.js", "broken syntax ((( ;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert_eq!(graph.nodes.len(), 2);
    let bad = &graph.nodes[1];
    assert_eq!(bad.resolved.path.file_name().unwrap(), "good.js");
    assert_eq!(bad.diagnostics[0].code, "vmz::pack::module::parse_failed");
    assert_eq!(bad.record.path.as_deref().map(|p| p.ends_with("good.js")), Some(true));
}
