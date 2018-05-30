//! Moved from `src/native/shell.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;

use vmz_compiler::native::shell::*;
use vmz_protocol::ShellPlatformAdapter;

#[test]
fn example_shell_ready_without_dist() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw1-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let report = check_native_shell_contract(&dir);
    assert_eq!(report.status, "ready", "{:?}", report.diagnostics);
    assert_eq!(report.shell.adapters.len(), 2);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_remote_https_entry() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-nw1-remote-{}",
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::create_dir_all(&dir);
    let mut shell = NativeWebViewShellManifest::local_bundled_example();
    shell.entry.entry_url = "https://cdn.example.com/app".into();
    fs::write(dir.join("native-shell.json"), shell.to_json()).unwrap();
    let report = check_native_shell_contract(&dir);
    assert_eq!(report.status, "failed");
    assert!(
        report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_REMOTE_ENTRY_DEFAULT))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_platform_schema_fork() {
    let mut shell = NativeWebViewShellManifest::local_bundled_example();
    shell.adapters = vec![
        ShellPlatformAdapter {
            platform: "ios".into(),
            kind: "webview_shell".into(),
            shell_schema: SHELL_SCHEMA.into(),
        },
        ShellPlatformAdapter {
            platform: "android".into(),
            kind: "webview_shell".into(),
            shell_schema: "com.vendor.android.private.shell".into(),
        },
    ];
    let mut diags = Vec::new();
    let dir = std::env::temp_dir();
    validate_shell(&shell, &dir, &mut diags);
    assert!(diags.iter().any(|d| d.code.as_deref() == Some(DIAG_PLATFORM_SEMANTIC_FORK)));
}
