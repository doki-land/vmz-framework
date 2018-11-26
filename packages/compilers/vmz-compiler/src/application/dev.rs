//!
//! Proves per-ApplicationId independent sessions, dirty→affected selection,
//! MountTable reverse-proxy dispatch (incl. 503 unavailable), mounted-test
//! selection modes, and deploy-adapter refs-only boundary.
//! First version is algebraic/conformance — not a live HTTP reverse proxy.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use vmz_protocol::{
    APPLICATION_AFFECTED_SCHEMA, APPLICATION_DEPLOY_ADAPTER_SCHEMA, APPLICATION_DEV_CHECK_SCHEMA,
    APPLICATION_DEV_SESSIONS_SCHEMA, APPLICATION_MOUNTED_TEST_SCHEMA,
    APPLICATION_PROXY_DISPATCH_SCHEMA, ApplicationAffectedPlan, ApplicationAffectedReason,
    ApplicationAffectedUnit, ApplicationArtifact, ApplicationDeployAdapterProof,
    ApplicationDevCheckReport, ApplicationDevRole, ApplicationDevSession, ApplicationDevSessions,
    ApplicationDiagnostic, ApplicationId, ApplicationMountTable, ApplicationMountedTestSelection,
    ApplicationProxyCase, ApplicationProxyDispatch, ApplicationTestModeSelection,
    DIAG_AFFECTED_LEAK, DIAG_PROXY_MISROUTE, DIAG_SESSION_SHARED, FailureContainmentProof,
};

use crate::application_artifact::check_application_artifact_boundary;
use crate::application_isolation::check_application_isolation;

const OFFICIAL_ADAPTERS: &[&str] = &["vmz-deployment-adapter", "vmz-deployment-adapter-rolldown"];

/// Check Dev/Test/Deploy contracts for a host workspace.
///
/// Builds per-ApplicationId sessions, dirty-path affected plans, mount proxy
/// dispatch (including unavailable mounts), and deploy-adapter boundary proofs.
/// `dirty_paths` selects which units enter the affected plan.
pub fn check_application_dev_test_deploy(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
    dirty_paths: &[PathBuf],
) -> ApplicationDevCheckReport {
    let host_root = host_root.as_ref();
    let boundary = check_application_artifact_boundary(host_root, package_roots);
    let isolation = check_application_isolation(host_root, package_roots);
    let mut diagnostics = boundary.diagnostics;
    diagnostics.extend(isolation.diagnostics);

    let host_id = resolve_host_id(&boundary.mount_table, host_root);
    let sessions = build_sessions(host_root, &host_id, &boundary.artifacts, &mut diagnostics);
    let unavailable = load_unavailable(host_root);
    let affected =
        plan_affected(host_root, &host_id, &boundary.artifacts, dirty_paths, &mut diagnostics);
    let proxy = build_proxy_dispatch(
        &boundary.mount_table,
        &host_id,
        &unavailable,
        &isolation.failure_containment,
        &mut diagnostics,
    );
    let tests = build_test_selection(&host_id, &boundary.artifacts, &affected);
    let deploy = build_deploy_proof(&boundary.mount_table, &boundary.artifacts, &mut diagnostics);

    ApplicationDevCheckReport {
        schema: APPLICATION_DEV_CHECK_SCHEMA.into(),
        sessions,
        affected,
        proxy,
        tests,
        deploy,
        diagnostics,
    }
}

fn resolve_host_id(mount_table: &ApplicationMountTable, host_root: &Path) -> ApplicationId {
    if let Some(id) = &mount_table.host_application_id {
        return id.clone();
    }
    // Host without explicit descriptor still owns an orchestration session.
    let _ = host_root;
    ApplicationId("_host".into())
}

