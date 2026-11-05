//! pack 增量缓存验收：内容摘要复用、图结构变化整体失效、孤儿清理，
//! 以及「冷构建」与「增量构建」产物逐字节一致。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use vmz_pack::chunk::{ChunkPlan, plan_chunks};
use vmz_pack::emit::{
    EmitCache, EmitOptions, plan_emit, plan_emit_with_cache, write_emit, write_emit_incremental,
};
use vmz_pack::graph::ModuleGraph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, LinkPlan, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-incr-{name}-{}", std::process::id()));
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
    EmitOptions { public_base: "/_vmz/".to_string(), minify: true }
}

/// 两入口共享模块：产出 3 个 chunk（one / two / shared）。
fn build(root: &Path) -> (ModuleGraph, LinkPlan, ChunkPlan) {
    let graph = build_with(root, &["one", "two"]);
    let link_plan = link(&graph, &entry_uses(&["a1", "a2"]));
    let chunks = plan_chunks(&graph, &link_plan);
    assert!(chunks.diagnostics.is_empty(), "{:?}", chunks.diagnostics);
    (graph, link_plan, chunks)
}

fn build_with(root: &Path, entries: &[&str]) -> ModuleGraph {
    let entries: Vec<(String, PathBuf)> = entries
        .iter()
        .map(|logical| (logical.to_string(), root.join(format!("src/{logical}.js"))))
        .collect();
    let graph = vmz_pack::graph::build_graph(&entries, Target::Browser, root);
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    graph
}

fn entry_uses(exports: &[&str]) -> Vec<EntryUse> {
    ["one", "two"]
        .iter()
        .zip(exports)
        .map(|(logical, export)| EntryUse {
            entry_logical: logical.to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec![export.to_string()]),
        })
        .collect()
}

/// 目录快照：相对路径 → 字节。缓存目录不计入产物闭包。
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(dir: &Path, prefix: &str, out: &mut BTreeMap<String, Vec<u8>>) {
        for entry in fs::read_dir(dir).unwrap().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path();
            if entry.file_type().unwrap().is_dir() {
                if name == ".vmz-pack-cache" {
                    continue;
                }
                walk(&path, &format!("{prefix}{name}/"), out);
            } else {
                out.insert(format!("{prefix}{name}"), fs::read(path).unwrap());
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, "", &mut out);
    out
}

fn chunk_files(dir: &Path) -> Vec<String> {
    snapshot(dir).keys().filter(|name| name.ends_with(".js")).cloned().collect()
}

const TREE: &[(&str, &str)] = &[
    ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
    ("src/one.js", "import { shared } from './shared.js';\nexport const a1 = shared;\n"),
    ("src/two.js", "import { shared } from './shared.js';\nexport const a2 = shared;\n"),
    ("src/shared.js", "export const shared = 7;\n"),
];

/// 冷构建（无缓存）与增量构建（命中缓存）产物逐字节一致。
#[test]
fn warm_reuse_matches_cold_build_byte_for_byte() {
    let root = temp_tree("bytes", TREE);
    let (graph, link_plan, chunks) = build(&root);

    let cold_dir = root.join("out-cold");
    let cold_plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    write_emit(&cold_plan, &cold_dir).unwrap();

    let warm_dir = root.join("out-warm");
    let mut cache = EmitCache::load(&warm_dir);
    let warm_plan =
        plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&warm_plan, &warm_dir, true).unwrap();
    cache.store().unwrap();

    assert_eq!(snapshot(&cold_dir), snapshot(&warm_dir));

    // 再跑一次：全部命中缓存，产物不变。
    let mut cache = EmitCache::load(&warm_dir);
    let again = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&again, &warm_dir, true).unwrap();
    cache.store().unwrap();
    assert_eq!(snapshot(&cold_dir), snapshot(&warm_dir));
}

