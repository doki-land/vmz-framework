//! `resolve` 层验收：exports 封装、条件分流、包实例身份、`#imports` 与诊断码。
//!
//! 临时包树建在 `std::env::temp_dir()` 下的唯一名目录（`{进程id}-{序号}`），
//! 用完即删，不触碰工作区真实 `node_modules`；每个用例断言的 `Resolved.path`
//! 都与 `fs::canonicalize` 后的真实文件比较。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use vmz_pack::PackDiagnostic;
use vmz_pack::resolve::{ResolveRequest, Resolved, Target, resolve};

static NEXT_TREE: AtomicUsize = AtomicUsize::new(0);

/// 独立临时包树；Drop 时清理。
struct Tree {
    root: PathBuf,
}

impl Tree {
    fn new() -> Self {
        let seq = NEXT_TREE.fetch_add(1, Ordering::SeqCst);
        let root =
            std::env::temp_dir().join(format!("vmz-pack-resolve-{}-{seq}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("create temp tree");
        Self { root }
    }

    /// 写一个文件（自动建父目录）。
    fn file(&self, rel: &str, contents: &str) {
        let path = self.root.join(rel);
        fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
        fs::write(&path, contents).expect("write file");
    }

    /// 期望的 canonical 路径（与 `Resolved.path` 同口径比较）。
    fn canon(&self, rel: &str) -> PathBuf {
        fs::canonicalize(self.root.join(rel)).expect("canonicalize expected path")
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// 以 tree 根作为项目根发起一次解析。
fn attempt(
    tree: &Tree,
    specifier: &str,
    importer_rel: &str,
    target: Target,
) -> Result<Resolved, PackDiagnostic> {
    resolve(&ResolveRequest {
        specifier: specifier.to_string(),
        importer: tree.root.join(importer_rel),
        target,
        root: tree.root.clone(),
    })
}

fn unwrap_err(result: Result<Resolved, PackDiagnostic>) -> PackDiagnostic {
    match result {
        Err(diagnostic) => diagnostic,
        Ok(resolved) => panic!("expected error, got {:?}", resolved),
    }
}

/// exports 精确命中：`.` 与子路径，附带 canonical 包实例身份。
#[test]
fn exports_exact_subpath_and_instance_identity() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/widgets/package.json",
        r#"{
            "name": "widgets",
            "version": "2.3.4",
            "exports": { ".": "./dist/index.js", "./sub": "./dist/sub.js" }
        }"#,
    );
    tree.file("app/node_modules/widgets/dist/index.js", "export const a = 1;\n");
    tree.file("app/node_modules/widgets/dist/sub.js", "export const b = 2;\n");

    let main =
        attempt(&tree, "widgets", "app/src/main.js", Target::Browser).expect("main entry resolves");
    assert_eq!(main.path, tree.canon("app/node_modules/widgets/dist/index.js"));
    let pkg = main.package.expect("package identity attached");
    assert_eq!(pkg.name, "widgets");
    assert_eq!(pkg.version.as_deref(), Some("2.3.4"));
    assert_eq!(pkg.root, tree.canon("app/node_modules/widgets"));

    let sub = attempt(&tree, "widgets/sub", "app/src/main.js", Target::Browser)
        .expect("subpath resolves");
    assert_eq!(sub.path, tree.canon("app/node_modules/widgets/dist/sub.js"));
    assert_eq!(sub.package.expect("subpath keeps identity").root, pkg.root);
}

/// `*` pattern：精确键优先，pattern 按最长前缀、再最长后缀取胜，`*` 双向替换。
#[test]
fn exports_star_pattern_longest_prefix_and_suffix() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/star-pkg/package.json",
        r#"{
            "name": "star-pkg",
            "version": "1.0.0",
            "exports": {
                ".": "./index.js",
                "./features/*": "./src/features/*.js",
                "./features/adv/*": "./adv/*.js",
                "./data/*.json": "./mapped/*.txt"
            }
        }"#,
    );
    tree.file("app/node_modules/star-pkg/index.js", "export const root = 1;\n");
    tree.file("app/node_modules/star-pkg/src/features/y.js", "export const y = 1;\n");
    tree.file("app/node_modules/star-pkg/adv/x.js", "export const x = 1;\n");
    tree.file("app/node_modules/star-pkg/mapped/y.txt", "payload\n");

    let adv = attempt(&tree, "star-pkg/features/adv/x", "app/src/main.js", Target::Browser)
        .expect("longest prefix wins");
    assert_eq!(adv.path, tree.canon("app/node_modules/star-pkg/adv/x.js"));

    let plain = attempt(&tree, "star-pkg/features/y", "app/src/main.js", Target::Browser)
        .expect("plain pattern matches");
    assert_eq!(plain.path, tree.canon("app/node_modules/star-pkg/src/features/y.js"));

    let suffixed = attempt(&tree, "star-pkg/data/y.json", "app/src/main.js", Target::Browser)
        .expect("suffix pattern matches");
    assert_eq!(suffixed.path, tree.canon("app/node_modules/star-pkg/mapped/y.txt"));
}

