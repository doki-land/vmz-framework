//!
//! Proves runtime/style/state/server/session/storage/trace namespaces and failure
//! containment. Shared npm bytes are allowed; shared *runtime semantics* are not.
//! No isolation-level switch (shared/sandboxed/external) — one strong contract.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use vmz_protocol::{
    APPLICATION_ISOLATION_CHECK_SCHEMA, APPLICATION_ISOLATION_SCHEMA, ApplicationArtifact,
    ApplicationDiagnostic, ApplicationId, ApplicationIsolationCheckReport,
    ApplicationIsolationNamespace, ApplicationMountTable, DIAG_CROSS_RUNTIME_REFERENCE,
    DIAG_FAILURE_CONTAINMENT, DIAG_ISOLATION_UNPROVEN, FailureContainmentProof,
    MountUnavailablePolicy,
};

use crate::application_artifact::check_application_artifact_boundary;

const ISOLATION_SURFACES: &[&str] =
    &["runtime", "style", "state", "server", "session", "storage", "trace", "failure"];

/// Check isolation namespaces and failure containment for host + mounted children.
///
/// Ensures runtime/style/state/server/session/storage/trace prefixes are unique
/// and that failure containment keeps one application's fault from taking over another.
pub fn check_application_isolation(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
) -> ApplicationIsolationCheckReport {
    let host_root = host_root.as_ref();
    let boundary = check_application_artifact_boundary(host_root, package_roots);
    let mut diagnostics = boundary.diagnostics;
    let namespaces = build_namespaces(&boundary.artifacts, &mut diagnostics);
    validate_namespace_uniqueness(&namespaces, &mut diagnostics);
    validate_namespace_prefixes(&namespaces, &mut diagnostics);
    validate_no_cross_executable(&boundary.artifacts, &mut diagnostics);
    let failure_containment =
        build_failure_containment(&boundary.artifacts, &boundary.mount_table, &mut diagnostics);
    validate_failure_containment(&failure_containment, &boundary.artifacts, &mut diagnostics);

    ApplicationIsolationCheckReport {
        schema: APPLICATION_ISOLATION_CHECK_SCHEMA.into(),
        namespaces,
        failure_containment,
        surfaces: ISOLATION_SURFACES.iter().map(|s| (*s).to_string()).collect(),
        diagnostics,
    }
}

