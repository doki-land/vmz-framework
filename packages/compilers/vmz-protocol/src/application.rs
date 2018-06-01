//! Application Collection / Mount contract.
//!
//! Freezes descriptor + host `applications.config.json5` schemas and diagnostic codes.
//! No Mount IR: mounts are application/deployment edges; catalog/mount-table are artifacts.

use serde::{Deserialize, Serialize};

/// Schema id for a child `package.json#vmz.application` descriptor.
pub const APPLICATION_DESCRIPTOR_SCHEMA: &str = "vmz.application.v0";

/// Schema id for the host `applications.config.json5` composition document.
pub const APPLICATIONS_CONFIG_SCHEMA: &str = "vmz.applications.v0";

/// Schema id for the read-only ApplicationCatalog artifact (no executable modules).
pub const APPLICATION_CATALOG_SCHEMA: &str = "vmz.application.catalog.v0";

/// Schema id for the structured `vmz application check` / N-API result.
pub const APPLICATION_CHECK_SCHEMA: &str = "vmz.application.check.v0";

/// Umbrella application-composition protocol id for handshake / catalog.
pub const APPLICATION_PROTOCOL: &str = "vmz.application.protocol.v0";

/// Hard: two packages declare the same explicit ApplicationId.
pub const DIAG_DUPLICATE_ID: &str = "vmz::application::duplicate_id";

/// Hard: collection or mount names an ApplicationId with no resolved descriptor.
pub const DIAG_UNKNOWN_REFERENCE: &str = "vmz::application::unknown_reference";

/// Hard: two mounts claim overlapping or identical `routeBase` prefixes.
pub const DIAG_MOUNT_COLLISION: &str = "vmz::application::mount_collision";

/// Hard: document `schema` field does not match a frozen application schema id.
pub const DIAG_INVALID_SCHEMA: &str = "vmz::application::invalid_schema";

/// Hard: host `applications.config.json5` failed parse or structural validation.
pub const DIAG_INVALID_CONFIG: &str = "vmz::application::invalid_config";

/// Hard: child `package.json#vmz.application` is missing required identity fields.
pub const DIAG_INVALID_DESCRIPTOR: &str = "vmz::application::invalid_descriptor";

/// Hard: mount `routeBase` is empty, not absolute, or otherwise illegal.
pub const DIAG_INVALID_ROUTE_BASE: &str = "vmz::application::invalid_route_base";

/// Hard: the same ApplicationId appears more than once in the mounts list.
pub const DIAG_DUPLICATE_MOUNT: &str = "vmz::application::duplicate_mount";

/// Hard: source or manifest embeds a host mount prefix that cannot relocate.
pub const DIAG_NON_RELOCATABLE_URL: &str = "vmz::application::non_relocatable_url";

/// Hard: deployment [`ApplicationBase`] failed normalization or join rules.
pub const DIAG_INVALID_BASE: &str = "vmz::application::invalid_base";

/// Hard: artifact or MountTable integrity hash does not match owned refs.
pub const DIAG_ARTIFACT_INTEGRITY: &str = "vmz::application::artifact_integrity";

/// Hard: executable module / graph / plan ownership crosses ApplicationId boundaries.
pub const DIAG_CROSS_RUNTIME_REFERENCE: &str = "vmz::application::cross_runtime_reference";

/// Schema id for a deployment-time application base (never baked into child compile).
pub const APPLICATION_BASE_SCHEMA: &str = "vmz.application.base.v0";

/// Schema id for logical URL surfaces compiled as if base were `/`.
pub const APPLICATION_RELOCATION_SCHEMA: &str = "vmz.application.relocation.v0";

/// Schema id for relocated URL surfaces after applying [`ApplicationBase`].
pub const APPLICATION_RELOCATED_SCHEMA: &str = "vmz.application.relocated.v0";

/// Schema id for relocatable source / manifest check reports.
pub const APPLICATION_RELOCATABLE_CHECK_SCHEMA: &str = "vmz.application.relocatable.v0";

