//! Application Collection / Mount contract (M0).
//!
//! Freezes descriptor + host `applications.config.json5` schemas and diagnostic codes.
//! No Mount IR: mounts are application/deployment edges; catalog/mount-table are artifacts.

use serde::{Deserialize, Serialize};

/// Child package identity: `package.json#vmz.application`.
pub const APPLICATION_DESCRIPTOR_SCHEMA: &str = "vmz.application.v0";

/// Host composition config: `applications.config.json5`.
pub const APPLICATIONS_CONFIG_SCHEMA: &str = "vmz.applications.v0";

/// Read-only catalog artifact for host pages (no executable modules).
pub const APPLICATION_CATALOG_SCHEMA: &str = "vmz.application.catalog.v0";

/// Structured result of `vmz application check` / N-API.
pub const APPLICATION_CHECK_SCHEMA: &str = "vmz.application.check.v0";

/// Handshake catalog of frozen application-composition schemas.
pub const APPLICATION_PROTOCOL: &str = "vmz.application.protocol.v0";

pub const DIAG_DUPLICATE_ID: &str = "vmz::application::duplicate_id";
pub const DIAG_UNKNOWN_REFERENCE: &str = "vmz::application::unknown_reference";
pub const DIAG_MOUNT_COLLISION: &str = "vmz::application::mount_collision";
pub const DIAG_INVALID_SCHEMA: &str = "vmz::application::invalid_schema";
pub const DIAG_INVALID_CONFIG: &str = "vmz::application::invalid_config";
pub const DIAG_INVALID_DESCRIPTOR: &str = "vmz::application::invalid_descriptor";
pub const DIAG_INVALID_ROUTE_BASE: &str = "vmz::application::invalid_route_base";
pub const DIAG_DUPLICATE_MOUNT: &str = "vmz::application::duplicate_mount";
pub const DIAG_NON_RELOCATABLE_URL: &str = "vmz::application::non_relocatable_url";
pub const DIAG_INVALID_BASE: &str = "vmz::application::invalid_base";
pub const DIAG_ARTIFACT_INTEGRITY: &str = "vmz::application::artifact_integrity";
pub const DIAG_CROSS_RUNTIME_REFERENCE: &str = "vmz::application::cross_runtime_reference";

/// Deployment-time application base (never baked into child compile).
pub const APPLICATION_BASE_SCHEMA: &str = "vmz.application.base.v0";

/// Logical URL surfaces compiled as if base were `/`.
pub const APPLICATION_RELOCATION_SCHEMA: &str = "vmz.application.relocation.v0";

/// Relocated URL surfaces after applying [`ApplicationBase`].
pub const APPLICATION_RELOCATED_SCHEMA: &str = "vmz.application.relocated.v0";

/// Result of relocatable source / manifest checks (M1).
pub const APPLICATION_RELOCATABLE_CHECK_SCHEMA: &str = "vmz.application.relocatable.v0";

/// Independent application build artifact (M2). No sibling Program Graph embedded.
pub const APPLICATION_ARTIFACT_SCHEMA: &str = "vmz.application.artifact.v0";

/// Host mount table artifact (M2). Refs only — never embeds child graphs/plans.
pub const APPLICATION_MOUNT_TABLE_SCHEMA: &str = "vmz.application.mount_table.v0";

/// Result of artifact-boundary ownership checks (M2).
pub const APPLICATION_ARTIFACT_BOUNDARY_SCHEMA: &str = "vmz.application.artifact_boundary.v0";

/// Per-application isolation namespace proof (M3).
pub const APPLICATION_ISOLATION_SCHEMA: &str = "vmz.application.isolation.v0";

/// Host+children isolation conformance report (M3).
pub const APPLICATION_ISOLATION_CHECK_SCHEMA: &str = "vmz.application.isolation_check.v0";

pub const DIAG_ISOLATION_UNPROVEN: &str = "vmz::application::isolation_unproven";
pub const DIAG_FAILURE_CONTAINMENT: &str = "vmz::application::failure_containment";
pub const DIAG_ROUTE_NOT_PUBLIC: &str = "vmz::application::route_not_public";
pub const DIAG_MOUNT_UNREACHABLE: &str = "vmz::application::mount_unreachable";

