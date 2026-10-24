use vmz_generator::js::rewrite_ts_spec_imports;

#[test]
fn ignores_non_module_ts_text() {
    let source = "const source = './generated.ts';\nexport const marker = 'tsx';";
    assert_eq!(rewrite_ts_spec_imports(source), source);
}

#[test]
fn rewrites_real_module_specifiers() {
    let source = "import value from './value.ts';\nexport { value } from './value.tsx';";
    let output = rewrite_ts_spec_imports(source);
    assert!(!output.contains(".ts"));
    assert!(output.contains("./value.js"));
}

#[test]
fn leaves_same_line_strings_and_comments_alone() {
    let source = concat!(
        "const label = \"./value.ts\";\n",
        "import value from \"./value.ts\"; // keep \"./value.ts\" in this comment\n",
        "export { value } from './other.tsx';\n",
    );
    let output = rewrite_ts_spec_imports(source);
    assert!(
        output.contains("const label = \"./value.ts\";"),
        "a plain string on the same line must not be rewritten: {output}"
    );
    assert!(
        output.contains("// keep \"./value.ts\" in this comment"),
        "the comment must not be rewritten: {output}"
    );
    assert!(output.contains("from \"./value.js\""), "import specifier must move to .js: {output}");
    assert!(output.contains("'./other.js'"), "export specifier must move to .js: {output}");
}

#[test]
fn rewrites_dynamic_import_specifiers() {
    let source = concat!(
        "const lazy = await import(\"./lazy.ts\");\n",
        "const other = import('./other.tsx');\n",
        "const keep = \"./lazy.ts\";\n",
    );
    let output = rewrite_ts_spec_imports(source);
    assert!(output.contains("import(\"./lazy.js\")"), "dynamic import must be rewritten: {output}");
    assert!(output.contains("import('./other.js')"), "{output}");
    assert!(output.contains("const keep = \"./lazy.ts\""), "{output}");
}

#[test]
fn keeps_unrelated_statements_byte_identical() {
    let source = concat!(
        "const broken = 1;\n",
        "import value from \"./value.ts\";\n",
        "const tail = \"keep .ts here\";\n",
    );
    let output = rewrite_ts_spec_imports(source);
    assert_eq!(
        output,
        "const broken = 1;\nimport value from \"./value.js\";\nconst tail = \"keep .ts here\";\n",
        "only the specifier range may change"
    );
}
