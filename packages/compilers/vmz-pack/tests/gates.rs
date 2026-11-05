//! 产物级门禁：把「该有的有、不该有的没有、同输入同产物」落成对
//! `write_emit` 落盘结果的封闭断言。与 `emit.rs` 的语义单测不同，这里把
//! 整棵产物树当作一个产品验收：可达闭包、引用完整性、分包边界、vendor
//! 去重、类型零残留、字节级确定性，以及必须真失败的负向门禁。
//!
//! 每个门禁先钉住夹具前提（证明断言非真空），再断言产物不变量。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use vmz_pack::PackDiagnostic;
use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, EmitPlan, plan_emit, write_emit};
use vmz_pack::graph::{ModuleGraph, build_graph};
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, LinkPlan, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-gates-{name}-{}", std::process::id()));
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
    EmitOptions { public_base: "/_vmz/".to_string(), minify: false }
}

fn codes(diagnostics: &[PackDiagnostic]) -> Vec<String> {
    diagnostics.iter().map(|diagnostic| diagnostic.code.clone()).collect()
}

/// 全流水线：图 → 链接 → 分包 → 产物计划。默认要求全程零诊断；门禁需要
/// 诊断的用例不走本助手。
fn run_pipeline(
    root: &Path,
    entries: &[(String, PathBuf)],
    uses: &[EntryUse],
) -> (ModuleGraph, LinkPlan, EmitPlan) {
    let graph = build_graph(entries, Target::Browser, root);
    assert!(graph.diagnostics.is_empty(), "graph: {:?}", graph.diagnostics);
    let link_plan = link(&graph, uses);
    assert!(link_plan.diagnostics.is_empty(), "link: {:?}", link_plan.diagnostics);
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "chunk: {:?}", chunks.diagnostics);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    assert!(plan.diagnostics.is_empty(), "emit: {:?}", plan.diagnostics);
    (graph, link_plan, plan)
}

/// 落盘产物树：相对路径 → 字节。
fn read_tree(out: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut files = BTreeMap::new();
    let mut stack = vec![out.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let rel = path.strip_prefix(out).unwrap().to_string_lossy().replace('\\', "/");
            files.insert(rel, fs::read(&path).unwrap());
        }
    }
    files
}

