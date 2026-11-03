//! 图组装验收：入口可达、边形态、类型导入不建边、解析失败保留诊断。

use std::fs;
use std::path::PathBuf;

use vmz_pack::graph::{EdgeKind, NodeKind, build_graph};
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

/// CSS 导入进图成为不透明 Style 节点：不按 JS 源码解析、无出边、
/// 无诊断；宿主 importer→style 的有序副作用边保留。
#[test]
fn css_import_becomes_opaque_style_node() {
    let root = temp_tree(
        "cssstyle",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import './s.css';\nexport const x = 1;\n"),
            ("src/s.css", "body{margin:0}\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 2);

    let edge = &graph.nodes[0].static_edges[0];
    assert_eq!(edge.specifier, "./s.css");
    assert_eq!(edge.kind, EdgeKind::SideEffect);
    assert!(edge.target.is_ok(), "{:?}", edge.target);

    let css = &graph.nodes[1];
    assert_eq!(css.kind, NodeKind::Style);
    assert!(css.resolved.path.ends_with("s.css"));
    assert!(css.diagnostics.is_empty());
    assert!(css.record.statements.is_empty(), "CSS 不得按 JS 源码收集事实");
    assert!(css.record.assets.is_empty());
    assert!(css.static_edges.is_empty() && css.dynamic_edges.is_empty());
}

/// CSS 作为图入口显式拒绝：样式必须挂在 JS 宿主模块的执行序上。
#[test]
fn css_entry_is_rejected() {
    let root = temp_tree(
        "cssentry",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/s.css", "body{margin:0}\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/s.css"))], Target::Browser, &root);
    assert_eq!(graph.diagnostics.len(), 1);
    assert_eq!(graph.diagnostics[0].code, "vmz::pack::graph::style_entry_unsupported");
    assert!(graph.entries.is_empty());
    assert!(graph.nodes.is_empty());
}

/// JSON 导入进图成为不透明值节点：不按 JS 源码解析、无出边、无诊断；
/// 宿主 importer→json 的静态值绑定边保留。
#[test]
fn json_import_becomes_opaque_value_node() {
    let root = temp_tree(
        "jsonvalue",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import data from './d.json';\nexport const x = data;\n"),
            ("src/d.json", "{\n  \"k\": 1\n}\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 2);

    let edge = &graph.nodes[0].static_edges[0];
    assert_eq!(edge.specifier, "./d.json");
    assert_eq!(edge.kind, EdgeKind::Static);
    assert!(edge.target.is_ok(), "{:?}", edge.target);

    let json = &graph.nodes[1];
    assert_eq!(json.kind, NodeKind::Json);
    assert!(json.resolved.path.ends_with("d.json"));
    assert!(json.diagnostics.is_empty(), "JSON 不得按 JS 解析产生 parse_failed");
    assert!(json.record.statements.is_empty(), "JSON 不得按 JS 源码收集事实");
    assert!(json.record.imports.is_empty());
    assert!(json.static_edges.is_empty() && json.dynamic_edges.is_empty());
}

/// JSON 作为图入口显式拒绝：值节点只有被 JS 宿主消费才有意义。
#[test]
fn json_entry_is_rejected() {
    let root = temp_tree(
        "jsonentry",
        &[("package.json", r#"{"name":"app","version":"0.0.0"}"#), ("src/d.json", "{\"k\":1}\n")],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/d.json"))], Target::Browser, &root);
    assert_eq!(graph.diagnostics.len(), 1);
    assert_eq!(graph.diagnostics[0].code, "vmz::pack::graph::json_entry_unsupported");
    assert!(graph.entries.is_empty());
    assert!(graph.nodes.is_empty());
}

/// 箭头常量 `const load = () => import('./lazy.js')` 的箭头体是正式
/// `ImportExpression`，建一条动态边。对照：把普通箭头调用得出来的字符串
/// 传入，不产生动态边，避免以「箭头函数 + 实参」猜测 import 语义。
#[test]
fn arrow_const_dynamic_edge_is_built_from_the_import_expression() {
    let root = temp_tree(
        "arrowconst",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "const load = () => import('./lazy.js');\nconst run = (() => {})('./lazy.js');\nconst same = important('./lazy.js');\nexport { load, run, same };\n",
            ),
            ("src/lazy.js", "export default 3;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let node = &graph.nodes[graph.index_of(&entry).unwrap()];
    assert_eq!(node.dynamic_edges.len(), 1, "{:?}", node.dynamic_edges);
    assert_eq!(node.dynamic_edges[0].specifier, "./lazy.js");
    assert!(node.dynamic_edges[0].target.is_ok());
}

/// 根绝对 URL 动态 import（`import('/dom.browser.js')`）是站点运行时 URL：
/// 边保留专用外部诊断（发射层原样保留），不是 `not_found` 文件解析失败。
#[test]
fn root_absolute_dynamic_import_is_external_url_edge() {
    let root = temp_tree(
        "dynamicurl",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "const face = () => import(/* @vite-ignore */ '/dom.browser.js');\nexport const load = face;\n",
            ),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 1);
    let node = &graph.nodes[graph.index_of(&entry).unwrap()];
    assert_eq!(node.dynamic_edges.len(), 1);
    let edge = &node.dynamic_edges[0];
    assert_eq!(edge.specifier, "/dom.browser.js");
    let diagnostic = edge.target.as_ref().expect_err("URL 边不解析为文件");
    assert_eq!(diagnostic.code, "vmz::pack::resolve::dynamic_url_external");
    assert!(diagnostic.message.contains("/dom.browser.js"), "{diagnostic:?}");
}

/// 对照：静态根绝对说明符仍是文件解析语义，缺失目标是 `not_found`。
#[test]
fn root_absolute_static_import_still_resolves_as_file() {
    let root = temp_tree(
        "staticurl",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { missing } from '/ghost.js';\nexport const x = missing;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let node = &graph.nodes[graph.index_of(&entry).unwrap()];
    let edge = &node.static_edges[0];
    let diagnostic = edge.target.as_ref().expect_err("缺失文件不得解析");
    assert_eq!(diagnostic.code, "vmz::pack::resolve::not_found");
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
