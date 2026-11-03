//! TS 源码包 NodeNext 形态解析回归。
//!
//! 未预编译的 TS 包入口直指 `src/`，作者按 NodeNext 习惯把说明符写成
//! `./client.js`，落盘文件却是 `./client.ts`。解析必须做同源 TS 扩展替换
//! （与 `tsc --rewriteRelativeImportExtensions` 一致），否则整包不可消费。

use std::fs;
use std::path::PathBuf;

use vmz_pack::graph::build_graph;
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-ts-sub-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    for (path, content) in files {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

/// 说明符写 `./client.js`，落盘是 `./client.ts`：命中同源 `.ts` 文件。
#[test]
fn js_specifier_substitutes_sibling_ts_source() {
    let root = temp_tree(
        "tssubstitute",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { run } from './client.js';\nexport const x = run;\n"),
            ("src/client.ts", "export function run(): string { return 'ts'; }\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 2, "client.ts 必须作为真实节点入图");
    let node = &graph.nodes[graph.index_of(&entry).unwrap()];
    let target = node.static_edges[0].target.as_ref().expect("`.js`→`.ts` 替换必须命中");
    assert!(
        target.ends_with("src/client.ts"),
        "解析应落在同源 `.ts` 文件：{}",
        target.display()
    );
    let _ = fs::remove_dir_all(&root);
}

/// 对照：同名 `.js` 文件真实存在时优先原文件，不做替换。
#[test]
fn existing_js_file_wins_over_ts_substitution() {
    let root = temp_tree(
        "jswins",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { run } from './client.js';\nexport const x = run;\n"),
            ("src/client.js", "export function run() { return 'js'; }\n"),
            ("src/client.ts", "export function run(): string { return 'ts'; }\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);

    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let node = &graph.nodes[graph.index_of(&entry).unwrap()];
    let target = node.static_edges[0].target.as_ref().expect("真实 `.js` 必须命中");
    assert!(
        target.ends_with("src/client.js"),
        "原 `.js` 文件优先：{}",
        target.display()
    );
    let _ = fs::remove_dir_all(&root);
}