/// 产物文本里被静态/动态 import 消费的说明符。
///
/// 只识别机器合成形状：标识符 `from` / `import` 与随后的字符串字面量之间
/// 只有空白（或动态调用多一对 `(`）。字符串、模板与注释内部一律不透明，
/// 数据源文本里的 `./x` 不会被误判为模块说明符。
fn import_specifiers(code: &str) -> Vec<String> {
    let chars: Vec<char> = code.chars().collect();
    let mut out = Vec::new();
    let mut index = 0;
    let mut last_ident: Option<String> = None;
    let mut ident_is_member = false;
    let mut between: String = String::new();
    let mut line_comment = false;
    let mut block_comment = false;
    while index < chars.len() {
        let ch = chars[index];
        let next = chars.get(index + 1).copied();
        if line_comment {
            if ch == '\n' {
                line_comment = false;
            }
            index += 1;
            continue;
        }
        if block_comment {
            if ch == '*' && next == Some('/') {
                block_comment = false;
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if ch == '/' && next == Some('/') {
            line_comment = true;
            index += 2;
            continue;
        }
        if ch == '/' && next == Some('*') {
            block_comment = true;
            index += 2;
            continue;
        }
        if ch == '"' || ch == '\'' || ch == '`' {
            // 进入字符串：判定前一个标识符与本引号之间是否构成 import 形状。
            // 成员访问形态（`obj.from`、`obj.import(...)`）不是模块说明符。
            let takes = !ident_is_member
                && (matches!(last_ident.as_deref(), Some("from"))
                    || (matches!(last_ident.as_deref(), Some("import"))
                        && (between.trim().is_empty() || between.trim() == "(")));
            let quote = ch;
            let mut cursor = index + 1;
            let mut text = String::new();
            while cursor < chars.len() {
                let inner = chars[cursor];
                if inner == '\\' {
                    cursor += 2;
                    continue;
                }
                if inner == quote {
                    break;
                }
                text.push(inner);
                cursor += 1;
            }
            if takes && quote != '`' {
                out.push(text);
            }
            index = cursor + 1;
            last_ident = None;
            ident_is_member = false;
            between.clear();
            continue;
        }
        if ch.is_ascii_alphabetic() || ch == '_' || ch == '$' {
            // 标识符前一个字符是 `.` 时是成员访问（`obj.from`），不作关键字。
            ident_is_member = index > 0 && chars[index - 1] == '.';
            let mut cursor = index;
            let mut word = String::new();
            while cursor < chars.len()
                && (chars[cursor].is_ascii_alphanumeric()
                    || chars[cursor] == '_'
                    || chars[cursor] == '$')
            {
                word.push(chars[cursor]);
                cursor += 1;
            }
            last_ident = Some(word);
            between.clear();
            index = cursor;
            continue;
        }
        if last_ident.is_some() {
            between.push(ch);
            if between.len() > 8 {
                last_ident = None;
                between.clear();
            }
        }
        index += 1;
    }
    out
}

/// 引用完整性门禁：产物树里每个 .js 的每个说明符都必须解析到树内真实
/// 文件；浏览器产物不得残留任何裸说明符。返回违规清单（空 = 通过），
/// 供正向门禁与负向自检共用。
fn reference_integrity_violations(out: &Path) -> Vec<String> {
    let files = read_tree(out);
    let mut violations = Vec::new();
    for (rel, bytes) in &files {
        if !rel.ends_with(".js") {
            continue;
        }
        let code = String::from_utf8_lossy(bytes);
        for specifier in import_specifiers(&code) {
            if !specifier.starts_with('.') {
                violations.push(format!("{rel}: bare specifier `{specifier}` survived emit"));
                continue;
            }
            let base = Path::new(rel).parent().unwrap_or_else(|| Path::new(""));
            let resolved = base.join(&specifier).to_string_lossy().replace('\\', "/");
            // 归一化 `./` 前缀与 `a/./b` 形态，产物文件名不含 `..`。
            let normalized = resolved.replace("/./", "/");
            let normalized = normalized.strip_prefix("./").unwrap_or(&normalized).to_string();
            if !files.contains_key(&normalized) {
                violations.push(format!(
                    "{rel}: import `{specifier}` resolves to missing `{normalized}`"
                ));
            }
        }
    }
    violations
}

/// 门禁 1：落盘文件集与 manifest 互洽；从未进图的幽灵文件与被链接层
/// 丢弃的纯模块，既不出现在任何 chunk 成员清单，也不泄漏任何文本。
#[test]
fn gate_emitted_files_match_manifest_and_pruned_modules_are_absent() {
    let root = temp_tree(
        "closure",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/one.js",
                "import { shared } from './shared.js';\nimport { p1 } from './priv1.js';\nimport { d } from './dropped.js';\nexport const a1 = shared + p1;\n",
            ),
            (
                "app/src/two.js",
                "import { shared } from './shared.js';\nimport { p2 } from './priv2.js';\nexport const a2 = shared + p2;\n",
            ),
            ("app/src/shared.js", "export const shared = 7;\n"),
            ("app/src/priv1.js", "export const p1 = 101;\n"),
            ("app/src/priv2.js", "export const p2 = 202;\n"),
            // 被 import 但绑定未被消费且自身纯：整模块应被链接层丢弃。
            ("app/src/dropped.js", "export const d = 'DROPPED_MARKER';\n"),
            // 从未被任何人 import：图都进不来。
            ("app/src/ghost.js", "export const ghost = 'GHOST_MARKER';\n"),
        ],
    );
    let app = root.join("app");
    let (graph, _link, plan) = run_pipeline(
        &app,
        &[("one".to_string(), app.join("src/one.js")), ("two".to_string(), app.join("src/two.js"))],
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

    // 夹具前提：dropped 进过图、ghost 从未进图。
    let paths: Vec<String> =
        graph.nodes.iter().map(|n| n.resolved.path.to_string_lossy().replace('\\', "/")).collect();
    assert!(paths.iter().any(|p| p.ends_with("src/dropped.js")), "{paths:?}");
    assert!(!paths.iter().any(|p| p.ends_with("src/ghost.js")), "{paths:?}");
    // 夹具前提：三个 chunk（one、two、shared），dropped 不在任何成员清单。
    assert_eq!(
        plan.artifacts.len(),
        3,
        "{:?}",
        plan.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    let members: Vec<&str> =
        plan.artifacts.iter().flat_map(|a| a.modules.iter().map(String::as_str)).collect();
    assert!(!members.iter().any(|m| m.ends_with("src/dropped.js")), "{members:?}");
    // 文本零泄漏。
    for artifact in &plan.artifacts {
        assert!(!artifact.code.contains("DROPPED_MARKER"), "{}", artifact.chunk_id);
        assert!(!artifact.code.contains("GHOST_MARKER"), "{}", artifact.chunk_id);
    }

    // 落盘闭包：磁盘文件集 = chunk + source map + manifest，一个不多一个不少。
    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    let tree = read_tree(&out);
    let mut expected: BTreeSet<String> = BTreeSet::new();
    for artifact in &plan.artifacts {
        expected.insert(artifact.file_name.clone());
        expected.insert(format!("{}.map", artifact.file_name));
    }
    expected.insert("manifest.json".to_string());
    assert_eq!(tree.keys().collect::<Vec<_>>(), expected.iter().collect::<Vec<_>>());

    // manifest 与落盘互指：manifest 的 chunk 文件名集合与磁盘一致。
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(manifest["version"], "v0");
    let manifest_files: BTreeSet<String> = manifest["chunks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|chunk| chunk["file"].as_str().unwrap().to_string())
        .collect();
    let disk_js: BTreeSet<String> =
        tree.keys().filter(|name| name.ends_with(".js")).cloned().collect();
    assert_eq!(manifest_files, disk_js);
}

/// 门禁 2：每个产物的每个 import 说明符都解析到产物树内真实文件，浏览器
/// 产物不残留裸说明符；附带牙齿自检——删掉一个共享 chunk 后同一检查必须
/// 报出悬空引用，证明门禁不是恒真的空转。
#[test]
fn gate_every_emitted_specifier_resolves_on_disk() {
    let root = temp_tree(
        "integrity",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "app/src/one.js",
                "import { shared } from './shared.js';\nexport const a1 = shared;\nexport const load = () => import('./lazy.js');\n",
            ),
            (
                "app/src/two.js",
                "import { shared } from './shared.js';\nimport { main } from 'acme';\nexport const a2 = shared + main;\n",
            ),
            ("app/src/shared.js", "export const shared = 7;\n"),
            ("app/src/lazy.js", "export const later = 1;\n"),
            (
                "app/node_modules/acme/package.json",
                r#"{"name":"acme","version":"1.0.0","type":"module","exports":{".":"./index.js"}}"#,
            ),
            ("app/node_modules/acme/index.js", "export { core as main } from './lib/core.js';\n"),
            ("app/node_modules/acme/lib/core.js", "export const core = 42;\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("one".to_string(), app.join("src/one.js")), ("two".to_string(), app.join("src/two.js"))],
        &[
            EntryUse {
                entry_logical: "one".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a1".into(), "load".into()]),
            },
            EntryUse {
                entry_logical: "two".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a2".into()]),
            },
        ],
    );

    // 夹具前提：共享 chunk、异步 chunk、vendor 模块全部在场。
    let ids: Vec<&str> = plan.artifacts.iter().map(|a| a.chunk_id.as_str()).collect();
    assert!(ids.iter().any(|id| id.starts_with("shared/")), "{ids:?}");
    assert!(ids.iter().any(|id| id.starts_with("async/")), "{ids:?}");
    assert!(
        plan.artifacts
            .iter()
            .flat_map(|a| a.modules.iter())
            .any(|m| m.contains("node_modules/acme")),
        "{ids:?}"
    );

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());

    // 牙齿自检：删掉共享 chunk 文件，同一检查必须报出悬空引用。
    let corrupt = root.join("dist-corrupt");
    let _ = fs::remove_dir_all(&corrupt);
    copy_tree(&out, &corrupt);
    let shared_file =
        &plan.artifacts.iter().find(|a| a.chunk_id.starts_with("shared/")).unwrap().file_name;
    fs::remove_file(corrupt.join(shared_file)).unwrap();
    let violations = reference_integrity_violations(&corrupt);
    assert!(
        violations.iter().any(|line| line.contains(shared_file)),
        "gate must report the dangling reference: {violations:?}"
    );
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &dest);
        } else {
            fs::copy(entry.path(), dest).unwrap();
        }
    }
}

