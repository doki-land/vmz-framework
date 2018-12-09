//! Application artifact boundary — content-addressed refs per ApplicationId.
//!
//! Each ApplicationId owns an [`ApplicationArtifact`] with content-addressed refs.
//! Host MountTable / Catalog hold refs / metadata only — never Program Graph or
//! Execution Plan bodies. No Mount IR.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use vmz_protocol::{
    APPLICATION_ARTIFACT_BOUNDARY_SCHEMA, APPLICATION_ARTIFACT_SCHEMA,
    APPLICATION_MOUNT_TABLE_SCHEMA, ApplicationArtifact, ApplicationArtifactBoundaryReport,
    ApplicationCatalog, ApplicationCheckReport, ApplicationDescriptor, ApplicationDiagnostic,
    ApplicationMountTable, ApplicationMountTableEntry, ArtifactRef, ArtifactSliceKind,
    DIAG_ARTIFACT_INTEGRITY, DIAG_CROSS_RUNTIME_REFERENCE, DIAG_INVALID_CONFIG,
};

use crate::application::check_applications;
use crate::plugin::sha256_hex_bytes;

/// Build independent ApplicationArtifacts + host MountTable/Catalog and prove ownership boundary.
pub fn check_application_artifact_boundary(
    host_root: impl AsRef<Path>,
    package_roots: &[PathBuf],
) -> ApplicationArtifactBoundaryReport {
    let host_root = host_root.as_ref();
    let check = check_applications(host_root, package_roots);
    build_boundary_report(host_root, &check)
}

fn build_boundary_report(
    host_root: &Path,
    check: &ApplicationCheckReport,
) -> ApplicationArtifactBoundaryReport {
    let mut diagnostics = check.diagnostics.clone();
    let mut artifacts = Vec::new();
    for d in &check.descriptors {
        artifacts.push(build_artifact(d, &mut diagnostics));
    }
    artifacts.sort_by(|a, b| a.application_id.as_str().cmp(b.application_id.as_str()));
    let by_id: HashMap<&str, &ApplicationArtifact> =
        artifacts.iter().map(|a| (a.application_id.as_str(), a)).collect();
    let mount_table = build_mount_table(host_root, check, &by_id, &mut diagnostics);
    let catalog = check.catalog.clone();
    validate_unique_executable_ownership(&artifacts, &mut diagnostics);
    validate_mount_table_is_refs_only(&mount_table, &mut diagnostics);
    validate_catalog_has_no_executables(&catalog, &mut diagnostics);
    validate_artifact_integrities(&artifacts, &mut diagnostics);
    validate_mount_refs(&artifacts, &mount_table, &mut diagnostics);
    ApplicationArtifactBoundaryReport {
        schema: APPLICATION_ARTIFACT_BOUNDARY_SCHEMA.into(),
        artifacts,
        mount_table,
        catalog,
        diagnostics,
    }
}