/// Schema id for an independent application build artifact (refs only, no sibling graphs).
pub const APPLICATION_ARTIFACT_SCHEMA: &str = "vmz.application.artifact.v0";

/// Schema id for the host MountTable artifact (refs only; never embeds child graphs/plans).
pub const APPLICATION_MOUNT_TABLE_SCHEMA: &str = "vmz.application.mount_table.v0";

/// Schema id for artifact-boundary ownership check reports.
pub const APPLICATION_ARTIFACT_BOUNDARY_SCHEMA: &str = "vmz.application.artifact_boundary.v0";

/// Schema id for a per-application isolation namespace proof.
pub const APPLICATION_ISOLATION_SCHEMA: &str = "vmz.application.isolation.v0";

/// Schema id for host+children isolation conformance reports.
pub const APPLICATION_ISOLATION_CHECK_SCHEMA: &str = "vmz.application.isolation_check.v0";

/// Hard: isolation namespaces are missing, colliding, or not proven for an ApplicationId.
pub const DIAG_ISOLATION_UNPROVEN: &str = "vmz::application::isolation_unproven";

/// Hard: a failed child mount would take down the host or surviving siblings.
pub const DIAG_FAILURE_CONTAINMENT: &str = "vmz::application::failure_containment";

/// Hard: cross-app Link targets a RouteId outside the child's public route contracts.
pub const DIAG_ROUTE_NOT_PUBLIC: &str = "vmz::application::route_not_public";

/// Hard: cross-app Link cannot resolve because the target application is not mounted.
pub const DIAG_MOUNT_UNREACHABLE: &str = "vmz::application::mount_unreachable";

/// Schema id for cross-application `<Link application to>` contracts.
pub const APPLICATION_CROSS_LINK_SCHEMA: &str = "vmz.application.cross_link.v0";

/// Schema id for host composition conformance reports.
pub const APPLICATION_HOST_COMPOSITION_SCHEMA: &str = "vmz.application.host_composition.v0";

/// Schema id for per-ApplicationId independent dev session tables.
pub const APPLICATION_DEV_SESSIONS_SCHEMA: &str = "vmz.application.dev_sessions.v0";

/// Schema id for dirty-path to affected-ApplicationId rebuild plans.
pub const APPLICATION_AFFECTED_SCHEMA: &str = "vmz.application.affected.v0";

/// Schema id for MountTable reverse-proxy dispatch proofs.
pub const APPLICATION_PROXY_DISPATCH_SCHEMA: &str = "vmz.application.proxy_dispatch.v0";

/// Schema id for `vmz test --application` / `--mounted` selection contracts.
pub const APPLICATION_MOUNTED_TEST_SCHEMA: &str = "vmz.application.mounted_test.v0";

/// Schema id for deployment adapter boundary proofs.
pub const APPLICATION_DEPLOY_ADAPTER_SCHEMA: &str = "vmz.application.deploy_adapter.v0";

/// Schema id for the umbrella Dev/Test/Deploy conformance report.
pub const APPLICATION_DEV_CHECK_SCHEMA: &str = "vmz.application.dev_check.v0";

/// Hard: two ApplicationIds share one N-API/dev session or Program Graph/runtime.
pub const DIAG_SESSION_SHARED: &str = "vmz::application::session_shared";

/// Hard: reverse-proxy case routes to the wrong ApplicationId or fails stripBase.
pub const DIAG_PROXY_MISROUTE: &str = "vmz::application::proxy_misroute";

/// Hard: dirty-path rebuild plan rebuilds an ApplicationId outside the affected set.
pub const DIAG_AFFECTED_LEAK: &str = "vmz::application::affected_leak";

/// Handshake catalog of frozen application-composition schemas and diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProtocolCatalog {
    /// Always [`APPLICATION_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<ApplicationDocumentKind>,
    /// Stable diagnostic codes callers may see.
    pub diagnostics: Vec<String>,
}

