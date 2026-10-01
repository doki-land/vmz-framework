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