/// 单模块改动：只有该 chunk 重新生成，其余 chunk 沿用旧文件名与字节，
/// 变化 chunk 的旧文件名被清理；结果与同输入冷构建逐字节一致。
#[test]
fn single_module_change_rebuilds_only_its_chunk() {
    let root = temp_tree("single", TREE);
    let (graph, link_plan, chunks) = build(&root);

    let out = root.join("out");
    let mut cache = EmitCache::load(&out);
    let first = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&first, &out, true).unwrap();
    cache.store().unwrap();
    let before = chunk_files(&out);
    assert_eq!(before.len(), 3, "{before:?}");

    // 只改 one.js 的导出值：one chunk 变，shared / two 不变。
    fs::write(
        root.join("src/one.js"),
        "import { shared } from './shared.js';\nexport const a1 = shared + 1;\n",
    )
    .unwrap();
    let (graph, link_plan, chunks) = build(&root);

    let cold_dir = root.join("out-cold");
    let cold_plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    write_emit(&cold_plan, &cold_dir).unwrap();

    let mut cache = EmitCache::load(&out);
    let plan = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&plan, &out, true).unwrap();
    cache.store().unwrap();

    assert_eq!(snapshot(&cold_dir), snapshot(&out), "增量与冷构建必须逐字节一致");
    let after = chunk_files(&out);
    let unchanged = before.iter().filter(|name| after.contains(name)).count();
    assert_eq!(
        unchanged, 2,
        "只应替换 one chunk，旧 shared/two 文件继续沿用：{before:?} -> {after:?}"
    );
    assert_eq!(after.len(), 3, "变化 chunk 的旧文件必须删除：{after:?}");
}

/// 图结构变化（新增模块 + 新边）必须整体失效：即使缓存条目仍在，
/// 本次任何 chunk 都不得复用旧结果。
#[test]
fn graph_change_invalidates_every_cached_chunk() {
    let root = temp_tree("graphchange", TREE);
    let (graph, link_plan, chunks) = build(&root);

    let out = root.join("out");
    let mut cache = EmitCache::load(&out);
    let first = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&first, &out, true).unwrap();
    cache.store().unwrap();

    // 把所有缓存条目的最终文本改成哨兵：若本次仍复用条目，哨兵会进入产物。
    let cache_dir = out.join(".vmz-pack-cache");
    let mut poisoned = 0;
    for entry in fs::read_dir(&cache_dir).unwrap().flatten() {
        let path = entry.path();
        if !path.is_file() || path.file_name().is_some_and(|name| name == "index.json") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        let mut value: serde_json::Value = serde_json::from_str(&text).unwrap();
        value["code"] = serde_json::Value::String("__CACHE_LEAK__\n".to_string());
        fs::write(&path, serde_json::to_string(&value).unwrap()).unwrap();
        poisoned += 1;
    }
    assert_eq!(poisoned, 3, "缓存条目数量");

    // 图未变：复用成立，哨兵文本会被写进产物。
    let mut cache = EmitCache::load(&out);
    let warm = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&warm, &out, true).unwrap();
    cache.store().unwrap();
    let leaked = snapshot(&out)
        .values()
        .any(|bytes| String::from_utf8_lossy(bytes).contains("__CACHE_LEAK__"));
    assert!(leaked, "图未变时应复用缓存条目");

    // 新增模块与边：图结构变化 → 整体失效，哨兵不得出现在产物中。
    fs::write(root.join("src/extra.js"), "export const extra = 1;\n").unwrap();
    fs::write(
        root.join("src/one.js"),
        "import { shared } from './shared.js';\nimport { extra } from './extra.js';\nexport const a1 = shared + extra;\n",
    )
    .unwrap();
    let (graph, link_plan, chunks) = build(&root);

    let mut cache = EmitCache::load(&out);
    let changed =
        plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    assert!(cache.graph_changed(), "图结构变化必须报告整体失效");
    write_emit_incremental(&changed, &out, true).unwrap();
    cache.store().unwrap();

    let leaked = snapshot(&out)
        .values()
        .any(|bytes| String::from_utf8_lossy(bytes).contains("__CACHE_LEAK__"));
    assert!(!leaked, "图变化后不得复用任何旧 chunk");

    let cold_dir = root.join("out-cold");
    let cold_plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();
    write_emit(&cold_plan, &cold_dir).unwrap();
    assert_eq!(snapshot(&cold_dir), snapshot(&out), "失效后重建必须与冷构建一致");
}