/// exports 封装：未导出的深层路径报错，绝不回退 `src/` 猜文件。
#[test]
fn exports_encapsulated_deep_path_never_falls_back() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/sealed/package.json",
        r#"{ "name": "sealed", "version": "1.0.0", "exports": { ".": "./index.js" } }"#,
    );
    tree.file("app/node_modules/sealed/index.js", "export const ok = 1;\n");
    tree.file("app/node_modules/sealed/src/index.js", "export const leaked = 1;\n");
    tree.file("app/node_modules/sealed/lib/index.js", "export const leaked2 = 1;\n");

    let main = attempt(&tree, "sealed", "app/src/main.js", Target::Browser)
        .expect("exported main resolves");
    assert_eq!(main.path, tree.canon("app/node_modules/sealed/index.js"));

    let diagnostic =
        unwrap_err(attempt(&tree, "sealed/src/index.js", "app/src/main.js", Target::Browser));
    assert_eq!(diagnostic.code, "vmz::pack::resolve::encapsulated");
    assert_eq!(diagnostic.path, Some(tree.canon("app/node_modules/sealed").display().to_string()));
    assert!(diagnostic.message.contains("exports"), "message: {}", diagnostic.message);
}

/// 同一 specifier 在 Browser 与 Node 下解析到不同文件（条件集合 + 书写顺序）。
#[test]
fn browser_and_node_conditions_resolve_different_files() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/cond-pkg/package.json",
        r#"{
            "name": "cond-pkg",
            "version": "1.0.0",
            "exports": {
                ".": {
                    "browser": "./browser.js",
                    "import": { "node": "./node.mjs", "default": "./shared.mjs" },
                    "default": "./fallback.js"
                }
            }
        }"#,
    );
    tree.file("app/node_modules/cond-pkg/browser.js", "export const v = 'browser';\n");
    tree.file("app/node_modules/cond-pkg/node.mjs", "export const v = 'node';\n");
    tree.file("app/node_modules/cond-pkg/shared.mjs", "export const v = 'shared';\n");
    tree.file("app/node_modules/cond-pkg/fallback.js", "export const v = 'fallback';\n");

    let browser = attempt(&tree, "cond-pkg", "app/src/main.js", Target::Browser)
        .expect("browser condition resolves");
    assert_eq!(browser.path, tree.canon("app/node_modules/cond-pkg/browser.js"));

    let node = attempt(&tree, "cond-pkg", "app/src/main.js", Target::Node)
        .expect("node condition resolves");
    assert_eq!(node.path, tree.canon("app/node_modules/cond-pkg/node.mjs"));
    assert_ne!(browser.path, node.path, "browser 与 Node 必须分流到不同文件");
}

/// `require` 分支不激活：跳过并按作者顺序落到 `default`。
#[test]
fn require_condition_is_skipped_and_falls_to_default() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/req-only/package.json",
        r#"{
            "name": "req-only",
            "version": "1.0.0",
            "exports": { ".": { "require": "./cjs.cjs", "default": "./esm.mjs" } }
        }"#,
    );
    tree.file("app/node_modules/req-only/cjs.cjs", "module.exports = 1;\n");
    tree.file("app/node_modules/req-only/esm.mjs", "export const v = 1;\n");

    for target in [Target::Browser, Target::Node] {
        let resolved = attempt(&tree, "req-only", "app/src/main.js", target)
            .expect("default condition resolves");
        assert_eq!(
            resolved.path,
            tree.canon("app/node_modules/req-only/esm.mjs"),
            "target {target:?} must skip `require`"
        );
    }
}

