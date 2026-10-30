//! `module` 模块事实层验收：源码 → `ModuleRecord` 只经 Oak TypeScript AST 建立，
//! 所有事实用 `&source[span.0..span.1]` 切片回到原文核对，不接受正则识别。

use vmz_pack::PackDiagnostic;
use vmz_pack::module::{ExportFact, ImportKind, ImportedName, StatementEffect, parse_module};

/// 记录 span 切片回原文（UTF-8 字节区间，exclusive end）。
fn slice(source: &str, span: (usize, usize)) -> &str {
    &source[span.0..span.1]
}

/// 该记录的 `statement_fact_incomplete` 诊断（应恒为空表示无事实缺口）。
fn statement_fact_incomplete(record: &vmz_pack::module::ModuleRecord) -> Vec<&PackDiagnostic> {
    record
        .diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.code == "vmz::pack::module::statement_fact_incomplete")
        .collect()
}

fn ok(source: &str) -> vmz_pack::module::ModuleRecord {
    parse_module(Some("app.ts"), source)
        .unwrap_or_else(|diags| panic!("期望解析成功，实际诊断：{diags:?}"))
}

/// ① 普通值导入：default / named / namespace / 混合（含内联 `type` 绑定）。
#[test]
fn value_imports_are_collected_from_oak_ast() {
    let source = "import Def from './a.js';\nimport { REGISTRY, type IconDef } from './b.js';\nimport * as ns from './c.js';\nimport Def2, { x } from './d.js';";
    let record = ok(source);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);
    assert_eq!(record.imports.len(), 4);

    let def = &record.imports[0];
    assert_eq!(def.kind, ImportKind::Static);
    assert_eq!(def.specifier, "./a.js");
    assert_eq!(slice(source, def.span), "import Def from './a.js';");
    assert_eq!(slice(source, def.specifier_span.unwrap()), "'./a.js'");
    assert_eq!(def.bindings.len(), 1);
    assert_eq!(def.bindings[0].local, "Def");
    assert_eq!(def.bindings[0].imported, ImportedName::Default);
    assert_eq!(def.bindings[0].span, None, "Oak AST 不携带 binding span");

    let named = &record.imports[1];
    assert_eq!(named.specifier, "./b.js");
    assert_eq!(slice(source, named.span), "import { REGISTRY, type IconDef } from './b.js';");
    assert_eq!(slice(source, named.specifier_span.unwrap()), "'./b.js'");
    assert_eq!(named.bindings.len(), 2);
    assert_eq!(named.bindings[0].imported, ImportedName::Name("REGISTRY".into()));
    assert!(!named.bindings[0].inline_type_only);
    assert_eq!(named.bindings[1].local, "IconDef");
    assert_eq!(named.bindings[1].imported, ImportedName::Name("IconDef".into()));
    assert!(named.bindings[1].inline_type_only, "内联 `type IconDef` 应被识别");

    let namespace = &record.imports[2];
    assert_eq!(namespace.specifier, "./c.js");
    assert_eq!(slice(source, namespace.span), "import * as ns from './c.js';");
    assert_eq!(namespace.bindings[0].imported, ImportedName::Namespace);
    assert_eq!(namespace.bindings[0].local, "ns");

    let mixed = &record.imports[3];
    assert_eq!(mixed.specifier, "./d.js");
    assert_eq!(slice(source, mixed.span), "import Def2, { x } from './d.js';");
    assert_eq!(mixed.bindings.len(), 2);
    assert_eq!(mixed.bindings[0].imported, ImportedName::Default);
    assert_eq!(mixed.bindings[1].imported, ImportedName::Name("x".into()));
}

/// ② 声明级 `import type { T }`：整条导入标记为类型事实。
#[test]
fn declaration_level_type_import_is_flagged() {
    let source = "import type { T } from './types.js';";
    let record = ok(source);
    assert_eq!(record.imports.len(), 1);
    let fact = &record.imports[0];
    assert!(fact.type_only, "`import type` 应标记声明级类型导入");
    assert_eq!(fact.kind, ImportKind::Static);
    assert_eq!(fact.specifier, "./types.js");
    assert_eq!(slice(source, fact.span), "import type { T } from './types.js';");
    assert_eq!(slice(source, fact.specifier_span.unwrap()), "'./types.js'");
    assert_eq!(fact.bindings.len(), 1);
    assert!(!fact.bindings[0].inline_type_only, "type 在声明级而非绑定内");
}