fn build_artifact(
    d: &ApplicationDescriptor,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationArtifact {
    let package_root = d.package_root.clone().unwrap_or_default();
    let descriptor_body = format!(
        "{}|{}|{}|{}|{}",
        d.schema,
        d.id.as_str(),
        d.entry_route,
        d.title.as_deref().unwrap_or(""),
        d.summary.as_deref().unwrap_or("")
    );
    let descriptor_hash = sha256_hex_bytes(descriptor_body.as_bytes());
    let program_graph_ref = artifact_ref(
        ArtifactSliceKind::ProgramGraph,
        &format!("program:{}:{descriptor_hash}:{package_root}", d.id.as_str()),
    );
    let execution_plan_ref = artifact_ref(
        ArtifactSliceKind::ExecutionPlan,
        &format!("plan:{}:{descriptor_hash}:{package_root}", d.id.as_str()),
    );
    let route_manifest_ref = artifact_ref(
        ArtifactSliceKind::RouteManifest,
        &format!("routes:{}:{}", d.id.as_str(), d.entry_route),
    );
    let asset_manifest_ref = artifact_ref(
        ArtifactSliceKind::AssetManifest,
        &format!("assets:{}:{descriptor_hash}", d.id.as_str()),
    );
    let server_deployment_ref = artifact_ref(
        ArtifactSliceKind::ServerDeployment,
        &format!("server:{}:{descriptor_hash}", d.id.as_str()),
    );
    let public_route_contracts = vec![d.entry_route.clone()];
    let n = descriptor_hash.len().min(16);
    let executable_module_id = format!("exec:{}:{}", d.id.as_str(), &descriptor_hash[..n]);
    let integrity = compute_artifact_integrity(
        d.id.as_str(),
        &descriptor_hash,
        &program_graph_ref,
        &execution_plan_ref,
        &route_manifest_ref,
        &asset_manifest_ref,
        &server_deployment_ref,
        &public_route_contracts,
        &executable_module_id,
    );
    if package_root.is_empty() {
        diagnostics.push(
            ApplicationDiagnostic::coded_error(
                d.package_root
                    .as_ref()
                    .map(|r| Path::new(r).join("package.json").display().to_string())
                    .unwrap_or_else(|| "package.json".into()),
                DIAG_ARTIFACT_INTEGRITY,
            )
            .with_arg(
                "detail",
                format!("ApplicationId `{}` artifact missing packageRoot", d.id.as_str()),
            ),
        );
    }
    ApplicationArtifact {
        schema: APPLICATION_ARTIFACT_SCHEMA.into(),
        application_id: d.id.clone(),
        descriptor_hash,
        program_graph_ref,
        execution_plan_ref,
        route_manifest_ref,
        asset_manifest_ref,
        server_deployment_ref,
        public_route_contracts,
        integrity,
        package_root: d.package_root.clone(),
        executable_module_id,
    }
}

fn artifact_ref(kind: ArtifactSliceKind, material: &str) -> ArtifactRef {
    ArtifactRef { kind, hash: sha256_hex_bytes(material.as_bytes()) }
}

#[allow(clippy::too_many_arguments)]
fn compute_artifact_integrity(
    application_id: &str,
    descriptor_hash: &str,
    program_graph_ref: &ArtifactRef,
    execution_plan_ref: &ArtifactRef,
    route_manifest_ref: &ArtifactRef,
    asset_manifest_ref: &ArtifactRef,
    server_deployment_ref: &ArtifactRef,
    public_route_contracts: &[String],
    executable_module_id: &str,
) -> String {
    let envelope = format!(
        "{application_id}|{descriptor_hash}|{}:{}|{}:{}|{}:{}|{}:{}|{}:{}|{}|{}",
        program_graph_ref.kind,
        program_graph_ref.hash,
        execution_plan_ref.kind,
        execution_plan_ref.hash,
        route_manifest_ref.kind,
        route_manifest_ref.hash,
        asset_manifest_ref.kind,
        asset_manifest_ref.hash,
        server_deployment_ref.kind,
        server_deployment_ref.hash,
        public_route_contracts.join(","),
        executable_module_id
    );
    sha256_hex_bytes(envelope.as_bytes())
}

fn build_mount_table(
    host_root: &Path,
    check: &ApplicationCheckReport,
    by_id: &HashMap<&str, &ApplicationArtifact>,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) -> ApplicationMountTable {
    let config_path = host_root.join("applications.config.json5");
    let host_application_id = check
        .descriptors
        .iter()
        .find(|d| d.package_root.as_ref().map(|r| Path::new(r) == host_root).unwrap_or(false))
        .map(|d| d.id.clone());
    let mut mounts = Vec::new();
    for m in &check.mounts {
        let Some(art) = by_id.get(m.application.as_str()) else {
            continue;
        };
        let artifact_ref = ArtifactRef {
            kind: ArtifactSliceKind::ApplicationArtifact,
            hash: art.integrity.clone(),
        };
        let public_route_summary = art.public_route_contracts.clone();
        let integrity = sha256_hex_bytes(
            format!(
                "{}|{}|{}:{}|{}",
                m.route_base,
                m.application.as_str(),
                artifact_ref.kind,
                artifact_ref.hash,
                public_route_summary.join(",")
            )
            .as_bytes(),
        );
        mounts.push(ApplicationMountTableEntry {
            route_base: m.route_base.clone(),
            application_id: m.application.clone(),
            artifact_ref,
            public_route_summary,
            health: Some("ok".into()),
            fallback: Some("unavailable".into()),
            integrity,
        });
    }
    let table_integrity = sha256_hex_bytes(
        mounts.iter().map(|m| m.integrity.as_str()).collect::<Vec<_>>().join("|").as_bytes(),
    );
    if !mounts.is_empty() && !config_path.is_file() {
        diagnostics.push(
            ApplicationDiagnostic::coded_error(
                config_path.display().to_string(),
                DIAG_INVALID_CONFIG,
            )
            .with_arg(
                "detail",
                "mount table entries present but applications.config.json5 missing",
            ),
        );
    }
    ApplicationMountTable {
        schema: APPLICATION_MOUNT_TABLE_SCHEMA.into(),
        host_application_id,
        mounts,
        integrity: table_integrity,
    }
}

fn validate_unique_executable_ownership(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let mut seen: HashMap<&str, &str> = HashMap::new();
    let mut graph_hashes: HashMap<&str, &str> = HashMap::new();
    let mut plan_hashes: HashMap<&str, &str> = HashMap::new();
    for a in artifacts {
        let exec = a.executable_module_id.as_str();
        let gid = a.application_id.as_str();
        if let Some(prev) = seen.insert(exec, gid) {
            diagnostics.push(
                ApplicationDiagnostic::coded_error(
                    a.package_root.clone().unwrap_or_default(),
                    DIAG_CROSS_RUNTIME_REFERENCE,
                )
                .with_arg(
                    "detail",
                    format!("executableModuleId `{exec}` owned by both `{prev}` and `{gid}`"),
                ),
            );
        }
        if let Some(prev) = graph_hashes.insert(a.program_graph_ref.hash.as_str(), gid) {
            if prev != gid {
                diagnostics.push(
                    ApplicationDiagnostic::coded_error(
                        a.package_root.clone().unwrap_or_default(),
                        DIAG_CROSS_RUNTIME_REFERENCE,
                    )
                    .with_arg(
                        "detail",
                        format!("programGraphRef hash shared by `{prev}` and `{gid}`"),
                    ),
                );
            }
        }
        if let Some(prev) = plan_hashes.insert(a.execution_plan_ref.hash.as_str(), gid) {
            if prev != gid {
                diagnostics.push(
                    ApplicationDiagnostic::coded_error(
                        a.package_root.clone().unwrap_or_default(),
                        DIAG_CROSS_RUNTIME_REFERENCE,
                    )
                    .with_arg(
                        "detail",
                        format!("executionPlanRef hash shared by `{prev}` and `{gid}`"),
                    ),
                );
            }
        }
    }
}

fn validate_mount_table_is_refs_only(
    table: &ApplicationMountTable,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let json = serde_json::to_string(table).unwrap_or_default();
    for forbidden in
        ["\"programGraph\"", "\"executionPlan\"", "\"executableModule\"", "\"modules\""]
    {
        if json.contains(forbidden) {
            diagnostics.push(
                ApplicationDiagnostic::coded_error(
                    "ApplicationMountTable",
                    DIAG_CROSS_RUNTIME_REFERENCE,
                )
                .with_arg(
                    "detail",
                    format!("MountTable must not embed child bodies (found {forbidden})"),
                ),
            );
        }
    }
}

fn validate_catalog_has_no_executables(
    catalog: &ApplicationCatalog,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let json = serde_json::to_string(catalog).unwrap_or_default();
    for forbidden in ["\"programGraph\"", "\"executionPlan\"", "\"executableModuleId\""] {
        if json.contains(forbidden) {
            diagnostics.push(
                ApplicationDiagnostic::coded_error(
                    "ApplicationCatalog",
                    DIAG_CROSS_RUNTIME_REFERENCE,
                )
                .with_arg("detail", format!("ApplicationCatalog must not embed {forbidden}")),
            );
        }
    }
}

fn validate_artifact_integrities(
    artifacts: &[ApplicationArtifact],
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    for a in artifacts {
        let expected = compute_artifact_integrity(
            a.application_id.as_str(),
            &a.descriptor_hash,
            &a.program_graph_ref,
            &a.execution_plan_ref,
            &a.route_manifest_ref,
            &a.asset_manifest_ref,
            &a.server_deployment_ref,
            &a.public_route_contracts,
            &a.executable_module_id,
        );
        if expected != a.integrity {
            diagnostics.push(
                ApplicationDiagnostic::coded_error(
                    a.package_root.clone().unwrap_or_default(),
                    DIAG_ARTIFACT_INTEGRITY,
                )
                .with_arg(
                    "detail",
                    format!(
                        "ApplicationArtifact `{}` integrity mismatch",
                        a.application_id.as_str()
                    ),
                ),
            );
        }
    }
}

fn validate_mount_refs(
    artifacts: &[ApplicationArtifact],
    table: &ApplicationMountTable,
    diagnostics: &mut Vec<ApplicationDiagnostic>,
) {
    let known: HashSet<&str> = artifacts.iter().map(|a| a.integrity.as_str()).collect();
    for m in &table.mounts {
        if !known.contains(m.artifact_ref.hash.as_str()) {
            diagnostics.push(ApplicationDiagnostic::coded_error("ApplicationMountTable", DIAG_ARTIFACT_INTEGRITY).with_arg("detail", format!(
                    "mount `{}` artifactRef.hash does not match any ApplicationArtifact integrity",
                    m.application_id.as_str()
                )));
        }
    }
}