/// One document kind entry inside [`ApplicationProtocolCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDocumentKind {
    /// Kind id (`descriptor`, `config`, `mount_table`, `isolation`, ...).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

impl ApplicationProtocolCatalog {
    /// Frozen catalog for the current application protocol generation.
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

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Explicit ApplicationId - never derived from directory names.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ApplicationId(
    /// Stable id string (letters, digits, `-`, `_`, `.`).
    pub String,
);

impl ApplicationId {
    /// Borrow the stable id string.
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

/// Child identity from `package.json#vmz.application` ("who I am"), not mount location.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDescriptor {
    /// Always [`APPLICATION_DESCRIPTOR_SCHEMA`].
    pub schema: String,
    /// Stable explicit ApplicationId for this package.
    pub id: ApplicationId,
    /// Stable RouteId of the child entry (not a URL string).
    #[serde(rename = "entryRoute")]
    pub entry_route: String,
    /// Optional human title for catalog / host UI.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Optional one-line summary for catalog consumers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Free-form tags for host filtering (not mount keys).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Absolute package root that declared this descriptor (filled by resolver).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "packageRoot")]
    pub package_root: Option<String>,
    /// npm `package.json` name when known (informational only).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "packageName")]
    pub package_name: Option<String>,
}

/// Host mount edge: ApplicationId -> routeBase (+ optional deploymentRef).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMount {
    /// Child ApplicationId this edge mounts.
    pub application: ApplicationId,
    /// Absolute URL prefix under the host where the child is reachable.
    #[serde(rename = "routeBase")]
    pub route_base: String,
    /// Optional deployment identity when the child ships as a separate unit.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "deploymentRef")]
    pub deployment_ref: Option<String>,
}

/// Named group inside a collection; array order is the author-visible order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationGroup {
    /// Stable group id within the parent collection.
    pub id: String,
    /// Optional display title for host navigation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Member ApplicationIds in explicit array order.
    pub applications: Vec<ApplicationId>,
}

/// Explicit collection: selection / order / grouping only (orthogonal to Mount).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCollection {
    /// Stable collection id used by catalog membership.
    pub id: String,
    /// Ordered groups that define catalog presentation.
    pub groups: Vec<ApplicationGroup>,
}

/// Host `applications.config.json5` root: collections plus mount edges.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationsConfig {
    /// Always [`APPLICATIONS_CONFIG_SCHEMA`].
    pub schema: String,
    /// Author collections (order/grouping); may be empty.
    #[serde(default)]
    pub collections: Vec<ApplicationCollection>,
    /// Host mount edges; routeBase uniqueness is validated separately.
    #[serde(default)]
    pub mounts: Vec<ApplicationMount>,
}

/// One catalog row for host UI queries (no executable modules).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCatalogEntry {
    /// ApplicationId this row describes.
    pub id: ApplicationId,
    /// Child entry RouteId copied from the descriptor.
    #[serde(rename = "entryRoute")]
    pub entry_route: String,
    /// Optional title from the descriptor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Optional summary from the descriptor.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    /// Tags copied from the descriptor.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    /// Collection membership in config array order (not filesystem order).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub collections: Vec<String>,
    /// Mounted routeBase when this ApplicationId appears in mounts.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "routeBase")]
    pub route_base: Option<String>,
}

/// Read-only ApplicationCatalog artifact for host pages.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCatalog {
    /// Always [`APPLICATION_CATALOG_SCHEMA`].
    pub schema: String,
    /// Flat list following collection group array order; unlisted mounts omitted.
    pub applications: Vec<ApplicationCatalogEntry>,
    /// Collections echoed for host consumers that need grouping structure.
    pub collections: Vec<ApplicationCollection>,
}

/// Source span for an application diagnostic (byte offsets in `path`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationSourceSpan {
    /// Absolute or workspace-relative path of the offending source.
    pub path: String,
    /// Inclusive start byte offset.
    pub start: u32,
    /// Exclusive end byte offset.
    pub end: u32,
}

