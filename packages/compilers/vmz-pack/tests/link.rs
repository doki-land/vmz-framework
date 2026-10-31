//! 链接层验收：符号活跃剪枝、副作用保留、重导出链、循环、双包实例、
//! 未知导出保守升级、动态边随语句存活、TLA 形态保守保留。

use std::fs;
use std::path::PathBuf;

use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, UsedReexport, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-link-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    for (path, content) in files {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

/// 具名入口只激活被用符号：未引用的纯模块整体消除、未引用的纯语句剪除。
#[test]
fn named_use_prunes_unused_pure_modules_and_statements() {
    let root = temp_tree(
        "prune",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { a } from './lib.js';\nimport { unused } from './pure.js';\nexport const main = a;\n",
            ),
            ("src/lib.js", "export function a(){ return 1 }\nexport function b(){ return 2 }\n"),
            ("src/pure.js", "export function unused(){ return 0 }\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 3);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let lib = graph.index_of(&root.join("src/lib.js")).unwrap();
    let pure = graph.index_of(&root.join("src/pure.js")).unwrap();
    let entry_node = graph.index_of(&entry).unwrap();
    let found = |node: usize| plan.modules.iter().find(|m| m.node == node);
    assert_eq!(found(entry_node).unwrap().active_statements, vec![0]);
    // lib 只激活 a 的声明语句，b 剪除。
    assert_eq!(found(lib).unwrap().active_statements, vec![0]);
    // pure.js 图可达但无任何使用 → 不保留。
    assert!(found(pure).is_none());
}

/// 活跃语句引用的本地 Pure 声明必须激活：`f` 只被导出的活跃初值引用，
/// 不激活会产出悬空调用；`f` 激活后级联到 `g`。级联不经需求队列，靠模块内
/// 不动点扫描收敛。
#[test]
fn referenced_local_pure_declarations_are_activated() {
    let root = temp_tree(
        "localrefs",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "function g(){ return 2 }\nfunction f(){ return g() }\nexport const main = f();\n",
            ),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    let entry_node = graph.index_of(&entry).unwrap();
    let module = plan.modules.iter().find(|m| m.node == entry_node).expect("entry retained");
    assert_eq!(module.active_statements, vec![0, 1, 2], "{:?}", module.active_statements);
}

/// 副作用导入（css 与包）强制目标全量保留。
#[test]
fn side_effect_imports_force_full_retention() {
    let root = temp_tree(
        "sideeffect",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import './styles.css';\nimport 'side-pkg';\nexport const x = 1;\n"),
            ("src/styles.css", "body { color: red; }\n"),
            (
                "node_modules/side-pkg/package.json",
                r#"{"name":"side-pkg","version":"0.0.0","main":"index.js"}"#,
            ),
            (
                "node_modules/side-pkg/index.js",
                "export const marker = setup();\nfunction setup(){ return 1 }\n",
            ),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );

    let css = graph.index_of(&root.join("src/styles.css")).unwrap();
    let pkg = graph.index_of(&root.join("node_modules/side-pkg/index.js")).unwrap();
    let css_module = plan.modules.iter().find(|m| m.node == css).expect("css retained");
    let css_count = graph.nodes[css].record.statements.len();
    assert_eq!(css_module.active_statements, (0..css_count).collect::<Vec<_>>());
    // 包入口全量：SideEffect 与 Pure 语句都激活。
    let pkg_module = plan.modules.iter().find(|m| m.node == pkg).expect("pkg retained");
    assert_eq!(pkg_module.active_statements, vec![0, 1]);
}

/// barrel `export *` 链：具名使用穿透星号重导出并记录来源。
#[test]
fn barrel_star_reexport_chain_propagates() {
    let root = temp_tree(
        "barrel",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { deep } from './barrel.js';\nexport const use = deep;\n"),
            ("src/barrel.js", "export * from './impl.js';\n"),
            (
                "src/impl.js",
                "export function deep(){ return 42 }\nexport function other(){ return 44 }\n",
            ),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["use".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let barrel = graph.index_of(&root.join("src/barrel.js")).unwrap();
    let impl_node = graph.index_of(&root.join("src/impl.js")).unwrap();
    let barrel_module = plan.modules.iter().find(|m| m.node == barrel).unwrap();
    assert_eq!(
        barrel_module.used_reexports,
        vec![UsedReexport::All { export_index: 0, target_node: impl_node }]
    );
    // impl 只激活 deep，other 剪除。
    let impl_module = plan.modules.iter().find(|m| m.node == impl_node).unwrap();
    assert_eq!(impl_module.active_statements, vec![0]);
}

/// live binding：`import {a} from './src.js'; export {a as b}` 把需求传到来源。
#[test]
fn live_binding_reexport_of_imported_name() {
    let root = temp_tree(
        "livebinding",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { b } from './m.js';\nexport const use = b;\n"),
            ("src/m.js", "import { a } from './src.js';\nexport { a as b };\n"),
            ("src/src.js", "export function a(){ return 1 }\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["use".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let m = graph.index_of(&root.join("src/m.js")).unwrap();
    let src = graph.index_of(&root.join("src/src.js")).unwrap();
    // m 自身没有可激活语句（`export {a as b}` 不是声明），但必须保留。
    let m_module = plan.modules.iter().find(|mod_| mod_.node == m).unwrap();
    assert!(m_module.active_statements.is_empty());
    // 需求传到 src.js 并激活 a 的声明。
    let src_module = plan.modules.iter().find(|mod_| mod_.node == src).unwrap();
    assert_eq!(src_module.active_statements, vec![0]);
}

/// 模块循环（a↔b 互引互用）：不动点终止，双方按需激活且不误报诊断。
#[test]
fn module_cycles_terminate_and_retain_on_demand() {
    let root = temp_tree(
        "cycle",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { pong } from './a.js';\nexport const use = pong;\n"),
            (
                "src/a.js",
                "import { ping } from './b.js';\nexport function pong(){ return ping() }\n",
            ),
            (
                "src/b.js",
                "import { pong } from './a.js';\nexport function ping(){ return pong() }\n",
            ),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["use".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let a = graph.index_of(&root.join("src/a.js")).unwrap();
    let b = graph.index_of(&root.join("src/b.js")).unwrap();
    assert_eq!(plan.modules.iter().find(|m| m.node == a).unwrap().active_statements, vec![0]);
    assert_eq!(plan.modules.iter().find(|m| m.node == b).unwrap().active_statements, vec![0]);
}

/// 双 node_modules 包实例：v1 与 v2 是不同节点，各自按使用独立激活。
#[test]
fn dual_package_instances_stay_distinct() {
    let root = temp_tree(
        "dualpkg",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "import { pk } from 'pkg';\nimport { use } from 'mid';\nexport const main = [pk, use];\n",
            ),
            (
                "node_modules/pkg/package.json",
                r#"{"name":"pkg","version":"1.0.0","main":"index.js"}"#,
            ),
            ("node_modules/pkg/index.js", "export function pk(){ return 1 }\n"),
            (
                "node_modules/mid/package.json",
                r#"{"name":"mid","version":"0.0.0","main":"index.js"}"#,
            ),
            (
                "node_modules/mid/index.js",
                "import { pk } from 'pkg';\nexport function use(){ return pk() }\n",
            ),
            (
                "node_modules/mid/node_modules/pkg/package.json",
                r#"{"name":"pkg","version":"2.0.0","main":"index.js"}"#,
            ),
            ("node_modules/mid/node_modules/pkg/index.js", "export function pk(){ return 2 }\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    assert_eq!(graph.nodes.len(), 4);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);

    let v1 = graph.index_of(&root.join("node_modules/pkg/index.js")).unwrap();
    let v2 = graph.index_of(&root.join("node_modules/mid/node_modules/pkg/index.js")).unwrap();
    assert_ne!(v1, v2);
    assert_eq!(
        graph.nodes[v1].resolved.package.as_ref().unwrap().version.as_deref(),
        Some("1.0.0")
    );
    assert_eq!(
        graph.nodes[v2].resolved.package.as_ref().unwrap().version.as_deref(),
        Some("2.0.0")
    );
    // 两个实例都因各自的使用被保留并激活。
    assert_eq!(plan.modules.iter().find(|m| m.node == v1).unwrap().active_statements, vec![0]);
    assert_eq!(plan.modules.iter().find(|m| m.node == v2).unwrap().active_statements, vec![0]);
}

/// 未知导出：给出 `unknown_export` 诊断并把目标模块保守转为全量激活。
#[test]
fn unknown_export_diagnoses_and_activates_fully() {
    let root = temp_tree(
        "unknown",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { ghost } from './lib.js';\nexport const main = ghost;\n"),
            ("src/lib.js", "export function real(){ return 1 }\nexport const other = real();\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );

    let lib = graph.index_of(&root.join("src/lib.js")).unwrap();
    let codes: Vec<_> = plan.diagnostics.iter().map(|d| d.code.as_str()).collect();
    assert!(codes.contains(&"vmz::pack::link::unknown_export"), "diagnostics: {codes:?}");
    // 保守升级：lib 全部语句激活（含未被使用的 real）。
    assert_eq!(plan.modules.iter().find(|m| m.node == lib).unwrap().active_statements, vec![0, 1]);
}

/// 动态边随语句存活：包含语句被剪除则动态目标不保留；全量入口则保留。
#[test]
fn dynamic_edges_follow_statement_activity() {
    let root = temp_tree(
        "dynamic",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "export const keep = 1;\nexport function loader(){ const mod = import('./lazy.js'); return mod; }\n",
            ),
            ("src/lazy.js", "export default 42;\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let lazy = graph.index_of(&root.join("src/lazy.js")).expect("lazy in graph");
    let entry_node = graph.index_of(&entry).unwrap();

    // 具名入口只用 keep：loader 纯且未用 → 剪除 → 动态边死 → lazy 不保留。
    let pruned = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["keep".into()]),
        }],
    );
    assert!(pruned.diagnostics.is_empty(), "{:?}", pruned.diagnostics);
    assert!(pruned.modules.iter().all(|m| m.node != lazy));
    assert!(pruned.modules.iter().find(|m| m.node == entry_node).unwrap().dynamic_edges.is_empty());

    // 全量入口：loader 激活 → 动态边活 → lazy 全量保留。
    let full = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::Full,
            exports: EntryExports::All,
        }],
    );
    assert!(full.diagnostics.is_empty(), "{:?}", full.diagnostics);
    let lazy_module = full.modules.iter().find(|m| m.node == lazy).expect("lazy retained");
    assert_eq!(lazy_module.active_statements, vec![0]);
    assert_eq!(full.modules.iter().find(|m| m.node == entry_node).unwrap().dynamic_edges, vec![0]);
}

/// TLA 形态：`has_tla` 由 Oak root 级事实置位，链接层按非纯语句
/// 保守保留该模块（TLA 资格事实供后续产物层决定异步边界）。
#[test]
fn tla_shaped_module_retained_without_new_diagnostics() {
    let root = temp_tree(
        "tla",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { val } from './tla.js';\nexport const main = val;\n"),
            ("src/tla.js", "const w = await (fetch());\nexport { w as val };\n"),
        ],
    );
    let entry = root.join("src/entry.js");
    let graph = build_graph(&[("main".to_string(), entry.clone())], Target::Browser, &root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);

    let tla = graph.index_of(&root.join("src/tla.js")).unwrap();
    // 模块层按 Oak 正式事实置位 TLA、不报语句诊断。
    assert!(graph.nodes[tla].record.flags.has_tla);
    assert!(graph.nodes[tla].record.diagnostics.is_empty());

    let plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "main".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["main".into()]),
        }],
    );
    assert!(plan.diagnostics.is_empty(), "{:?}", plan.diagnostics);
    // `await (…) ` 形态判不了即非纯：模块保留且语句恒活。
    assert_eq!(plan.modules.iter().find(|m| m.node == tla).unwrap().active_statements, vec![0]);
}