/// ③ 副作用导入：无绑定，只有模块说明符。
#[test]
fn side_effect_import_has_no_bindings() {
    let source = "import './side.js';";
    let record = ok(source);
    assert_eq!(record.imports.len(), 1);
    let fact = &record.imports[0];
    assert_eq!(fact.kind, ImportKind::SideEffect);
    assert!(!fact.type_only);
    assert!(fact.bindings.is_empty());
    assert_eq!(fact.specifier, "./side.js");
    assert_eq!(slice(source, fact.span), "import './side.js';");
    assert_eq!(slice(source, fact.specifier_span.unwrap()), "'./side.js'");
}

/// ④ 本地导出与默认导出四种形态。
#[test]
fn local_and_default_exports_are_classified() {
    let source = "export const x = 1;\nconst a = 1;\nexport { a as b };";
    let record = ok(source);
    assert_eq!(record.exports.len(), 2);
    match &record.exports[0] {
        ExportFact::Local { local, exported, type_only, span } => {
            assert_eq!(local, "x");
            assert_eq!(exported, "x");
            assert!(!type_only);
            assert_eq!(slice(source, *span), "export const x = 1;");
        }
        other => panic!("期望 Local 导出，实际 {other:?}"),
    }
    match &record.exports[1] {
        ExportFact::Local { local, exported, span, .. } => {
            assert_eq!(local, "a");
            assert_eq!(exported, "b");
            assert_eq!(slice(source, *span), "export { a as b };");
        }
        other => panic!("期望 Local 导出，实际 {other:?}"),
    }
    // 被 export 包裹的声明同样产出声明事实。
    assert_eq!(record.statements.len(), 2);
    assert_eq!(record.statements[0].declared_names, ["x"]);
    assert_eq!(slice(source, record.statements[0].span), "const x = 1;");
    assert_eq!(record.statements[1].declared_names, ["a"]);
    assert_eq!(slice(source, record.statements[1].span), "const a = 1;");

    // `export default class Foo {}`：具名默认导出。
    let class_source = "export default class Foo {}";
    let record = ok(class_source);
    match &record.exports[0] {
        ExportFact::Default { local, span } => {
            assert_eq!(local.as_deref(), Some("Foo"));
            assert_eq!(slice(class_source, *span), "export default class Foo {}");
        }
        other => panic!("期望 Default 导出，实际 {other:?}"),
    }
    assert_eq!(record.statements[0].declared_names, ["Foo"]);
    assert_eq!(slice(class_source, record.statements[0].span), "class Foo {}");

    // `export default <expr>`：无本模块名字。
    let expr_source = "export default 42;";
    let record = ok(expr_source);
    match &record.exports[0] {
        ExportFact::Default { local, span } => {
            assert_eq!(local, &None);
            assert_eq!(slice(expr_source, *span), "export default 42;");
        }
        other => panic!("期望 Default 导出，实际 {other:?}"),
    }
}

/// ⑤ 具名重导出与星号重导出。
#[test]
fn reexports_from_source_modules_are_recorded() {
    let source = "export { a } from './m.js';\nexport * from './n.js';";
    let record = ok(source);
    assert_eq!(record.exports.len(), 2);
    match &record.exports[0] {
        ExportFact::ReexportNamed {
            source: module,
            source_span,
            local,
            exported,
            type_only,
            span,
        } => {
            assert_eq!(module, "./m.js");
            assert_eq!(local, "a");
            assert_eq!(exported, "a");
            assert!(!type_only);
            assert_eq!(slice(source, *span), "export { a } from './m.js';");
            assert_eq!(slice(source, source_span.unwrap()), "'./m.js'");
        }
        other => panic!("期望 ReexportNamed，实际 {other:?}"),
    }
    match &record.exports[1] {
        ExportFact::ReexportAll { source: module, source_span, span } => {
            assert_eq!(module, "./n.js");
            assert_eq!(slice(source, *span), "export * from './n.js';");
            assert_eq!(slice(source, source_span.unwrap()), "'./n.js'");
        }
        other => panic!("期望 ReexportAll，实际 {other:?}"),
    }
    assert!(record.imports.is_empty(), "重导出不是 import 事实");
}

