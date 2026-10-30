//! 产物写出层验收：文本装配与剪枝、类型擦除、跨 chunk 合成 import、
//! 动态 import 占位符重写、资源替换与拷贝、名字冲突与未实现语义拒绝、
//! 确定性、write_emit 落盘与 manifest。

use std::fs;
use std::path::PathBuf;

use vmz_pack::PackDiagnostic;
use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, plan_emit, write_emit};
use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryUse, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-emit-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    for (path, content) in files {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

fn options() -> EmitOptions {
    EmitOptions { public_base: "/_vmz/".to_string() }
}

fn codes(diagnostics: &[PackDiagnostic]) -> Vec<String> {
    diagnostics.iter().map(|diagnostic| diagnostic.code.clone()).collect()
}

/// 单入口两模块：同 chunk 拼接、未用纯导出消失、TS 类型语法擦除、
/// type-only 导入不进图也不产出文本。
#[test]
fn single_entry_prunes_and_erases_types() {
    let root = temp_tree(
        "prune",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import type { Config } from './types.js';\nimport { helper } from './lib.js';\nexport const run = helper;\n",
            ),
            (
                "src/lib.js",
                "export function helper(n?: number): number { return n ?? 42 }\nexport function unusedHelper(): number { return 0 }\n",
            ),
            ("src/types.js", "export type Config = { n: number };\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    // type-only 导入不建边：types.js 不进图。
    assert_eq!(graph.nodes.len(), 2);

    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["run".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    assert_eq!(plan.artifacts.len(), 1);
    let artifact = &plan.artifacts[0];
    assert_eq!(artifact.chunk_id, "entry/main");
    assert!(artifact.file_name.starts_with("entry-main-"), "{}", artifact.file_name);
    assert!(artifact.file_name.ends_with(".js"));
    // 执行序：被依赖者先于导入者。
    assert!(artifact.modules[0].ends_with("src/lib.js"));
    assert!(artifact.modules[1].ends_with("src/entry.js"));
    assert!(artifact.imports.is_empty());

    let code = &artifact.code;
    assert!(code.contains("function helper"), "{code}");
    // 未引用的纯导出整体剪除。
    assert!(!code.contains("unusedHelper"), "{code}");
    // 类型语法与 type-only 导入全部消失。
    assert!(!code.contains("number"), "{code}");
    assert!(!code.contains("Config"), "{code}");
    assert!(!code.contains("types.js"), "{code}");
    // 同 chunk 拼接不产出任何 import 语句；导出合成为具名声明。
    assert!(!code.contains("import"), "{code}");
    assert!(code.contains("export { helper }"), "{code}");
    assert!(code.contains("export { run }"), "{code}");
    assert!(!code.contains("__vmz_chunk_"), "{code}");
    assert!(code.ends_with(";\n"));

    assert_eq!(plan.entry_files, vec![("main".to_string(), artifact.file_name.clone())]);
    assert!(plan.assets.is_empty());
    assert!(plan.dynamic_files.is_empty());
}

/// 双入口共享模块：公共 chunk 独立成文件，两个入口 chunk 合成跨 chunk
/// import 引用目标文件名（占位符两遍法收口）。
#[test]
fn two_entries_emit_shared_chunk_imports() {
    let root = temp_tree(
        "shared",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/one.js", "import { shared } from './shared.js';\nexport const a1 = shared;\n"),
            ("src/two.js", "import { shared } from './shared.js';\nexport const a2 = shared;\n"),
            ("src/shared.js", "export const shared = 7;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("one".to_string(), root.join("src/one.js")),
            ("two".to_string(), root.join("src/two.js")),
        ],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let link_plan = link(
        &graph,
        &[
            EntryUse { entry_logical: "one".to_string(), used_exports: Some(vec!["a1".into()]) },
            EntryUse { entry_logical: "two".to_string(), used_exports: Some(vec!["a2".into()]) },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    assert_eq!(plan.artifacts.len(), 3);
    let shared = &plan.artifacts.iter().find(|a| a.chunk_id == "shared/one+two").unwrap();
    assert!(shared.file_name.starts_with("shared-one-two-"), "{}", shared.file_name);
    assert!(shared.code.contains("export { shared }"), "{}", shared.code);

    for (logical, member) in [("one", "a1"), ("two", "a2")] {
        let artifact =
            plan.artifacts.iter().find(|a| a.chunk_id == format!("entry/{logical}")).unwrap();
        assert_eq!(artifact.imports, vec![shared.file_name.clone()]);
        assert!(
            artifact
                .code
                .contains(&format!("import {{ shared }} from \"./{}\";", shared.file_name)),
            "{}",
            artifact.code
        );
        assert!(artifact.code.contains(&format!("export {{ {member} }}")), "{}", artifact.code);
        assert!(!artifact.code.contains("__vmz_chunk_"), "{}", artifact.code);
    }
    assert_eq!(plan.entry_files.len(), 2);
}

/// 动态 import：目标独立 async chunk，源 chunk 文本里的说明符被重写为
/// 目标产物文件名的动态 import，边界进入 manifest。
#[test]
fn dynamic_import_rewrites_specifier() {
    let root = temp_tree(
        "dynamic",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/app.js", "export const load = () => import('./lazy.js');\n"),
            ("src/lazy.js", "export const later = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("app".to_string(), root.join("src/app.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "app".to_string(), used_exports: Some(vec!["load".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    assert_eq!(plan.artifacts.len(), 2);
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/app").unwrap();
    let lazy = plan.artifacts.iter().find(|a| a.chunk_id.starts_with("async/")).unwrap();
    assert!(lazy.modules[0].ends_with("src/lazy.js"));
    assert_eq!(entry.dynamic, vec![lazy.file_name.clone()]);
    assert!(entry.code.contains(&format!("import(\"./{}\")", lazy.file_name)), "{}", entry.code);
    assert!(!entry.code.contains("./lazy.js"), "{}", entry.code);
    assert_eq!(plan.dynamic_files, vec![(entry.file_name.clone(), lazy.file_name.clone())]);
    assert!(!entry.code.contains("__vmz_chunk_"), "{}", entry.code);
}

/// CSS 正式支持端到端：副作用导入不进 JS 文本（不留空壳），级联按
/// chunk 成员执行序聚合为独立 `style-<hash8>.css`，同身份去重先到先得，
/// `modules` 按执行序记录贡献宿主。
#[test]
fn css_side_effect_import_aggregates_into_style_artifact() {
    let root = temp_tree(
        "cssstyle",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import './a.css';\nimport { helper } from './lib.js';\nexport const x = helper;\n",
            ),
            ("src/lib.js", "import './a.css';\nimport './b.css';\nexport const helper = 1;\n"),
            ("src/a.css", "a { color: red }\n"),
            ("src/b.css", "b { color: blue }\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["x".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    // JS 产物不含任何 CSS 文件引用：import 语句文本整体移除。
    let code = &plan.artifacts[0].code;
    assert!(!code.contains(".css"), "{code}");
    assert!(!code.contains("import"), "{code}");

    // 单 chunk 级联：成员执行序 lib→entry，`a.css` 去重先到先得。
    assert_eq!(plan.styles.len(), 1);
    let style = &plan.styles[0];
    assert!(style.file_name.starts_with("style-"), "{}", style.file_name);
    assert!(style.file_name.ends_with(".css"));
    let stem = style.file_name.strip_suffix(".css").unwrap();
    let hash = stem.rsplit('-').next().unwrap();
    assert_eq!(hash.len(), 8, "指纹命名与 chunk 同规则: {}", style.file_name);
    assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(style.url, format!("/_vmz/{}", style.file_name));
    assert_eq!(style.source_paths.len(), 2, "{:?}", style.source_paths);
    assert!(style.source_paths[0].ends_with("src/a.css"));
    assert!(style.source_paths[1].ends_with("src/b.css"));
    let red = style.content.find("color: red").unwrap();
    let blue = style.content.find("color: blue").unwrap();
    assert!(red < blue, "拼接顺序即执行序: {}", style.content);
    assert_eq!(style.content.matches("color: red").count(), 1, "去重: {}", style.content);
    assert_eq!(style.modules.len(), 2);
    assert!(style.modules[0].ends_with("src/lib.js"));
    assert!(style.modules[1].ends_with("src/entry.js"));

    // write_emit 完整落盘：CSS 文件字节与产物一致。
    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(fs::read(out.join(&style.file_name)).unwrap(), style.content.as_bytes());
}

/// 死模块（剪枝的动态分支）的 CSS 不进级联：可达性即宿主活跃性。
#[test]
fn dead_module_css_is_not_emitted() {
    let root = temp_tree(
        "cssdead",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export function go() { return import('./lazy.js'); }\nexport const x = 1;\n",
            ),
            ("src/lazy.js", "import './dead.css';\nexport const later = 1;\n"),
            ("src/dead.css", "dead { color: red }\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    // `go` 未被使用：纯声明不激活 → 包含动态 import 的语句不活 → 边死 → lazy.js 不保留。
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["x".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.styles.is_empty(), "{:?}", plan.styles);
}

/// CSS 内相对 `url()` 按 asset 规则搬迁：共享 `assets/` 指纹命名、
/// 重写为 `./assets/…` 相对路径并随 write_emit 拷贝；绝对路径、
/// 协议 URL 与片段引用原样保留。
#[test]
fn css_url_relative_reference_is_relocated() {
    let root = temp_tree(
        "cssurl",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import './s.css';\nexport const x = 1;\n"),
            (
                "src/s.css",
                "a { background: url(./img/logo.svg); }\nb { background: url(\"./img/logo.svg\"); }\nc { background: url(/abs.png); }\nd { background: url(https://cdn/x.png); }\ne { background: url(#frag); }\n",
            ),
            ("src/img/logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["x".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    assert_eq!(plan.assets.len(), 1, "{:?}", plan.assets);
    let asset = &plan.assets[0];
    assert!(asset.module_path.ends_with("src/s.css"));
    assert_eq!(asset.specifier, "./img/logo.svg");
    assert!(asset.file_name.starts_with("assets/logo-"), "{}", asset.file_name);

    assert_eq!(plan.styles.len(), 1);
    let content = &plan.styles[0].content;
    let relocated = format!("./{}", asset.file_name);
    // 同一值两处引用（unquoted 与 quoted）都重写；unquoted 补双引号。
    assert_eq!(content.matches(&format!("url(\"{relocated}\")")).count(), 2, "{content}");
    assert!(content.contains("url(/abs.png)"), "{content}");
    assert!(content.contains("url(https://cdn/x.png)"), "{content}");
    assert!(content.contains("url(#frag)"), "{content}");
    assert!(!content.contains("./img/"), "{content}");

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert!(out.join(&asset.file_name).is_file(), "CSS 派生资产随 write_emit 拷贝");
}

/// 未实现形态保持显式拒绝：CSS `@import` 跨文件级联、CSS 绑定导入、
/// CSS 重导出与动态导入 CSS 都不得静默产出错误级联。
#[test]
fn unsupported_style_forms_are_rejected() {
    let cases: [(&str, [&str; 2], [&str; 2], &str); 4] = [
        (
            "atimport",
            [
                "import './s.css';\nexport const x = 1;\n",
                "body{margin:0}\n@import url('other.css');\n",
            ],
            ["src/entry.js", "src/s.css"],
            "vmz::pack::emit::style_import_unsupported",
        ),
        (
            "binding",
            ["import sheet from './s.css';\nexport const x = sheet;\n", "body{margin:0}\n"],
            ["src/entry.js", "src/s.css"],
            "vmz::pack::emit::style_binding_unsupported",
        ),
        (
            "reexport",
            ["export { a } from './s.css';\n", "body{margin:0}\n"],
            ["src/entry.js", "src/s.css"],
            "vmz::pack::emit::style_reexport_unsupported",
        ),
        (
            "dynamic",
            ["export const load = () => import('./s.css');\n", "body{margin:0}\n"],
            ["src/entry.js", "src/s.css"],
            "vmz::pack::emit::dynamic_style_unsupported",
        ),
    ];
    for (name, contents, paths, expected) in cases {
        let mut files: Vec<(&str, &str)> =
            vec![("package.json", r#"{"name":"app","version":"0.0.0"}"#)];
        files.extend(paths.iter().copied().zip(contents));
        let root = temp_tree(name, &files);
        let graph =
            build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
        let link_plan =
            link(&graph, &[EntryUse { entry_logical: "main".to_string(), used_exports: None }]);
        let chunks = plan_chunks(&graph, &link_plan);
        let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
        assert!(codes(&errors).contains(&expected.to_string()), "{name}: {errors:?}");
    }
}

/// JSON default 导入端到端：值节点不透明进图，chunk 文本头部内联原样
/// JSON（字节保真、不改缩进），无 `./d.json` 引用残留，链接层不产生
/// 虚假 `unknown_export`。
#[test]
fn json_default_import_inlines_raw_text() {
    let root = temp_tree(
        "jsonvalue",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import data from './d.json';\nexport const k = data.k;\n"),
            ("src/d.json", "{\n  \"k\": 1\n}\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["k".into()]) }],
    );
    assert!(link_plan.diagnostics.is_empty(), "{:?}", link_plan.diagnostics);
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let code = &plan.artifacts[0].code;
    // 原始 JSON 文本字节保真内联为 default 绑定的 const 声明（含原文件
    // 的缩进与尾换行，不重新序列化）。
    assert!(code.contains("const data = {\n  \"k\": 1\n}\n;"), "{code}");
    assert!(!code.contains("./d.json"), "{code}");
    assert!(!code.contains("import"), "{code}");
    assert!(code.contains("export { k }"), "{code}");
}

/// JSON 的具名/命名空间绑定、重导出与动态导入保持显式拒绝：
/// 值节点只支持 default 导入，不猜导出形态。
#[test]
fn unsupported_json_forms_are_rejected() {
    let cases: [(&str, &str, &str); 4] = [
        (
            "named",
            "import { k } from './d.json';\nexport const x = k;\n",
            "vmz::pack::emit::json_binding_unsupported",
        ),
        (
            "namespace",
            "import * as ns from './d.json';\nexport const x = ns;\n",
            "vmz::pack::emit::json_binding_unsupported",
        ),
        (
            "reexport",
            "export { k } from './d.json';\n",
            "vmz::pack::emit::json_reexport_unsupported",
        ),
        (
            "dynamic",
            "export const load = () => import('./d.json');\n",
            "vmz::pack::emit::dynamic_json_unsupported",
        ),
    ];
    for (name, source, expected) in cases {
        let root = temp_tree(
            &format!("jsonreject-{name}"),
            &[
                ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
                ("src/entry.js", source),
                ("src/d.json", "{\"k\":1}\n"),
            ],
        );
        let graph =
            build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
        assert!(graph.diagnostics.is_empty(), "{name}: {:?}", graph.diagnostics);
        let link_plan =
            link(&graph, &[EntryUse { entry_logical: "main".to_string(), used_exports: None }]);
        let chunks = plan_chunks(&graph, &link_plan);
        let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
        assert!(codes(&errors).contains(&expected.to_string()), "{name}: {errors:?}");
    }
}

/// bootstrap 端到端：对象字面量箭头包裹的动态 import 建独立 async chunk、
/// 说明符重写为目标 chunk 文件且查询串随身份剥离；裸包经 `exports` browser
/// 条件进图；入口 `used_exports = None` 整体执行（全部模块保留）；两懒页
/// 共享 lib 落 shared chunk，且 bootstrap chunk 不预载 lib。
#[test]
fn bootstrap_dynamic_map_emits_async_chunks() {
    let root = temp_tree(
        "bootstrap",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/bootstrap.js",
                "import { helper } from 'fake-pkg';\nconst __vmzPageModules = {\n  \"pages/index\": () => import(\"./pages/index.client.js\"),\n  \"pages/about\": () => import(\"./pages/about.client.js?v=1\"),\n};\nexport const registry = { modules: __vmzPageModules, helper };\n",
            ),
            (
                "src/pages/index.client.js",
                "import { shared } from '../lib.js';\nexport const page = shared + 1;\n",
            ),
            (
                "src/pages/about.client.js",
                "import { shared } from '../lib.js';\nexport const about = shared + 2;\n",
            ),
            ("src/lib.js", "export const shared = 42;\n"),
            (
                "node_modules/fake-pkg/package.json",
                r#"{
                    "name": "fake-pkg",
                    "version": "1.0.0",
                    "exports": {
                        ".": { "browser": "./browser.js", "import": "./import.js", "default": "./default.js" }
                    }
                }"#,
            ),
            ("node_modules/fake-pkg/browser.js", "export const helper = 'browser';\n"),
            ("node_modules/fake-pkg/import.js", "export const helper = 'import';\n"),
            ("node_modules/fake-pkg/default.js", "export const helper = 'default';\n"),
        ],
    );
    let graph = build_graph(
        &[("bootstrap".to_string(), root.join("src/bootstrap.js"))],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    // bootstrap + fake-pkg/browser + 两个页面 client + 共享 lib = 5 节点。
    assert_eq!(graph.nodes.len(), 5);
    let bootstrap_node = &graph.nodes[0];
    assert_eq!(bootstrap_node.dynamic_edges.len(), 2);
    assert!(bootstrap_node.dynamic_edges.iter().all(|edge| edge.target.is_ok()));
    assert_eq!(bootstrap_node.dynamic_edges[1].specifier, "./pages/about.client.js?v=1");

    // 入口不声明导出使用：整体执行，全部模块保留。
    let link_plan =
        link(&graph, &[EntryUse { entry_logical: "bootstrap".to_string(), used_exports: None }]);
    assert_eq!(link_plan.modules.len(), graph.nodes.len(), "入口整体执行应保留全部模块");

    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    assert_eq!(chunks.dynamic_boundaries.len(), 2);
    assert!(chunks.dynamic_boundaries.iter().all(|(source, _)| *source == 0));

    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(plan.artifacts.len(), 4);
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/bootstrap").unwrap();
    assert!(entry.imports.is_empty(), "{:?}", entry.imports);
    assert_eq!(entry.dynamic.len(), 2, "bootstrap 动态数组非空");
    assert_eq!(plan.dynamic_files.len(), 2);
    assert!(plan.dynamic_files.iter().all(|(from, _)| from == &entry.file_name));
    for (_, to) in &plan.dynamic_files {
        assert!(entry.dynamic.contains(to), "{:?}", entry.dynamic);
    }

    // 箭头包裹形态保留，说明符重写为目标 chunk 文件；查询串不残留。
    assert!(entry.code.contains("() => import(\"./"), "{}", entry.code);
    assert!(!entry.code.contains("./pages/"), "{}", entry.code);
    assert!(!entry.code.contains("?v=1"), "{}", entry.code);
    assert!(!entry.code.contains("__vmz_chunk_"), "{}", entry.code);
    assert!(entry.code.contains("__vmzPageModules"), "{}", entry.code);
    assert!(entry.code.contains("export { registry }"), "{}", entry.code);
    // 裸包经 `browser` 条件解析进图并拼入入口 chunk。
    assert!(
        entry.modules.iter().any(|m| m.ends_with("node_modules/fake-pkg/browser.js")),
        "{:?}",
        entry.modules
    );
    // 共享 lib 不在 bootstrap chunk（触发前不加载）。
    assert!(!entry.modules.iter().any(|m| m.ends_with("src/lib.js")), "{:?}", entry.modules);

    // 两个独立 async chunk 与一个 shared chunk。
    let async_chunks: Vec<_> =
        plan.artifacts.iter().filter(|a| a.chunk_id.starts_with("async/")).collect();
    assert_eq!(async_chunks.len(), 2);
    assert!(async_chunks.iter().any(|a| a.chunk_id.ends_with("src/pages/about.client.js")));
    assert!(async_chunks.iter().any(|a| a.chunk_id.ends_with("src/pages/index.client.js")));
    let shared =
        plan.artifacts.iter().find(|a| a.chunk_id.starts_with("shared/")).expect("shared chunk");
    assert!(shared.modules.iter().any(|m| m.ends_with("src/lib.js")), "{:?}", shared.modules);
    assert!(shared.code.contains("export { shared }"), "{}", shared.code);
    for lazy in &async_chunks {
        assert_eq!(lazy.imports, vec![shared.file_name.clone()]);
        assert!(
            lazy.code.contains(&format!("import {{ shared }} from \"./{}\";", shared.file_name)),
            "{}",
            lazy.code
        );
    }

    assert_eq!(plan.entry_files, vec![("bootstrap".to_string(), entry.file_name.clone())]);
}

/// 同 chunk 两个模块声明同名绑定：拼接会产生非法重复声明，显式拒绝。
#[test]
fn name_conflict_is_rejected() {
    let root = temp_tree(
        "conflict",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { value } from './a.js';\nexport const main = value;\n"),
            ("src/a.js", "import './b.js';\nexport const value = 1;\n"),
            ("src/b.js", "export const value = 2;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["main".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(codes(&errors).contains(&"vmz::pack::emit::name_conflict".to_string()), "{errors:?}");
    assert!(errors.iter().any(|d| d.message.contains("value")), "{errors:?}");
}

/// 同 chunk 的 `import { value as v }`：拼接语义要求绑定原名可达，
/// scope 重写未实现，显式拒绝。
#[test]
fn binding_rename_is_rejected() {
    let root = temp_tree(
        "rename",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { value as v } from './a.js';\nexport const main = v;\n"),
            ("src/a.js", "export const value = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["main".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::binding_rename_unsupported".to_string()),
        "{errors:?}"
    );
}

/// 同 chunk `export * as ns from`：拼接后无法表达命名空间语义，显式拒绝。
#[test]
fn namespace_synthesis_is_rejected() {
    let root = temp_tree(
        "namespace",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { ns } from './barrel.js';\nexport const main = ns.thing;\n"),
            ("src/barrel.js", "export * as ns from './impl.js';\n"),
            ("src/impl.js", "export const thing = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["main".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::namespace_synthesis_unsupported".to_string()),
        "{errors:?}"
    );
}

/// 规范形态资源引用：只重写 `new URL` 第一参数为指纹化相对路径，保留
/// URL 构造外壳（chunk 与资产同目录写出，运行时解析成立）；资源进产物集
/// 并随 write_emit 拷贝。
#[test]
fn asset_replaced_by_fingerprinted_url_and_copied() {
    let root = temp_tree(
        "asset",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "export const icon = new URL('./logo.svg', import.meta.url);\n"),
            ("src/logo.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let link_plan = link(
        &graph,
        &[EntryUse { entry_logical: "main".to_string(), used_exports: Some(vec!["icon".into()]) }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    assert_eq!(plan.assets.len(), 1);
    let asset = &plan.assets[0];
    assert!(asset.module_path.ends_with("src/entry.js"));
    assert_eq!(asset.specifier, "./logo.svg");
    assert!(asset.file_name.starts_with("assets/logo-"), "{}", asset.file_name);
    assert!(asset.file_name.ends_with(".svg"));
    assert_eq!(asset.url, format!("/_vmz/{}", asset.file_name));
    assert!(std::path::Path::new(&asset.source_path).exists());

    let code = &plan.artifacts[0].code;
    // URL 对象语义：外壳保留，只换第一参数为指纹化相对路径。
    assert!(code.contains("new URL("), "{code}");
    assert!(code.contains("import.meta.url"), "{code}");
    assert!(code.contains(&format!("\"./{}\"", asset.file_name)), "{code}");
    assert!(!code.contains("./logo.svg"), "{code}");
    assert!(!code.contains(&asset.url), "{code}");

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    let copied = out.join(&asset.file_name);
    assert_eq!(fs::read(&copied).unwrap(), fs::read(&asset.source_path).unwrap());
}

/// 同输入两次 plan_emit 结果逐字节一致（指纹与占位符替换无随机性）。
#[test]
fn plan_is_deterministic() {
    let root = temp_tree(
        "determinism",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/one.js", "import { shared } from './shared.js';\nexport const a1 = shared;\n"),
            ("src/two.js", "import { shared } from './shared.js';\nexport const a2 = shared;\n"),
            ("src/shared.js", "export const shared = 7;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("one".to_string(), root.join("src/one.js")),
            ("two".to_string(), root.join("src/two.js")),
        ],
        Target::Browser,
        &root,
    );
    let link_plan = link(
        &graph,
        &[
            EntryUse { entry_logical: "one".to_string(), used_exports: Some(vec!["a1".into()]) },
            EntryUse { entry_logical: "two".to_string(), used_exports: Some(vec!["a2".into()]) },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let first = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    let second = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(first, second);
}

/// write_emit 落盘：全部 chunk 文件与 manifest.json 字节一致，
/// manifest 为 v0 合同形状且入口映射可解析。
#[test]
fn write_emit_lands_files_and_manifest() {
    let root = temp_tree(
        "write",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/one.js", "import { shared } from './shared.js';\nexport const a1 = shared;\n"),
            ("src/two.js", "import { shared } from './shared.js';\nexport const a2 = shared;\n"),
            ("src/shared.js", "export const shared = 7;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("one".to_string(), root.join("src/one.js")),
            ("two".to_string(), root.join("src/two.js")),
        ],
        Target::Browser,
        &root,
    );
    let link_plan = link(
        &graph,
        &[
            EntryUse { entry_logical: "one".to_string(), used_exports: Some(vec!["a1".into()]) },
            EntryUse { entry_logical: "two".to_string(), used_exports: Some(vec!["a2".into()]) },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    for artifact in &plan.artifacts {
        let bytes = fs::read(out.join(&artifact.file_name)).unwrap();
        assert_eq!(bytes, artifact.code.as_bytes());
    }
    let manifest_raw = fs::read_to_string(out.join("manifest.json")).unwrap();
    assert_eq!(manifest_raw, plan.manifest_json);
    let manifest: serde_json::Value = serde_json::from_str(&manifest_raw).unwrap();
    assert_eq!(manifest["version"], "v0");
    assert_eq!(manifest["chunks"].as_array().unwrap().len(), 3);
    let entries = manifest["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 2);
    for (logical, file) in &plan.entry_files {
        let matched = entries
            .iter()
            .find(|entry| entry["logical"] == logical.as_str())
            .unwrap_or_else(|| panic!("entry `{logical}` missing in manifest"));
        assert_eq!(matched["file"], file.as_str());
    }
}

/// 源文本含产物占位符前缀：替换会有歧义，显式拒绝。
#[test]
fn placeholder_collision_is_rejected() {
    let root = temp_tree(
        "collision",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "export const marker = \"__vmz_chunk_0__\";\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            used_exports: Some(vec!["marker".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::placeholder_collision".to_string()),
        "{errors:?}"
    );
}

/// 手工图：成员模块事实不完整（statement_fact_incomplete）时整体拒绝，
/// 不产出猜测文本。
#[test]
fn incomplete_facts_member_is_rejected() {
    use vmz_pack::graph::{EdgeKind, GraphEntry, ModuleEdge, ModuleGraph, ModuleNode, NodeKind};
    use vmz_pack::link::{LinkPlan, LinkedModule};
    use vmz_pack::module::ModuleRecord;
    use vmz_pack::resolve::Resolved;

    let root = temp_tree("incomplete", &[("package.json", r#"{"name":"app","version":"0.0.0"}"#)]);
    let app = root.join("app.js");
    fs::write(&app, "export const main = 1;\n").unwrap();
    let pending = root.join("pending.js");

    let mut app_node = ModuleNode {
        kind: NodeKind::Js,
        resolved: Resolved { path: app.clone(), package: None },
        record: ModuleRecord::empty(Some(app.display().to_string())),
        static_edges: vec![ModuleEdge {
            specifier: "./pending.js".to_string(),
            kind: EdgeKind::Static,
            target: Ok(pending.clone()),
        }],
        dynamic_edges: Vec::new(),
        diagnostics: Vec::new(),
    };
    app_node.record.imports.push(vmz_pack::module::ImportFact {
        specifier: "./pending.js".to_string(),
        specifier_span: None,
        span: (0, 0),
        kind: vmz_pack::module::ImportKind::SideEffect,
        type_only: false,
        bindings: Vec::new(),
    });
    let mut pending_node = ModuleNode {
        kind: NodeKind::Js,
        resolved: Resolved { path: pending.clone(), package: None },
        record: ModuleRecord::empty(Some(pending.display().to_string())),
        static_edges: Vec::new(),
        dynamic_edges: Vec::new(),
        diagnostics: Vec::new(),
    };
    pending_node.record.diagnostics.push(PackDiagnostic::new(
        "vmz::pack::module::statement_fact_incomplete",
        "facts incomplete",
    ));

    let nodes = vec![app_node, pending_node];
    let node_index = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.resolved.path.clone(), index))
        .collect();
    let graph = ModuleGraph {
        target: Target::Browser,
        root: root.clone(),
        entries: vec![GraphEntry { logical: "main".to_string(), id: app.clone() }],
        nodes,
        node_index,
        diagnostics: Vec::new(),
    };
    let link_plan = LinkPlan {
        modules: vec![
            LinkedModule {
                node: 0,
                active_statements: Vec::new(),
                used_reexports: Vec::new(),
                dynamic_edges: Vec::new(),
            },
            LinkedModule {
                node: 1,
                active_statements: Vec::new(),
                used_reexports: Vec::new(),
                dynamic_edges: Vec::new(),
            },
        ],
        diagnostics: Vec::new(),
    };
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::incomplete_facts".to_string()),
        "{errors:?}"
    );
}

/// 手工图：成员文件在计划与写出之间不可读（磁盘缺失）时显式拒绝。
#[test]
fn missing_source_file_is_rejected() {
    use vmz_pack::graph::{GraphEntry, ModuleGraph, ModuleNode, NodeKind};
    use vmz_pack::link::{LinkPlan, LinkedModule};
    use vmz_pack::module::ModuleRecord;
    use vmz_pack::resolve::Resolved;

    let root = temp_tree("readfail", &[("package.json", r#"{"name":"app","version":"0.0.0"}"#)]);
    let gone = root.join("gone.js");
    let node = ModuleNode {
        kind: NodeKind::Js,
        resolved: Resolved { path: gone.clone(), package: None },
        record: ModuleRecord::empty(Some(gone.display().to_string())),
        static_edges: Vec::new(),
        dynamic_edges: Vec::new(),
        diagnostics: Vec::new(),
    };
    let node_path = node.resolved.path.clone();
    let graph = ModuleGraph {
        target: Target::Browser,
        root: root.clone(),
        entries: vec![GraphEntry { logical: "main".to_string(), id: gone.clone() }],
        nodes: vec![node],
        node_index: std::collections::HashMap::from([(node_path, 0usize)]),
        diagnostics: Vec::new(),
    };
    let link_plan = LinkPlan {
        modules: vec![LinkedModule {
            node: 0,
            active_statements: Vec::new(),
            used_reexports: Vec::new(),
            dynamic_edges: Vec::new(),
        }],
        diagnostics: Vec::new(),
    };
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(codes(&errors).contains(&"vmz::pack::emit::read_failed".to_string()), "{errors:?}");
}

/// 根绝对 URL 动态 import（运行时 face 加载 `/dom.browser.js`）文本原样
/// 保留，给非致命诊断 `dynamic_url_kept`，不阻断产物、不产生 chunk 重写。
#[test]
fn root_absolute_dynamic_import_is_kept_verbatim() {
    let root = temp_tree(
        "urlkeep",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export const loadFace = () => import('/dom.browser.js');\n",
            ),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan =
        link(&graph, &[EntryUse { entry_logical: "main".to_string(), used_exports: None }]);
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(
        codes(&plan.diagnostics).contains(&"vmz::pack::emit::dynamic_url_kept".to_string()),
        "{:?}",
        plan.diagnostics
    );
    let code = &plan.artifacts[0].code;
    assert!(code.contains("import('/dom.browser.js')"), "{code}");
    assert!(plan.dynamic_files.is_empty(), "{:?}", plan.dynamic_files);
}

/// 非根绝对（相对/裸说明符）的未解析动态 import 仍显式拒绝，
/// 保留通道只覆盖 `/` 开头的站点 origin URL。
#[test]
fn unresolved_relative_dynamic_import_still_errors() {
    let root = temp_tree(
        "urlreject",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export const loadFace = () => import('./gone.js');\n",
            ),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan =
        link(&graph, &[EntryUse { entry_logical: "main".to_string(), used_exports: None }]);
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::dynamic_unresolved".to_string()),
        "{errors:?}"
    );
}
