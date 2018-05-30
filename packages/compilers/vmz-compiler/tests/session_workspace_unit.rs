//! Moved from `src/session/workspace.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::PathBuf;

use std::fs;
use vmz_compiler::plugin::{
    ContributionItem, ContributionKind, PluginIdentity, PluginStage, sha256_hex_bytes,
};
use vmz_compiler::session::workspace::*;

fn fixture_project(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "vmz-ws-{}-{}-{}",
        tag,
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::write(
        dir.join("src").join("Application.vmz"),
        "<template>\n<p>hi</p>\n</template>\n\n<script client>\nexport default class Application {}\n</script>\n",
    )
    .unwrap();
    dir
}

#[test]
fn handshake_accepts_matching_protocols() {
    let host = ProtocolVersionsOwned::from(&PROTOCOL);
    assert!(handshake(&host).is_ok());
    assert_eq!(PROTOCOL.program_ir_schema, vmz_protocol::PROGRAM_SCHEMA);
    assert_eq!(PROTOCOL.plugin_protocol, PLUGIN_PROTOCOL_V1);
}

#[test]
fn handshake_rejects_mismatch() {
    let mut host = ProtocolVersionsOwned::from(&PROTOCOL);
    host.compiler_protocol = "9.9.9".into();
    assert!(handshake(&host).is_err());
}