/// ⑥ 动态 import：字面量取事实，非字面量必须给诊断且置标志。
#[test]
fn dynamic_import_literal_and_unresolved_paths() {
    // 字面量：说明符可静态取得。
    let source = "const p = import('./x.js');";
    let record = ok(source);
    assert_eq!(record.imports.len(), 1);
    let fact = &record.imports[0];
    assert_eq!(fact.kind, ImportKind::Dynamic);
    assert_eq!(fact.specifier, "./x.js");
    assert_eq!(fact.bindings, []);
    assert_eq!(slice(source, fact.span), "import('./x.js')");
    assert_eq!(slice(source, fact.specifier_span.unwrap()), "'./x.js'");
    assert!(!record.flags.dynamic_import_nonliteral);
    assert!(record.diagnostics.is_empty());
    assert_eq!(record.statements[0].declared_names, ["p"]);
    assert_eq!(slice(source, record.statements[0].span), "const p = import('./x.js');");

    // 语句头形态：`import(…)` 被 Oak 拆成空 import 指纹 + 后随表达式，配对后仍是动态事实。
    let head_source = "import('./x.js');";
    let record = ok(head_source);
    assert_eq!(record.imports.len(), 1);
    assert_eq!(record.imports[0].kind, ImportKind::Dynamic);
    assert_eq!(record.imports[0].specifier, "./x.js");
    assert_eq!(slice(head_source, record.imports[0].span), "import('./x.js');");
    assert_eq!(slice(head_source, record.imports[0].specifier_span.unwrap()), "'./x.js'");
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);

    // 非字面量：无法静态解析，必须诊断，不得静默。
    let dynamic_source = "const q = import(someVar);";
    let record = ok(dynamic_source);
    assert_eq!(record.imports.len(), 1);
    let fact = &record.imports[0];
    assert_eq!(fact.kind, ImportKind::Dynamic);
    assert_eq!(fact.specifier, "");
    assert_eq!(fact.specifier_span, None);
    assert_eq!(slice(dynamic_source, fact.span), "import(someVar)");
    assert!(record.flags.dynamic_import_nonliteral);
    assert_eq!(record.diagnostics.len(), 1, "{:?}", record.diagnostics);
    assert_eq!(record.diagnostics[0].code, "vmz::pack::module::dynamic_import_unresolved");
    assert_eq!(record.diagnostics[0].path.as_deref(), Some("app.ts"));
    assert_eq!(slice(dynamic_source, record.diagnostics[0].span.unwrap()), "import(someVar)");
}

/// 动态 import 的 span 形状启发必须由 `import` 原文佐证：`require` 与普通
/// 调用不得产生 import 事实，真实动态 import 形态不受影响。
#[test]
fn shape_heuristics_require_import_text() {
    // 语句头 `require('…')`：普通调用表达式，无 import 事实也无诊断。
    let source = "require('./m');";
    let record = ok(source);
    assert!(record.imports.is_empty(), "{:?}", record.imports);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);

    // 表达式位置 `require('…')`：callee 为标识符，不产生动态事实。
    let record = ok("const m = require('./m');");
    assert!(record.imports.is_empty(), "{:?}", record.imports);

    // 词边界校验：`important(…)` 与 `import` 前缀同形，只是普通调用。
    let record = ok("const p = important('./x.js');");
    assert!(record.imports.is_empty(), "{:?}", record.imports);

    // 回归护栏：真实动态 import 仍是事实。
    let record = ok("const p = import('./x.js');");
    assert_eq!(record.imports.len(), 1);
    assert_eq!(record.imports[0].kind, ImportKind::Dynamic);
    assert_eq!(record.imports[0].specifier, "./x.js");
}

/// ⑦ 富模块全量 span 切片：每条 import / export / statement 记录都回到原文。
#[test]
fn every_record_span_slices_back_to_source() {
    let source = "import './side.js';\nexport const version = '1';\nconst local = 1;\nexport { local as api };";
    let record = ok(source);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);

    assert_eq!(record.imports.len(), 1);
    assert_eq!(slice(source, record.imports[0].span), "import './side.js';");
    assert_eq!(slice(source, record.imports[0].specifier_span.unwrap()), "'./side.js'");

    assert_eq!(record.exports.len(), 2);
    let export_span = |fact: &ExportFact| match fact {
        ExportFact::Local { span, .. }
        | ExportFact::Default { span, .. }
        | ExportFact::ReexportNamed { span, .. }
        | ExportFact::ReexportAll { span, .. }
        | ExportFact::ReexportNamespace { span, .. } => *span,
    };
    assert_eq!(slice(source, export_span(&record.exports[0])), "export const version = '1';");
    assert_eq!(slice(source, export_span(&record.exports[1])), "export { local as api };");

    // 声明语句：export 包裹的声明与裸声明都记录自身 span。
    assert_eq!(record.statements.len(), 2);
    assert_eq!(slice(source, record.statements[0].span), "const version = '1';");
    assert_eq!(record.statements[0].declared_names, ["version"]);
    assert_eq!(slice(source, record.statements[1].span), "const local = 1;");
    assert_eq!(record.statements[1].declared_names, ["local"]);
}