/// One diagnostic emitted by application composition / isolation / reloc checks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDiagnostic {
    /// Stable `vmz::application::*` code.
    pub code: String,
    /// `error` for hard failures; other severities reserved for tooling.
    pub severity: String,
    /// Path most relevant to the finding.
    pub path: String,
    /// Human-readable explanation.
    pub message: String,
    /// Optional byte span when the finding maps to a source file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub span: Option<ApplicationSourceSpan>,
}

/// Aggregate result of `vmz application check` / N-API composition validation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationCheckReport {
    /// Always [`APPLICATION_CHECK_SCHEMA`].
    pub schema: String,
    /// Resolved child descriptors under the host.
    pub descriptors: Vec<ApplicationDescriptor>,
    /// Collections taken from host config.
    pub collections: Vec<ApplicationCollection>,
    /// Mount edges taken from host config.
    pub mounts: Vec<ApplicationMount>,
    /// Derived read-only catalog for host consumers.
    pub catalog: ApplicationCatalog,
    /// Hard findings that block a clean composition.
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationCheckReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Deployment parameter applied after independent `/` compile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationBase {
    /// Always [`APPLICATION_BASE_SCHEMA`].
    pub schema: String,
    /// Normalized mount/deployment base (`/` or `/prefix` without trailing slash).
    pub base: String,
    /// Optional ApplicationId this base relocates (host may omit for shared proofs).
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "applicationId")]
    pub application_id: Option<ApplicationId>,
}

impl ApplicationBase {
    /// Logical root base (`/`) with no ApplicationId binding.
    pub fn root() -> Self {
        Self { schema: APPLICATION_BASE_SCHEMA.into(), base: "/".into(), application_id: None }
    }
}

/// One logical URL surface compiled at base `/`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LogicalUrlEntry {
    /// Stable id (RouteId / AssetId / CapabilityId / ...).
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
    /// Always [`APPLICATION_RELOCATION_SCHEMA`].
    pub schema: String,
    /// ApplicationId whose logical surfaces are listed.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Always `/` for the logical compile view.
    #[serde(rename = "logicalBase")]
    pub logical_base: String,
    /// Logical URL surfaces owned by this application.
    pub entries: Vec<LogicalUrlEntry>,
}

/// One URL after applying [`ApplicationBase`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelocatedUrlEntry {
    /// Same stable id as the logical entry.
    pub id: String,
    /// Same kind as the logical entry.
    pub kind: String,
    /// Original logical path under `/`.
    #[serde(rename = "logicalPath")]
    pub logical_path: String,
    /// Public href after joining with the deployment base.
    pub href: String,
}

/// Relocated surfaces for a single ApplicationBase.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RelocatedApplicationUrls {
    /// Always [`APPLICATION_RELOCATED_SCHEMA`].
    pub schema: String,
    /// ApplicationId these hrefs belong to.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Deployment base used for the join.
    pub base: String,
    /// Relocated entries (id/kind preserved; href rewritten).
    pub entries: Vec<RelocatedUrlEntry>,
}

/// Relocatable check report: prove `/` and a non-root base both round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationRelocatableReport {
    /// Always [`APPLICATION_RELOCATABLE_CHECK_SCHEMA`].
    pub schema: String,
    /// ApplicationId under test when known.
    #[serde(rename = "applicationId", skip_serializing_if = "Option::is_none")]
    pub application_id: Option<ApplicationId>,
    /// Absolute package root scanned for relocatable sources.
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
    /// Hard findings (non-relocatable URLs, invalid bases, ...).
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationRelocatableReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Content-addressed ref to an owned artifact slice (never inlines the slice).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtifactRef {
    /// Slice kind (`programGraph`, `executionPlan`, `routeManifest`, ...).
    pub kind: String,
    /// Content hash of the referenced slice.
    pub hash: String,
}

