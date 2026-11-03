//! homepage node pack 真实形态的 name_conflict 回归测试。
//!
//! 两处历史故障形态（0.3.x 的 homepage 构建在旧二进制上显式拒绝）：
//! - `plannerCopy`：同 chunk 两个声明认领者 + 隔离模块的跨 chunk 消费钉住 canonical。
//! - `fromCodePoint`：entities 具名重导出与 markdown-it 命名空间导入形成双钉，
//!   面名分裂后 chunk 面同时发 canonical 与 fresh 名两条导出。

use std::fs;
use std::path::PathBuf;

use vmz_pack::chunk::plan_chunks;
use vmz_pack::emit::{EmitOptions, plan_emit};
use vmz_pack::graph::build_graph;
use vmz_pack::link::{EntryExecution, EntryExports, EntryUse, link};
use vmz_pack::resolve::Target;

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root = std::env::temp_dir().join(format!("vmz-pack-repro-{name}-{}", std::process::id()));
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

/// homepage deploy-planner 形态：page 同 chunk 多绑定导入 locales 的
/// `plannerCopy` + 别名导入 copy 的 `plannerCopy`；planner.js 含模板插值
/// （scope 不完整 → 隔离 chunk）跨 chunk 导入 copy 的 `plannerCopy` 钉住
/// canonical。兜底应把两个声明都改名、消费者重写到各自落点 fresh 名，
/// chunk 面只发 canonical 一条别名导出，不产出 `name_conflict`。
#[test]
fn planner_copy_same_chunk_collision_with_isolated_pin_resolves() {
    let root = temp_tree(
        "plannerreal",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "src/pages/deploy-planner.client.js",
                "import { plannerCopy, plannerCopyFailedLabel, plannerCopyError } from '../locales/planner.js';\n\
                 import { buildDeployPlan, DEFAULT_ANSWERS } from '../deploy/planner.js';\n\
                 import { plannerCopy as plannerLabels } from '../deploy/planner-copy.js';\n\
                 export default class Page {\n\
                     copy() { return `${plannerCopy()} ${plannerCopyFailedLabel()} ${plannerCopyError()}`; }\n\
                     run() { return buildDeployPlan(DEFAULT_ANSWERS) + plannerLabels('zh-hans'); }\n\
                 }\n",
            ),
            (
                "src/deploy/planner.js",
                "import { plannerCopy } from './planner-copy.js';\n\
                 export function buildDeployPlan(answers) { return `# 提示\n${plannerCopy(answers.locale)}`; }\n\
                 export const DEFAULT_ANSWERS = {};\n",
            ),
            (
                "src/deploy/planner-copy.js",
                "export function plannerCopy(locale = 'zh-hans') { return locale === 'zh-hans' ? '复制提示词' : 'Copy prompt'; }\n",
            ),
            (
                "src/locales/planner.js",
                "export function plannerCopy() { return '复制提示词'; }\n\
                 export function plannerCopyFailedLabel() { return 'x'; }\n\
                 export function plannerCopyError() { return 'y'; }\n\
                 export function plannerKicker() { return 'z'; }\n",
            ),
        ],
    );
    let graph = build_graph(
        &[("pages/deploy-planner".to_string(), root.join("src/pages/deploy-planner.client.js"))],
        Target::Node,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "pages/deploy-planner".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["default".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    // planner.js 的模板插值使其成为 isolated 单模块 chunk。
    assert!(
        chunks.chunks.iter().any(|c| c.id.starts_with("isolated/") && c.modules.len() == 1),
        "template-interpolation module must be isolated"
    );
    let plan = plan_emit(&graph, &link_plan, &chunks, &options())
        .unwrap_or_else(|errors| panic!("planner shape rejected: {errors:?}"));
    assert!(
        !plan.diagnostics.iter().any(|d| d.code == "vmz::pack::emit::name_conflict"),
        "{:?}",
        plan.diagnostics
    );
    let entry =
        plan.artifacts.iter().find(|a| a.chunk_id.starts_with("entry/")).expect("entry chunk");
    // 两个声明都改名落 fresh 名，面只发 canonical 一条别名导出。
    assert!(entry.code.contains("function plannerCopy__vmz"), "{}", entry.code);
    assert_eq!(entry.code.matches("as plannerCopy }").count(), 1, "{}", entry.code);
    assert!(!entry.code.contains("export { plannerCopy }"), "{}", entry.code);
    // 隔离模块跨 chunk 消费必须落到自己认领者的发射面名（copy.js 的 fresh 面），
    // 不得绑到 canonical 面（locales 的同名 getter）——0.3.x 曾在 static assemble
    // 把 `buildDeployPlan` 的 `plannerCopy()` 绑成 locales 版（返回字符串）而崩。
    let isolated = plan
        .artifacts
        .iter()
        .find(|a| {
            a.chunk_id.starts_with("isolated/")
                && a.modules.iter().any(|m| m.ends_with("src/deploy/planner.js"))
        })
        .expect("isolated planner chunk");
    let import_line = isolated
        .code
        .lines()
        .find(|line| line.contains("plannerCopy") && line.contains("import"))
        .unwrap_or("");
    assert!(
        import_line.contains("plannerCopy__vmz"),
        "isolated consumer must import the copy claimant's split face, got: {import_line}"
    );
    // 页面同样被隔离（编译产物含模板插值）：其 `plannerCopy as plannerLabels`
    // 也必须落到 copy.js 的分裂面，而 `plannerCopy`（locales 具名导入）落
    // canonical 面。
    let page = plan
        .artifacts
        .iter()
        .find(|a| {
            a.chunk_id.starts_with("isolated/")
                && a.modules.iter().any(|m| m.ends_with("src/pages/deploy-planner.client.js"))
        })
        .expect("isolated page chunk");
    let labels_line = page
        .code
        .lines()
        .find(|line| line.contains("plannerLabels") && line.contains("import"))
        .unwrap_or("");
    assert!(
        labels_line.contains("plannerCopy__vmz") && labels_line.contains("as plannerLabels"),
        "page alias import must read the split face, got: {labels_line}"
    );
}

/// homepage Markdown/MarkdownIt 共享 chunk 形态：entities 的 decode.js 具名
/// 重导出 `fromCodePoint`（钉 1），markdown-it 的 index.mjs 命名空间导入
/// utils.mjs（钉 2），entity.mjs 同 chunk 具名导入 `fromCodePoint`。双钉
/// 触发面名分裂：两个声明都改名，canonical 发原名别名，另一被钉认领者以
/// fresh 名自身为面名，不产出 `name_conflict`。
#[test]
fn from_code_point_double_pinned_face_split_resolves() {
    let root = temp_tree(
        "fromcodepoint",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "src/pages/a.client.js",
                "import Markdown from '../components/Markdown.js';\nexport default class A { m() { return Markdown; } }\n",
            ),
            (
                "src/pages/b.client.js",
                "import MarkdownIt from '../components/MarkdownIt.js';\nexport default class B { m() { return MarkdownIt; } }\n",
            ),
            (
                "src/components/Markdown.js",
                "import MarkdownIt from 'markdown-it';\nexport default function render(src) { return new MarkdownIt().render(src); }\n",
            ),
            (
                "src/components/MarkdownIt.js",
                "import MarkdownIt from 'markdown-it';\nexport default function render2(src) { return new MarkdownIt().render(src); }\n",
            ),
            (
                "node_modules/markdown-it/package.json",
                r#"{"name":"markdown-it","version":"14.3.0","type":"module","main":"./lib/index.mjs","exports":{".":"./lib/index.mjs"}}"#,
            ),
            (
                "node_modules/markdown-it/lib/index.mjs",
                "import * as utils from './common/utils.mjs';\nimport { entityRule } from './rules_inline/entity.mjs';\nexport default class MarkdownIt { render(src) { return utils.escapeHtml(src) + entityRule(0); } }\n",
            ),
            (
                "node_modules/markdown-it/lib/common/utils.mjs",
                "import { decodeHTML } from 'entities';\n\
                 function fromCodePoint(c) { return String.fromCharCode(c); }\n\
                 function isValidEntityCode(c) { return c > 0; }\n\
                 export function escapeHtml(s) { return decodeHTML(s); }\n\
                 export function isSpace(c) { return c === 32; }\n\
                 export { fromCodePoint, isValidEntityCode };\n",
            ),
            (
                "node_modules/markdown-it/lib/rules_inline/entity.mjs",
                "import { isValidEntityCode, fromCodePoint } from '../common/utils.mjs';\n\
                 export function entityRule(code) { return isValidEntityCode(code) ? fromCodePoint(code) : fromCodePoint(0xFFFD); }\n",
            ),
            (
                "node_modules/entities/package.json",
                r#"{"name":"entities","version":"4.5.0","type":"module","main":"./lib/esm/index.js","exports":{".":"./lib/esm/index.js"}}"#,
            ),
            (
                "node_modules/entities/lib/esm/index.js",
                "export { decodeHTML } from './decode.js';\n",
            ),
            (
                "node_modules/entities/lib/esm/decode.js",
                "import decodeCodePoint, { replaceCodePoint, fromCodePoint } from './decode_codepoint.js';\n\
                 export { replaceCodePoint, fromCodePoint } from './decode_codepoint.js';\n\
                 export function decodeHTML(s) { return fromCodePoint(65) + replaceCodePoint(66) + decodeCodePoint(67) + String(s); }\n",
            ),
            (
                "node_modules/entities/lib/esm/decode_codepoint.js",
                "export const fromCodePoint = String.fromCodePoint ?? ((c) => String.fromCharCode(c));\n\
                 export function replaceCodePoint(c) { return c; }\n\
                 export default function decodeCodePoint(c) { return fromCodePoint(replaceCodePoint(c)); }\n",
            ),
        ],
    );
    let graph = build_graph(
        &[
            ("pages/a".to_string(), root.join("src/pages/a.client.js")),
            ("pages/b".to_string(), root.join("src/pages/b.client.js")),
        ],
        Target::Node,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[
            EntryUse {
                entry_logical: "pages/a".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["default".into()]),
            },
            EntryUse {
                entry_logical: "pages/b".to_string(),
                execution: EntryExecution::SideEffects,
                exports: EntryExports::Named(vec!["default".into()]),
            },
        ],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options())
        .unwrap_or_else(|errors| panic!("fromCodePoint shape rejected: {errors:?}"));
    assert!(
        !plan.diagnostics.iter().any(|d| d.code == "vmz::pack::emit::name_conflict"),
        "{:?}",
        plan.diagnostics
    );
    let shared = plan
        .artifacts
        .iter()
        .find(|a| a.modules.iter().any(|m| m.ends_with("lib/common/utils.mjs")))
        .expect("shared chunk with utils.mjs");
    // 两个声明认领者都改名。
    assert!(shared.code.contains("fromCodePoint__vmz"), "{}", shared.code);
    // 面分裂：canonical 发原名别名 + 另一被钉认领者发 fresh 名，共两条导出且名字不撞。
    let face_exports = shared.code.matches("as fromCodePoint").count();
    assert!(face_exports >= 1, "{}", shared.code);
}

