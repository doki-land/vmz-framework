//! Token-level TypeScript type erasure contract.

use vmz_generator::js::erase_types;

const COMPONENT: &str = r#"
export default class Card {
  public title: string = "x";
  async onMount(): Promise<void> {
this.title = "y";
  }
}
"#;

#[test]
fn erases_class_member_and_return_types() {
    let js = erase_types(COMPONENT).unwrap();
    assert!(js.contains("class Card"), "{js}");
    assert!(js.contains("onMount"), "{js}");
    assert!(!js.contains("Promise<void>"), "{js}");
    assert!(!js.contains("public title: string"), "{js}");
    assert!(js.contains(r#"title = "x";"#), "{js}");
}

#[test]
fn erases_parameter_annotations_and_optional_markers() {
    let js = erase_types(
        "class Card {\n  render(items?: string[]): HTMLElement {\n    return null;\n  }\n}\n",
    )
    .unwrap();
    assert!(js.contains("render(items)"), "{js}");
    assert!(!js.contains("string[]"), "{js}");
    assert!(!js.contains("HTMLElement"), "{js}");
}

#[test]
fn erases_interfaces_type_aliases_and_type_imports() {
    let source = "import type { User } from './user';\ninterface Props {\n  title: string;\n}\ntype Name = string | number;\nexport type { Props };\nconst title = 'x';\n";
    let js = erase_types(source).unwrap();
    assert!(!js.contains("interface Props"), "{js}");
    assert!(!js.contains("type Name"), "{js}");
    assert!(!js.contains("import type"), "{js}");
    assert!(!js.contains("export type"), "{js}");
    assert!(js.contains("const title = 'x';"), "{js}");
}

#[test]
fn erases_as_casts_and_non_null_assertions() {
    let js = erase_types(
        "const el = document.body as HTMLElement;\nconst name = value as unknown as string;\nconst direct = el!.dataset.name;\n",
    )
    .unwrap();
    assert!(!js.contains("as HTMLElement"), "{js}");
    assert!(!js.contains("as unknown"), "{js}");
    assert!(!js.contains("as string"), "{js}");
    assert!(!js.contains("el!"), "{js}");
    assert!(js.contains("document.body;"), "{js}");
}

#[test]
fn erases_union_and_intersection_casts() {
    let js = erase_types(
        "const target = ev?.target as Element | null;\nconst el = (target as HTMLElement).closest('[data-vmz-option]') as HTMLElement | null;\nconst merged = value as A & B;\n",
    )
    .unwrap();
    assert!(!js.contains("as Element"), "{js}");
    assert!(!js.contains("as HTMLElement"), "{js}");
    assert!(!js.contains("as A"), "{js}");
    assert!(!js.contains("| null"), "{js}");
    assert!(!js.contains("& B"), "{js}");
    assert!(js.contains("ev?.target;") || js.contains("ev?.target"), "{js}");
}

#[test]
fn erases_generic_declarations_and_calls() {
    let js = erase_types(
        "function identity<T>(value: T): T {\n  return value;\n}\nconst list = identity<string>('x');\nclass Box<T> {\n  value: T;\n}\n",
    )
    .unwrap();
    assert!(!js.contains("<T>"), "{js}");
    assert!(!js.contains("<string>"), "{js}");
    assert!(js.contains("function identity(value)"), "{js}");
    assert!(js.contains("identity('x')"), "{js}");
    assert!(js.contains("class Box"), "{js}");
}

#[test]
fn keeps_value_colons_strings_comments_and_ternaries() {
    let source = "const map = { key: 1, nested: { other: 2 } };\nconst text = 'a: b as c';\n// note: keep\nconst pick = flag ? map.key : map.other;\n";
    let js = erase_types(source).unwrap();
    assert!(js.contains("key: 1"), "{js}");
    assert!(js.contains("other: 2"), "{js}");
    assert!(js.contains("'a: b as c'"), "{js}");
    assert!(js.contains("// note: keep"), "{js}");
    assert!(js.contains("flag ? map.key : map.other"), "{js}");
}

#[test]
fn erases_arrow_parameter_and_return_types() {
    let js =
        erase_types("const upper = (value: string): string => value.toUpperCase();\n").unwrap();
    assert!(js.contains("(value)"), "{js}");
    assert!(!js.contains(": string"), "{js}");
    assert!(js.contains("=> value.toUpperCase()"), "{js}");
}

#[test]
fn erases_annotations_on_keyword_named_members() {
    let js = erase_types(
        "class Button {\n  public type: string = 'button';\n  variant = 'primary';\n}\nclass TextArea {\n  public readonly: boolean = false;\n  readonly = true;\n}\n",
    )
    .unwrap();
    assert!(!js.contains("public"), "{js}");
    assert!(!js.contains(": string"), "{js}");
    assert!(!js.contains(": boolean"), "{js}");
    assert!(js.contains("type = 'button';"), "{js}");
    assert!(js.contains("readonly = false;"), "{js}");
    assert!(js.contains("readonly = true;"), "{js}");
}

#[test]
fn erases_keyword_named_parameter_and_return_types() {
    let js =
        erase_types("class Picker {\n  get(keyof: string): string {\n    return keyof;\n  }\n}\n")
            .unwrap();
    assert!(!js.contains("keyof: string"), "{js}");
    assert!(js.contains("get(keyof)"), "{js}");
}

#[test]
fn rejects_enums_and_namespaces() {
    assert!(erase_types("enum Color {\n  Red,\n}\n").is_err());
    assert!(erase_types("namespace App {\n  export const x = 1;\n}\n").is_err());
    assert!(erase_types("declare module 'vmz:http' {\n}\n").is_err());
}

#[test]
fn erases_as_casts_after_keyword_named_members() {
    // `default`/`type`/`class`/`new`/`delete` 是关键字，但点访问后是合法成员名；
    // 其后的 `as` 仍是类型断言，必须剥离（LSystem `fractal-wasm.ts` 实测形态）。
    let js = erase_types(
        "import('./fractal.wasm').then((mod) => {\n  resolved = mod.default as FractalWasm;\n});\nconst kind = widget.type as Kind;\nconst ctor = registry.class as Ctor;\nconst made = factory.new as Made;\nconst gone = cache.delete as Gone;\nconst viaOpt = mod?.default as FractalWasm;\nconst self = mod.as as Alias;\n",
    )
    .unwrap();
    assert!(!js.contains(" as "), "{js}");
    assert!(!js.contains("FractalWasm"), "{js}");
    assert!(js.contains("resolved = mod.default;"), "{js}");
    assert!(js.contains("widget.type;"), "{js}");
    assert!(js.contains("registry.class;"), "{js}");
    assert!(js.contains("factory.new;"), "{js}");
    assert!(js.contains("cache.delete;"), "{js}");
    assert!(js.contains("mod?.default;"), "{js}");
    assert!(js.contains("mod.as;"), "{js}");
}

#[test]
fn erases_as_casts_in_expression_positions() {
    // 变量初始化、函数实参、箭头函数返回、`then` 回调体、可选链之后。
    let js = erase_types(
        "const wasm = mod.default as FractalWasm;\nresolve(mod.default as FractalWasm);\nconst pick = (m) => m.default as FractalWasm;\npromise.then((m) => m.default as FractalWasm);\nconst el = doc?.body as HTMLElement;\n",
    )
    .unwrap();
    assert!(!js.contains(" as "), "{js}");
    assert!(js.contains("const wasm = mod.default;"), "{js}");
    assert!(js.contains("resolve(mod.default);"), "{js}");
    assert!(js.contains("(m) => m.default;"), "{js}");
    assert!(js.contains("m.default);"), "{js}");
    assert!(js.contains("doc?.body;"), "{js}");
}

#[test]
fn erases_non_null_after_keyword_named_members() {
    let js = erase_types("mod.default!.init();\nconst t = widget.type!;\n").unwrap();
    assert!(!js.contains("default!"), "{js}");
    assert!(!js.contains("type!"), "{js}");
    assert!(js.contains("mod.default.init();"), "{js}");
}

#[test]
fn keyword_named_members_do_not_corrupt_following_constructs() {
    // `default`/`class` 作为成员名时不得进入 case/class 结构状态，
    // 否则后续的三元冒号、类型标注与对象字面量会被误处理。
    let js = erase_types("const x = cond ? mod.default : alt\nconst y: number = 1;\n").unwrap();
    assert!(js.contains("cond ? mod.default : alt"), "{js}");
    assert!(!js.contains(": number"), "{js}");
    let js2 = erase_types("mod.class as Ctor;\nconst o = { a: 1 };\n").unwrap();
    assert!(!js2.contains(" as "), "{js2}");
    assert!(js2.contains("{ a: 1 }"), "{js2}");
}

#[test]
fn rejects_dangling_as_casts() {
    // 真正的语法错误仍要报：`as` 后面没有类型时显式拒绝，不静默吞掉后续 token。
    assert!(erase_types("const x = foo as;\n").is_err());
    assert!(erase_types("const x = foo as\n").is_err());
    assert!(erase_types("const x = foo as = 1;\n").is_err());
}

#[test]
fn keeps_as_used_as_plain_identifier() {
    let js = erase_types("let as = 1;\nas;\nconst o = { as: 2 };\nexport { as };\nimport { a as b } from './x';\nexport { b as c };\n").unwrap();
    assert!(js.contains("let as = 1;"), "{js}");
    assert!(js.contains("{ as: 2 }"), "{js}");
    assert!(js.contains("export { as };"), "{js}");
    assert!(js.contains("import { a as b } from './x';"), "{js}");
    assert!(js.contains("export { b as c };"), "{js}");
}

#[test]
fn erases_satisfies_in_expression_positions() {
    // `satisfies` 词法上是普通标识符，按上下文识别为 TS 断言并剥离。
    let js = erase_types(
        "const cfg = value satisfies Config;\nregister(name satisfies string, opts satisfies Options);\nconst pick = (m) => m.default satisfies FractalWasm;\npromise.then((m) => { resolved = m.default satisfies FractalWasm; });\nconst viaOpt = mod?.default satisfies FractalWasm;\n",
    )
    .unwrap();
    assert!(!js.contains("satisfies"), "{js}");
    assert!(js.contains("const cfg = value;"), "{js}");
    assert!(js.contains("register(name, opts);"), "{js}");
    assert!(js.contains("(m) => m.default;"), "{js}");
    assert!(js.contains("resolved = m.default;"), "{js}");
    assert!(js.contains("mod?.default;"), "{js}");
}

#[test]
fn keeps_satisfies_used_as_plain_identifier() {
    let js = erase_types("const satisfies = 1;\nf(satisfies);\nconst y = satisfies;\nmod.satisfies;\nconst o = { satisfies: 2 };\n").unwrap();
    assert!(js.contains("const satisfies = 1;"), "{js}");
    assert!(js.contains("f(satisfies);"), "{js}");
    assert!(js.contains("const y = satisfies;"), "{js}");
    assert!(js.contains("mod.satisfies;"), "{js}");
    assert!(js.contains("{ satisfies: 2 }"), "{js}");
}

#[test]
fn rejects_dangling_satisfies() {
    assert!(erase_types("const x = foo satisfies;\n").is_err());
    assert!(erase_types("const x = foo satisfies\n").is_err());
}

#[test]
fn erases_angle_bracket_assertions_at_expression_start() {
    // `<T>expr` 前缀断言（JSX 已禁，表达式起点的 `<` 只能是断言或泛型箭头）。
    let js = erase_types(
        "const el = <HTMLElement>document.body;\nresolve(<FractalWasm>mod.default);\nconst label = <string>cfg.name;\nfunction pick(m) {\n  return <FractalWasm>m.default;\n}\nconst arrow = () => <FractalWasm>mod.default;\nconst nested = <FractalWasm>(mod.default as unknown);\n",
    )
    .unwrap();
    assert!(!js.contains("<HTMLElement>"), "{js}");
    assert!(!js.contains("<FractalWasm>"), "{js}");
    assert!(!js.contains("<string>"), "{js}");
    assert!(js.contains("const el = document.body;"), "{js}");
    assert!(js.contains("resolve(mod.default);"), "{js}");
    assert!(js.contains("const label = cfg.name;"), "{js}");
    assert!(js.contains("return m.default;"), "{js}");
    assert!(js.contains("() => mod.default;"), "{js}");
    assert!(js.contains("(mod.default);"), "{js}");
}

#[test]
fn erases_angle_bracket_assertions_with_complex_types() {
    let js = erase_types(
        "const m = <Map<string, number>>cache.map;\nconst u = <A | B>value;\nconst g = <T>(x: T) => x;\nconst n = pick<Map<string, number>>(input);\n",
    )
    .unwrap();
    assert!(js.contains("const m = cache.map;"), "{js}");
    assert!(js.contains("const u = value;"), "{js}");
    // 泛型箭头函数的类型参数同样擦除，参数标注由既有路径处理。
    assert!(js.contains("const g = (x) => x;"), "{js}");
    // 嵌套泛型调用的 `>>` 闭合也要整体擦除。
    assert!(js.contains("const n = pick(input);"), "{js}");
}

#[test]
fn erases_assertions_in_export_declarations() {
    // 裸 `export`（default/const 等声明）不是说明符子句，其中的断言照常剥离。
    let js = erase_types(
        "export const picked = resolved as FractalWasm | null;\nexport const checked = resolved satisfies Config;\nexport default foo as Bar;\nexport const forced = <FractalWasm>resolved;\n",
    )
    .unwrap();
    assert!(!js.contains(" as "), "{js}");
    assert!(!js.contains("satisfies"), "{js}");
    assert!(!js.contains("<FractalWasm>"), "{js}");
    assert!(js.contains("export const picked = resolved;"), "{js}");
    assert!(js.contains("export const checked = resolved;"), "{js}");
    assert!(js.contains("export default foo;"), "{js}");
    assert!(js.contains("export const forced = resolved;"), "{js}");
    // 命名空间重导出里的 `as` 是合法面名，必须保留。
    let kept = erase_types("export * as ns from './x';\n").unwrap();
    assert!(kept.contains("export * as ns from './x';"), "{kept}");
}

#[test]
fn keeps_comparisons_and_generic_calls() {
    // 比较表达式与泛型调用不得误伤。
    let js = erase_types(
        "const c = a < b;\nconst d = a < b && b > 0;\nconst v = identity<string>('x');\nf(a < b);\nfor (let i = 0; i < n; i++) { step(i); }\nconst t = x < y ? 1 : 2;\nconst s = f<string>() as string;\n",
    )
    .unwrap();
    assert!(js.contains("a < b"), "{js}");
    assert!(js.contains("b > 0"), "{js}");
    assert!(js.contains("identity('x')"), "{js}");
    assert!(!js.contains("<string>"), "{js}");
    assert!(js.contains("f(a < b);"), "{js}");
    assert!(js.contains("i < n"), "{js}");
    assert!(js.contains("x < y ? 1 : 2"), "{js}");
    assert!(js.contains("const s = f();"), "{js}");
}
