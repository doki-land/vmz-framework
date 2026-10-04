//! Regression: event-shell / production-catalog check must finish (Oak parser progress).

use std::path::PathBuf;
use std::time::{Duration, Instant};

use vmz_compiler::pipeline::check::{CheckOptions, check_path, check_project};
use vmz_compiler::pipeline::compile::{CompileOptions, compile_path, compile_project};

fn examples_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples")
}

#[test]
fn event_shell_files_check_without_hang() {
    let root = examples_root().join("event-shell");
    for rel in ["src/Application.vmz", "src/components/EventButton.vmz", "src/pages/index.vmz"] {
        let path = root.join(rel);
        let start = Instant::now();
        let report = check_path(&path, &CheckOptions::default()).unwrap();
        assert!(
            start.elapsed() < Duration::from_secs(10),
            "{rel} check took {:?}",
            start.elapsed()
        );
        eprintln!("{rel}: {} diagnostic(s)", report.diagnostics.len());
    }
}

#[test]
fn event_shell_project_check_without_hang() {
    let root = examples_root().join("event-shell");
    let start = Instant::now();
    let report = check_project(&root, &CheckOptions::default()).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(30),
        "event-shell check_project took {:?}",
        start.elapsed()
    );
    eprintln!(
        "event-shell: {} file(s), {} diagnostic(s)",
        report.files_checked,
        report.diagnostics.len()
    );
}

#[test]
fn event_button_compile_without_hang() {
    let path = examples_root().join("event-shell/src/components/EventButton.vmz");
    let out = std::env::temp_dir().join(format!(
        "vmz-event-button-compile-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::create_dir_all(&out);
    let options = CompileOptions {
        out_dir: out.clone(),
        release: false,
        tw: None,
        scss: None,
        runtime_dist: None,
    };
    let start = Instant::now();
    let report = compile_path(&path, &options).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(30),
        "EventButton compile_path took {:?}",
        start.elapsed()
    );
    eprintln!(
        "EventButton compile: {} emitted, {} diagnostic(s)",
        report.emitted.len(),
        report.diagnostics.len()
    );
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn hello_greeting_compile_without_hang() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../examples/hello/src/components/Greeting.vmz");
    let out = std::env::temp_dir().join(format!(
        "vmz-hello-greeting-compile-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::create_dir_all(&out);
    let options = CompileOptions {
        out_dir: out.clone(),
        release: false,
        tw: None,
        scss: None,
        runtime_dist: None,
    };
    let start = Instant::now();
    let report = compile_path(&path, &options).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(30),
        "Greeting compile_path took {:?}",
        start.elapsed()
    );
    eprintln!(
        "Greeting compile: {} emitted, {} diagnostic(s)",
        report.emitted.len(),
        report.diagnostics.len()
    );
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn hello_project_compile_without_hang() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../examples/hello");
    let out = std::env::temp_dir().join(format!(
        "vmz-hello-project-compile-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::create_dir_all(&out);
    let options = CompileOptions {
        out_dir: out.clone(),
        release: false,
        tw: None,
        scss: None,
        runtime_dist: None,
    };
    let start = Instant::now();
    let report = compile_project(&root, &options).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(30),
        "hello compile_project took {:?}",
        start.elapsed()
    );
    eprintln!(
        "hello compile: {} emitted, {} diagnostic(s)",
        report.emitted.len(),
        report.diagnostics.len()
    );
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn event_shell_compile_project_without_hang() {
    let root = examples_root().join("event-shell");
    let out = std::env::temp_dir().join(format!(
        "vmz-event-shell-compile-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = std::fs::create_dir_all(&out);
    let options = CompileOptions {
        out_dir: out.clone(),
        release: false,
        tw: None,
        scss: None,
        runtime_dist: None,
    };
    let start = Instant::now();
    let report = compile_project(&root, &options).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(60),
        "event-shell compile_project took {:?}",
        start.elapsed()
    );
    eprintln!(
        "event-shell compile: {} emitted, {} diagnostic(s)",
        report.emitted.len(),
        report.diagnostics.len()
    );
    let _ = std::fs::remove_dir_all(&out);
}

#[test]
fn production_catalog_project_check_without_hang() {
    let root = examples_root().join("production-catalog");
    let start = Instant::now();
    let report = check_project(&root, &CheckOptions::default()).unwrap();
    assert!(
        start.elapsed() < Duration::from_secs(60),
        "production-catalog check_project took {:?}",
        start.elapsed()
    );
    eprintln!(
        "production-catalog: {} file(s), {} diagnostic(s)",
        report.files_checked,
        report.diagnostics.len()
    );
}