/// Cross-application `<Link application to>` contract (M4).
pub const APPLICATION_CROSS_LINK_SCHEMA: &str = "vmz.application.cross_link.v0";

/// Host composition conformance report (M4).
pub const APPLICATION_HOST_COMPOSITION_SCHEMA: &str = "vmz.application.host_composition.v0";

/// Per-ApplicationId independent dev session row (M5).
pub const APPLICATION_DEV_SESSIONS_SCHEMA: &str = "vmz.application.dev_sessions.v0";

/// Dirty paths → affected ApplicationIds (M5).
pub const APPLICATION_AFFECTED_SCHEMA: &str = "vmz.application.affected.v0";

/// MountTable reverse-proxy dispatch proof (M5).
pub const APPLICATION_PROXY_DISPATCH_SCHEMA: &str = "vmz.application.proxy_dispatch.v0";

/// `vmz test --application` / `--mounted` selection contract (M5).
pub const APPLICATION_MOUNTED_TEST_SCHEMA: &str = "vmz.application.mounted_test.v0";

/// Deployment adapter boundary proof (M5).
pub const APPLICATION_DEPLOY_ADAPTER_SCHEMA: &str = "vmz.application.deploy_adapter.v0";

/// Umbrella Dev/Test/Deploy conformance report (M5).
pub const APPLICATION_DEV_CHECK_SCHEMA: &str = "vmz.application.dev_check.v0";

pub const DIAG_SESSION_SHARED: &str = "vmz::application::session_shared";
pub const DIAG_PROXY_MISROUTE: &str = "vmz::application::proxy_misroute";
pub const DIAG_AFFECTED_LEAK: &str = "vmz::application::affected_leak";

/// Catalog of frozen schema ids (gate / host handshake).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProtocolCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<ApplicationDocumentKind>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDocumentKind {
    pub kind: String,
    pub schema: String,
}

impl ApplicationProtocolCatalog {
    pub fn v0() -> Self {
        Self {
            schema: APPLICATION_PROTOCOL.into(),
            protocol: APPLICATION_PROTOCOL.into(),
            documents: vec![
                ApplicationDocumentKind {
                    kind: "descriptor".into(),
                    schema: APPLICATION_DESCRIPTOR_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "config".into(),
                    schema: APPLICATIONS_CONFIG_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "catalog".into(),
                    schema: APPLICATION_CATALOG_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "check".into(),
                    schema: APPLICATION_CHECK_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "base".into(),
                    schema: APPLICATION_BASE_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "relocation".into(),
                    schema: APPLICATION_RELOCATION_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "relocated".into(),
                    schema: APPLICATION_RELOCATED_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "relocatable".into(),
                    schema: APPLICATION_RELOCATABLE_CHECK_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "artifact".into(),
                    schema: APPLICATION_ARTIFACT_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "mount_table".into(),
                    schema: APPLICATION_MOUNT_TABLE_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "artifact_boundary".into(),
                    schema: APPLICATION_ARTIFACT_BOUNDARY_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "isolation".into(),
                    schema: APPLICATION_ISOLATION_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "isolation_check".into(),
                    schema: APPLICATION_ISOLATION_CHECK_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "cross_link".into(),
                    schema: APPLICATION_CROSS_LINK_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "host_composition".into(),
                    schema: APPLICATION_HOST_COMPOSITION_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "dev_sessions".into(),
                    schema: APPLICATION_DEV_SESSIONS_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "affected".into(),
                    schema: APPLICATION_AFFECTED_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "proxy_dispatch".into(),
                    schema: APPLICATION_PROXY_DISPATCH_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "mounted_test".into(),
                    schema: APPLICATION_MOUNTED_TEST_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "deploy_adapter".into(),
                    schema: APPLICATION_DEPLOY_ADAPTER_SCHEMA.into(),
                },
                ApplicationDocumentKind {
                    kind: "dev_check".into(),
                    schema: APPLICATION_DEV_CHECK_SCHEMA.into(),
                },
            ],
            diagnostics: vec![
                DIAG_DUPLICATE_ID.into(),
                DIAG_UNKNOWN_REFERENCE.into(),
                DIAG_MOUNT_COLLISION.into(),
                DIAG_INVALID_SCHEMA.into(),
                DIAG_INVALID_CONFIG.into(),
                DIAG_INVALID_DESCRIPTOR.into(),
                DIAG_INVALID_ROUTE_BASE.into(),
                DIAG_DUPLICATE_MOUNT.into(),
                DIAG_NON_RELOCATABLE_URL.into(),
                DIAG_INVALID_BASE.into(),
                DIAG_ARTIFACT_INTEGRITY.into(),
                DIAG_CROSS_RUNTIME_REFERENCE.into(),
                DIAG_ISOLATION_UNPROVEN.into(),
                DIAG_FAILURE_CONTAINMENT.into(),
                DIAG_ROUTE_NOT_PUBLIC.into(),
                DIAG_MOUNT_UNREACHABLE.into(),
                DIAG_SESSION_SHARED.into(),
                DIAG_PROXY_MISROUTE.into(),
                DIAG_AFFECTED_LEAK.into(),
            ],
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Explicit ApplicationId — never derived from directory names.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ApplicationId(pub String);

impl ApplicationId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl From<String> for ApplicationId {
    fn from(value: String) -> Self {
        Self(value)
    }
}

impl From<&str> for ApplicationId {
    fn from(value: &str) -> Self {
        Self(value.to_string())
    }
}

/// `package.json#vmz.application` — identity only ("who I am"), not mount location.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDescriptor {
    pub schema: String,
    pub id: ApplicationId,
    /// Stable RouteId of the child entry (not a URL string).
    #[serde(rename = "entryRoute")]
    pub entry_route: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Absolute package root that declared this descriptor (filled by resolver).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "packageRoot")]
    pub package_root: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "packageName")]
    pub package_name: Option<String>,
}