/// 数组目标：取第一个可解析项，条件不适用的项跳过继续。
#[test]
fn array_target_takes_first_resolvable_entry() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/arr-pkg/package.json",
        r#"{
            "name": "arr-pkg",
            "version": "1.0.0",
            "exports": { ".": [ { "node": "./only-node.js" }, "./fallback.js" ] }
        }"#,
    );
    tree.file("app/node_modules/arr-pkg/only-node.js", "export const v = 'node';\n");
    tree.file("app/node_modules/arr-pkg/fallback.js", "export const v = 'fallback';\n");

    let node = attempt(&tree, "arr-pkg", "app/src/main.js", Target::Node)
        .expect("first entry applies for node");
    assert_eq!(node.path, tree.canon("app/node_modules/arr-pkg/only-node.js"));

    let browser = attempt(&tree, "arr-pkg", "app/src/main.js", Target::Browser)
        .expect("inapplicable entry is skipped");
    assert_eq!(browser.path, tree.canon("app/node_modules/arr-pkg/fallback.js"));
}

/// 无 `exports` 的遗留包：入口字段优先级、字段缺失顺延、index 兜底、深层子路径不受封装。
#[test]
fn legacy_package_without_exports_uses_entry_fields_and_deep_paths() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file(
        "app/node_modules/legacy/package.json",
        r#"{
            "name": "legacy",
            "version": "0.9.0",
            "main": "./lib/main.js",
            "module": "./esm/main.mjs",
            "browser": "./browser/main.js"
        }"#,
    );
    tree.file("app/node_modules/legacy/lib/main.js", "module.exports = 'main';\n");
    tree.file("app/node_modules/legacy/esm/main.mjs", "export const v = 'module';\n");
    tree.file("app/node_modules/legacy/browser/main.js", "export const v = 'browser';\n");
    tree.file("app/node_modules/legacy/lib/util.js", "export const util = 1;\n");

    let browser = attempt(&tree, "legacy", "app/src/main.js", Target::Browser)
        .expect("browser field wins for browser target");
    assert_eq!(browser.path, tree.canon("app/node_modules/legacy/browser/main.js"));

    let node = attempt(&tree, "legacy", "app/src/main.js", Target::Node)
        .expect("main field wins for node target");
    assert_eq!(node.path, tree.canon("app/node_modules/legacy/lib/main.js"));

    // 无 exports 即无封装：深层子路径按常规文件查找，且带实例身份。
    let deep = attempt(&tree, "legacy/lib/util", "app/src/main.js", Target::Node)
        .expect("legacy deep import resolves");
    assert_eq!(deep.path, tree.canon("app/node_modules/legacy/lib/util.js"));
    assert_eq!(deep.package.expect("legacy keeps identity").version.as_deref(), Some("0.9.0"));

    // `main` 指向缺失文件 → 顺延 `module`。
    tree.file(
        "app/node_modules/broken-main/package.json",
        r#"{ "name": "broken-main", "main": "./gone.js", "module": "./present.mjs" }"#,
    );
    tree.file("app/node_modules/broken-main/present.mjs", "export const v = 1;\n");
    let repaired = attempt(&tree, "broken-main", "app/src/main.js", Target::Node)
        .expect("falls forward to module");
    assert_eq!(repaired.path, tree.canon("app/node_modules/broken-main/present.mjs"));

    // 无任何入口字段 → `index.*` 兜底。
    tree.file(
        "app/node_modules/idx-pkg/package.json",
        r#"{ "name": "idx-pkg", "version": "0.0.1" }"#,
    );
    tree.file("app/node_modules/idx-pkg/index.ts", "export const v = 1;\n");
    let indexed = attempt(&tree, "idx-pkg", "app/src/main.js", Target::Browser)
        .expect("index fallback resolves");
    assert_eq!(indexed.path, tree.canon("app/node_modules/idx-pkg/index.ts"));
}