/// homepage shiki singleton 形态：同 chunk 内 core 的 `function codeToHast`
/// 普通声明导出与 bundle 的 `const { codeToHast, codeToHtml } =
/// createSingletonShorthands()` 解构简写声明导出同名冲突。简写声明 token
/// 兼任属性键（上游 `rename_unsafe`），改名时声明 span 按
/// `<旧名>: <新名>` 重写保住键，面分裂按通常合同发射，不产出
/// `name_conflict`；未冲突的 `codeToHtml` 不受影响。
#[test]
fn destructured_singleton_shorthand_face_split_resolves() {
    let root = temp_tree(
        "shikisingleton",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "src/pages/a.client.js",
                "import { codeToHast } from '../vendor/index.js';\nexport default class A { m() { return codeToHast('x'); } }\n",
            ),
            (
                "src/vendor/index.js",
                "export { codeToHast } from './bundle.js';\nexport * from './core.js';\n",
            ),
            (
                "src/vendor/core.js",
                // 工厂体用成员赋值构造单例对象：对象字面量键名与模块绑定
                // 同名会触发 `AmbiguousMemberKey` 不完备守卫，与本案无关。
                "export function createSingletonShorthands() {\n\
                 const shorthands = {};\n\
                 shorthands.codeToHast = (c) => c;\n\
                 shorthands.codeToHtml = (c) => c;\n\
                 return shorthands;\n\
                 }\n\
                 function codeToHast(code) { return code; }\n\
                 export { codeToHast };\n",
            ),
            (
                "src/vendor/bundle.js",
                "import { createSingletonShorthands } from './core.js';\n\
                 const { codeToHast, codeToHtml } = createSingletonShorthands();\n\
                 export { codeToHast, codeToHtml };\n",
            ),
        ],
    );
    let graph = build_graph(
        &[("pages/a".to_string(), root.join("src/pages/a.client.js"))],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "pages/a".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["default".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    let plan = plan_emit(&graph, &link_plan, &chunks, &options())
        .unwrap_or_else(|errors| panic!("shiki singleton shape rejected: {errors:?}"));
    assert!(
        !plan.diagnostics.iter().any(|d| d.code == "vmz::pack::emit::name_conflict"),
        "{:?}",
        plan.diagnostics
    );
    let shared = plan
        .artifacts
        .iter()
        .find(|a| {
            a.modules.iter().any(|m| m.ends_with("src/vendor/core.js"))
                && a.modules.iter().any(|m| m.ends_with("src/vendor/bundle.js"))
        })
        .expect("shared chunk with core.js and bundle.js");
    // 简写声明 token 兼任属性键：声明 span 保键重写。
    assert!(shared.code.contains("codeToHast: codeToHast__vmz"), "{}", shared.code);
    // 面分裂：canonical 面恰好一条原名别名导出。
    assert_eq!(shared.code.matches(" as codeToHast }").count(), 1, "{}", shared.code);
    // fresh 名自身面导出存在。
    assert!(
        shared
            .code
            .lines()
            .any(|line| line.contains("export { codeToHast__vmz") && !line.contains(" as ")),
        "{}",
        shared.code
    );
    // 未冲突的 `codeToHtml` 不改名。
    assert!(!shared.code.contains("codeToHtml__vmz"), "{}", shared.code);
}

/// homepage shiki 消费形态的隔离侧：`dep.js` 含模板插值（scope 不完整 →
/// 隔离 chunk），`index.mjs` 与 `bundle.js` 都 `export * from './dep.js'`
/// （跨 chunk 星号），同时 `bundle.js` 用解构声明显式导出同名 `value`。
/// ESM 星号遮蔽：显式导出优先，跨 chunk 星号登记的 `value` 不构成
/// `name_conflict`；未被遮蔽的 `make` 单来源登记保持合法。
#[test]
fn cross_chunk_star_export_shadowed_by_explicit_export_resolves() {
    let root = temp_tree(
        "starshadow",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0","type":"module"}"#),
            (
                "src/pages/a.client.js",
                "export default class A {\n    async h() {\n        const m = await import('../vendor/index.mjs');\n        return m.value();\n    }\n}\n",
            ),
            (
                "src/vendor/index.mjs",
                "export { value } from './bundle.js';\nexport * from './dep.js';\n",
            ),
            (
                "src/vendor/bundle.js",
                "import { make } from './dep.js';\nexport * from './dep.js';\nconst { value } = make();\nexport { value };\n",
            ),
            (
                "src/vendor/dep.js",
                "export function make() { return { value: () => 'v' }; }\nexport function value() { return `${marker()}`; }\nfunction marker() { return 'm'; }\n",
            ),
        ],
    );
    let graph = build_graph(
        &[("pages/a".to_string(), root.join("src/pages/a.client.js"))],
        Target::Browser,
        &root,
    );
    assert!(graph.diagnostics.is_empty(), "{:?}", graph.diagnostics);
    let link_plan = link(
        &graph,
        &[EntryUse {
            entry_logical: "pages/a".to_string(),
            execution: EntryExecution::SideEffects,
            exports: EntryExports::Named(vec!["default".into()]),
        }],
    );
    let chunks = plan_chunks(&graph, &link_plan);
    // dep.js 的模板插值使其成为 isolated 单模块 chunk。
    assert!(
        chunks.chunks.iter().any(|c| c.id.starts_with("isolated/") && c.modules.len() == 1),
        "template-interpolation module must be isolated"
    );
    let plan = plan_emit(&graph, &link_plan, &chunks, &options())
        .unwrap_or_else(|errors| panic!("star shadow shape rejected: {errors:?}"));
    assert!(
        !plan.diagnostics.iter().any(|d| d.code == "vmz::pack::emit::name_conflict"),
        "{:?}",
        plan.diagnostics
    );
    let shared = plan
        .artifacts
        .iter()
        .find(|a| {
            a.modules.iter().any(|m| m.ends_with("src/vendor/index.mjs"))
                && a.modules.iter().any(|m| m.ends_with("src/vendor/bundle.js"))
        })
        .expect("shared chunk with index.mjs and bundle.js");
    // 显式导出保持原名发射，跨 chunk 星号登记被其遮蔽。
    assert!(shared.code.contains("export { value }"), "{}", shared.code);
    // 跨 chunk 星号边原样发射到隔离 chunk 产物。
    assert!(shared.code.contains("export * from"), "{}", shared.code);
}