/// Host mount edge: ApplicationId → routeBase (+ optional deploymentRef).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMount {
    pub application: ApplicationId,
    #[serde(rename = "routeBase")]
    pub route_base: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "deploymentRef")]
    pub deployment_ref: Option<String>,
}

/// Collection group — explicit order is the array order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationGroup {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub applications: Vec<ApplicationId>,
}

/// Explicit collection — selection / order / grouping only (⊥ Mount).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCollection {
    pub id: String,
    pub groups: Vec<ApplicationGroup>,
}

/// Host `applications.config.json5` root.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationsConfig {
    pub schema: String,
    #[serde(default)]
    pub collections: Vec<ApplicationCollection>,
    #[serde(default)]
    pub mounts: Vec<ApplicationMount>,
}

/// Catalog entry for host UI queries (no executable modules).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCatalogEntry {
    pub id: ApplicationId,
    #[serde(rename = "entryRoute")]
    pub entry_route: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Collection membership in config array order (not filesystem order).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "routeBase")]
    pub route_base: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCatalog {
    pub schema: String,
    /// Flat list following collection group array order; unlisted mounts omitted.
    pub applications: Vec<ApplicationCatalogEntry>,
    pub collections: Vec<ApplicationCollection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationSourceSpan {
    pub path: String,
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDiagnostic {
    pub code: String,
    pub severity: String,
    pub path: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<ApplicationSourceSpan>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCheckReport {
    pub schema: String,
    pub descriptors: Vec<ApplicationDescriptor>,
    pub collections: Vec<ApplicationCollection>,
    pub mounts: Vec<ApplicationMount>,
    pub catalog: ApplicationCatalog,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationCheckReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Deployment parameter applied after independent `/` compile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationBase {
    pub schema: String,
    /// Normalized mount/deployment base (`/` or `/prefix` without trailing slash).
    pub base: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "applicationId")]
    pub application_id: Option<ApplicationId>,
}

impl ApplicationBase {
    pub fn root() -> Self {
        Self { schema: APPLICATION_BASE_SCHEMA.into(), base: "/".into(), application_id: None }
    }
}

/// One logical URL surface compiled at base `/`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogicalUrlEntry {
    /// Stable id (RouteId / AssetId / CapabilityId / …).
    pub id: String,
    /// Kind of surface this URL feeds.
    pub kind: String,
    /// Logical absolute path as if application base were `/`.
    #[serde(rename = "logicalPath")]
    pub logical_path: String,
}

/// Independent-compile relocation manifest (no host mount prefix baked in).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationRelocationManifest {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Always `/` for the logical compile view.
    #[serde(rename = "logicalBase")]
    pub logical_base: String,
    pub entries: Vec<LogicalUrlEntry>,
}