/// 门禁 3：路由（多入口）私有模块不交叉污染——私有文本只住在自己的
/// chunk；共享文本全产物树里恰好一份。
#[test]
fn gate_route_privates_never_cross_contaminate() {
    let root = temp_tree(
        "isolation",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/route-a.js",
                "import { shared } from './shared.js';\nimport { secretA } from './secret-a.js';\nexport const a = shared + secretA;\n",
            ),
            (
                "app/src/route-b.js",
                "import { shared } from './shared.js';\nimport { secretB } from './secret-b.js';\nexport const b = shared + secretB;\n",
            ),
            ("app/src/shared.js", "export const shared = 'SHARED_MARKER';\n"),
            ("app/src/secret-a.js", "export const secretA = 'SECRET_A_MARKER';\n"),
            ("app/src/secret-b.js", "export const secretB = 'SECRET_B_MARKER';\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[
            ("route-a".to_string(), app.join("src/route-a.js")),
            ("route-b".to_string(), app.join("src/route-b.js")),
        ],
        &[
            EntryUse {
                entry_logical: "route-a".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["a".into()]),
            },
            EntryUse {
                entry_logical: "route-b".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["b".into()]),
            },
        ],
    );

    // 夹具前提：恰好两个入口 chunk + 一个共享 chunk。
    assert_eq!(
        plan.artifacts.len(),
        3,
        "{:?}",
        plan.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    let chunk_of = |prefix: &str| {
        plan.artifacts
            .iter()
            .find(|a| a.chunk_id == prefix)
            .unwrap_or_else(|| panic!("chunk {prefix} missing"))
    };
    let entry_a = chunk_of("entry/route-a");
    let entry_b = chunk_of("entry/route-b");
    let shared = chunk_of("shared/route-a+route-b");

    assert!(entry_a.code.contains("SECRET_A_MARKER"), "{}", entry_a.code);
    assert!(!entry_b.code.contains("SECRET_A_MARKER"), "{}", entry_b.code);
    assert!(!shared.code.contains("SECRET_A_MARKER"), "{}", shared.code);
    assert!(entry_b.code.contains("SECRET_B_MARKER"), "{}", entry_b.code);
    assert!(!entry_a.code.contains("SECRET_B_MARKER"), "{}", entry_a.code);
    assert!(!shared.code.contains("SECRET_B_MARKER"), "{}", shared.code);

    // 共享文本恰好一份：只在共享 chunk 出现，两个入口经合成 import 引用它。
    let holders: Vec<&str> = plan
        .artifacts
        .iter()
        .filter(|a| a.code.contains("SHARED_MARKER"))
        .map(|a| a.chunk_id.as_str())
        .collect();
    assert_eq!(holders, vec!["shared/route-a+route-b"]);
    assert!(entry_a.imports.contains(&shared.file_name), "{:?}", entry_a.imports);
    assert!(entry_b.imports.contains(&shared.file_name), "{:?}", entry_b.imports);
}