/// 相对解析：扩展推断、目录 `index.*`、资源文件原样命中；相对解析不附包身份。
#[test]
fn relative_resolution_extensions_index_and_resources() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "import './helper';\n");
    tree.file("app/src/helper.ts", "export const helper = 1;\n");
    tree.file("app/src/components/index.tsx", "export const C = 1;\n");
    tree.file("app/src/styles.css", "body {}\n");
    tree.file("app/src/config.mjs", "export const config = 1;\n");

    let helper = attempt(&tree, "./helper", "app/src/main.js", Target::Browser)
        .expect("extension inference");
    assert_eq!(helper.path, tree.canon("app/src/helper.ts"));
    assert!(helper.package.is_none(), "相对解析不附带包实例身份");

    let components = attempt(&tree, "./components", "app/src/main.js", Target::Browser)
        .expect("directory index");
    assert_eq!(components.path, tree.canon("app/src/components/index.tsx"));

    let css = attempt(&tree, "./styles.css", "app/src/main.js", Target::Browser)
        .expect("resource file hits as-is");
    assert_eq!(css.path, tree.canon("app/src/styles.css"));

    let config = attempt(&tree, "./config", "app/src/main.js", Target::Node)
        .expect("mjs extension inference");
    assert_eq!(config.path, tree.canon("app/src/config.mjs"));

    let diagnostic = unwrap_err(attempt(&tree, "./missing", "app/src/main.js", Target::Browser));
    assert_eq!(diagnostic.code, "vmz::pack::resolve::not_found");
    assert_eq!(diagnostic.path, Some(tree.root.join("app/src/main.js").display().to_string()));
}

/// 嵌套 node_modules 同名双版本：物理根与版本都不同即不同实例，身份不串。
#[test]
fn nested_same_name_packages_have_distinct_identities() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");
    tree.file("app/src/deep/page.js", "export {};\n");
    tree.file(
        "app/node_modules/dup/package.json",
        r#"{ "name": "dup", "version": "1.0.0", "main": "./index.js" }"#,
    );
    tree.file("app/node_modules/dup/index.js", "export const v = 'v1';\n");
    tree.file(
        "app/src/deep/node_modules/dup/package.json",
        r#"{ "name": "dup", "version": "2.0.0", "main": "./index.js" }"#,
    );
    tree.file("app/src/deep/node_modules/dup/index.js", "export const v = 'v2';\n");

    let outer = attempt(&tree, "dup", "app/src/main.js", Target::Node).expect("outer dup");
    let outer_pkg = outer.package.expect("outer identity");
    assert_eq!(outer.path, tree.canon("app/node_modules/dup/index.js"));
    assert_eq!(outer_pkg.version.as_deref(), Some("1.0.0"));
    assert_eq!(outer_pkg.root, tree.canon("app/node_modules/dup"));

    let inner = attempt(&tree, "dup", "app/src/deep/page.js", Target::Node).expect("inner dup");
    let inner_pkg = inner.package.expect("inner identity");
    assert_eq!(inner.path, tree.canon("app/src/deep/node_modules/dup/index.js"));
    assert_eq!(inner_pkg.version.as_deref(), Some("2.0.0"));
    assert_eq!(inner_pkg.root, tree.canon("app/src/deep/node_modules/dup"));

    assert_ne!(outer_pkg.root, inner_pkg.root, "同名不同物理根必须是不同实例");
    assert_ne!(outer_pkg.version, inner_pkg.version, "同名不同版本必须是不同实例");
}