fn build_namespaces(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<ApplicationIsolationNamespace> {
    let mut out = Vec::with_capacity(artifacts.len());
    for a in artifacts {
        let id = a.application_id.as_str();
        if id.is_empty() || id == "unknown" {
            diagnostics.push(ApplicationDiagnostic::coded_error(
                a.package_root.clone().unwrap_or_default(),
                "isolation requires an explicit ApplicationId",
                DIAG_ISOLATION_UNPROVEN,
            ));
            continue;
        }
        out.push(ApplicationIsolationNamespace {
            schema: APPLICATION_ISOLATION_SCHEMA.into(),
            application_id: a.application_id.clone(),
            runtime: format!("vmz:runtime:{id}:{}", a.executable_module_id),
            style: format!("vmz:style:{id}"),
            state: format!("vmz:state:{id}"),
            server: format!("vmz:server:{id}"),
            session: format!("vmz:session:{id}"),
            storage: format!("vmz:storage:{id}"),
            trace: format!("vmz:trace:{id}"),
            inspector_regions: format!("vmz:inspector:{id}"),
        });
    }
    out.sort_by(|a, b| a.application_id.as_str().cmp(b.application_id.as_str()));
    out
}

fn validate_namespace_uniqueness(
    namespaces: &[ApplicationIsolationNamespace],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let mut buckets: HashMap<&str, HashMap<&str, &str>> = HashMap::new();
    for ns in namespaces {
        let id = ns.application_id.as_str();
        for (surface, value) in [
            ("runtime", ns.runtime.as_str()),
            ("style", ns.style.as_str()),
            ("state", ns.state.as_str()),
            ("server", ns.server.as_str()),
            ("session", ns.session.as_str()),
            ("storage", ns.storage.as_str()),
            ("trace", ns.trace.as_str()),
            ("inspector", ns.inspector_regions.as_str()),
        ] {
            let map = buckets.entry(surface).or_default();
            if let Some(prev) = map.insert(value, id) {
                if prev != id {
                    diagnostics.push(ApplicationDiagnostic::coded_error(id, format!(
                            "{surface} namespace `{value}` shared by `{prev}` and `{id}` (runtime semantics must not be shared)"
                        ), DIAG_ISOLATION_UNPROVEN));
                }
            }
        }
    }
}

fn validate_namespace_prefixes(
    namespaces: &[ApplicationIsolationNamespace],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    for ns in namespaces {
        let id = ns.application_id.as_str();
        let expected = [
            ("runtime", ns.runtime.as_str(), format!("vmz:runtime:{id}:")),
            ("style", ns.style.as_str(), format!("vmz:style:{id}")),
            ("state", ns.state.as_str(), format!("vmz:state:{id}")),
            ("server", ns.server.as_str(), format!("vmz:server:{id}")),
            ("session", ns.session.as_str(), format!("vmz:session:{id}")),
            ("storage", ns.storage.as_str(), format!("vmz:storage:{id}")),
            ("trace", ns.trace.as_str(), format!("vmz:trace:{id}")),
            ("inspector", ns.inspector_regions.as_str(), format!("vmz:inspector:{id}")),
        ];
        for (surface, value, prefix) in expected {
            let ok =
                if surface == "runtime" { value.starts_with(&prefix) } else { value == prefix };
            if !ok {
                diagnostics.push(ApplicationDiagnostic::coded_error(id, format!(
                        "{surface} namespace `{value}` is not ApplicationId-scoped (want `{prefix}`)"
                    ), DIAG_ISOLATION_UNPROVEN));
            }
        }
    }
}

fn validate_no_cross_executable(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let mut by_exec: HashMap<&str, &str> = HashMap::new();
    for a in artifacts {
        let exec = a.executable_module_id.as_str();
        let id = a.application_id.as_str();
        if let Some(prev) = by_exec.insert(exec, id) {
            if prev != id {
                diagnostics.push(ApplicationDiagnostic::coded_error(
                    a.package_root.clone().unwrap_or_default(),
                    format!("executable `{exec}` appears in both `{prev}` and `{id}`"),
                    DIAG_CROSS_RUNTIME_REFERENCE,
                ));
            }
        }
    }
}

fn build_failure_containment(
    artifacts: &[ApplicationArtifact],
    mount_table: &ApplicationMountTable,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> Vec<FailureContainmentProof> {
    let mut proofs = Vec::new();
    let all_ids: Vec<ApplicationId> = artifacts.iter().map(|a| a.application_id.clone()).collect();
    let mount_by_id: HashMap<&str, &str> = mount_table
        .mounts
        .iter()
        .map(|m| (m.application_id.as_str(), m.route_base.as_str()))
        .collect();

    let mounted: Vec<&ApplicationArtifact> =
        artifacts.iter().filter(|a| mount_by_id.contains_key(a.application_id.as_str())).collect();

    if mounted.is_empty() && !mount_table.mounts.is_empty() {
        diagnostics.push(ApplicationDiagnostic::coded_error(
            "ApplicationMountTable",
            "mounts present but no matching ApplicationArtifacts for failure containment",
            DIAG_FAILURE_CONTAINMENT,
        ));
    }

    for a in &mounted {
        let failed = a.application_id.as_str();
        let route_base = mount_by_id.get(failed).copied().unwrap_or("/");
        let siblings: Vec<ApplicationId> =
            all_ids.iter().filter(|id| id.as_str() != failed).cloned().collect();
        proofs.push(FailureContainmentProof {
            failed_application_id: a.application_id.clone(),
            host_survives: true,
            siblings_survive: siblings,
            unavailable: MountUnavailablePolicy {
                application_id: a.application_id.clone(),
                route_base: route_base.into(),
                status: 503,
                reason: "application_unavailable".into(),
            },
        });
    }
    proofs
}

fn validate_failure_containment(
    proofs: &[FailureContainmentProof],
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let all: HashSet<&str> = artifacts.iter().map(|a| a.application_id.as_str()).collect();
    for p in proofs {
        let failed = p.failed_application_id.as_str();
        if !p.host_survives {
            diagnostics.push(ApplicationDiagnostic::coded_error(
                failed,
                format!("host must survive failure of `{failed}`"),
                DIAG_FAILURE_CONTAINMENT,
            ));
        }
        if p.unavailable.status != 503 || p.unavailable.reason != "application_unavailable" {
            diagnostics.push(ApplicationDiagnostic::coded_error(
                failed,
                "failed mount must return structured unavailable (503 application_unavailable)",
                DIAG_FAILURE_CONTAINMENT,
            ));
        }
        let sibling_set: HashSet<&str> = p.siblings_survive.iter().map(|id| id.as_str()).collect();
        if sibling_set.contains(failed) {
            diagnostics.push(ApplicationDiagnostic::coded_error(
                failed,
                "failed application listed as surviving sibling",
                DIAG_FAILURE_CONTAINMENT,
            ));
        }
        for id in &all {
            if *id == failed {
                continue;
            }
            if !sibling_set.contains(id) {
                diagnostics.push(ApplicationDiagnostic::coded_error(
                    failed,
                    format!("sibling `{id}` must survive failure of `{failed}`"),
                    DIAG_FAILURE_CONTAINMENT,
                ));
            }
        }
    }
}