/// 门禁 4：存活 `import()` 真的切出独立 async chunk、不被静态内联；
/// 死动态边不下发——入口里连异步 chunk 文件都不存在。
#[test]
fn gate_dynamic_chunk_is_lazy_and_not_statically_inlined() {
    let root = temp_tree(
        "lazy",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/app.js",
                "export function loader() { const mod = import('./lazy.js'); return mod; }\nexport const eager = 1;\n",
            ),
            ("app/src/lazy.js", "export const later = 'LAZY_MARKER';\n"),
        ],
    );
    let app = root.join("app");
    let entries = [("app".to_string(), app.join("src/app.js"))];

    // 存活变体：消费 `loader` 导出，动态边活。
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &entries,
        &[EntryUse {
            entry_logical: "app".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["loader".into(), "eager".into()]),
        }],
    );
    assert_eq!(
        plan.artifacts.len(),
        2,
        "{:?}",
        plan.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/app").unwrap();
    let lazy = plan.artifacts.iter().find(|a| a.chunk_id.starts_with("async/")).unwrap();
    // 懒模块不是入口成员、入口不静态 import 懒 chunk，只有动态 import。
    assert!(!entry.modules.iter().any(|m| m.ends_with("src/lazy.js")), "{:?}", entry.modules);
    assert!(!entry.code.contains(&format!("from \"./{}\"", lazy.file_name)), "{}", entry.code);
    assert!(entry.code.contains(&format!("import(\"./{}\")", lazy.file_name)), "{}", entry.code);
    assert!(!entry.code.contains("LAZY_MARKER"), "{}", entry.code);
    assert!(lazy.code.contains("LAZY_MARKER"), "{}", lazy.code);
    assert_eq!(plan.dynamic_files, vec![(entry.file_name.clone(), lazy.file_name.clone())]);

    // 落盘后动态目标真实存在。
    let out = root.join("dist-live");
    write_emit(&plan, &out).unwrap();
    assert!(out.join(&lazy.file_name).exists());
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());

    // 死亡变体：不消费 `loader`，函数声明纯且未用 → 动态边死——零 async
    // chunk，懒文本全树消失。
    let (_graph2, _link2, dead) = run_pipeline(
        &app,
        &entries,
        &[EntryUse {
            entry_logical: "app".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["eager".into()]),
        }],
    );
    assert_eq!(
        dead.artifacts.len(),
        1,
        "{:?}",
        dead.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    assert_eq!(dead.artifacts[0].chunk_id, "entry/app");
    assert!(!dead.artifacts[0].code.contains("LAZY_MARKER"), "{}", dead.artifacts[0].code);
    assert!(!dead.artifacts[0].code.contains("lazy"), "{}", dead.artifacts[0].code);
    let out_dead = root.join("dist-dead");
    write_emit(&dead, &out_dead).unwrap();
    let tree = read_tree(&out_dead);
    assert!(
        !tree.keys().any(|name| name.contains("async")),
        "{:?}",
        tree.keys().collect::<Vec<_>>()
    );
}

/// 门禁 4b：存活动态边的另一种常见作者形态——`export const load = () =>
/// import(...)`。当前链接层对箭头函数常量保守保留（已记录为缺口 D3：
/// 不消费该导出时懒 chunk 仍下发）；这里只钉住消费时的正确分包行为。
#[test]
fn gate_arrow_export_dynamic_import_splits_when_consumed() {
    let root = temp_tree(
        "lazy-arrow",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/app.js",
                "export const load = () => import('./lazy.js');\nexport const eager = 1;\n",
            ),
            ("app/src/lazy.js", "export const later = 'LAZY_MARKER';\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("app".to_string(), app.join("src/app.js"))],
        &[EntryUse {
            entry_logical: "app".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["load".into(), "eager".into()]),
        }],
    );
    assert_eq!(
        plan.artifacts.len(),
        2,
        "{:?}",
        plan.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/app").unwrap();
    let lazy = plan.artifacts.iter().find(|a| a.chunk_id.starts_with("async/")).unwrap();
    assert!(entry.code.contains(&format!("import(\"./{}\")", lazy.file_name)), "{}", entry.code);
    assert!(!entry.code.contains(&format!("from \"./{}\"", lazy.file_name)), "{}", entry.code);
    assert!(!entry.modules.iter().any(|m| m.ends_with("src/lazy.js")), "{:?}", entry.modules);
}