fn build_sessions(
    host_root: &Path,
    host_id: &ApplicationId,
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationDevSessions {
    let mut sessions = Vec::new();
    sessions.push(ApplicationDevSession {
        application_id: host_id.clone(),
        package_root: host_root.display().to_string(),
        independent: true,
        role: ApplicationDevRole::Host,
    });
    for a in artifacts {
        let id = a.application_id.as_str();
        if id == host_id.as_str() {
            continue;
        }
        let root = a.package_root.clone().unwrap_or_else(|| format!("<missing:{id}>"));
        sessions.push(ApplicationDevSession {
            application_id: a.application_id.clone(),
            package_root: root,
            independent: true,
            role: ApplicationDevRole::Child,
        });
    }
    sessions.sort_by(|a, b| a.application_id.as_str().cmp(b.application_id.as_str()));

    // Prove no shared session keys.
    let mut seen: HashMap<String, String> = HashMap::new();
    for s in &sessions {
        let key = format!("{}::{}", s.role, s.package_root);
        if let Some(prev) = seen.insert(key.clone(), s.application_id.as_str().into()) {
            if prev != s.application_id.as_str() {
                diagnostics.push(ApplicationDiagnostic::coded_error(s.package_root.clone(), DIAG_SESSION_SHARED).with_arg("detail", format!(
                        "dev session package root shared by `{prev}` and `{}`",
                        s.application_id.as_str()
                    )));
            }
        }
        if !s.independent {
            diagnostics.push(ApplicationDiagnostic::coded_error(s.application_id.as_str(), DIAG_SESSION_SHARED).with_arg("detail", "dev session must be independent (no shared Program Graph/runtime)"));
        }
    }

    ApplicationDevSessions { schema: APPLICATION_DEV_SESSIONS_SCHEMA.into(), sessions }
}

fn load_unavailable(host_root: &Path) -> BTreeSet<String> {
    let path = host_root.join("unavailable-applications.json");
    let Ok(text) = fs::read_to_string(path) else {
        return BTreeSet::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return BTreeSet::new();
    };
    let arr = value
        .as_array()
        .cloned()
        .or_else(|| value.get("applications").and_then(|v| v.as_array().cloned()))
        .unwrap_or_default();
    arr.into_iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
}

fn plan_affected(
    host_root: &Path,
    host_id: &ApplicationId,
    artifacts: &[ApplicationArtifact],
    dirty_paths: &[PathBuf],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationAffectedPlan {
    let config_path = host_root.join("applications.config.json5");
    let mut by_root: BTreeMap<String, ApplicationId> = BTreeMap::new();
    for a in artifacts {
        if let Some(root) = &a.package_root {
            by_root.insert(normalize_path(root), a.application_id.clone());
        }
    }
    let host_norm = normalize_path(&host_root.display().to_string());

    let mut units: Vec<ApplicationAffectedUnit> = Vec::new();
    let mut rebuilt: BTreeSet<String> = BTreeSet::new();

    let dirty_display: Vec<String> = dirty_paths.iter().map(|p| p.display().to_string()).collect();

    for dirty in dirty_paths {
        let dirty_s = normalize_path(&dirty.display().to_string());
        let dirty_name = dirty.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();

        if dirty_s == normalize_path(&config_path.display().to_string())
            || dirty_name == "applications.config.json5"
        {
            push_unit(
                &mut units,
                &mut rebuilt,
                host_id.clone(),
                ApplicationAffectedReason::MountConfig,
            );
            continue;
        }

        // Match longest package root prefix.
        let mut matched: Option<(usize, ApplicationId)> = None;
        for (root, id) in &by_root {
            if dirty_s.starts_with(root)
                && (dirty_s.len() == root.len()
                    || dirty_s.as_bytes().get(root.len()) == Some(&b'/')
                    || dirty_s.as_bytes().get(root.len()) == Some(&b'\\'))
            {
                let len = root.len();
                if matched.as_ref().map(|(l, _)| *l).unwrap_or(0) < len {
                    matched = Some((len, id.clone()));
                }
            }
        }

        if let Some((_, id)) = matched {
            let reason = if dirty_name == "package.json" {
                ApplicationAffectedReason::Descriptor
            } else {
                ApplicationAffectedReason::ChildSource
            };
            push_unit(&mut units, &mut rebuilt, id.clone(), reason);
            if reason == ApplicationAffectedReason::Descriptor {
                // Descriptor metadata also refreshes host catalogs.
                push_unit(
                    &mut units,
                    &mut rebuilt,
                    host_id.clone(),
                    ApplicationAffectedReason::Descriptor,
                );
            }
            continue;
        }

        if dirty_s.starts_with(&host_norm) {
            push_unit(
                &mut units,
                &mut rebuilt,
                host_id.clone(),
                ApplicationAffectedReason::CollectionUi,
            );
            continue;
        }

        // Shared package outside host/children — rebuild declared dependents (all apps for v1).
        for a in artifacts {
            push_unit(
                &mut units,
                &mut rebuilt,
                a.application_id.clone(),
                ApplicationAffectedReason::SharedPackage,
            );
        }
        push_unit(
            &mut units,
            &mut rebuilt,
            host_id.clone(),
            ApplicationAffectedReason::SharedPackage,
        );
    }

    units.sort_by(|a, b| {
        (a.application_id.as_str(), a.reason.as_str())
            .cmp(&(b.application_id.as_str(), b.reason.as_str()))
    });
    units.dedup_by(|a, b| a.application_id == b.application_id && a.reason == b.reason);

    let all_ids: BTreeSet<String> = artifacts
        .iter()
        .map(|a| a.application_id.as_str().to_string())
        .chain(std::iter::once(host_id.as_str().to_string()))
        .collect();
    let not_rebuilt: Vec<ApplicationId> =
        all_ids.into_iter().filter(|id| !rebuilt.contains(id)).map(ApplicationId).collect();

    // Child source must not rebuild siblings.
    if dirty_paths.len() == 1 {
        if let Some((_, id)) = by_root.iter().find(|(root, _)| {
            let d = normalize_path(&dirty_paths[0].display().to_string());
            d.starts_with(root.as_str())
        }) {
            let dirty_name = dirty_paths[0].file_name().and_then(|s| s.to_str()).unwrap_or("");
            if dirty_name != "package.json"
                && dirty_name != "applications.config.json5"
                && units.iter().any(|u| {
                    u.application_id.as_str() != id.as_str()
                        && u.application_id.as_str() != host_id.as_str()
                        && u.reason == ApplicationAffectedReason::ChildSource
                })
            {
                diagnostics.push(ApplicationDiagnostic::coded_error(dirty_paths[0].display().to_string(), DIAG_AFFECTED_LEAK).with_arg("detail", format!(
                        "child_source change under `{}` leaked rebuild to sibling applications",
                        id.as_str()
                    )));
            }
        }
    }

    ApplicationAffectedPlan {
        schema: APPLICATION_AFFECTED_SCHEMA.into(),
        dirty: dirty_display,
        units,
        not_rebuilt,
    }
}

fn push_unit(
    units: &mut Vec<ApplicationAffectedUnit>,
    rebuilt: &mut BTreeSet<String>,
    id: ApplicationId,
    reason: ApplicationAffectedReason,
) {
    rebuilt.insert(id.as_str().to_string());
    units.push(ApplicationAffectedUnit { application_id: id, reason });
}

fn build_proxy_dispatch(
    mount_table: &ApplicationMountTable,
    host_id: &ApplicationId,
    unavailable: &BTreeSet<String>,
    failure_containment: &[FailureContainmentProof],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationProxyDispatch {
    let mut cases = Vec::new();

    // Longest-prefix match table.
    let mut mounts: Vec<(String, ApplicationId)> = mount_table
        .mounts
        .iter()
        .map(|m| (normalize_base(&m.route_base), m.application_id.clone()))
        .collect();
    mounts.sort_by_key(|m| std::cmp::Reverse(m.0.len()));

    for (base, id) in &mounts {
        let status = if unavailable.contains(id.as_str()) { 503 } else { 200 };
        let reason = if status == 503 { Some("application_unavailable".into()) } else { None };
        cases.push(ApplicationProxyCase {
            url: base.clone(),
            application_id: Some(id.clone()),
            strip_base: Some("/".into()),
            status,
            reason,
        });
        // Nested path under base
        let nested =
            if base.ends_with('/') { format!("{base}page") } else { format!("{base}/page") };
        cases.push(ApplicationProxyCase {
            url: nested,
            application_id: Some(id.clone()),
            strip_base: Some("/page".into()),
            status,
            reason: if status == 503 { Some("application_unavailable".into()) } else { None },
        });
    }

    cases.push(ApplicationProxyCase {
        url: "/".into(),
        application_id: Some(host_id.clone()),
        strip_base: Some("/".into()),
        status: 200,
        reason: None,
    });
    cases.push(ApplicationProxyCase {
        url: "/__vmz_no_such_mount".into(),
        application_id: None,
        strip_base: None,
        status: 404,
        reason: Some("not_found".into()),
    });

    // Cross-check failure containment policies for unavailable apps.
    for id in unavailable {
        let ok = failure_containment.iter().any(|f| {
            f.failed_application_id.as_str() == id
                && f.unavailable.status == 503
                && f.unavailable.reason == "application_unavailable"
                && f.host_survives
        });
        if !ok && !failure_containment.is_empty() {
            diagnostics.push(ApplicationDiagnostic::coded_error(id.clone(), DIAG_PROXY_MISROUTE).with_arg("detail", format!(
                    "unavailable ApplicationId `{id}` lacks failure-containment 503 application_unavailable proof"
                )));
        }
    }

    // Verify dispatch algebra on generated cases.
    for case in &cases {
        let expected = dispatch_url(&case.url, &mounts, host_id, unavailable);
        if expected.status != case.status
            || expected.application_id.as_ref().map(|a| a.as_str())
                != case.application_id.as_ref().map(|a| a.as_str())
        {
            diagnostics.push(ApplicationDiagnostic::coded_error(case.url.clone(), DIAG_PROXY_MISROUTE).with_arg("detail", format!(
                    "proxy case mismatch for `{}`: expected status={} app={:?}, got status={} app={:?}",
                    case.url,
                    expected.status,
                    expected.application_id.as_ref().map(|a| a.as_str()),
                    case.status,
                    case.application_id.as_ref().map(|a| a.as_str())
                )));
        }
    }

    ApplicationProxyDispatch { schema: APPLICATION_PROXY_DISPATCH_SCHEMA.into(), cases }
}

fn dispatch_url(
    url: &str,
    mounts: &[(String, ApplicationId)],
    host_id: &ApplicationId,
    unavailable: &BTreeSet<String>,
) -> ApplicationProxyCase {
    if url == "/__vmz_no_such_mount" {
        return ApplicationProxyCase {
            url: url.into(),
            application_id: None,
            strip_base: None,
            status: 404,
            reason: Some("not_found".into()),
        };
    }
    for (base, id) in mounts {
        if url == base || url.starts_with(&format!("{base}/")) {
            let strip = if url == base {
                "/".to_string()
            } else {
                let rest = &url[base.len()..];
                if rest.is_empty() { "/".into() } else { rest.to_string() }
            };
            if unavailable.contains(id.as_str()) {
                return ApplicationProxyCase {
                    url: url.into(),
                    application_id: Some(id.clone()),
                    strip_base: Some(strip),
                    status: 503,
                    reason: Some("application_unavailable".into()),
                };
            }
            return ApplicationProxyCase {
                url: url.into(),
                application_id: Some(id.clone()),
                strip_base: Some(strip),
                status: 200,
                reason: None,
            };
        }
    }
    if url == "/" {
        return ApplicationProxyCase {
            url: url.into(),
            application_id: Some(host_id.clone()),
            strip_base: Some("/".into()),
            status: 200,
            reason: None,
        };
    }
    ApplicationProxyCase {
        url: url.into(),
        application_id: None,
        strip_base: None,
        status: 404,
        reason: Some("not_found".into()),
    }
}

fn build_test_selection(
    host_id: &ApplicationId,
    artifacts: &[ApplicationArtifact],
    affected: &ApplicationAffectedPlan,
) -> ApplicationMountedTestSelection {
    let sample =
        artifacts.first().map(|a| a.application_id.clone()).unwrap_or_else(|| host_id.clone());

    let application = ApplicationTestModeSelection {
        id: sample.as_str().into(),
        test_scope: Some("standalone".into()),
        contracts: Vec::new(),
        selected_application_ids: vec![sample.clone()],
    };
    let mounted = ApplicationTestModeSelection {
        id: sample.as_str().into(),
        test_scope: None,
        contracts: vec!["relocation".into(), "host_boundary".into()],
        selected_application_ids: vec![sample.clone(), host_id.clone()],
    };
    let affected_ids: Vec<ApplicationId> = {
        let mut set = BTreeSet::new();
        for u in &affected.units {
            set.insert(u.application_id.as_str().to_string());
        }
        set.into_iter().map(ApplicationId).collect()
    };
    let affected_mode = ApplicationTestModeSelection {
        id: "*".into(),
        test_scope: Some("affected".into()),
        contracts: Vec::new(),
        selected_application_ids: affected_ids,
    };

    ApplicationMountedTestSelection {
        schema: APPLICATION_MOUNTED_TEST_SCHEMA.into(),
        application,
        mounted,
        affected: affected_mode,
    }
}

fn build_deploy_proof(
    mount_table: &ApplicationMountTable,
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationDeployAdapterProof {
    let table_json = serde_json::to_string(mount_table).unwrap_or_default();
    let refs_only = !table_json.contains("programGraph")
        && !table_json.contains("executionPlan")
        && !table_json.contains("\"program\"")
        && !table_json.contains("executableModule");
    if !refs_only {
        diagnostics.push(ApplicationDiagnostic::coded_error("ApplicationMountTable", DIAG_PROXY_MISROUTE).with_arg("detail", "deploy adapter proof: MountTable must remain refs-only"));
    }

    let per_app = artifacts.iter().all(|a| !a.server_deployment_ref.hash.is_empty());

    ApplicationDeployAdapterProof {
        schema: APPLICATION_DEPLOY_ADAPTER_SCHEMA.into(),
        mount_table_refs_only: refs_only,
        adapters: OFFICIAL_ADAPTERS.iter().map(|s| (*s).to_string()).collect(),
        per_application_deployment_refs: per_app || artifacts.is_empty(),
    }
}

fn normalize_path(s: &str) -> String {
    s.replace('\\', "/").trim_end_matches('/').to_string()
}

fn normalize_base(s: &str) -> String {
    let mut b = s.replace('\\', "/");
    if b.is_empty() {
        return "/".into();
    }
    if !b.starts_with('/') {
        b = format!("/{b}");
    }
    if b.len() > 1 {
        b = b.trim_end_matches('/').to_string();
    }
    b
}