/// One URL after applying [`ApplicationBase`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelocatedUrlEntry {
    pub id: String,
    pub kind: String,
    #[serde(rename = "logicalPath")]
    pub logical_path: String,
    pub href: String,
}

/// Relocated surfaces for a single ApplicationBase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelocatedApplicationUrls {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    pub base: String,
    pub entries: Vec<RelocatedUrlEntry>,
}

/// M1 relocatable check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationRelocatableReport {
    pub schema: String,
    #[serde(rename = "applicationId", skip_serializing_if = "Option::is_none")]
    pub application_id: Option<ApplicationId>,
    #[serde(rename = "packageRoot")]
    pub package_root: String,
    /// Logical manifest used for `/` and non-root proofs (may be synthetic in checks).
    pub manifest: ApplicationRelocationManifest,
    /// Proof under logical `/`.
    #[serde(rename = "atRoot")]
    pub at_root: RelocatedApplicationUrls,
    /// Proof under a non-root base.
    #[serde(rename = "atRelocated")]
    pub at_relocated: RelocatedApplicationUrls,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationRelocatableReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Content-addressed ref to an owned artifact slice (never inlines the slice).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactRef {
    pub kind: String,
    pub hash: String,
}

/// Independent per-application build artifact (M2).
///
/// Owns Program Graph / Execution Plan / routes / assets by **reference**.
/// Host MountTable must not embed these bodies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationArtifact {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    #[serde(rename = "descriptorHash")]
    pub descriptor_hash: String,
    #[serde(rename = "programGraphRef")]
    pub program_graph_ref: ArtifactRef,
    #[serde(rename = "executionPlanRef")]
    pub execution_plan_ref: ArtifactRef,
    #[serde(rename = "routeManifestRef")]
    pub route_manifest_ref: ArtifactRef,
    #[serde(rename = "assetManifestRef")]
    pub asset_manifest_ref: ArtifactRef,
    #[serde(rename = "serverDeploymentRef")]
    pub server_deployment_ref: ArtifactRef,
    /// Public RouteId contracts this application exposes to cross-app Links.
    #[serde(rename = "publicRouteContracts", default)]
    pub public_route_contracts: Vec<String>,
    /// Content hash over the artifact ownership envelope (refs + contracts).
    pub integrity: String,
    /// Absolute package root that produced this artifact.
    #[serde(rename = "packageRoot", skip_serializing_if = "Option::is_none")]
    pub package_root: Option<String>,
    /// Executable module ownership id — must not appear in foreign artifacts.
    #[serde(rename = "executableModuleId")]
    pub executable_module_id: String,
}

/// One host mount boundary row (refs only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountTableEntry {
    #[serde(rename = "routeBase")]
    pub route_base: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    #[serde(rename = "artifactRef")]
    pub artifact_ref: ArtifactRef,
    #[serde(rename = "publicRouteSummary", default)]
    pub public_route_summary: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
    pub integrity: String,
}

/// Host ApplicationMountTable artifact (M2).
///
/// Forbidden fields (must never appear): programGraph, executionPlan, executable modules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountTable {
    pub schema: String,
    #[serde(rename = "hostApplicationId", skip_serializing_if = "Option::is_none")]
    pub host_application_id: Option<ApplicationId>,
    pub mounts: Vec<ApplicationMountTableEntry>,
    pub integrity: String,
}