/// 门禁 5：同输入两次完整流水线 + 落盘，文件名集合与逐字节内容一致。
#[test]
fn gate_same_input_rebuild_is_byte_identical() {
    let root = temp_tree(
        "rebuild",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/one.js",
                "import { shared } from './shared.js';\nexport const a1 = shared;\nexport const load = () => import('./lazy.js');\n",
            ),
            (
                "app/src/two.js",
                "import { shared } from './shared.js';\nexport const a2 = shared;\n",
            ),
            ("app/src/shared.js", "export const shared = 7;\n"),
            ("app/src/lazy.js", "export const later = 1;\n"),
        ],
    );
    let app = root.join("app");
    let entries =
        [("one".to_string(), app.join("src/one.js")), ("two".to_string(), app.join("src/two.js"))];
    let uses = [
        EntryUse {
            entry_logical: "one".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["a1".into(), "load".into()]),
        },
        EntryUse {
            entry_logical: "two".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["a2".into()]),
        },
    ];

    let (_g1, _l1, first) = run_pipeline(&app, &entries, &uses);
    // 第二次从 build_graph 重新起步，排除任何缓存残留。
    let (_g2, _l2, second) = run_pipeline(&app, &entries, &uses);
    assert_eq!(first, second);

    let out_first = root.join("dist-a");
    let out_second = root.join("dist-b");
    write_emit(&first, &out_first).unwrap();
    write_emit(&second, &out_second).unwrap();
    let tree_first = read_tree(&out_first);
    let tree_second = read_tree(&out_second);
    let names_first: Vec<&String> = tree_first.keys().collect();
    let names_second: Vec<&String> = tree_second.keys().collect();
    assert_eq!(names_first, names_second);
    for (name, bytes) in &tree_first {
        assert_eq!(bytes, &tree_second[name], "byte drift in {name}");
    }
}

/// 门禁 6：多文件 npm 包跟随包内相对导入整链入图，子路径导入
/// （`pkg/sub`）命中 exports 映射，包内未被引用的文件不下发。
#[test]
fn gate_vendor_multifile_package_follows_relative_and_subpath_imports() {
    let root = temp_tree(
        "vendor-chain",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "app/src/entry.js",
                "import { main } from 'acme';\nimport { sub } from 'acme/sub';\nexport const run = main + sub;\n",
            ),
            (
                "app/node_modules/acme/package.json",
                r#"{"name":"acme","version":"1.0.0","type":"module","exports":{".":"./index.js","./sub":"./sub.js"}}"#,
            ),
            ("app/node_modules/acme/index.js", "export { core as main } from './lib/core.js';\n"),
            (
                "app/node_modules/acme/lib/core.js",
                "import { util } from './util.js';\nexport const core = 'ACME_CORE:' + util;\n",
            ),
            ("app/node_modules/acme/lib/util.js", "export const util = 'ACME_UTIL';\n"),
            ("app/node_modules/acme/sub.js", "export const sub = 'ACME_SUB';\n"),
            // 包内未被引用的文件：应随剪枝消失。
            ("app/node_modules/acme/lib/ghost.js", "export const ghost = 'ACME_GHOST';\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("main".to_string(), app.join("src/entry.js"))],
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );

    // 夹具前提：包的主入口、内部相对链两跳、子路径模块全部进产物。
    let members: Vec<&str> =
        plan.artifacts.iter().flat_map(|a| a.modules.iter().map(String::as_str)).collect();
    for expected in ["acme/index.js", "acme/lib/core.js", "acme/lib/util.js", "acme/sub.js"] {
        assert!(members.iter().any(|m| m.contains(expected)), "{expected} missing in {members:?}");
    }
    assert!(!members.iter().any(|m| m.contains("acme/lib/ghost.js")), "{members:?}");
    let all = plan.artifacts.iter().map(|a| a.code.as_str()).collect::<Vec<_>>().join("\n");
    assert!(all.contains("ACME_CORE"), "{all}");
    assert!(all.contains("ACME_UTIL"), "{all}");
    assert!(all.contains("ACME_SUB"), "{all}");
    assert!(!all.contains("ACME_GHOST"), "{all}");

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());
}