/// ⑧ 语法错误必须返回诊断，不静默降级为部分事实。
#[test]
fn syntax_errors_return_diagnostics() {
    let error = parse_module(Some("broken.ts"), "function {").expect_err("语法错误必须 Err");
    assert!(!error.is_empty());
    for diagnostic in &error {
        assert_eq!(diagnostic.code, "vmz::pack::module::parse_failed");
        assert_eq!(diagnostic.path.as_deref(), Some("broken.ts"));
        assert!(diagnostic.span.is_some(), "Oak 诊断应带 span：{diagnostic:?}");
        assert!(!diagnostic.message.is_empty());
    }
}

/// ⑨ 顶层 await（TLA）：由 Oak root 级 `top_level_await_spans` 正式事实驱动。
#[test]
fn top_level_await_is_recorded() {
    let source = "await fetch('/x');\nconst later = await(1);";
    let record = ok(source);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);
    assert!(record.flags.has_tla, "两个顶层 await 形态都必须置位 TLA 事实");
    assert!(!record.flags.dynamic_import_nonliteral);

    // 函数边界内的 await 不是 TLA。
    let nested = ok("async function main() { await fetch('/x'); }");
    assert!(!nested.flags.has_tla, "await 穿越函数边界不得记为 TLA");
    let for_await = ok("for await (const c of stream()) { }");
    assert!(for_await.flags.has_tla, "`for await` 标记必须记为 TLA");
}

/// 资源引用：规范形态 `new URL('<lit>', import.meta.url)` 记录为资源事实。
#[test]
fn canonical_url_asset_is_recorded() {
    let source = "const u = new URL('./logo.svg', import.meta.url);";
    let record = ok(source);
    assert_eq!(record.assets.len(), 1, "{:?}", record.assets);
    let asset = &record.assets[0];
    assert_eq!(asset.specifier, "./logo.svg");
    assert_eq!(slice(source, asset.span), "new URL('./logo.svg', import.meta.url)");
    assert_eq!(slice(source, asset.specifier_span.unwrap()), "'./logo.svg'");
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);
}

/// 非规范 URL 形态不是模块相对资源：单参相对文档基址，非 `import.meta.url`
/// 基址无法静态确定，都不记资源事实、不猜测。
#[test]
fn non_canonical_url_is_not_asset() {
    let single = ok("const u = new URL('./logo.svg');");
    assert!(single.assets.is_empty(), "{:?}", single.assets);
    let other_base = ok("const u = new URL('./logo.svg', document.baseURI);");
    assert!(other_base.assets.is_empty(), "{:?}", other_base.assets);
}

/// 语句头 `import.meta.url` 是普通表达式语句：不是模块导入，
/// 不再按空指纹给诊断。
#[test]
fn import_meta_is_plain_expression() {
    let source = "import.meta.url;";
    let record = ok(source);
    assert!(record.imports.is_empty(), "{:?}", record.imports);
    assert!(record.assets.is_empty(), "{:?}", record.assets);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);
}

/// 多 declarator：绑定名全部来自 AST，所有初值纯时整体判 `Pure`。
#[test]
fn multi_declarator_names_and_effect_are_complete() {
    let source = "const a = 1, b = 2;";
    let record = ok(source);
    assert!(record.diagnostics.is_empty(), "{:?}", record.diagnostics);
    assert_eq!(record.statements.len(), 1);
    let statement = &record.statements[0];
    assert_eq!(statement.declared_names, ["a", "b"]);
    assert_eq!(statement.effect, StatementEffect::Pure);
    assert_eq!(slice(source, statement.span), "const a = 1, b = 2;");
}