/// `#imports`：相对目标、`*` pattern、裸包目标与未定义诊断。
#[test]
fn hash_imports_resolve_within_owning_package() {
    let tree = Tree::new();
    tree.file(
        "app/package.json",
        r##"{
            "name": "app",
            "version": "0.0.1",
            "imports": {
                "#lib": "./src/lib.js",
                "#features/*": "./src/features/*.js",
                "#dep": "ext-pkg"
            }
        }"##,
    );
    tree.file("app/src/main.js", "import '#lib';\n");
    tree.file("app/src/lib.js", "export const lib = 1;\n");
    tree.file("app/src/features/x.js", "export const x = 1;\n");
    tree.file(
        "app/node_modules/ext-pkg/package.json",
        r#"{ "name": "ext-pkg", "version": "3.0.0", "main": "./main.js" }"#,
    );
    tree.file("app/node_modules/ext-pkg/main.js", "export const ext = 1;\n");

    let lib = attempt(&tree, "#lib", "app/src/main.js", Target::Browser)
        .expect("relative imports target");
    assert_eq!(lib.path, tree.canon("app/src/lib.js"));
    let app_identity = lib.package.expect("imports 目标附带所属包实例身份");
    assert_eq!(app_identity.name, "app");
    assert_eq!(app_identity.version.as_deref(), Some("0.0.1"));
    assert_eq!(app_identity.root, tree.canon("app"));

    let feature = attempt(&tree, "#features/x", "app/src/main.js", Target::Browser)
        .expect("imports pattern target");
    assert_eq!(feature.path, tree.canon("app/src/features/x.js"));

    let dep =
        attempt(&tree, "#dep", "app/src/main.js", Target::Browser).expect("bare imports target");
    assert_eq!(dep.path, tree.canon("app/node_modules/ext-pkg/main.js"));
    let dep_pkg = dep.package.expect("bare target identity");
    assert_eq!(dep_pkg.name, "ext-pkg");
    assert_eq!(dep_pkg.version.as_deref(), Some("3.0.0"));

    let diagnostic = unwrap_err(attempt(&tree, "#nope", "app/src/main.js", Target::Browser));
    assert_eq!(diagnostic.code, "vmz::pack::resolve::not_found");
    assert!(diagnostic.message.contains("imports"), "message: {}", diagnostic.message);
}

/// 诊断码矩阵：not_found / unsupported_condition / forbidden / bad_exports / bad_manifest / invalid_specifier。
#[test]
fn diagnostic_codes_are_stable() {
    let tree = Tree::new();
    tree.file("app/src/main.js", "export {};\n");

    // 裸包不存在。
    let absent =
        unwrap_err(attempt(&tree, "totally-absent-pkg", "app/src/main.js", Target::Browser));
    assert_eq!(absent.code, "vmz::pack::resolve::not_found");
    assert_eq!(absent.path, Some(tree.root.join("app/src/main.js").display().to_string()));

    // 只有 require 分支：当前 target 无适用条件。
    tree.file(
        "app/node_modules/cond-only/package.json",
        r#"{ "name": "cond-only", "version": "1.0.0", "exports": { ".": { "require": "./cjs.js" } } }"#,
    );
    let unsupported = unwrap_err(attempt(&tree, "cond-only", "app/src/main.js", Target::Browser));
    assert_eq!(unsupported.code, "vmz::pack::resolve::unsupported_condition");
    assert!(unsupported.message.contains("require"), "message: {}", unsupported.message);

    // null 目标 = 明确禁止。
    tree.file(
        "app/node_modules/blocked/package.json",
        r#"{ "name": "blocked", "version": "1.0.0", "exports": { ".": "./index.js", "./blocked": null } }"#,
    );
    tree.file("app/node_modules/blocked/index.js", "export const v = 1;\n");
    let forbidden = unwrap_err(attempt(&tree, "blocked/blocked", "app/src/main.js", Target::Node));
    assert_eq!(forbidden.code, "vmz::pack::resolve::forbidden");

    // exports 混合子路径键与条件键。
    tree.file(
        "app/node_modules/mixed/package.json",
        r#"{ "name": "mixed", "exports": { ".": "./a.js", "import": "./b.js" } }"#,
    );
    let mixed = unwrap_err(attempt(&tree, "mixed", "app/src/main.js", Target::Browser));
    assert_eq!(mixed.code, "vmz::pack::resolve::bad_exports");

    // package.json 非法 JSON。
    tree.file("app/node_modules/broken-json/package.json", "{ not json");
    let broken = unwrap_err(attempt(&tree, "broken-json", "app/src/main.js", Target::Browser));
    assert_eq!(broken.code, "vmz::pack::resolve::bad_manifest");

    // 空 specifier。
    let empty = unwrap_err(attempt(&tree, "", "app/src/main.js", Target::Browser));
    assert_eq!(empty.code, "vmz::pack::resolve::invalid_specifier");
}

