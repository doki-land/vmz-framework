use std::path::PathBuf;
use vmz_compiler::pipeline::compile::{compile_path, CompileOptions};

#[test]
fn counter_button_compile_path_completes() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let path = root.join("../../examples/counter/src/components/CounterButton.vmz");
    let mut options = CompileOptions::default();
    options.out_dir = std::env::temp_dir().join("vmz-counter-compile");
    let report = compile_path(&path, &options).expect("compile_path");
    assert!(report.diagnostics.iter().all(|d| !d.is_error()), "diagnostics: {:?}", report.diagnostics);
}