/// 门禁 7：同一包被多入口引用时去重——包模块恰好落一个共享 chunk，
/// 两个入口都经合成 import 引用，全树无第二份包文本。
#[test]
fn gate_vendor_package_lands_once_across_entries() {
    let root = temp_tree(
        "vendor-dedup",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            ("app/src/one.js", "import { core } from 'acme';\nexport const a1 = core;\n"),
            ("app/src/two.js", "import { core } from 'acme';\nexport const a2 = core;\n"),
            (
                "app/node_modules/acme/package.json",
                r#"{"name":"acme","version":"1.0.0","type":"module","exports":{".":"./index.js"}}"#,
            ),
            ("app/node_modules/acme/index.js", "export { core } from './lib/core.js';\n"),
            ("app/node_modules/acme/lib/core.js", "export const core = 'ACME_CORE';\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("one".to_string(), app.join("src/one.js")), ("two".to_string(), app.join("src/two.js"))],
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

    // 包文本恰好一份，且住共享 chunk。
    let holders: Vec<&str> = plan
        .artifacts
        .iter()
        .filter(|a| a.code.contains("ACME_CORE"))
        .map(|a| a.chunk_id.as_str())
        .collect();
    assert_eq!(holders.len(), 1, "{holders:?}");
    assert!(holders[0].starts_with("shared/"), "{holders:?}");
    // 包内两个模块同属一个 chunk（不出现一半在共享一半在入口）。
    let shared_chunk = plan.artifacts.iter().find(|a| a.chunk_id == holders[0]).unwrap();
    let package_modules: Vec<&str> = shared_chunk
        .modules
        .iter()
        .filter(|m| m.contains("node_modules/acme"))
        .map(String::as_str)
        .collect();
    assert_eq!(package_modules.len(), 2, "{package_modules:?}");
    // 两个入口都经合成 import 引用共享 chunk。
    for logical in ["entry/one", "entry/two"] {
        let entry = plan.artifacts.iter().find(|a| a.chunk_id == logical).unwrap();
        assert!(entry.imports.contains(&shared_chunk.file_name), "{logical}: {:?}", entry.imports);
    }

    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());
}

/// 门禁 8：CJS 包（含包内多级 require 链）与 ESM 应用混用。运行期安全的
/// 不变量不是「产物里没有 `module.exports` 字样」，而是**凡出现
/// CommonJS 全局（`module.exports` / `exports.` / `require(`）的 chunk
/// 必然先装填互操作壳**（`module` / `exports` / `require` 被绑定为壳内
/// 局部量），运行期才不会抛 `module is not defined`。
#[test]
fn gate_cjs_esm_mix_binds_commonjs_globals_in_interop_shell() {
    let root = temp_tree(
        "cjs-mix",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "app/src/entry.js",
                "import { twice } from 'acme-cjs';\nexport const run = twice(21);\n",
            ),
            (
                "app/node_modules/acme-cjs/package.json",
                r#"{"name":"acme-cjs","version":"1.0.0","main":"./lib/index.js"}"#,
            ),
            (
                "app/node_modules/acme-cjs/lib/index.js",
                "const util = require('./util')\nexports.twice = function (n) { return util.double(n) }\n",
            ),
            (
                "app/node_modules/acme-cjs/lib/util.js",
                "function double(n) { return n * 2 }\nmodule.exports = exports = { double };\n",
            ),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("main".to_string(), app.join("src/entry.js"))],
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );

    // 夹具前提：两个 CJS 文件各自隔离发射（singleton 真 ESM 文件）。
    let cjs_chunks: Vec<&vmz_pack::emit::ChunkArtifact> = plan
        .artifacts
        .iter()
        .filter(|a| a.modules.iter().any(|m| m.contains("node_modules/acme-cjs")))
        .collect();
    assert_eq!(
        cjs_chunks.len(),
        2,
        "{:?}",
        plan.artifacts.iter().map(|a| &a.chunk_id).collect::<Vec<_>>()
    );
    // 凡出现 CommonJS 全局引用的 chunk 必须先装填壳；纯 ESM chunk 一个都没有。
    for artifact in &plan.artifacts {
        let touches_commonjs = artifact.code.contains("module.exports")
            || artifact.code.contains("exports.")
            || artifact.code.contains("require(");
        if touches_commonjs {
            assert!(
                artifact.code.contains("let module = { exports: {} };"),
                "shell missing in {}:\n{}",
                artifact.chunk_id,
                artifact.code
            );
            assert!(
                artifact.code.contains("function require(id)"),
                "shell missing in {}:\n{}",
                artifact.chunk_id,
                artifact.code
            );
        }
    }
    // ESM 入口 chunk 自身不携带任何 CommonJS 全局自由引用。
    let entry = plan.artifacts.iter().find(|a| a.chunk_id == "entry/main").unwrap();
    assert!(!entry.code.contains("module.exports"), "{}", entry.code);
    assert!(!entry.code.contains("require("), "{}", entry.code);
    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());
}

