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

/// 规范形态资源引用：`new URL('./logo.svg', import.meta.url)` 整段替换为
/// 指纹 URL 字面量，资源进产物集并随 write_emit 拷贝。
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
    assert!(code.contains(&format!("\"{}\"", asset.url)), "{code}");
    assert!(!code.contains("new URL"), "{code}");
    assert!(!code.contains("import.meta"), "{code}");

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
    use vmz_pack::graph::{EdgeKind, GraphEntry, ModuleEdge, ModuleGraph, ModuleNode};
    use vmz_pack::link::{LinkPlan, LinkedModule};
    use vmz_pack::module::ModuleRecord;
    use vmz_pack::resolve::Resolved;

    let root = temp_tree("incomplete", &[("package.json", r#"{"name":"app","version":"0.0.0"}"#)]);
    let app = root.join("app.js");
    fs::write(&app, "export const main = 1;\n").unwrap();
    let pending = root.join("pending.js");

    let mut app_node = ModuleNode {
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

    let graph = ModuleGraph {
        target: Target::Browser,
        entries: vec![GraphEntry { logical: "main".to_string(), id: app.clone() }],
        nodes: vec![app_node, pending_node],
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
    use vmz_pack::graph::{GraphEntry, ModuleGraph, ModuleNode};
    use vmz_pack::link::{LinkPlan, LinkedModule};
    use vmz_pack::module::ModuleRecord;
    use vmz_pack::resolve::Resolved;

    let root = temp_tree("readfail", &[("package.json", r#"{"name":"app","version":"0.0.0"}"#)]);
    let gone = root.join("gone.js");
    let node = ModuleNode {
        resolved: Resolved { path: gone.clone(), package: None },
        record: ModuleRecord::empty(Some(gone.display().to_string())),
        static_edges: Vec::new(),
        dynamic_edges: Vec::new(),
        diagnostics: Vec::new(),
    };
    let graph = ModuleGraph {
        target: Target::Browser,
        entries: vec![GraphEntry { logical: "main".to_string(), id: gone.clone() }],
        nodes: vec![node],
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