/// 孤儿检测：不属于本次产物闭包的旧 chunk / map / css / 资源必须删除，
/// 缓存目录与外来文件保持不动。
#[test]
fn write_emit_removes_orphan_artifacts() {
    let root = temp_tree("orphan", TREE);
    let (graph, link_plan, chunks) = build(&root);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options()).unwrap();

    let out = root.join("out");
    write_emit(&plan, &out).unwrap();

    // 伪造上一轮遗留的旧产物与外来文件。
    let stale = [
        "stale-abcdef12.js",
        "stale-abcdef12.js.map",
        "stale-style-abcdef12.css",
        "assets/stale-0123456789abcdef.svg",
    ];
    fs::create_dir_all(out.join("assets")).unwrap();
    for name in stale {
        fs::write(out.join(name), "stale").unwrap();
    }
    fs::write(out.join("package.json"), "{}").unwrap();
    fs::write(out.join("notes.txt"), "keep me").unwrap();

    write_emit(&plan, &out).unwrap();

    // 断言产物闭包之外没有任何 .js / .map / .css 或 assets 文件。
    let expected: Vec<String> = {
        let mut names: Vec<String> = plan
            .artifacts
            .iter()
            .flat_map(|artifact| {
                [artifact.file_name.clone(), format!("{}.map", artifact.file_name)]
            })
            .collect();
        names.extend(plan.styles.iter().map(|style| style.file_name.clone()));
        names.extend(plan.assets.iter().map(|asset| asset.file_name.clone()));
        names
    };
    let remaining: Vec<String> = snapshot(&out)
        .into_keys()
        .filter(|name| {
            name.ends_with(".js")
                || name.ends_with(".map")
                || name.ends_with(".css")
                || name.starts_with("assets/")
        })
        .collect();
    let mut sorted_expected = expected;
    sorted_expected.sort();
    assert_eq!(remaining, sorted_expected, "输出目录残留孤儿产物");
    assert_eq!(fs::read_to_string(out.join("package.json")).unwrap(), "{}");
    assert_eq!(fs::read_to_string(out.join("notes.txt")).unwrap(), "keep me");
}

/// 增量写入不得误删外来文件或缓存目录：`_vmz/pack` 里可能同时躺着宿主放进去
/// 的文件，清扫只允许动本轮产物形态，且 `.vmz-pack-cache/` 必须原样保留。
#[test]
fn incremental_sweep_keeps_foreign_files_and_cache_dir() {
    let root = temp_tree("foreign", TREE);
    let (graph, link_plan, chunks) = build(&root);

    let out = root.join("pack");
    let mut cache = EmitCache::load(&out);
    let first = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&first, &out, true).unwrap();
    cache.store().unwrap();

    let cache_dir = out.join(".vmz-pack-cache");
    let cache_index = cache_dir.join("index.json");
    assert!(cache_index.is_file(), "首轮写入应留下缓存索引");

    // 外来文件：根目录非产物形态、`assets/` 非指纹形态、子目录文件。
    fs::create_dir_all(out.join("assets")).unwrap();
    fs::create_dir_all(out.join("host")).unwrap();
    fs::write(out.join("package.json"), "{\"type\":\"module\"}").unwrap();
    fs::write(out.join("host-notes.txt"), "keep me").unwrap();
    fs::write(out.join("assets/host-logo.png"), "host asset").unwrap();
    fs::write(out.join("assets/README"), "host readme").unwrap();
    fs::write(out.join("host/extra.json"), "{}").unwrap();
    // 同时留一个旧资源指纹文件，确认孤儿清理仍然生效。
    fs::write(out.join("assets/stale-0123456789abcdef.svg"), "stale").unwrap();

    let mut cache = EmitCache::load(&out);
    let again = plan_emit_with_cache(&graph, &link_plan, &chunks, &options(), &mut cache).unwrap();
    write_emit_incremental(&again, &out, true).unwrap();
    cache.store().unwrap();

    assert!(cache_index.is_file(), "`.vmz-pack-cache/index.json` 不得被清扫");
    assert!(cache_dir.is_dir(), "`.vmz-pack-cache/` 不得被清扫");
    assert_eq!(fs::read_to_string(out.join("package.json")).unwrap(), "{\"type\":\"module\"}");
    assert_eq!(fs::read_to_string(out.join("host-notes.txt")).unwrap(), "keep me");
    assert_eq!(fs::read_to_string(out.join("assets/host-logo.png")).unwrap(), "host asset");
    assert_eq!(fs::read_to_string(out.join("assets/README")).unwrap(), "host readme");
    assert_eq!(fs::read_to_string(out.join("host/extra.json")).unwrap(), "{}");
    assert!(
        !out.join("assets/stale-0123456789abcdef.svg").exists(),
        "闭包外的指纹资源仍必须删除"
    );
}
