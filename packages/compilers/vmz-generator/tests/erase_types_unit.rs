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
fn rejects_enums_and_namespaces() {
    assert!(erase_types("enum Color {\n  Red,\n}\n").is_err());
    assert!(erase_types("namespace App {\n  export const x = 1;\n}\n").is_err());
    assert!(erase_types("declare module 'vmz:http' {\n}\n").is_err());
}