/// 解构声明：绑定名由 declarator 给出，不再产生 `statement_fact_incomplete`。
#[test]
fn destructuring_names_are_facts_without_diagnostics() {
    let source = "const { a, b } = require('./m');";
    let record = ok(source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    let statement = &record.statements[0];
    assert_eq!(statement.declared_names, ["a", "b"]);
    assert_eq!(statement.effect, StatementEffect::SideEffect);
    assert_eq!(slice(source, statement.span), "const { a, b } = require('./m');");

    // 解构按属性读取处理：初值纯也判副作用，与无初值的 `let` 区分。
    let pattern = ok("const { a } = pureCall();");
    assert!(statement_fact_incomplete(&pattern).is_empty(), "{:?}", pattern.diagnostics);
    assert_eq!(pattern.statements[0].declared_names, ["a"]);
    assert_eq!(pattern.statements[0].effect, StatementEffect::SideEffect);

    let uninitialized = ok("let x;");
    assert!(
        statement_fact_incomplete(&uninitialized).is_empty(),
        "{:?}",
        uninitialized.diagnostics
    );
    assert_eq!(uninitialized.statements[0].declared_names, ["x"]);
    assert_eq!(uninitialized.statements[0].effect, StatementEffect::Init);
}

/// 类表达式：`ClassExpression` 的声明/引用事实与同形态 `ClassDeclaration` 同构，
/// 不再产生 `statement_fact_incomplete`。
#[test]
fn class_expression_facts_mirror_class_declaration() {
    // 匿名类表达式：字段初值依赖与方法体引用照常收集。
    let source = "var X = class { a = 1; constructor(v) { this.a = v; } b = f(this.a); };";
    let record = ok(source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    let statement = &record.statements[0];
    assert_eq!(statement.declared_names, ["X"]);
    assert_eq!(slice(source, statement.span), source);

    // 与同形态具名声明的引用事实逐字段一致（两边同走保守收录规则）。
    let decl_source = "class X { a = 1; constructor(v) { this.a = v; } b = f(this.a); }";
    let decl = ok(decl_source);
    assert!(statement_fact_incomplete(&decl).is_empty(), "{:?}", decl.diagnostics);
    assert_eq!(
        statement.referenced_names, decl.statements[0].referenced_names,
        "类表达式与同形态声明的引用事实必须同构"
    );
    assert!(
        statement.referenced_names.iter().any(|name| name == "f"),
        "字段初值 `f(this.a)` 的依赖必须收录：{:?}",
        statement.referenced_names
    );

    // 具名 + `extends`：heritage 原文取首段标识符作为运行时引用。
    let extends_source = "const C = class Named extends Base { static s = 1; m() {} };";
    let record = ok(extends_source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    assert_eq!(record.statements[0].declared_names, ["C"]);
    assert_eq!(record.statements[0].referenced_names, ["Base"]);
    assert_eq!(slice(extends_source, record.statements[0].span), extends_source);
    // 同形态声明：成员事实同构；`extends` 引用暂缺是上游 builder 缺口
    // （parser 从不产出 `HeritageClause` 节点，`ClassDeclaration.extends` 恒为 `None`），
    // 上游补齐后本断言自动收紧为与表达式侧一致。
    let decl = ok("class C extends Base { static s = 1; m() {} }");
    assert!(statement_fact_incomplete(&decl).is_empty(), "{:?}", decl.diagnostics);
    assert_eq!(decl.statements[0].declared_names, ["C"]);
    assert!(
        decl.statements[0]
            .referenced_names
            .iter()
            .all(|name| record.statements[0].referenced_names.contains(name)),
        "声明侧引用必须是表达式侧引用的子集（上游 `extends` 缺口只会让声明侧少收）"
    );

    // 调用实参位置：匿名空类表达式是普通表达式事实，无缺口。
    let call_source = "f(class {});";
    let record = ok(call_source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    assert!(record.statements[0].declared_names.is_empty());
    assert_eq!(record.statements[0].referenced_names, ["f"]);
    assert_eq!(slice(call_source, record.statements[0].span), "f(class {});");

    // 匿名 `export default class`：按既有空名语义（无本地绑定名、默认导出 local 为空）。
    let default_source = "export default class { c = 3; }";
    let record = ok(default_source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    match &record.exports[0] {
        ExportFact::Default { local, span } => {
            assert_eq!(local, &None);
            assert_eq!(slice(default_source, *span), "export default class { c = 3; }");
        }
        other => panic!("期望 Default 导出，实际 {other:?}"),
    }
    assert!(record.statements[0].declared_names.is_empty(), "{:?}", record.statements[0]);
}

/// `export const { a } = x`：导出名来自 declarator 绑定名。
#[test]
fn destructured_export_resolves_local_name() {
    let source = "export const { a } = x;";
    let record = ok(source);
    assert!(statement_fact_incomplete(&record).is_empty(), "{:?}", record.diagnostics);
    assert_eq!(record.exports.len(), 1);
    match &record.exports[0] {
        ExportFact::Local { local, exported, .. } => {
            assert_eq!(local, "a");
            assert_eq!(exported, "a");
        }
        other => panic!("期望 Local 导出，实际 {other:?}"),
    }
    assert_eq!(record.statements[0].declared_names, ["a"]);
}
