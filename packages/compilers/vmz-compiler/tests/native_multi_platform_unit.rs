//! Moved from `src/native/multi_platform.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_protocol::*;


use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::native::multi_platform::*;
use vmz_protocol::MultiPlatformAdapter;

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn ios_android_shared_ready() {
    let dir = tmp("vmz-nw6-");
    let report = check_multi_platform_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready);
    assert_eq!(report.multi_platform.adapters.len(), 2);
    assert_eq!(report.multi_platform.shared.bridge_schema, BRIDGE_PROTOCOL_SCHEMA);
    assert_eq!(report.multi_platform.shared.surface_schema, NATIVE_SURFACE_SCHEMA);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_platform_semantic_fork() {
    let dir = tmp("vmz-nw6-fork-");
    let mut mp = NativeMultiPlatformManifest::ios_android_example();
    if let Some(a) = mp.adapters.iter_mut().find(|a| a.platform == NativePlatformId::Android) {
        a.bridge_schema = "com.android.private.bridge".into();
    }
    fs::write(dir.join("native-multi-platform.json"), serde_json::to_string_pretty(&mp).unwrap())
        .unwrap();
    let report = check_multi_platform_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(report.diagnostics.iter().any(|d| {
        d.code_string().as_deref() == Some(DIAG_PLATFORM_SEMANTIC_FORK)
            || d.code_string().as_deref() == Some(DIAG_PLATFORM_PRIVATE_SCHEMA)
    }));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_adapter_as_semantic_core() {
    let dir = tmp("vmz-nw6-core-");
    let mut mp = NativeMultiPlatformManifest::ios_android_example();
    for a in &mut mp.adapters {
        a.packaging_only = false;
        a.is_semantic_truth_source = true;
    }
    fs::write(dir.join("native-multi-platform.json"), serde_json::to_string_pretty(&mp).unwrap())
        .unwrap();
    let report = check_multi_platform_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_ADAPTER_IS_SEMANTIC_CORE))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_missing_android_adapter() {
    let dir = tmp("vmz-nw6-miss-");
    let shared = MultiPlatformSharedContracts::canonical();
    let mp = NativeMultiPlatformManifest {
        schema: MULTI_PLATFORM_SCHEMA.into(),
        shared: shared.clone(),
        platforms: vec![NativePlatformId::Ios],
        adapters: vec![MultiPlatformAdapter::packaging_stub(NativePlatformId::Ios, &shared)],
        allows_platform_semantic_fork: false,
    };
    fs::write(dir.join("native-multi-platform.json"), serde_json::to_string_pretty(&mp).unwrap())
        .unwrap();
    let report = check_multi_platform_contract(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_MISSING_PLATFORM_ADAPTER))
    );
    let _ = fs::remove_dir_all(&dir);
}