/// Independent per-application build artifact.
///
/// Owns Program Graph / Execution Plan / routes / assets by **reference**.
/// Host MountTable must not embed these bodies.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationArtifact {
    /// Always [`APPLICATION_ARTIFACT_SCHEMA`].
    pub schema: String,
    /// ApplicationId that owns this artifact envelope.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Hash of the resolved descriptor used to produce this artifact.
    #[serde(rename = "descriptorHash")]
    pub descriptor_hash: String,
    /// Ref to the owned Program Graph slice.
    #[serde(rename = "programGraphRef")]
    pub program_graph_ref: ArtifactRef,
    /// Ref to the owned Execution Plan slice.
    #[serde(rename = "executionPlanRef")]
    pub execution_plan_ref: ArtifactRef,
    /// Ref to the owned route manifest slice.
    #[serde(rename = "routeManifestRef")]
    pub route_manifest_ref: ArtifactRef,
    /// Ref to the owned asset manifest slice.
    #[serde(rename = "assetManifestRef")]
    pub asset_manifest_ref: ArtifactRef,
    /// Ref to the owned server deployment slice.
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
    /// Executable module ownership id - must not appear in foreign artifacts.
    #[serde(rename = "executableModuleId")]
    pub executable_module_id: String,
}

/// One host mount boundary row (refs only).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountTableEntry {
    /// Absolute host routeBase for this mount.
    #[serde(rename = "routeBase")]
    pub route_base: String,
    /// Mounted ApplicationId.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Content-addressed ref to the child ApplicationArtifact.
    #[serde(rename = "artifactRef")]
    pub artifact_ref: ArtifactRef,
    /// Summary of public RouteIds advertised at this mount.
    #[serde(rename = "publicRouteSummary", default)]
    pub public_route_summary: Vec<String>,
    /// Optional health probe label for deploy adapters.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    /// Optional fallback policy label when the mount is unavailable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<String>,
    /// Integrity hash over this mount row envelope.
    pub integrity: String,
}

/// Host ApplicationMountTable artifact.
///
/// Forbidden fields (must never appear): programGraph, executionPlan, executable modules.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountTable {
    /// Always [`APPLICATION_MOUNT_TABLE_SCHEMA`].
    pub schema: String,
    /// Optional host ApplicationId that owns this table.
    #[serde(rename = "hostApplicationId", skip_serializing_if = "Option::is_none")]
    pub host_application_id: Option<ApplicationId>,
    /// Mount rows in host config order.
    pub mounts: Vec<ApplicationMountTableEntry>,
    /// Integrity hash over the full table envelope.
    pub integrity: String,
}

/// Artifact-boundary ownership report for host + children.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationArtifactBoundaryReport {
    /// Always [`APPLICATION_ARTIFACT_BOUNDARY_SCHEMA`].
    pub schema: String,
    /// Independent child artifacts under check.
    pub artifacts: Vec<ApplicationArtifact>,
    /// Host MountTable that must remain refs-only.
    #[serde(rename = "mountTable")]
    pub mount_table: ApplicationMountTable,
    /// Read-only catalog used by host composition (must not embed executables).
    pub catalog: ApplicationCatalog,
    /// Hard findings (integrity / cross-runtime ownership).
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationArtifactBoundaryReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Namespaced isolation surfaces for one ApplicationId.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIsolationNamespace {
    /// Always [`APPLICATION_ISOLATION_SCHEMA`].
    pub schema: String,
    /// ApplicationId these namespaces isolate.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Runtime namespace key (must be unique across mounted apps).
    pub runtime: String,
    /// Style / CSS isolation key.
    pub style: String,
    /// Client state namespace key.
    pub state: String,
    /// Server / capability namespace key.
    pub server: String,
    /// Session namespace key (must not be shared across ApplicationIds).
    pub session: String,
    /// Storage namespace key.
    pub storage: String,
    /// Trace / observability namespace key.
    pub trace: String,
    /// Inspector region namespace key.
    #[serde(rename = "inspectorRegions")]
    pub inspector_regions: String,
}