/// `?` 查询与 `#` 片段不是文件身份：先剥离再解析；`#` 开头的 imports
/// 说明符在剥离之前分流，不受影响。
#[test]
fn query_and_fragment_are_stripped_before_file_identity() {
    let tree = Tree::new();
    tree.file(
        "app/package.json",
        r##"{ "name": "app", "version": "0.0.1", "imports": { "#lib": "./src/lib.js" } }"##,
    );
    tree.file("app/src/main.js", "export {};\n");
    tree.file("app/src/helper.js", "export const helper = 1;\n");
    tree.file("app/src/lib.js", "export const lib = 1;\n");
    tree.file(
        "app/node_modules/widgets/package.json",
        r#"{ "name": "widgets", "version": "2.3.4", "exports": { ".": "./dist/index.js", "./sub": "./dist/sub.js" } }"#,
    );
    tree.file("app/node_modules/widgets/dist/index.js", "export const a = 1;\n");
    tree.file("app/node_modules/widgets/dist/sub.js", "export const b = 2;\n");

    let plain =
        attempt(&tree, "./helper.js", "app/src/main.js", Target::Browser).expect("plain path");
    let queried =
        attempt(&tree, "./helper.js?v=2", "app/src/main.js", Target::Browser).expect("query");
    let fragmented = attempt(&tree, "./helper.js#section", "app/src/main.js", Target::Browser)
        .expect("fragment");
    let both = attempt(&tree, "./helper.js?v=2#section", "app/src/main.js", Target::Browser)
        .expect("query and fragment");
    assert_eq!(queried.path, plain.path, "查询不属于文件身份");
    assert_eq!(fragmented.path, plain.path, "片段不属于文件身份");
    assert_eq!(both.path, plain.path, "查询与片段同时剥离");

    // 剥离后扩展推断照常生效。
    let inferred = attempt(&tree, "./helper?inline=1", "app/src/main.js", Target::Browser)
        .expect("extension inference after strip");
    assert_eq!(inferred.path, plain.path);

    // 裸包与子路径的查询在拆分包段前剥离，exports 匹配与实例身份不受影响。
    let sub = attempt(&tree, "widgets/sub?raw=1", "app/src/main.js", Target::Browser)
        .expect("bare subpath query stripped");
    assert_eq!(sub.path, tree.canon("app/node_modules/widgets/dist/sub.js"));
    assert_eq!(sub.package.expect("bare identity kept").name, "widgets");

    let entry = attempt(&tree, "widgets?cache=1", "app/src/main.js", Target::Browser)
        .expect("bare entry query stripped");
    assert_eq!(entry.path, tree.canon("app/node_modules/widgets/dist/index.js"));

    // `#` 开头是 imports 说明符，不是片段，不被剥离。
    let hash = attempt(&tree, "#lib", "app/src/main.js", Target::Browser).expect("imports intact");
    assert_eq!(hash.path, tree.canon("app/src/lib.js"));
}

/// importer 上溯找不到时从项目根上溯兜底。
#[test]
fn root_fallback_walks_from_project_root_when_importer_chain_has_none() {
    let tree = Tree::new();
    tree.file(
        "proj/node_modules/only-here/package.json",
        r#"{ "name": "only-here", "version": "4.5.6", "main": "./main.js" }"#,
    );
    tree.file("proj/node_modules/only-here/main.js", "export const v = 1;\n");
    tree.file("outside/nested/page.js", "export {};\n");

    let resolved = resolve(&ResolveRequest {
        specifier: "only-here".to_string(),
        importer: tree.root.join("outside/nested/page.js"),
        target: Target::Node,
        root: tree.root.join("proj"),
    })
    .expect("root fallback finds the package");

    assert_eq!(resolved.path, tree.canon("proj/node_modules/only-here/main.js"));
    let pkg = resolved.package.expect("identity via root walk");
    assert_eq!(pkg.version.as_deref(), Some("4.5.6"));
    assert_eq!(pkg.root, tree.canon("proj/node_modules/only-here"));
}
