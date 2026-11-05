//! `as` 断言擦除的产物级验收：动态 import 回调里的 `mod.default as T`
//! （关键字成员名 + 断言）不得进入最终 chunk 文本。

use std::fs;
use std::path::PathBuf;

use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, plan_emit};
use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("vmz-pack-emit-as-cast-{name}-{}", std::process::id()));
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
fn debug_angle_assertion_module_facts() {
    let source = "export const forced = <FractalWasm>resolved;\nexport const plain = resolved;\n";
    let record = vmz_pack::module::parse_module(Some("x.js"), source).unwrap();
    for (index, statement) in record.statements.iter().enumerate() {
        let (start, end) = statement.span;
        eprintln!("stmt {index}: span=({start},{end}) text={:?}", &source[start..end]);
    }
    eprintln!("diags: {:?}", record.diagnostics);
}

#[test]
fn as_cast_after_keyword_member_never_reaches_chunk_text() {
    let root = temp_tree(
        "keyword-member",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "let resolved = null;\nexport function load() {\n  return import('./impl.js').then((mod) => {\n    resolved = mod.default as FractalWasm;\n  });\n}\nexport const picked = resolved as FractalWasm | null;\nexport const checked = resolved satisfies FractalWasm | null;\nexport const forced = <FractalWasm>resolved;\n",
            ),
            ("src/impl.js", "export default { init() {} };\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec![
                "load".into(),
                "picked".into(),
                "checked".into(),
                "forced".into(),
            ]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    let plan = plan_emit(
        &graph,
        &link_plan,
        &chunks,
        &EmitOptions { public_base: "/_vmz/".into(), minify: false },
    )
    .unwrap();

    let all =
        plan.artifacts.iter().map(|artifact| artifact.code.as_str()).collect::<Vec<_>>().join("\n");
    assert!(!all.contains("as FractalWasm"), "{all}");
    assert!(!all.contains("resolved as"), "{all}");
    assert!(!all.contains("satisfies"), "{all}");
    assert!(!all.contains("<FractalWasm>"), "{all}");
    assert!(all.contains("mod.default"), "{all}");
    assert!(all.contains("const checked = resolved;"), "{all}");
    assert!(all.contains("const forced = resolved;"), "{all}");
    // 合法 ESM 别名 `export { x as default }` 不是类型断言，必须原样保留。
    assert!(all.contains("as default"), "{all}");
}
