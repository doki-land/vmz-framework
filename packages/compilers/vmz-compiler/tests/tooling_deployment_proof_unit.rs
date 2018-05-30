//! Moved from `src/tooling/deployment_proof.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;
use vmz_compiler::tooling::deployment_proof::*;

#[test]
fn empty_without_deployment() {
    let dir = std::env::temp_dir().join(format!("vmz-x4-empty-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let report = check_deployment_proof(&dir);
    assert_eq!(report.status, "empty");
    assert_eq!(report.schema, DEPLOYMENT_PROOF_CHECK_SCHEMA);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn dead_chunk_via_depends_on() {
    let dir = std::env::temp_dir().join(format!("vmz-x4-dead-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let json = r#"{
  "schema": "vmz.deployment.v0",
  "units": [
{"chunkId":"pages/index","kind":"page","dependsOn":["components/Card"],"capabilities":[],"serverModuleId":null,"clientCalls":[],"resumeEntries":[]},
{"chunkId":"components/Card","kind":"component","dependsOn":[],"capabilities":["load"],"serverModuleId":"CardServer","clientCalls":[{"method":"load","fromClientMethod":"boot"}],"resumeEntries":[]},
{"chunkId":"components/Orphan","kind":"component","dependsOn":[],"capabilities":[],"serverModuleId":null,"clientCalls":[],"resumeEntries":[]}
  ]
}"#;
    fs::write(dir.join("vmz-deployment.json"), json).unwrap();
    let dead = plan_dead_graph(&dir);
    assert!(dead.dead_chunks.contains(&"components/Orphan".into()));
    assert!(!dead.dead_chunks.contains(&"components/Card".into()));
    let boundary = plan_boundary_validators(&dir);
    assert!(boundary.validators.iter().any(|v| v.kind == "route" && v.id == "pages/index"));
    let leak = plan_leakage(&dir);
    assert_eq!(leak.status, "ready");
    let report = check_deployment_proof(&dir);
    assert_eq!(report.status, "ready");
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn ghost_rpc_fails_leakage() {
    let dir = std::env::temp_dir().join(format!("vmz-x4-ghost-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let json = r#"{
  "schema": "vmz.deployment.v0",
  "units": [
{"chunkId":"pages/index","kind":"page","dependsOn":[],"capabilities":[],"serverModuleId":null,"clientCalls":[{"method":"ghostRpc","fromClientMethod":null}],"resumeEntries":[]}
  ]
}"#;
    fs::write(dir.join("vmz-deployment.json"), json).unwrap();
    let leak = plan_leakage(&dir);
    assert_eq!(leak.status, "failed");
    assert!(leak.findings.iter().any(|f| f.kind == "unknown_client_call"));
    assert_eq!(check_deployment_proof(&dir).status, "failed");
    let _ = fs::remove_dir_all(&dir);
}