/// Policy applied when a mounted application is unavailable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MountUnavailablePolicy {
    /// Failed or unavailable ApplicationId.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// routeBase that becomes unavailable.
    #[serde(rename = "routeBase")]
    pub route_base: String,
    /// HTTP-style status the host should surface for that mount.
    pub status: u16,
    /// Machine-readable reason for the unavailable state.
    pub reason: String,
}

/// Proof that one child's failure does not take down host or siblings.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct FailureContainmentProof {
    /// ApplicationId whose failure is simulated.
    #[serde(rename = "failedApplicationId")]
    pub failed_application_id: ApplicationId,
    /// Host process / document must remain alive.
    #[serde(rename = "hostSurvives")]
    pub host_survives: bool,
    /// Sibling ApplicationIds that must keep serving.
    #[serde(rename = "siblingsSurvive")]
    pub siblings_survive: Vec<ApplicationId>,
    /// Unavailable policy applied to the failed mount only.
    pub unavailable: MountUnavailablePolicy,
}

/// Host+children isolation conformance report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIsolationCheckReport {
    /// Always [`APPLICATION_ISOLATION_CHECK_SCHEMA`].
    pub schema: String,
    /// Proven namespaces per ApplicationId.
    pub namespaces: Vec<ApplicationIsolationNamespace>,
    /// Failure-containment proofs for each mounted child.
    #[serde(rename = "failureContainment")]
    pub failure_containment: Vec<FailureContainmentProof>,
    /// Isolation surface names covered by this check.
    pub surfaces: Vec<String>,
    /// Hard findings (unproven namespaces / containment failures).
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationIsolationCheckReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Declared or scanned cross-application `<Link application to>`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrossApplicationLink {
    /// Always [`APPLICATION_CROSS_LINK_SCHEMA`].
    pub schema: String,
    /// Target ApplicationId named by the Link.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Target public RouteId in the child application.
    #[serde(rename = "routeId")]
    pub route_id: String,
    /// Resolved document href under the host mount base (when reachable).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub href: Option<String>,
    /// Mount routeBase used for href join when known.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "routeBase")]
    pub route_base: Option<String>,
    /// Cross-app Links always perform full document navigation.
    #[serde(rename = "documentNavigation")]
    pub document_navigation: bool,
    /// Source path of the Link (host page / fixture).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// Host composition conformance report.
///
/// Catalog is read-only data for ordinary host pages - VMZ does not emit gallery UI.
/// Cross-app Links resolve to real `<a href>` document navigation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationHostCompositionReport {
    /// Always [`APPLICATION_HOST_COMPOSITION_SCHEMA`].
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
    /// Hard findings (unknown ApplicationId / non-public route / unreachable mount).
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationHostCompositionReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One independent N-API/dev session keyed by ApplicationId.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevSession {
    /// ApplicationId that owns this session.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// Absolute package root bound to the session.
    #[serde(rename = "packageRoot")]
    pub package_root: String,
    /// Sessions never share Program Graph / runtime - always true when proven.
    pub independent: bool,
    /// `host` | `child`
    pub role: String,
}

/// Table of independent dev sessions (one row per ApplicationId).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevSessions {
    /// Always [`APPLICATION_DEV_SESSIONS_SCHEMA`].
    pub schema: String,
    /// Session rows; sharing a session across ids is a hard failure.
    pub sessions: Vec<ApplicationDevSession>,
}

/// One dirty-path to ApplicationId rebuild unit.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationAffectedUnit {
    /// ApplicationId that must rebuild for the dirty set.
    #[serde(rename = "applicationId")]
    pub application_id: ApplicationId,
    /// `child_source` | `descriptor` | `collection_ui` | `mount_config` | `shared_package`
    pub reason: String,
}

