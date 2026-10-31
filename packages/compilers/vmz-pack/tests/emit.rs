//! 产物写出层验收：文本装配与剪枝、类型擦除、跨 chunk 合成 import、
//! 动态 import 占位符重写、资源替换与拷贝、名字冲突与未实现语义拒绝、
//! 确定性、write_emit 落盘与 manifest。

use std::fs;
use std::path::PathBuf;

use vmz_pack::PackDiagnostic;
use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, plan_emit, write_emit};
use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, link};
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
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
    // 末尾是 sourceMappingURL 注释行，注释行之前的装配文本以 `;\n` 收口。
    let comment = format!("//# sourceMappingURL={}.map\n", artifact.file_name);
    assert!(code.ends_with(&comment), "{code}");
    assert!(code[..code.len() - comment.len()].ends_with(";\n"), "{code}");

    assert_eq!(plan.entry_files, vec![("main".to_string(), artifact.file_name.clone())]);
    assert!(plan.assets.is_empty());
    assert!(plan.dynamic_files.is_empty());
}

/// source map v3 产物形状：`version`/`file`/`sources`（与 manifest `modules`
/// 同口径）/`sourcesContent` 内嵌/`mappings` 非空；`code` 末尾注释行与
/// map 文件名一致；manifest `chunks[].sourceMap` 如实报告 `<file>.map`。
#[test]
fn source_map_shape_matches_chunk_contract() {
    let root = temp_tree(
        "smapshape",
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    let manifest: serde_json::Value = serde_json::from_str(&plan.manifest_json).unwrap();
    for (index, artifact) in plan.artifacts.iter().enumerate() {
        let map: serde_json::Value = serde_json::from_str(&artifact.source_map).unwrap();
        assert_eq!(map["version"], 3, "{}", artifact.file_name);
        assert_eq!(map["file"], artifact.file_name.as_str());
        let sources: Vec<&str> =
            map["sources"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(sources, artifact.modules.iter().map(String::as_str).collect::<Vec<_>>());
        assert_eq!(map["sourcesContent"].as_array().unwrap().len(), sources.len());
        let mappings = map["mappings"].as_str().unwrap();
        assert!(!mappings.is_empty(), "{}", artifact.file_name);
        assert!(
            artifact.code.ends_with(&format!("//# sourceMappingURL={}.map\n", artifact.file_name)),
            "{}",
            artifact.code
        );
        assert_eq!(
            manifest["chunks"][index]["sourceMap"],
            format!("{}.map", artifact.file_name).as_str()
        );
    }
}

/// 解码 source map v3 `mappings` 为逐生成行的绝对
/// `(gen_col, src_index, src_line, src_col)` 段序列。
fn decode_mappings(mappings: &str) -> Vec<Vec<(u32, u32, u32, u32)>> {
    const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out: Vec<Vec<(u32, u32, u32, u32)>> = Vec::new();
    let (mut src_index, mut src_line, mut src_col) = (0i64, 0i64, 0i64);
    for line in mappings.split(';') {
        let mut gen_col = 0i64;
        let mut segments = Vec::new();
        if !line.is_empty() {
            for field in line.split(',') {
                let bytes = field.as_bytes();
                let mut pos = 0usize;
                let mut values: Vec<i64> = Vec::new();
                while pos < bytes.len() {
                    let mut result = 0i64;
                    let mut shift = 0u32;
                    loop {
                        let digit =
                            B64.iter().position(|b| *b == bytes[pos]).expect("base64 digit") as i64;
                        pos += 1;
                        result += (digit & 31) << shift;
                        shift += 5;
                        if digit & 32 == 0 {
                            break;
                        }
                    }
                    values.push(if result & 1 == 1 { -(result >> 1) } else { result >> 1 });
                }
                gen_col += values.first().copied().unwrap_or(0);
                if values.len() >= 4 {
                    src_index += values[1];
                    src_line += values[2];
                    src_col += values[3];
                    segments.push((
                        gen_col as u32,
                        src_index as u32,
                        src_line as u32,
                        src_col as u32,
                    ));
                }
            }
        }
        out.push(segments);
    }
    out
}

/// 行级映射链端到端：多行函数切片逐行回指原模块行列，跨模块切片按
/// `sources` 下标分流；合成行（`export {}` 与注释行）无映射段。
#[test]
fn source_map_line_mappings_decode_to_module_lines() {
    let root = temp_tree(
        "smaplines",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/lib.js",
                "export function helper(n) {\n  return n + 1;\n}\nexport const VALUE = 41;\n",
            ),
            (
                "src/entry.js",
                "import { helper, VALUE } from './lib.js';\nexport const run = helper(VALUE);\n",
            ),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(plan.artifacts.len(), 1);
    let artifact = &plan.artifacts[0];
    assert!(artifact.modules[0].ends_with("src/lib.js"));
    assert!(artifact.modules[1].ends_with("src/entry.js"));

    let map: serde_json::Value = serde_json::from_str(&artifact.source_map).unwrap();
    let decoded = decode_mappings(map["mappings"].as_str().unwrap());
    // 装配体 5 行有映射（函数 3 行 + VALUE 1 行 + entry 1 行），
    // 合成 export 行与注释行不产段。切片起点在 `export ` 关键字之后
    // （声明起点列 7），多行切片的续行回指原模块行起点（列 0）。
    assert_eq!(
        decoded,
        vec![
            vec![(0, 0, 0, 7)],
            vec![(0, 0, 1, 0)],
            vec![(0, 0, 2, 0)],
            vec![(0, 0, 3, 7)],
            vec![(0, 1, 1, 7)],
        ],
        "mappings: {}",
        map["mappings"].as_str().unwrap()
    );
    // 段与生成文本逐行对得上：第 2 行是 `  return n + 1;`（lib 第 2 行）。
    let body_lines: Vec<&str> = artifact.code.lines().collect();
    assert_eq!(body_lines[1].trim(), "return n + 1;", "{}", body_lines[1]);
    assert!(body_lines[4].contains("helper(VALUE)"), "{}", body_lines[4]);
}

/// write_emit 物化 `.map`：每个 chunk 的 `<file_name>.map` 落盘且字节
/// 与产物 `source_map` 一致。
#[test]
fn write_emit_lands_source_maps() {
    let root = temp_tree(
        "smapwrite",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/app.js", "export const load = () => import('./lazy.js');\n"),
            ("src/lazy.js", "export const later = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("app".to_string(), root.join("src/app.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "app".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["load".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    for artifact in &plan.artifacts {
        let map_path = out.join(format!("{}.map", artifact.file_name));
        assert!(map_path.is_file(), "{}", map_path.display());
        assert_eq!(fs::read_to_string(&map_path).unwrap(), artifact.source_map);
        let js = fs::read_to_string(out.join(&artifact.file_name)).unwrap();
        assert!(js.contains(&format!("//# sourceMappingURL={}.map\n", artifact.file_name)), "{js}");
    }
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
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
        &[EntryUse {
            entry_logical: "app".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["load".into()]),
        }],
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["x".into()]),
        }],
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["x".into()]),
        }],
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["x".into()]),
        }],
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
        let link_plan = link(
            &graph,
            &[EntryUse {
                entry_logical: "main".to_string(),
                execution: EntryExecution::Full,
                exports: EntryExports::All,
            }],
        );
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["k".into()]),
        }],
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
        let link_plan = link(
            &graph,
            &[EntryUse {
                entry_logical: "main".to_string(),
                execution: EntryExecution::Full,
                exports: EntryExports::All,
            }],
        );
        let chunks = plan_chunks(&graph, &link_plan);
        let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
        assert!(codes(&errors).contains(&expected.to_string()), "{name}: {errors:?}");
    }
}