/// 门禁 9：TS 语法零残留——类型导入、接口、类型别名、注解、泛型参数与
/// `as` 断言全部擦除，运行时代码原样保留。类型模块因 type-only 不建边，
/// 整棵类型语法树随剪枝消失。
#[test]
fn gate_ts_syntax_leaves_zero_type_residue() {
    let root = temp_tree(
        "ts-erasure",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/entry.js",
                "import type { Config } from './types.js';\nimport { pick, marker } from './lib.js';\nexport function run(input?: Config): number {\n  const chosen = pick(input as Config);\n  return (chosen.value as number) + marker.length;\n}\n",
            ),
            (
                "app/src/lib.js",
                "export function pick<T>(cfg: T): T { return cfg }\nexport const marker: string = 'RUNTIME_MARKER';\n",
            ),
            (
                "app/src/types.js",
                "export type Config = { value: number };\nexport interface Unused { n: number }\n",
            ),
        ],
    );
    let app = root.join("app");
    let (graph, _link, plan) = run_pipeline(
        &app,
        &[("main".to_string(), app.join("src/entry.js"))],
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );

    // 类型模块不进图；产物里零类型语法、零断言残留。
    assert!(!graph.nodes.iter().any(|n| n.resolved.path.ends_with("types.js")));
    let all = plan.artifacts.iter().map(|a| a.code.as_str()).collect::<Vec<_>>().join("\n");
    assert!(all.contains("RUNTIME_MARKER"), "{all}");
    assert!(all.contains("function pick"), "{all}");
    assert!(all.contains("function run"), "{all}");
    for residue in
        ["import type", "export type", "interface ", ": number", ": string", "<T", " as "]
    {
        assert!(!all.contains(residue), "residue `{residue}` in:\n{all}");
    }
}

/// 门禁 9b：可达模块里的 `interface` 声明不再触发整文件隔离——成员与
/// `extends` 进入 scope 事实后，运行时代码仍按导出需求逐绑定发射。
#[test]
fn gate_interface_members_do_not_force_module_isolation() {
    let root = temp_tree(
        "interface-members",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/entry.js",
                "import { pick } from './models.js';\nexport const run = (value) => pick(value);\n",
            ),
            (
                "app/src/models.js",
                "export interface Options extends Record<string, unknown> {\n  readonly id?: string\n  label: string\n  render(count: number): string\n}\nexport function pick(options) { return options.label }\n",
            ),
        ],
    );
    let app = root.join("app");
    let (graph, _link, plan) = run_pipeline(
        &app,
        &[("main".to_string(), app.join("src/entry.js"))],
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );

    assert!(
        graph.nodes.iter().any(|node| node.resolved.path.ends_with("models.js")),
        "the interface module is reachable and must stay in the graph"
    );
    let all =
        plan.artifacts.iter().map(|artifact| artifact.code.as_str()).collect::<Vec<_>>().join("\n");
    assert!(all.contains("function pick"), "{all}");
    assert!(all.contains("options.label"), "the runtime body survives isolation:\n{all}");
    for residue in ["interface ", "readonly", ": number", ": string"] {
        assert!(!all.contains(residue), "residue `{residue}` in:\n{all}");
    }
}

/// 门禁 10：保守判副作用的调用语句不被剪枝也不重排——产物中调用点的
/// 相对顺序与源码一致。
#[test]
fn gate_effectful_call_order_is_preserved() {
    let root = temp_tree(
        "order",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/entry.js",
                "import { mark } from './ops.js';\nmark('first');\nmark('second');\nexport const run = mark('third');\n",
            ),
            ("app/src/ops.js", "export function mark(tag) { return tag }\n"),
        ],
    );
    let app = root.join("app");
    let (_graph, _link, plan) = run_pipeline(
        &app,
        &[("main".to_string(), app.join("src/entry.js"))],
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );

    assert_eq!(plan.artifacts.len(), 1);
    let code = &plan.artifacts[0].code;
    let first = code.find("mark('first')").unwrap_or_else(|| panic!("{code}"));
    let second = code.find("mark('second')").unwrap_or_else(|| panic!("{code}"));
    let third = code.find("mark('third')").unwrap_or_else(|| panic!("{code}"));
    assert!(first < second && second < third, "{code}");
}

/// 负向门禁 11：静态 import 指向不存在的模块——链接层必须产出结构化
/// 诊断并指明说明符，产物计划不得静默成功出悬空引用（N-API 侧把链接
/// 诊断升级为构建失败由 `vmz-napi` 的 pack wire 测试钉住）。
#[test]
fn gate_missing_static_import_target_is_a_structured_build_failure() {
    let root = temp_tree(
        "missing",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "app/src/entry.js",
                "import { ghost } from './ghost.js';\nexport const run = ghost;\n",
            ),
        ],
    );
    let app = root.join("app");
    let graph =
        build_graph(&[("main".to_string(), app.join("src/entry.js"))], Target::Browser, &app);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    // 结构化诊断必须存在且指明 `./ghost.js`；不允许无声静默。
    assert!(!link_plan.diagnostics.is_empty(), "missing import must be diagnosed");
    assert!(
        link_plan
            .diagnostics
            .iter()
            .any(|d| d.message.contains("./ghost.js") || d.message.contains("ghost.js")),
        "{:?}",
        link_plan.diagnostics
    );
    // 即使调用方忽略诊断继续要产物，emit 也只能显式拒绝或产出可诊断文本，
    // 不得留下指向缺席模块的悬空 import。
    let chunks = plan_chunks(&graph, &link_plan);
    match plan_emit(&graph, &link_plan, &chunks, &options()) {
        Err(errors) => {
            assert!(!errors.is_empty());
        }
        Ok(plan) => {
            let out = root.join("dist");
            write_emit(&plan, &out).unwrap();
            let violations = reference_integrity_violations(&out);
            assert!(
                violations.is_empty(),
                "dangling references escaped diagnostics: {violations:?}"
            );
        }
    }
}