#[test]
fn update_files_tracks_dirty_then_check_runs() {
    let dir = fixture_project("check");
    let vmz = dir.join("src").join("Application.vmz");
    let mut ws = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: dir.join("dist"),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    ws.update_files([FileChange { path: vmz.clone(), kind: ChangeKind::Update }]);
    assert!(ws.dirty_paths().any(|p| p == vmz));

    let report = ws.check(&CheckOptions::default()).unwrap();
    assert!(report.files_checked >= 1);
    assert!(!report.has_errors(), "{:?}", report.diagnostics);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn two_builds_emit_byte_identical_program_ir() {
    let dir = fixture_project("ir");
    let a = dir.join("dist-a");
    let b = dir.join("dist-b");
    let mut ws_a = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: a.clone(),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    let mut ws_b = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: b.clone(),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    let ra = ws_a.build().unwrap();
    let rb = ws_b.build().unwrap();
    assert!(ra.diagnostics.iter().all(|d| !d.is_error()), "{:?}", ra.diagnostics);
    assert!(rb.diagnostics.iter().all(|d| !d.is_error()), "{:?}", rb.diagnostics);

    let src = dir.join("src").join("Application.vmz");
    let ja = ws_a.query_program_graph(&src).unwrap();
    let jb = ws_b.query_program_graph(&src).unwrap();
    assert_eq!(ja, jb);
    assert!(ja.contains(vmz_protocol::PROGRAM_SCHEMA));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn leaf_dirty_rebuilds_only_affected_chunk() {
    let dir = fixture_project("n4");
    fs::create_dir_all(dir.join("src/components")).unwrap();
    let a = dir.join("src/components/A.vmz");
    let b = dir.join("src/components/B.vmz");
    let body =
        "<template><p>x</p></template>\n<script client>\nexport default class X {}\n</script>\n";
    fs::write(&a, body.replace("X", "A")).unwrap();
    fs::write(&b, body.replace("X", "B")).unwrap();

    let mut ws = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: dir.join("dist"),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    let full = ws.build().unwrap();
    assert!(full.full, "first build must be full");
    assert!(dir.join("dist/vmz-deployment.json").is_file());
    assert!(dir.join("dist/components/A.program.json").is_file());
    assert!(dir.join("dist/components/B.program.json").is_file());
    ws.clear_dirty();

    let t_before =
        fs::metadata(dir.join("dist/components/B.client.js")).unwrap().modified().unwrap();
    std::thread::sleep(std::time::Duration::from_millis(30));
    fs::write(&a, body.replace("X", "A2")).unwrap();
    ws.update_files([FileChange { path: a.clone(), kind: ChangeKind::Update }]);
    let plan = ws.query_affected();
    assert!(!plan.full);
    assert_eq!(plan.units.len(), 1);
    assert!(plan.units[0].chunk_id.contains("A"));

    let inc = ws.build().unwrap();
    assert!(!inc.full);
    assert_eq!(inc.affected_chunks, vec!["components/A".to_string()]);
    assert!(
        !inc.emitted.iter().any(|p| p.ends_with("B.client.js") || p.ends_with("B.program.json")),
        "sibling B must not be re-emitted: {:?}",
        inc.emitted
    );
    assert!(
        inc.emitted.iter().any(|p| p.ends_with("A.client.js") || p.ends_with("A.program.json"))
    );
    let t_after =
        fs::metadata(dir.join("dist/components/B.client.js")).unwrap().modified().unwrap();
    assert_eq!(t_before, t_after, "B.client.js mtime must stay");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn plugin_target_emitted_on_build() {
    let dir = fixture_project("plug");
    let mut ws = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: dir.join("dist"),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    let content =
        "<template><p>g</p></template>\n<script client>\nexport default class Gen {}\n</script>\n";
    let hash = sha256_hex_bytes(content.as_bytes());
    let report = ws.apply_plugin_contributions(ContributionBatch {
        plugin: PluginIdentity { name: "conformance".into(), version: "0.1.0".into() },
        protocol: PLUGIN_PROTOCOL_V1.into(),
        stage: PluginStage::WorkspaceResolve,
        cache_key: "c".into(),
        deterministic: true,
        items: vec![ContributionItem {
            id: "gen".into(),
            kind: ContributionKind::Source {
                path: PathBuf::from("src/Gen.vmz"),
                content: content.into(),
                content_hash: hash,
                materialize: true,
            },
        }],
    });
    assert_eq!(report.accepted, 1, "{:?}", report.rejected);

    let t = ws.apply_plugin_contributions(ContributionBatch {
        plugin: PluginIdentity { name: "conformance".into(), version: "0.1.0".into() },
        protocol: PLUGIN_PROTOCOL_V1.into(),
        stage: PluginStage::Target,
        cache_key: "t".into(),
        deterministic: true,
        items: vec![ContributionItem {
            id: "edge".into(),
            kind: ContributionKind::Target {
                target_id: "edge-preview".into(),
                kind: "edge".into(),
                manifest_json: r#"{"runtime":"edge","routes":["/"]}"#.into(),
            },
        }],
    });
    assert_eq!(t.accepted, 1, "{:?}", t.rejected);

    let built = ws.build().unwrap();
    assert!(built.diagnostics.iter().all(|d| !d.is_error()), "{:?}", built.diagnostics);
    assert!(dir.join("dist/vmz-plugin-targets.json").is_file());
    assert!(dir.join("dist/vmz-targets/edge-preview.json").is_file());
    assert!(dir.join("src/Gen.vmz").is_file());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn explain_returns_deployment_and_program_json() {
    let dir = fixture_project("explain");
    fs::create_dir_all(dir.join("src/components")).unwrap();
    fs::write(
        dir.join("src/components/Card.vmz"),
        r#"<template>
  <p if={ok}>{label}</p>
</template>
<script client>
export default class Card {
  ok = true;
  label = "x";
}
</script>
"#,
    )
    .unwrap();
    let mut ws = Workspace::create(WorkspaceOptions {
        root: dir.clone(),
        out_dir: dir.join("dist"),
        tw: None,
        scss: None,
        runtime_dist: None,
    });
    let report = ws.build().unwrap();
    assert!(report.diagnostics.iter().all(|d| !d.is_error()), "{:?}", report.diagnostics);
    let json = ws.explain("components/Card");
    assert!(json.contains("vmz.dx.explain.v0"), "{json}");
    assert!(json.contains("\"kind\": \"chunk\""), "{json}");
    assert!(json.contains("components/Card"), "{json}");
    assert!(json.contains("\"program\""), "{json}");
    let by_cap = ws.explain("capability:missing");
    assert!(by_cap.contains("vmz.dx.explain.v0"));
    let session = ws.query_session_graph();
    assert!(session.contains("vmz.session.v0"), "{session}");
    assert!(session.contains("components/Card"), "{session}");
    let catalog = ws.query_dx_catalog();
    assert!(catalog.contains("vmz.dx.v0"), "{catalog}");
    assert!(catalog.contains("vmz.dx.symbol.v0"), "{catalog}");
    let affected_dx = ws.query_affected_dx();
    assert!(affected_dx.contains("vmz.dx.affected.v0"), "{affected_dx}");
    let edge = ws.explain("components/Card#binding:0");
    assert!(edge.contains("\"kind\": \"binding\""), "{edge}");

    let rename = ws.plan_rename(
        r#"{"schema":"vmz.dx.rename.v0","kind":"route_id","from":"home","to":"landing"}"#,
    );
    assert!(rename.contains("vmz.dx.workspace_edit.v0"), "{rename}");
    // No RouteId refs in Card.vmz fixture ->rejected (no_references).
    assert!(rename.contains("\"status\": \"rejected\""), "{rename}");
    assert!(rename.contains("dx.rename.no_references") || rename.contains("no proven"), "{rename}");
    let bad = ws.plan_rename(r#"{"schema":"vmz.dx.rename.v0","kind":"nope","from":"a","to":"b"}"#);
    assert!(bad.contains("\"status\": \"rejected\""), "{bad}");

    let sel = ws.select_tests_affected();
    assert!(sel.contains("vmz.dx.test_selection.v0"), "{sel}");
    assert!(
        sel.contains("\"status\": \"empty\"")
            || sel.contains("\"status\": \"preview\"")
            || sel.contains("\"status\": \"ready\""),
        "{sel}"
    );

    let _ = fs::remove_dir_all(&dir);
}