/// M2 artifact-boundary ownership report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationArtifactBoundaryReport {
    pub schema: String,
    pub artifacts: Vec<ApplicationArtifact>,
    #[serde(rename = "mountTable")]
    pub mount_table: ApplicationMountTable,
    pub catalog: ApplicationCatalog,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationArtifactBoundaryReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Namespaced isolation surfaces for one ApplicationId (M3).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIsolationNamespace {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    pub runtime: String,
    pub style: String,
    pub state: String,
    pub server: String,
    pub session: String,
    pub storage: String,
    pub trace: String,
    #[serde(rename = "inspectorRegions")]
    pub inspector_regions: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MountUnavailablePolicy {
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    #[serde(rename = "routeBase")]
    pub route_base: String,
    pub status: u16,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailureContainmentProof {
    #[serde(rename = "failedApplicationId")]
    pub failed_application_id: ApplicationId,
    #[serde(rename = "hostSurvives")]
    pub host_survives: bool,
    #[serde(rename = "siblingsSurvive")]
    pub siblings_survive: Vec<ApplicationId>,
    pub unavailable: MountUnavailablePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIsolationCheckReport {
    pub schema: String,
    pub namespaces: Vec<ApplicationIsolationNamespace>,
    #[serde(rename = "failureContainment")]
    pub failure_containment: Vec<FailureContainmentProof>,
    pub surfaces: Vec<String>,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationIsolationCheckReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Declared or scanned cross-application `<Link application to>` (M4).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrossApplicationLink {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Target public RouteId in the child application.
    #[serde(rename = "routeId")]
    pub route_id: String,
    /// Resolved document href under the host mount base (when reachable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "routeBase")]
    pub route_base: Option<String>,
    /// Cross-app Links always perform full document navigation.
    #[serde(rename = "documentNavigation")]
    pub document_navigation: bool,
    /// Source path of the Link (host page / fixture).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// M4 host composition conformance report.
///
/// Catalog is read-only data for ordinary host pages — VMZ does not emit gallery UI.
/// Cross-app Links resolve to real `<a href>` document navigation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationHostCompositionReport {
    pub schema: String,
    /// Consumable ApplicationCatalog (config-array order; no directory scan).
    pub catalog: ApplicationCatalog,
    /// Provenance of catalog order (always `config-array` when valid).
    #[serde(rename = "catalogOrderSource")]
    pub catalog_order_source: String,
    /// Framework product kinds that must never appear as core types.
    #[serde(rename = "forbiddenProductKinds")]
    pub forbidden_product_kinds: Vec<String>,
    /// Resolved cross-application Links from the host.
    #[serde(rename = "crossApplicationLinks")]
    pub cross_application_links: Vec<CrossApplicationLink>,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationHostCompositionReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One independent N-API/dev session keyed by ApplicationId (M5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevSession {
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    #[serde(rename = "packageRoot")]
    pub package_root: String,
    /// Sessions never share Program Graph / runtime — always true when proven.
    pub independent: bool,
    /// `host` | `child`
    pub role: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevSessions {
    pub schema: String,
    pub sessions: Vec<ApplicationDevSession>,
}

/// One dirty → ApplicationId rebuild unit (M5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationAffectedUnit {
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// `child_source` | `descriptor` | `collection_ui` | `mount_config` | `shared_package`
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationAffectedPlan {
    pub schema: String,
    pub dirty: Vec<String>,
    pub units: Vec<ApplicationAffectedUnit>,
    #[serde(rename = "notRebuilt")]
    pub not_rebuilt: Vec<ApplicationId>,
}

/// One reverse-proxy dispatch case (M5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProxyCase {
    pub url: String,
    #[serde(rename = "applicationId", skip_serializing_if = "Option::is_none")]
    pub application_id: Option<ApplicationId>,
    #[serde(rename = "stripBase", skip_serializing_if = "Option::is_none")]
    pub strip_base: Option<String>,
    pub status: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProxyDispatch {
    pub schema: String,
    pub cases: Vec<ApplicationProxyCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationTestModeSelection {
    pub id: String,
    #[serde(rename = "testScope", skip_serializing_if = "Option::is_none")]
    pub test_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contracts: Vec<String>,
    #[serde(rename = "selectedApplicationIds")]
    pub selected_application_ids: Vec<ApplicationId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountedTestSelection {
    pub schema: String,
    pub application: ApplicationTestModeSelection,
    pub mounted: ApplicationTestModeSelection,
    pub affected: ApplicationTestModeSelection,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDeployAdapterProof {
    pub schema: String,
    #[serde(rename = "mountTableRefsOnly")]
    pub mount_table_refs_only: bool,
    pub adapters: Vec<String>,
    #[serde(rename = "perApplicationDeploymentRefs")]
    pub per_application_deployment_refs: bool,
}

/// M5 Dev/Test/Deploy umbrella report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevCheckReport {
    pub schema: String,
    pub sessions: ApplicationDevSessions,
    pub affected: ApplicationAffectedPlan,
    pub proxy: ApplicationProxyDispatch,
    pub tests: ApplicationMountedTestSelection,
    pub deploy: ApplicationDeployAdapterProof,
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationDevCheckReport {
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