/// 负向门禁 12：从不导出该名字的模块 import 具名绑定——链接层必须产出
/// `unknown_export` 诊断并指明名字与模块（文档意图：不静默放行到运行时
/// SyntaxError；N-API 失败升级见 `vmz-napi` pack wire 测试）。
#[test]
fn gate_unknown_named_export_is_a_structured_build_failure() {
    let root = temp_tree(
        "unknown-export",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("app/src/entry.js", "import { ghost } from './real.js';\nexport const run = ghost;\n"),
            ("app/src/real.js", "export const known = 1;\n"),
        ],
    );
    let app = root.join("app");
    let graph =
        build_graph(&[("main".to_string(), app.join("src/entry.js"))], Target::Browser, &app);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    let codes = codes(&link_plan.diagnostics);
    assert!(codes.contains(&"vmz::pack::link::unknown_export".to_string()), "{codes:?}");
    assert!(
        link_plan.diagnostics.iter().any(|d| d.message.contains("ghost")),
        "{:?}",
        link_plan.diagnostics
    );
}

/// 负向门禁 13（回归）：opaque 模块（scope 事实不完整，如含模板插值的
/// vendor 文件）的匿名默认导出——导出面是语法事实、名字真实存在，语句级
/// 激活定位不到时必须整模块保留兜底，不得报假 `unknown_export`（真实案例：
/// `linkify-it/lib/re.mjs` 的 `export default function (opts)`）。
#[test]
fn gate_opaque_module_default_export_is_not_a_false_positive() {
    let root = temp_tree(
        "opaque-default",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("app/src/entry.js", "import make from './lib.js';\nexport const run = make;\n"),
            (
                "app/src/lib.js",
                "export default function (opts) { const mark = `v${opts ? 1 : 0}`; return mark; }\n",
            ),
        ],
    );
    let app = root.join("app");
    let graph =
        build_graph(&[("main".to_string(), app.join("src/entry.js"))], Target::Browser, &app);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    // 夹具前提：lib 是 opaque（模板插值使 scope 事实不完整）。
    let lib = graph.nodes.iter().find(|n| n.resolved.path.ends_with("lib.js")).expect("lib node");
    assert!(lib.record.is_scope_incomplete(), "{:?}", lib.record.scope_incomplete_reasons);

    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    assert!(
        !codes(&link_plan.diagnostics).contains(&"vmz::pack::link::unknown_export".to_string()),
        "{:?}",
        link_plan.diagnostics
    );
    // 模块整棵保留并隔离发射，`export default` 原文留存在产物中。
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    let isolated = plan
        .artifacts
        .iter()
        .find(|a| a.modules.iter().any(|m| m.ends_with("lib.js")))
        .expect("lib chunk");
    assert!(isolated.code.contains("export default"), "{}", isolated.code);
    let out = root.join("dist");
    write_emit(&plan, &out).unwrap();
    assert_eq!(reference_integrity_violations(&out), Vec::<String>::new());
}

/// 负向门禁 14：opaque 模块上真实不存在的导出名——兜底只赦免「面里有、
/// 定位不到」，名字缺席仍必须 `unknown_export`，防止假阴性掩盖真缺口。
#[test]
fn gate_opaque_module_missing_export_still_fails() {
    let root = temp_tree(
        "opaque-missing",
        &[
            ("app/package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("app/src/entry.js", "import { nope } from './lib.js';\nexport const run = nope;\n"),
            ("app/src/lib.js", "const mark = `v${1}`;\nexport const known = mark;\n"),
        ],
    );
    let app = root.join("app");
    let graph =
        build_graph(&[("main".to_string(), app.join("src/entry.js"))], Target::Browser, &app);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let lib = graph.nodes.iter().find(|n| n.resolved.path.ends_with("lib.js")).expect("lib node");
    assert!(lib.record.is_scope_incomplete(), "{:?}", lib.record.scope_incomplete_reasons);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["run".into()]),
        }],
    );
    let codes = codes(&link_plan.diagnostics);
    assert!(codes.contains(&"vmz::pack::link::unknown_export".to_string()), "{codes:?}");
}