/// Dirty paths mapped to the minimal set of ApplicationIds that must rebuild.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationAffectedPlan {
    /// Always [`APPLICATION_AFFECTED_SCHEMA`].
    pub schema: String,
    /// Absolute dirty paths that triggered the plan.
    pub dirty: Vec<String>,
    /// Rebuild units for affected ApplicationIds only.
    pub units: Vec<ApplicationAffectedUnit>,
    /// ApplicationIds proven unaffected (must not rebuild).
    #[serde(rename = "notRebuilt")]
    pub not_rebuilt: Vec<ApplicationId>,
}

/// One reverse-proxy dispatch case against the MountTable.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProxyCase {
    /// Incoming public URL under the host.
    pub url: String,
    /// ApplicationId selected by longest routeBase match (if any).
    #[serde(rename = "applicationId", skip_serializing_if = "Option::is_none")]
    pub application_id: Option<ApplicationId>,
    /// Prefix stripped before forwarding into the child.
    #[serde(rename = "stripBase", skip_serializing_if = "Option::is_none")]
    pub strip_base: Option<String>,
    /// Expected dispatch status (200 for hit, 404 for miss, ...).
    pub status: u16,
    /// Optional machine reason when status is not a clean hit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// MountTable reverse-proxy dispatch proof document.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationProxyDispatch {
    /// Always [`APPLICATION_PROXY_DISPATCH_SCHEMA`].
    pub schema: String,
    /// Ordered dispatch cases for adapters / checks.
    pub cases: Vec<ApplicationProxyCase>,
}

/// One `vmz test` selection mode and the ApplicationIds it selects.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationTestModeSelection {
    /// Mode id (`application`, `mounted`, `affected`, ...).
    pub id: String,
    /// Optional test scope label for the mode.
    #[serde(rename = "testScope", skip_serializing_if = "Option::is_none")]
    pub test_scope: Option<String>,
    /// Contract names exercised under this selection.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contracts: Vec<String>,
    /// ApplicationIds selected by this mode.
    #[serde(rename = "selectedApplicationIds")]
    pub selected_application_ids: Vec<ApplicationId>,
}

/// Combined `--application` / `--mounted` / affected test selection contract.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationMountedTestSelection {
    /// Always [`APPLICATION_MOUNTED_TEST_SCHEMA`].
    pub schema: String,
    /// Selection for a single ApplicationId package.
    pub application: ApplicationTestModeSelection,
    /// Selection for host-mounted composition tests.
    pub mounted: ApplicationTestModeSelection,
    /// Selection narrowed to dirty-path affected ApplicationIds.
    pub affected: ApplicationTestModeSelection,
}

/// Proof that deploy adapters consume MountTable refs only (no embedded child bodies).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDeployAdapterProof {
    /// Always [`APPLICATION_DEPLOY_ADAPTER_SCHEMA`].
    pub schema: String,
    /// True when every MountTable entry is refs-only.
    #[serde(rename = "mountTableRefsOnly")]
    pub mount_table_refs_only: bool,
    /// Adapter ids that consumed the MountTable in this proof.
    pub adapters: Vec<String>,
    /// True when each ApplicationId keeps its own deployment ref.
    #[serde(rename = "perApplicationDeploymentRefs")]
    pub per_application_deployment_refs: bool,
}

/// Dev/Test/Deploy umbrella report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationDevCheckReport {
    /// Always [`APPLICATION_DEV_CHECK_SCHEMA`].
    pub schema: String,
    /// Independent per-ApplicationId dev sessions.
    pub sessions: ApplicationDevSessions,
    /// Dirty-path affected rebuild plan.
    pub affected: ApplicationAffectedPlan,
    /// Reverse-proxy dispatch proof.
    pub proxy: ApplicationProxyDispatch,
    /// Mounted / application / affected test selection.
    pub tests: ApplicationMountedTestSelection,
    /// Deploy adapter boundary proof.
    pub deploy: ApplicationDeployAdapterProof,
    /// Hard findings (shared sessions / misroutes / affected leaks).
    pub diagnostics: Vec<ApplicationDiagnostic>,
}

impl ApplicationDevCheckReport {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.severity == "error")
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