/// bootstrap 端到端：对象字面量箭头包裹的动态 import 建独立 async chunk、
/// 说明符重写为目标 chunk 文件且查询串随身份剥离；裸包经 `exports` browser
/// 条件进图；入口 `execution: Full` 整体执行（全部模块保留）；两懒页
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
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "bootstrap".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );
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
/// `b.js` 的值声明必须被活跃语句引用，否则纯且未使用的声明会被剪除，
/// 不再与 `a.js` 的导出构成冲突。
#[test]
fn name_conflict_is_rejected() {
    let root = temp_tree(
        "conflict",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { value } from './a.js';\nexport const main = value;\n"),
            ("src/a.js", "import './b.js';\nexport const value = 1;\n"),
            ("src/b.js", "export const value = 2;\nconsole.log(value);\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(codes(&errors).contains(&"vmz::pack::emit::name_conflict".to_string()), "{errors:?}");
    assert!(errors.iter().any(|d| d.message.contains("value")), "{errors:?}");
}

/// 同 chunk 冲突声明中未被导出事实消费的一侧改名 `{name}__vmz{node}`：
/// 声明 token 与活跃值引用一并改写，导出面与另一侧声明不受影响。
#[test]
fn conflicting_unexported_declaration_is_renamed() {
    let root = temp_tree(
        "declrename",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { value } from './a.js';\nexport const main = value;\n"),
            ("src/a.js", "import './b.js';\nexport const value = 1;\n"),
            ("src/b.js", "const value = 2;\nconsole.log(value);\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    assert_eq!(plan.artifacts.len(), 1);
    let code = &plan.artifacts[0].code;
    // 被导出的一侧原样保留，导出面不变。
    assert!(code.contains("const value = 1"), "{code}");
    assert!(code.contains("export { value }"), "{code}");
    assert!(code.contains("const main = value"), "{code}");
    // 未导出的一侧声明与引用一起改名。
    assert!(code.contains("console.log(value__vmz"), "{code}");
    assert!(!code.contains("const value = 2"), "{code}");
    assert!(!code.contains("console.log(value)"), "{code}");
}

/// 冲突声明的解构模式 token 同时充当属性键（上游 `rename_unsafe`），
/// 改名会改变语义：不改名，冲突维持 `name_conflict` 显式拒绝。
#[test]
fn destructuring_conflict_stays_rejected() {
    let root = temp_tree(
        "declconflict",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { value } from './a.js';\nexport const main = value;\n"),
            ("src/a.js", "import './b.js';\nexport const value = 1;\n"),
            ("src/b.js", "const { value } = obj;\nconsole.log(value);\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(codes(&errors).contains(&"vmz::pack::emit::name_conflict".to_string()), "{errors:?}");
}

/// 同 chunk 的 `import { value as v }`：scope 事实给出全部值引用，消费者
/// 绑定名在活跃语句切片内改写为 chunk 落点名，不产出任何 import 文本。
#[test]
fn binding_rename_is_applied_via_scope_facts() {
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    assert_eq!(plan.artifacts.len(), 1);
    let code = &plan.artifacts[0].code;
    assert!(code.contains("const main = value"), "{code}");
    assert!(!code.contains(" as v"), "{code}");
    assert!(!code.contains("import"), "{code}");
    assert!(code.contains("export { value }"), "{code}");
    assert!(code.contains("export { main }"), "{code}");
}

/// 隐藏改名落点：`export { value as shared }` 的 chunk 绑定名是 `value`，
/// 消费者引用全部改写；deferred 导出仍发 `export { value as shared }`。
#[test]
fn hidden_rename_lands_on_declaration_name() {
    let root = temp_tree(
        "hidden",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { shared } from './a.js';\nexport const main = shared;\n",
            ),
            ("src/a.js", "let value;\nexport { value as shared };\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let code = &plan.artifacts[0].code;
    assert!(code.contains("const main = value"), "{code}");
    assert!(code.contains("export { value as shared }"), "{code}");
    assert!(!code.contains("shared;"), "{code}");
}

/// default 导入落点到具名默认声明：`import D` 改写为 chunk 绑定名 `Foo`。
#[test]
fn default_import_renamed_to_class_binding() {
    let root = temp_tree(
        "defaultrename",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import D from './a.js';\nexport const main = D;\n"),
            ("src/a.js", "export default class Foo {}\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let code = &plan.artifacts[0].code;
    assert!(code.contains("const main = Foo"), "{code}");
    assert!(code.contains("export { Foo as default }"), "{code}");
}

/// 同 chunk 命名空间绑定：对本 chunk 自身产物发 import-from-self，真实
/// Module Namespace，发非致命 `namespace_widened`，不做名字重写。
#[test]
fn namespace_import_same_chunk_self_reference() {
    let root = temp_tree(
        "nssame",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import * as ns from './a.js';\nexport const main = ns.value;\n"),
            ("src/a.js", "export const value = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(plan.artifacts.len(), 1);
    let artifact = &plan.artifacts[0];
    let code = &artifact.code;
    assert!(
        code.contains(&format!("import * as ns from \"./{}\";", artifact.file_name)),
        "{code}"
    );
    assert!(code.contains("ns.value"), "{code}");
    assert!(code.contains("export { value }"), "{code}");
    assert!(
        codes(&plan.diagnostics).contains(&"vmz::pack::emit::namespace_widened".to_string()),
        "{:?}",
        plan.diagnostics
    );
}

/// 消费者重命名绑定经 deferred 导出转手：`export { helper as api }` 的
/// local 走同一重写计划，发射 `export { util as api }`。
#[test]
fn renamed_import_exported_via_deferred_local() {
    let root = temp_tree(
        "deferred",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { util as helper } from './lib.js';\nexport { helper as api };\n"),
            ("src/lib.js", "export const util = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["api".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let code = &plan.artifacts[0].code;
    assert!(code.contains("export { util as api }"), "{code}");
    assert!(!code.contains("helper"), "{code}");
}

/// 守卫反例：类型位置引用、嵌套遮蔽、`scope_incomplete`、消费者同名绑定
/// 四类都会让重写不安全，全部维持 `binding_rename_unsupported` 显式拒绝。
#[test]
fn binding_rename_guards_reject() {
    let cases: [(&str, &str); 4] = [
        (
            "type",
            "import { value as v } from './a.js';\nlet on: v = null;\nexport const main = v;\n",
        ),
        (
            "shadow",
            "import { value as v } from './a.js';\nexport const main = (() => { const value = 2; return v; })();\n",
        ),
        ("eval", "import { value as v } from './a.js';\neval('x');\nexport const main = v;\n"),
        (
            "collision",
            "import { value as v } from './a.js';\nconst value = 3;\nexport const main = v + value;\n",
        ),
    ];
    for (name, entry_src) in cases {
        let root = temp_tree(
            &format!("renameguard-{name}"),
            &[
                ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
                ("src/entry.js", entry_src),
                ("src/a.js", "export const value = 1;\n"),
            ],
        );
        let graph =
            build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
        let link_plan = link(
            &graph,
            &[EntryUse {
                entry_logical: "main".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["main".into()]),
            }],
        );
        let chunks = plan_chunks(&graph, &link_plan);
        let errors = match plan_emit(&graph, &link_plan, &chunks, &options()) {
            Ok(plan) => panic!("case `{name}` 期望拒绝，实际产出：{:?}", plan.artifacts),
            Err(errors) => errors,
        };
        assert!(
            codes(&errors).contains(&"vmz::pack::emit::binding_rename_unsupported".to_string()),
            "case `{name}`: {errors:?}"
        );
    }
}

/// 未使用绑定精确剪枝：scope 事实完整时绑定 used 当且仅当引用 span 落在
/// 活跃语句或 export 子句内。`shared` 只出现在形参遮蔽位置（模块绑定零值
/// 引用），跨 chunk import 不合成；真实使用的同名绑定照常合成。
#[test]
fn shadowed_only_import_binding_is_pruned() {
    let root = temp_tree(
        "shadowprune",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/one.js",
                "import { shared } from './shared.js';\nfunction f(shared){ return shared }\nexport const a1 = f(1);\n",
            ),
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let shared = plan.artifacts.iter().find(|a| a.chunk_id == "shared/one+two").unwrap();
    let one = plan.artifacts.iter().find(|a| a.chunk_id == "entry/one").unwrap();
    assert!(!one.code.contains("import"), "{}", one.code);
    assert!(one.code.contains("function f(shared)"), "{}", one.code);
    assert!(one.code.contains("export { a1 }"), "{}", one.code);

    let two = plan.artifacts.iter().find(|a| a.chunk_id == "entry/two").unwrap();
    assert!(
        two.code
            .contains(&format!("import {{ shared }} from \"./{}\";", shared.file_name)),
        "{}",
        two.code
    );
}

/// 未使用的同 chunk 绑定不参与预决议：`y` 只被剪除的纯语句引用，不重写
/// 也不误拒（旧行为对剪除语句内的引用 span 给 `binding_rename_unsupported`
/// 假拒绝）；目标模块按求值维度保留——副作用语句保留，未被消费的纯导出
/// 随剪除消失。
#[test]
fn unused_same_chunk_binding_skips_pre_resolve() {
    let root = temp_tree(
        "unusedsame",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { x as y } from './b.js';\nimport './b.js';\nconst pruned = y;\nexport const main = 1;\n",
            ),
            ("src/b.js", "export const x = 1;\nconsole.log(\"b-side\");\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let code = &plan.artifacts[0].code;
    assert!(code.contains("console.log(\"b-side\")"), "{code}");
    assert!(!code.contains("export { x }"), "{code}");
    assert!(!code.contains("pruned"), "{code}");
    assert!(!code.contains(" y"), "{code}");
}

/// 类型引用参与时回退方向：`extends T` 是运行时值使用但上游只记类型引用
/// （无 span），精确判定不可信，回退语法名字匹配后 import 照常保留——
/// 保守超集只多留不误剪，剪掉它会产出悬空引用。
#[test]
fn extends_only_use_falls_back_to_name_matching() {
    let root = temp_tree(
        "extendsfallback",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/one.js", "import { T } from './shared.js';\nexport class C extends T {}\n"),
            ("src/two.js", "import { v } from './shared.js';\nexport const a2 = v;\n"),
            ("src/shared.js", "export class T {}\nexport const v = 1;\n"),
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["C".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let shared = plan.artifacts.iter().find(|a| a.chunk_id == "shared/one+two").unwrap();
    let one = plan.artifacts.iter().find(|a| a.chunk_id == "entry/one").unwrap();
    assert!(
        one.code.contains(&format!("import {{ T }} from \"./{}\";", shared.file_name)),
        "{}",
        one.code
    );
    assert!(one.code.contains("class C extends T"), "{}", one.code);
}

/// External 决议：同 chunk barrel 的重导出事实链落到其它 chunk 时，消费者
/// 绑定按落点 chunk 与落点导出名合成跨 chunk import（`q as y`），
/// 名字保持消费者本地名 `y`。
#[test]
fn binding_external_chain_synthesizes_landing_name() {
    let root = temp_tree(
        "external",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/e1.js", "import { x as y } from './barrel.js';\nexport const main = y;\n"),
            ("src/barrel.js", "export { q as x } from './deep.js';\n"),
            ("src/deep.js", "export const q = 1;\n"),
            ("src/e2.js", "import { q } from './deep.js';\nexport const other = q;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("main".to_string(), root.join("src/e1.js")),
            ("other".to_string(), root.join("src/e2.js")),
        ],
        Target::Browser,
        &root,
    );
    let link_plan = link(
        &graph,
        &[
            EntryUse {
                entry_logical: "main".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["main".into()]),
            },
            EntryUse {
                entry_logical: "other".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["other".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let e1 = plan
        .artifacts
        .iter()
        .find(|artifact| artifact.code.contains("const main = y"))
        .expect("e1 chunk 保留本地名 y");
    assert!(e1.code.contains("import { q as y } from"), "{}", e1.code);
    assert!(!e1.code.contains("./barrel.js"), "{}", e1.code);
}

/// 同 chunk `export * as ns`：改写为对本 chunk 自身产物文件的引用，命名空间
/// 是真实 Module Namespace（原生 ESM 自引用），名字集加宽到整个 chunk，
/// 发非致命 `namespace_widened`，不阻断产出。
#[test]
fn same_chunk_namespace_reexport_emits_self_reference() {
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(plan.artifacts.len(), 1);
    let artifact = &plan.artifacts[0];
    let code = &artifact.code;
    // 自引用指向 chunk 自身最终文件名，不留占位符与原始说明符。
    assert!(
        code.contains(&format!("export * as ns from \"./{}\";", artifact.file_name)),
        "{code}"
    );
    assert!(!code.contains("__vmz_chunk_"), "{code}");
    assert!(!code.contains("./impl.js"), "{code}");
    // 命名空间经 chunk 导出面可达源模块导出。
    assert!(code.contains("export { thing }"), "{code}");
    assert!(
        codes(&plan.diagnostics).contains(&"vmz::pack::emit::namespace_widened".to_string()),
        "{:?}",
        plan.diagnostics
    );
}

/// 同 chunk 动态边界（SCC：动态目标与源同 chunk）：说明符改写为 chunk 自身
/// 产物文件，发非致命 `dynamic_same_chunk_widened`，manifest 动态映射如实
/// 记录自引用。
#[test]
fn same_chunk_dynamic_import_rewrites_to_self_chunk() {
    let root = temp_tree(
        "dynsame",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { helper } from './lib.js';\nexport const main = helper;\nexport const lazy = () => import('./lib.js');\n",
            ),
            (
                "src/lib.js",
                "import { main } from './entry.js';\nexport function helper() { return main; }\n",
            ),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into(), "lazy".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert_eq!(plan.artifacts.len(), 1, "循环依赖收缩为同一 chunk");
    let artifact = &plan.artifacts[0];
    let code = &artifact.code;
    assert!(
        code.contains(&format!("import(\"./{}\")", artifact.file_name)),
        "{code}"
    );
    assert!(!code.contains("__vmz_chunk_"), "{code}");
    assert!(!code.contains("./lib.js"), "{code}");
    assert_eq!(artifact.dynamic, vec![artifact.file_name.clone()], "动态映射如实记录自引用");
    assert!(
        codes(&plan.diagnostics)
            .contains(&"vmz::pack::emit::dynamic_same_chunk_widened".to_string()),
        "{:?}",
        plan.diagnostics
    );
}

/// 同 chunk `X as X` 重导出：目标模块的绑定事实给出 chunk 内绑定名，
/// 与目标模块自身的 Local 事实是同一导出，只发一条 `export { helper }`，
/// 不产出任何 export-from 文本。
#[test]
fn same_chunk_reexport_same_name_emits_single_binding_export() {
    let root = temp_tree(
        "reexportsame",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { helper } from './barrel.js';\nexport const main = helper;\n"),
            ("src/barrel.js", "export { helper as helper } from './lib.js';\n"),
            ("src/lib.js", "export function helper() { return 1 }\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    assert_eq!(plan.artifacts.len(), 1);

    let code = &plan.artifacts[0].code;
    assert!(code.contains("function helper"), "{code}");
    // 绑定名决议出的导出与 lib 自身 Local 事实合一：恰好一条。
    assert_eq!(code.matches("export { helper };").count(), 1, "{code}");
    assert!(code.contains("export { main }"), "{code}");
    // 同 chunk 拼接不产出 export-from，也不留占位符与原始说明符。
    assert!(!code.contains("} from"), "{code}");
    assert!(!code.contains("__vmz_chunk_"), "{code}");
    assert!(!code.contains("./lib.js"), "{code}");
    assert!(!code.contains("./barrel.js"), "{code}");
}

/// 同 chunk `A as B` 重导出、B 被其它 chunk 消费：落点绑定名沿事实解析为
/// `helper`，chunk 对外发 `export { helper as alias }`，消费方合成 import。
#[test]
fn same_chunk_reexport_rename_exports_to_other_chunks() {
    let root = temp_tree(
        "reexportrename",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/one.js", "import { alias } from './barrel.js';\nexport const a = alias;\n"),
            ("src/two.js", "import { alias } from './barrel.js';\nexport const b = alias;\n"),
            ("src/barrel.js", "export { helper as alias } from './lib.js';\n"),
            ("src/lib.js", "export function helper() { return 1 }\n"),
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["b".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let shared = plan.artifacts.iter().find(|a| a.chunk_id.starts_with("shared/")).unwrap();
    assert!(shared.code.contains("export { helper as alias }"), "{}", shared.code);
    assert!(shared.code.contains("export { helper }"), "{}", shared.code);
    assert!(!shared.code.contains("} from"), "{}", shared.code);
    assert!(!shared.code.contains("__vmz_chunk_"), "{}", shared.code);
    for logical in ["one", "two"] {
        let artifact =
            plan.artifacts.iter().find(|a| a.chunk_id == format!("entry/{logical}")).unwrap();
        assert!(
            artifact
                .code
                .contains(&format!("import {{ alias }} from \"./{}\";", shared.file_name)),
            "{}",
            artifact.code
        );
    }
}

/// 同 chunk 重导出链中途离开本 chunk：沿事实走到跨 chunk 一跳后，按跨
/// chunk 同形态发 `export { <目标导出名> as <导出名> } from <目标 chunk>`，
/// 同链路的重复表述只发一条。
#[test]
fn same_chunk_reexport_chain_leaving_chunk_emits_export_from() {
    let root = temp_tree(
        "reexportexternal",
        &[
            (
                "package.json",
                r#"{"name":"app","version":"0.0.0"}"#,
            ),
            (
                "src/entry.js",
                "export { thing } from './barrel.js';\nexport const load = () => import('./impl.js');\n",
            ),
            ("src/barrel.js", "export { x as thing } from './mid.js';\n"),
            ("src/mid.js", "export { value as x } from './impl.js';\n"),
            ("src/impl.js", "export const value = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["thing".into(), "load".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    // impl 同时被静态链与动态根可达 → 独立 chunk；entry/barrel/mid 同 chunk。
    let target = plan.artifacts.iter().find(|a| a.modules[0].ends_with("src/impl.js")).unwrap();
    assert_ne!(target.chunk_id, "entry/main");
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/main").unwrap();
    // 链路落点 `value` 直接以 chunk 对外导出名 `thing` 发 export-from，恰好一条。
    assert_eq!(
        entry.code.matches(&format!("export {{ value as thing }} from \"./{}\";", target.file_name)).count(),
        1,
        "{}",
        entry.code
    );
    assert!(entry.code.contains("export { load }"), "{}", entry.code);
    assert!(!entry.code.contains("__vmz_chunk_"), "{}", entry.code);
    assert!(!entry.code.contains("./barrel.js"), "{}", entry.code);
    assert!(!entry.code.contains("./mid.js"), "{}", entry.code);
    assert!(target.code.contains("export { value }"), "{}", target.code);
}

/// 重导出链的落点只有 `export *` 事实（星号来源不展开）：解析不到绑定
/// 事实，显式拒绝，不做名字猜测。
#[test]
fn same_chunk_reexport_from_star_source_is_rejected() {
    let root = temp_tree(
        "reexportstar",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { t2 } from './wrapper.js';\nexport const main = t2;\n"),
            ("src/wrapper.js", "export { thing as t2 } from './barrel.js';\n"),
            ("src/barrel.js", "export * from './impl.js';\n"),
            ("src/impl.js", "export const thing = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::reexport_rename_unsupported".to_string()),
        "{errors:?}"
    );
}

/// 重导出 `export { default as x } from`：`export default <表达式>` 没有
/// 绑定名可引用，解析不到绑定事实，显式拒绝。
#[test]
fn same_chunk_reexport_of_expression_default_is_rejected() {
    let root = temp_tree(
        "reexportexprdefault",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { answer } from './barrel.js';\nexport const main = answer;\n"),
            ("src/barrel.js", "export { default as answer } from './lib.js';\n"),
            ("src/lib.js", "export default 42;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::reexport_rename_unsupported".to_string()),
        "{errors:?}"
    );
}

/// 同 chunk `export *`：目标模块直接非类型具名导出沿事实链展开为具名
/// 导出，与目标模块自身 deferred Local 同一绑定同一名字去重成一条；
/// 未被需求命中的纯导出按既有剪枝口径消失，不产出 `export *` 文本。
#[test]
fn same_chunk_star_reexport_expands_direct_named_exports() {
    let root = temp_tree(
        "starexpand",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { thing } from './barrel.js';\nexport const main = thing;\n"),
            ("src/barrel.js", "export * from './lib.js';\n"),
            ("src/lib.js", "export const thing = 1;\nexport const other = 2;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    assert_eq!(plan.artifacts.len(), 1);

    let code = &plan.artifacts[0].code;
    assert!(code.contains("const thing = 1"), "{code}");
    // 展开的具名导出与 lib 自身 Local 事实合一：恰好一条。
    assert_eq!(code.matches("export { thing };").count(), 1, "{code}");
    assert!(code.contains("export { main }"), "{code}");
    // 未被需求的纯导出剪枝，星号文本与原始说明符不残留。
    assert!(!code.contains("export { other }"), "{code}");
    assert!(!code.contains("export *"), "{code}");
    assert!(!code.contains("__vmz_chunk_"), "{code}");
    assert!(!code.contains("./lib.js"), "{code}");
    assert!(!code.contains("./barrel.js"), "{code}");
}

/// 同 chunk `export *` 的来源自身含活跃 `export *`（名字经链流入不可
/// 枚举）：保持显式拒绝，不递归收集。
#[test]
fn same_chunk_star_reexport_active_star_chain_is_rejected() {
    let root = temp_tree(
        "starchain",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { thing } from './barrel.js';\nexport const main = thing;\n"),
            ("src/barrel.js", "export * from './lib.js';\n"),
            ("src/lib.js", "export * from './deep.js';\n"),
            ("src/deep.js", "export const thing = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::namespace_synthesis_unsupported".to_string()),
        "{errors:?}"
    );
}

/// 同 chunk `export *` 不传播 `default`（ESM 星号语义）：来源模块的
/// 表达式 default 无绑定名也不阻断具名展开，产物不含 `as default`。
#[test]
fn same_chunk_star_reexport_skips_expression_default() {
    let root = temp_tree(
        "stardefault",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { thing } from './barrel.js';\nexport const main = thing;\n"),
            ("src/barrel.js", "export * from './lib.js';\n"),
            ("src/lib.js", "export default 42;\nexport const thing = 1;\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let code = &plan.artifacts[0].code;
    assert!(code.contains("export { thing }"), "{code}");
    assert!(!code.contains("as default"), "{code}");
    // 未被需求的表达式 default 语句按剪枝口径消失。
    assert!(!code.contains("42"), "{code}");
    assert!(!code.contains("export *"), "{code}");
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
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["icon".into()]),
        }],
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

/// 死分支资产：链接层剪除的语句里的 `new URL` 引用不进产物集与 manifest，
/// `write_emit` 不建 `assets/` 目录，切片文本原样保留（资产不存在）。
#[test]
fn dead_branch_asset_is_not_emitted() {
    let root = temp_tree(
        "deadasset",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export const keep = 1;\nexport function deadIcon() { return new URL('./gone.svg', import.meta.url); }\n",
            ),
            ("src/gone.svg", "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["keep".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    assert!(plan.assets.is_empty(), "{:?}", plan.assets);
    assert!(!plan.manifest_json.contains("gone.svg"), "{}", plan.manifest_json);
    let code = &plan.artifacts[0].code;
    assert!(!code.contains("deadIcon"), "{code}");

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert!(!out.join("assets").exists(), "no assets dir for dead references");
}

/// 死分支资产文件缺失：被剪除的引用不读文件，构建成功；对照同一引用
/// 在全量执行下保持活跃时，缺失文件仍显式拒绝 `asset_unresolved`。
#[test]
fn dead_branch_missing_asset_file_does_not_fail_build() {
    let root = temp_tree(
        "deadassetmissing",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export const keep = 1;\nexport function deadIcon() { return new URL('./missing.svg', import.meta.url); }\n",
            ),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["keep".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.assets.is_empty(), "{:?}", plan.assets);

    let full_link = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );
    let full_chunks = plan_chunks(&graph, &full_link);
    let errors = plan_emit(&graph, &full_link, &full_chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::asset_unresolved".to_string()),
        "{errors:?}"
    );
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
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
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
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
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["marker".into()]),
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
    let node_index =
        nodes.iter().enumerate().map(|(index, node)| (node.resolved.path.clone(), index)).collect();
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
                used_targets: Vec::new(),
                dynamic_edges: Vec::new(),
            },
            LinkedModule {
                node: 1,
                active_statements: Vec::new(),
                used_reexports: Vec::new(),
                used_targets: Vec::new(),
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
            used_targets: Vec::new(),
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
            ("src/entry.js", "export const loadFace = () => import('/dom.browser.js');\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );
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
            ("src/entry.js", "export const loadFace = () => import('./gone.js');\n"),
        ],
    );
    let graph =
        build_graph(&[("main".to_string(), root.join("src/entry.js"))], Target::Browser, &root);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let errors = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap_err();
    assert!(
        codes(&errors).contains(&"vmz::pack::emit::dynamic_unresolved".to_string()),
        "{errors:?}"
    );
}

/// 跨 chunk 求值保留：入口只静态导入目标模块的未被消费导出时，绑定 import
/// 不会合成，但目标模块可观察求值，必须补一条 chunk 级副作用 import——否则
/// 目标及其传递副作用在运行时不会执行，减枝就改变了程序行为。
#[test]
fn cross_chunk_evaluation_is_preserved_without_used_bindings() {
    let root = temp_tree(
        "evalpreserve",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry-a.js",
                "import { unused } from './b.js';\nexport const a = 1;\n",
            ),
            (
                "src/entry-b.js",
                "import { used } from './b.js';\nexport const b = used;\n",
            ),
            ("src/b.js", "console.log('b-side');\nexport const used = 1;\nexport const unused = 2;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("a".to_string(), root.join("src/entry-a.js")),
            ("b".to_string(), root.join("src/entry-b.js")),
        ],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[
            EntryUse {
                entry_logical: "a".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a".into()]),
            },
            EntryUse {
                entry_logical: "b".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["b".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let shared =
        plan.artifacts.iter().find(|a| a.chunk_id.starts_with("shared/")).expect("shared chunk");
    assert!(shared.modules.iter().any(|m| m.ends_with("src/b.js")), "{:?}", shared.modules);
    assert!(shared.code.contains("console.log('b-side')"), "{}", shared.code);

    let entry_a = plan.artifacts.iter().find(|a| a.chunk_id == "entry/a").unwrap();
    assert!(
        entry_a.code.contains(&format!("import \"./{}\";", shared.file_name)),
        "{}",
        entry_a.code
    );
    // 未被消费的绑定不合成具名 import，也不把 `unused` 带进文本。
    assert!(!entry_a.code.contains("unused"), "{}", entry_a.code);

    let entry_b = plan.artifacts.iter().find(|a| a.chunk_id == "entry/b").unwrap();
    assert!(
        entry_b.code.contains(&format!("import {{ used }} from \"./{}\";", shared.file_name)),
        "{}",
        entry_b.code
    );
}

/// 分包依赖只取 link 活跃结论：入口 A 静态导入纯模块 P 的未消费导出时，
/// 这条边既不可观察求值也不是符号使用，不产生依赖边。P 不进入 shared 分区，
/// 只随真正使用它的入口 B 落进 B 的 chunk。
#[test]
fn pure_target_without_symbol_use_does_not_join_shared_partition() {
    let root = temp_tree(
        "chunkpure",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry-one.js", "import { unused } from './p.js';\nexport const one = 1;\n"),
            ("src/entry-two.js", "import { p } from './p.js';\nexport const two = p;\n"),
            ("src/p.js", "export const p = 1;\n"),
        ],
    );
    let graph = build_graph(
        &[
            ("one".to_string(), root.join("src/entry-one.js")),
            ("two".to_string(), root.join("src/entry-two.js")),
        ],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["one".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["two".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    assert_eq!(chunks.chunks.len(), 2, "{:?}", chunks.chunks);
    assert!(chunks.chunks.iter().all(|chunk| !chunk.id.starts_with("shared/")));
    let one = chunks.chunks.iter().find(|chunk| chunk.id == "entry/one").unwrap();
    let two = chunks.chunks.iter().find(|chunk| chunk.id == "entry/two").unwrap();
    let pure = graph.index_of(&root.join("src/p.js")).unwrap();
    assert!(!one.modules.contains(&pure), "{:?}", one.modules);
    assert!(two.modules.contains(&pure), "{:?}", two.modules);
    assert!(one.depends_on.is_empty(), "{:?}", one.depends_on);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
}
