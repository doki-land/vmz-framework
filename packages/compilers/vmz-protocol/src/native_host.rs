//! NativeAppHost / WebView deployment contracts.
//!
//! Freezes WebViewDeploymentProfile, NativeCapability, bridge protocol,
//! application identity, and security/version fields.
//! WebView reuses Browser lowering - no new View IR / no arbitrary JS bridge.

use serde::{Deserialize, Serialize};

/// Umbrella native-host protocol id for handshake / catalog.
pub const NATIVE_HOST_PROTOCOL: &str = "vmz.native_host.protocol.v0";

/// Schema id for WebViewDeploymentProfile (WebSurface delivery inside NativeAppHost).
pub const WEBVIEW_DEPLOYMENT_SCHEMA: &str = "vmz.native_host.webview_deployment.v0";
/// Schema id for a versioned NativeCapability declaration.
pub const NATIVE_CAPABILITY_SCHEMA: &str = "vmz.native_host.capability.v0";
/// Schema id for the typed WebSurface <-> NativeAppHost bridge manifest.
pub const BRIDGE_PROTOCOL_SCHEMA: &str = "vmz.native_host.bridge.v0";
/// Schema id for ApplicationIdentity (package id / origin / version).
pub const APPLICATION_IDENTITY_SCHEMA: &str = "vmz.native_host.application_identity.v0";
/// Schema id for the umbrella native-host check report.
pub const NATIVE_HOST_CHECK_SCHEMA: &str = "vmz.native_host.check.v0";

/// Schema id for the minimal WebView shell + local bundled entry contract.
pub const SHELL_SCHEMA: &str = "vmz.native_host.shell.v0";
/// Schema id for shell-contract check reports.
pub const SHELL_CHECK_SCHEMA: &str = "vmz.native_host.shell_check.v0";
/// Schema id for deep-link / universal-link map entries.
pub const DEEP_LINK_SCHEMA: &str = "vmz.native_host.deep_link.v0";
/// Schema id for local-bundled WebSurface entry artifacts.
pub const LOCAL_BUNDLE_SCHEMA: &str = "vmz.native_host.local_bundle.v0";

/// Schema id for a typed capability call envelope (nonce / permission / cancel / trace).
pub const CAPABILITY_CALL_SCHEMA: &str = "vmz.native_host.capability_call.v0";
/// Schema id for bridge call trace context (correlation + redaction).
pub const BRIDGE_TRACE_SCHEMA: &str = "vmz.native_host.bridge_trace.v0";
/// Schema id for the first-batch NativeBacked stub catalog + allowlist.
pub const BRIDGE_STUB_CATALOG_SCHEMA: &str = "vmz.native_host.bridge_stub_catalog.v0";
/// Schema id for bridge-contract check reports.
pub const BRIDGE_CHECK_SCHEMA: &str = "vmz.native_host.bridge_check.v0";

/// Schema id for NativeAppHost lifecycle policy (events + hard restore rules).
pub const LIFECYCLE_SCHEMA: &str = "vmz.native_host.lifecycle.v0";
/// Schema id for crash/restore persistence policy (not JS heap).
pub const PERSISTENCE_SCHEMA: &str = "vmz.native_host.persistence.v0";
/// Schema id for update / rollback channel policy.
pub const UPDATE_POLICY_SCHEMA: &str = "vmz.native_host.update_policy.v0";
/// Schema id for offline resource policy for local/hybrid delivery.
pub const OFFLINE_POLICY_SCHEMA: &str = "vmz.native_host.offline_policy.v0";
/// Schema id for lifecycle-contract check reports.
pub const LIFECYCLE_CHECK_SCHEMA: &str = "vmz.native_host.lifecycle_check.v0";

/// Schema id for the NativeAppHost full-stack profile umbrella.
pub const FULLSTACK_SCHEMA: &str = "vmz.native_host.fullstack.v0";
/// Schema id for SSR first-paint policy inside the WebView host.
pub const SSR_FIRST_PAINT_SCHEMA: &str = "vmz.native_host.ssr_first_paint.v0";
/// Schema id for `#server` transport binding (bridge must not bypass).
pub const SERVER_TRANSPORT_SCHEMA: &str = "vmz.native_host.server_transport.v0";
/// Schema id for auth / session isolation for the WebView host.
pub const AUTH_SESSION_SCHEMA: &str = "vmz.native_host.auth_session.v0";
/// Schema id for push capability declaration (stub allowed).
pub const PUSH_POLICY_SCHEMA: &str = "vmz.native_host.push_policy.v0";
/// Schema id for NativeAppHost network / cleartext policy.
pub const NETWORK_POLICY_SCHEMA: &str = "vmz.native_host.network_policy.v0";
/// Schema id for full-stack contract check reports.
pub const FULLSTACK_CHECK_SCHEMA: &str = "vmz.native_host.fullstack_check.v0";

/// Schema id for NativeSurfaceManifest (local surface driver ownership / lifetime).
pub const NATIVE_SURFACE_SCHEMA: &str = "vmz.native_host.native_surface.v0";
/// Schema id for NativeSurfaceId identity documents.
pub const NATIVE_SURFACE_ID_SCHEMA: &str = "vmz.native_host.native_surface_id.v0";
/// Schema id for WebSurface <-> NativeSurface cross-boundary data contract.
pub const NATIVE_SURFACE_BOUNDARY_SCHEMA: &str = "vmz.native_host.native_surface_boundary.v0";
/// Schema id for native-surface check reports.
pub const NATIVE_SURFACE_CHECK_SCHEMA: &str = "vmz.native_host.native_surface_check.v0";

/// Hard: NativeSurfaceManifest omits a stable `surfaceId`.
pub const DIAG_MISSING_SURFACE_ID: &str = "vmz::native_host::missing_surface_id";
/// Hard: NativeSurface has no owning region id for dispose / lifetime binding.
pub const DIAG_MISSING_OWNER_REGION: &str = "vmz::native_host::missing_owner_region";
/// Hard: NativeSurface omits an explicit lifetime (e.g. `bound_to_region`).
pub const DIAG_MISSING_SURFACE_LIFETIME: &str = "vmz::native_host::missing_surface_lifetime";
/// Hard: surface shares implicit WebView / JS state across the boundary.
pub const DIAG_IMPLICIT_STATE_SHARE: &str = "vmz::native_host::implicit_state_share";
/// Hard: preview / map / video surface is confused with a NativeBacked capability.
pub const DIAG_SURFACE_IS_CAPABILITY: &str = "vmz::native_host::surface_is_capability";
/// Hard: NativeSurface claims to be a semantic truth source (VPG/Plan must remain sole IR).
pub const DIAG_SURFACE_IS_SEMANTIC_TRUTH: &str = "vmz::native_host::surface_is_semantic_truth";

/// First high-value NativeSurface kind names (`camera` / `map` / `video`).
pub const HIGH_VALUE_SURFACE_KINDS: &[&str] = &["camera", "map", "video"];

/// Schema id for multi-platform Host Profile freeze (shared schemas across adapters).
pub const MULTI_PLATFORM_SCHEMA: &str = "vmz.native_host.multi_platform.v0";
/// Schema id for shared Host Profile schema pointers identical for every adapter.
pub const MULTI_PLATFORM_SHARED_SCHEMA: &str = "vmz.native_host.multi_platform_shared.v0";
/// Schema id for platform packaging adapter (packaging stub only).
pub const MULTI_PLATFORM_ADAPTER_SCHEMA: &str = "vmz.native_host.multi_platform_adapter.v0";
/// Schema id for multi-platform shared test-contract documents.
pub const MULTI_PLATFORM_TEST_SCHEMA: &str = "vmz.native_host.multi_platform_test.v0";
/// Schema id for multi-platform check reports.
pub const MULTI_PLATFORM_CHECK_SCHEMA: &str = "vmz.native_host.multi_platform_check.v0";

/// Hard: required platform lacks a packaging adapter entry.
pub const DIAG_MISSING_PLATFORM_ADAPTER: &str = "vmz::native_host::missing_platform_adapter";
/// Hard: adapter invents a platform-private Host Profile schema fork.
pub const DIAG_PLATFORM_PRIVATE_SCHEMA: &str = "vmz::native_host::platform_private_schema";
/// Hard: packaging adapter claims to be a second semantic core.
pub const DIAG_ADAPTER_IS_SEMANTIC_CORE: &str = "vmz::native_host::adapter_is_semantic_core";

/// Platforms that must share one bridge / surface / deployment / test contract.
pub const REQUIRED_MULTI_PLATFORMS: &[&str] = &["ios", "android"];

/// Adapter `kind` value for packaging stubs (not real Xcode/Gradle projects).
pub const MULTI_PLATFORM_ADAPTER_KIND: &str = "packaging_stub";

/// Hard: full-stack profile omits SSR first-paint policy.
pub const DIAG_MISSING_SSR_FIRST_PAINT: &str = "vmz::native_host::missing_ssr_first_paint";
/// Hard: full-stack profile omits `#server` transport binding.
pub const DIAG_MISSING_SERVER_TRANSPORT: &str = "vmz::native_host::missing_server_transport";
/// Hard: native bridge is allowed to bypass `#server` transport.
pub const DIAG_BRIDGE_BYPASSES_SERVER: &str = "vmz::native_host::bridge_bypasses_server";
/// Hard: full-stack profile omits auth / session isolation policy.
pub const DIAG_MISSING_AUTH_SESSION: &str = "vmz::native_host::missing_auth_session";
/// Hard: full-stack profile omits network / cleartext policy.
pub const DIAG_MISSING_NETWORK_POLICY: &str = "vmz::native_host::missing_network_policy";
/// Hard: remote/hybrid delivery or SSR lacks integrity evidence.
pub const DIAG_REMOTE_WITHOUT_INTEGRITY: &str = "vmz::native_host::remote_without_integrity";
/// Hard: bundled and remote SSR share cookie / origin assumptions.
pub const DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS: &str =
    "vmz::native_host::mixed_ssr_cookie_assumptions";

/// Hard: lifecycle policy is missing a required event name.
pub const DIAG_MISSING_LIFECYCLE_EVENT: &str = "vmz::native_host::missing_lifecycle_event";
/// Hard: lifecycle treats background as destroy (must stay distinct).
pub const DIAG_BACKGROUND_IS_DESTROY: &str = "vmz::native_host::background_is_destroy";
/// Hard: crash restore assumes surviving JS heap / in-memory WebView state.
pub const DIAG_CRASH_ASSUMES_JS_HEAP: &str = "vmz::native_host::crash_assumes_js_heap";
/// Hard: lifecycle omits an explicit persistence policy.
pub const DIAG_MISSING_PERSISTENCE: &str = "vmz::native_host::missing_persistence";
/// Hard: lifecycle omits update / rollback channel policy.
pub const DIAG_MISSING_UPDATE_POLICY: &str = "vmz::native_host::missing_update_policy";
/// Hard: lifecycle omits offline resource policy.
pub const DIAG_MISSING_OFFLINE_POLICY: &str = "vmz::native_host::missing_offline_policy";

/// Required NativeAppHost lifecycle event names (launch through destroy).
pub const REQUIRED_LIFECYCLE_EVENTS: &[&str] = &[
    "launch",
    "create",
    "load",
    "ready",
    "background",
    "foreground",
    "crash",
    "restore",
    "destroy",
];

/// Hard: capability call envelope is missing a nonce.
pub const DIAG_MISSING_NONCE: &str = "vmz::native_host::missing_nonce";
/// Hard: capability call envelope is missing a verified origin.
pub const DIAG_MISSING_ORIGIN: &str = "vmz::native_host::missing_origin";
/// Hard: capability call omits required permission declarations.
pub const DIAG_MISSING_PERMISSION: &str = "vmz::native_host::missing_permission";
/// Hard: async capability call omits cancellation support.
pub const DIAG_MISSING_CANCEL: &str = "vmz::native_host::missing_cancel";
/// Hard: capability call omits trace / correlation context.
pub const DIAG_MISSING_TRACE: &str = "vmz::native_host::missing_trace";
/// Hard: capability call omits a timeout bound.
pub const DIAG_MISSING_TIMEOUT: &str = "vmz::native_host::missing_timeout";
/// Hard: call targets a stub id outside the published catalog.
pub const DIAG_UNKNOWN_STUB: &str = "vmz::native_host::unknown_stub";
/// Hard: call targets a capability id not on the bridge allowlist.
pub const DIAG_CALL_NOT_ALLOWLISTED: &str = "vmz::native_host::call_not_allowlisted";

/// First-batch NativeBacked stub capability ids for bridge catalog checks.
pub const FIRST_BATCH_STUB_IDS: &[&str] =
    &["camera.capture", "file.pick", "share.send", "storage.get", "storage.set"];

/// Hard: shell entry artifacts (client JS / dom host / entry URL) are incomplete.
pub const DIAG_MISSING_ENTRY_ARTIFACT: &str = "vmz::native_host::missing_entry_artifact";
/// Hard: shell omits a required host hook (`load` / `error` / `exit` / ...).
pub const DIAG_MISSING_SHELL_HOOK: &str = "vmz::native_host::missing_shell_hook";
/// Hard: platforms fork Host Profile / shell semantics instead of sharing schemas.
pub const DIAG_PLATFORM_SEMANTIC_FORK: &str = "vmz::native_host::platform_semantic_fork";
/// Hard: remote entry is the silent default (local bundled must be explicit default).
pub const DIAG_REMOTE_ENTRY_DEFAULT: &str = "vmz::native_host::remote_entry_default";
/// Hard: shell omits deep-link / universal-link mapping.
pub const DIAG_MISSING_DEEP_LINK: &str = "vmz::native_host::missing_deep_link";
/// Hard: shell omits logging / redaction policy.
pub const DIAG_MISSING_LOG_POLICY: &str = "vmz::native_host::missing_log_policy";

/// Required WebView shell host hook names for load / error / exit / deepLink / log.
pub const REQUIRED_SHELL_HOOKS: &[&str] = &["load", "error", "exit", "deepLink", "log"];

/// Platforms that must share one shell schema (no semantic fork).
pub const REQUIRED_SHELL_PLATFORMS: &[&str] = &["ios", "android"];

/// Hard: bridge uses arbitrary JS injection / object postMessage instead of typed calls.
pub const DIAG_ARBITRARY_BRIDGE: &str = "vmz::native_host::arbitrary_bridge";
/// Hard: deployment / shell is missing ApplicationIdentity.
pub const DIAG_MISSING_IDENTITY: &str = "vmz::native_host::missing_identity";
/// Hard: bridge / stub catalog is missing a capability allowlist.
pub const DIAG_MISSING_ALLOWLIST: &str = "vmz::native_host::missing_allowlist";
/// Hard: declared capability class is Unsupported on the target platform.
pub const DIAG_UNSUPPORTED_CAPABILITY: &str = "vmz::native_host::unsupported_capability";
/// Hard: WebViewDeploymentProfile failed structural / schema validation.
pub const DIAG_INVALID_PROFILE: &str = "vmz::native_host::invalid_profile";
/// Hard: remote URL is the silent default asset mode (must not be implicit).
pub const DIAG_REMOTE_URL_DEFAULT: &str = "vmz::native_host::remote_url_default";

/// One document kind entry inside [`NativeHostProtocolCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostDocumentKind {
    /// Kind id (`webview_deployment`, `shell`, `lifecycle`, `native_surface`, ...).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

/// Handshake catalog for the NativeAppHost protocol domain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostProtocolCatalog {
    /// Always [`NATIVE_HOST_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<NativeHostDocumentKind>,
    /// Stable diagnostic codes callers may see.
    pub diagnostics: Vec<String>,
    /// Capability class names (`PureWeb` / `NativeBacked` / `NativeSurface` / ...).
    #[serde(rename = "capabilityClasses")]
    pub capability_classes: Vec<String>,
    /// Forbidden arbitrary-bridge patterns that must fail check.
    #[serde(rename = "forbiddenBridgePatterns")]
    pub forbidden_bridge_patterns: Vec<String>,
    /// First-batch NativeBacked stub capability ids.
    #[serde(rename = "firstBatchStubIds", default)]
    pub first_batch_stub_ids: Vec<String>,
    /// Required lifecycle event names from [`REQUIRED_LIFECYCLE_EVENTS`].
    #[serde(rename = "requiredLifecycleEvents", default)]
    pub required_lifecycle_events: Vec<String>,
    /// High-value NativeSurface kinds from [`HIGH_VALUE_SURFACE_KINDS`].
    #[serde(rename = "highValueSurfaceKinds", default)]
    pub high_value_surface_kinds: Vec<String>,
    /// Platforms that must share one Host Profile contract set.
    #[serde(rename = "requiredMultiPlatforms", default)]
    pub required_multi_platforms: Vec<String>,
}

impl NativeHostProtocolCatalog {
    /// Frozen catalog for the current native-host protocol generation.
    pub fn v0() -> Self {
        Self {
            schema: NATIVE_HOST_PROTOCOL.into(),
            protocol: NATIVE_HOST_PROTOCOL.into(),
            documents: vec![
                NativeHostDocumentKind {
                    kind: "webview_deployment".into(),
                    schema: WEBVIEW_DEPLOYMENT_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "capability".into(),
                    schema: NATIVE_CAPABILITY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "bridge".into(),
                    schema: BRIDGE_PROTOCOL_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "application_identity".into(),
                    schema: APPLICATION_IDENTITY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "check".into(),
                    schema: NATIVE_HOST_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind { kind: "shell".into(), schema: SHELL_SCHEMA.into() },
                NativeHostDocumentKind {
                    kind: "deep_link".into(),
                    schema: DEEP_LINK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "local_bundle".into(),
                    schema: LOCAL_BUNDLE_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "shell_check".into(),
                    schema: SHELL_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "capability_call".into(),
                    schema: CAPABILITY_CALL_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "bridge_trace".into(),
                    schema: BRIDGE_TRACE_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "bridge_stub_catalog".into(),
                    schema: BRIDGE_STUB_CATALOG_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "bridge_check".into(),
                    schema: BRIDGE_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "lifecycle".into(),
                    schema: LIFECYCLE_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "persistence".into(),
                    schema: PERSISTENCE_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "update_policy".into(),
                    schema: UPDATE_POLICY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "offline_policy".into(),
                    schema: OFFLINE_POLICY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "lifecycle_check".into(),
                    schema: LIFECYCLE_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "fullstack".into(),
                    schema: FULLSTACK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "ssr_first_paint".into(),
                    schema: SSR_FIRST_PAINT_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "server_transport".into(),
                    schema: SERVER_TRANSPORT_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "auth_session".into(),
                    schema: AUTH_SESSION_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "push_policy".into(),
                    schema: PUSH_POLICY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "network_policy".into(),
                    schema: NETWORK_POLICY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "fullstack_check".into(),
                    schema: FULLSTACK_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "native_surface".into(),
                    schema: NATIVE_SURFACE_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "native_surface_id".into(),
                    schema: NATIVE_SURFACE_ID_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "native_surface_boundary".into(),
                    schema: NATIVE_SURFACE_BOUNDARY_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "native_surface_check".into(),
                    schema: NATIVE_SURFACE_CHECK_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "multi_platform".into(),
                    schema: MULTI_PLATFORM_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "multi_platform_shared".into(),
                    schema: MULTI_PLATFORM_SHARED_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "multi_platform_adapter".into(),
                    schema: MULTI_PLATFORM_ADAPTER_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "multi_platform_test".into(),
                    schema: MULTI_PLATFORM_TEST_SCHEMA.into(),
                },
                NativeHostDocumentKind {
                    kind: "multi_platform_check".into(),
                    schema: MULTI_PLATFORM_CHECK_SCHEMA.into(),
                },
            ],
            diagnostics: vec![
                DIAG_ARBITRARY_BRIDGE.into(),
                DIAG_MISSING_IDENTITY.into(),
                DIAG_MISSING_ALLOWLIST.into(),
                DIAG_UNSUPPORTED_CAPABILITY.into(),
                DIAG_INVALID_PROFILE.into(),
                DIAG_REMOTE_URL_DEFAULT.into(),
                DIAG_MISSING_ENTRY_ARTIFACT.into(),
                DIAG_MISSING_SHELL_HOOK.into(),
                DIAG_PLATFORM_SEMANTIC_FORK.into(),
                DIAG_REMOTE_ENTRY_DEFAULT.into(),
                DIAG_MISSING_DEEP_LINK.into(),
                DIAG_MISSING_LOG_POLICY.into(),
                DIAG_MISSING_NONCE.into(),
                DIAG_MISSING_ORIGIN.into(),
                DIAG_MISSING_PERMISSION.into(),
                DIAG_MISSING_CANCEL.into(),
                DIAG_MISSING_TRACE.into(),
                DIAG_MISSING_TIMEOUT.into(),
                DIAG_UNKNOWN_STUB.into(),
                DIAG_CALL_NOT_ALLOWLISTED.into(),
                DIAG_MISSING_LIFECYCLE_EVENT.into(),
                DIAG_BACKGROUND_IS_DESTROY.into(),
                DIAG_CRASH_ASSUMES_JS_HEAP.into(),
                DIAG_MISSING_PERSISTENCE.into(),
                DIAG_MISSING_UPDATE_POLICY.into(),
                DIAG_MISSING_OFFLINE_POLICY.into(),
                DIAG_MISSING_SSR_FIRST_PAINT.into(),
                DIAG_MISSING_SERVER_TRANSPORT.into(),
                DIAG_BRIDGE_BYPASSES_SERVER.into(),
                DIAG_MISSING_AUTH_SESSION.into(),
                DIAG_MISSING_NETWORK_POLICY.into(),
                DIAG_REMOTE_WITHOUT_INTEGRITY.into(),
                DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS.into(),
                DIAG_MISSING_SURFACE_ID.into(),
                DIAG_MISSING_OWNER_REGION.into(),
                DIAG_MISSING_SURFACE_LIFETIME.into(),
                DIAG_IMPLICIT_STATE_SHARE.into(),
                DIAG_SURFACE_IS_CAPABILITY.into(),
                DIAG_SURFACE_IS_SEMANTIC_TRUTH.into(),
                DIAG_MISSING_PLATFORM_ADAPTER.into(),
                DIAG_PLATFORM_PRIVATE_SCHEMA.into(),
                DIAG_ADAPTER_IS_SEMANTIC_CORE.into(),
            ],
            capability_classes: vec![
                "PureWeb".into(),
                "NativeBacked".into(),
                "NativeSurface".into(),
                "ServerBacked".into(),
                "Unsupported".into(),
            ],
            forbidden_bridge_patterns: FORBIDDEN_BRIDGE_PATTERNS
                .iter()
                .map(|s| (*s).into())
                .collect(),
            first_batch_stub_ids: FIRST_BATCH_STUB_IDS.iter().map(|s| (*s).into()).collect(),
            required_lifecycle_events: REQUIRED_LIFECYCLE_EVENTS
                .iter()
                .map(|s| (*s).into())
                .collect(),
            high_value_surface_kinds: HIGH_VALUE_SURFACE_KINDS
                .iter()
                .map(|s| (*s).into())
                .collect(),
            required_multi_platforms: REQUIRED_MULTI_PLATFORMS
                .iter()
                .map(|s| (*s).into())
                .collect(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Patterns that must never appear as the WebSurface <-> NativeAppHost bridge contract.
pub const FORBIDDEN_BRIDGE_PATTERNS: &[&str] = &[
    "window.native",
    "window.webkit.messageHandlers",
    "arbitraryObject",
    "postMessage(rawValue)",
    "eval(",
];

/// Application identity for a native host package (id / origin / optional store metadata).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIdentity {
    /// Always [`APPLICATION_IDENTITY_SCHEMA`].
    pub schema: String,
    /// Stable application id used by the host and deep links.
    #[serde(rename = "applicationId")]
    pub application_id: String,
    /// Verified origin string (e.g. `app://demo.app`) for bridge checks.
    pub origin: String,
    /// Optional store / OS bundle identifier.
    #[serde(rename = "bundleId", default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    /// Optional human/package version string.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl ApplicationIdentity {
    /// Demo identity for fixtures and local shell examples.
    pub fn example() -> Self {
        Self {
            schema: APPLICATION_IDENTITY_SCHEMA.into(),
            application_id: "demo.app".into(),
            origin: "app://demo.app".into(),
            bundle_id: Some("com.vmz.demo".into()),
            version: Some("0.0.0".into()),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Native capability declaration (versioned and schema'd; not arbitrary injection).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeCapability {
    /// Always [`NATIVE_CAPABILITY_SCHEMA`].
    pub schema: String,
    /// Stable capability id (e.g. `camera.capture`).
    pub id: String,
    /// Capability contract version string.
    pub version: String,
    /// Capability class: `PureWeb` | `NativeBacked` | `NativeSurface` | `ServerBacked` | `Unsupported`.
    #[serde(rename = "capabilityClass")]
    pub capability_class: String,
    /// Platforms this capability targets (`ios` / `android` / ...).
    #[serde(rename = "targetPlatforms", default)]
    pub target_platforms: Vec<String>,
    /// Permission names the host must grant before the call.
    #[serde(default)]
    pub permissions: Vec<String>,
    /// Optional input payload schema id.
    #[serde(rename = "inputSchema", default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<String>,
    /// Optional output payload schema id.
    #[serde(rename = "outputSchema", default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<String>,
    /// Declared error codes the call may return.
    #[serde(default)]
    pub errors: Vec<String>,
    /// Optional lifecycle binding hint (`bound_to_region` / `app` / ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<String>,
    /// Whether the call is asynchronous.
    #[serde(rename = "async", default)]
    pub async_: bool,
    /// Whether the host must support cancellation for this call.
    #[serde(default)]
    pub cancellation: bool,
    /// Optional security posture string (e.g. `allowlist+origin+nonce`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security: Option<String>,
    /// Whether bridge trace / correlation is required.
    #[serde(default)]
    pub trace: bool,
}

impl NativeCapability {
    /// Example `camera.capture` NativeBacked capability for fixtures.
    pub fn camera_capture_example() -> Self {
        Self {
            schema: NATIVE_CAPABILITY_SCHEMA.into(),
            id: "camera.capture".into(),
            version: "1".into(),
            capability_class: "NativeBacked".into(),
            target_platforms: vec!["ios".into(), "android".into()],
            permissions: vec!["camera".into()],
            input_schema: Some("vmz.native.camera.capture.in.v1".into()),
            output_schema: Some("vmz.native.camera.capture.out.v1".into()),
            errors: vec!["permission_denied".into(), "cancelled".into(), "unavailable".into()],
            lifecycle: Some("bound_to_region".into()),
            async_: true,
            cancellation: true,
            security: Some("allowlist+origin+nonce".into()),
            trace: true,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Versioned bridge protocol between WebSurface and NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeProtocolManifest {
    /// Always [`BRIDGE_PROTOCOL_SCHEMA`].
    pub schema: String,
    /// Bridge protocol version string.
    pub version: String,
    /// Must be typed capability calls - never arbitrary object injection.
    pub mode: String,
    /// Whether every call must carry a verified origin.
    #[serde(rename = "requireOrigin")]
    pub require_origin: bool,
    /// Whether every call must carry a nonce.
    #[serde(rename = "requireNonce")]
    pub require_nonce: bool,
    /// Whether calls must be on the published allowlist.
    #[serde(rename = "requireAllowlist")]
    pub require_allowlist: bool,
    /// Whether `eval` / dynamic script injection is forbidden.
    #[serde(rename = "forbidEval")]
    pub forbid_eval: bool,
    /// Capability ids this bridge instance exposes.
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
}

impl BridgeProtocolManifest {
    /// Strict typed-capability bridge defaults for the current generation.
    pub fn v0(capability_ids: Vec<String>) -> Self {
        Self {
            schema: BRIDGE_PROTOCOL_SCHEMA.into(),
            version: "0".into(),
            mode: "typed_capability".into(),
            require_origin: true,
            require_nonce: true,
            require_allowlist: true,
            forbid_eval: true,
            capability_ids,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// WebView deployment profile - Delivery for WebSurface inside NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebViewDeploymentProfile {
    /// Always [`WEBVIEW_DEPLOYMENT_SCHEMA`].
    pub schema: String,
    /// Asset delivery mode: `local` | `remote` | `hybrid` - remote must not be silent default.
    #[serde(rename = "assetMode")]
    pub asset_mode: String,
    /// Application identity for this host package.
    pub identity: ApplicationIdentity,
    /// Optional Content-Security-Policy string for the WebView.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp: Option<String>,
    /// Typed bridge protocol this deployment exposes.
    #[serde(rename = "bridge")]
    pub bridge: BridgeProtocolManifest,
    /// Declared native capabilities for this deployment.
    #[serde(rename = "capabilities", default)]
    pub capabilities: Vec<NativeCapability>,
    /// Provenance: Browser/Web plan schema this WebSurface artifact lowers from.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Browser artifact reuse - WebView does not invent a second View lowering.
    #[serde(rename = "reusesBrowserLowering")]
    pub reuses_browser_lowering: bool,
    /// Optional update channel name (e.g. `store`).
    #[serde(rename = "updateChannel", default, skip_serializing_if = "Option::is_none")]
    pub update_channel: Option<String>,
    /// Optional rollback policy name (e.g. `previous_bundle`).
    #[serde(rename = "rollbackPolicy", default, skip_serializing_if = "Option::is_none")]
    pub rollback_policy: Option<String>,
    /// Optional offline policy name (e.g. `bundled_only`).
    #[serde(rename = "offlinePolicy", default, skip_serializing_if = "Option::is_none")]
    pub offline_policy: Option<String>,
}

impl WebViewDeploymentProfile {
    /// Local-bundled deployment example with the given capabilities.
    pub fn local_bundled_example(caps: Vec<NativeCapability>) -> Self {
        let ids: Vec<String> = caps.iter().map(|c| c.id.clone()).collect();
        Self {
            schema: WEBVIEW_DEPLOYMENT_SCHEMA.into(),
            asset_mode: "local".into(),
            identity: ApplicationIdentity::example(),
            csp: Some("default-src 'self'; bridge-src 'self'".into()),
            bridge: BridgeProtocolManifest::v0(ids),
            capabilities: caps,
            plan_schema: crate::program::PLAN_SCHEMA.into(),
            reuses_browser_lowering: true,
            update_channel: Some("store".into()),
            rollback_policy: Some("previous_bundle".into()),
            offline_policy: Some("bundled_only".into()),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One diagnostic finding from a native-host check.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostDiagnostic {
    /// JSON-pointer / logical path of the offending field.
    pub path: String,
    /// Severity label (`error` / `warning` / ...).
    pub severity: String,
    /// Human-readable finding message.
    pub message: String,
    /// Optional stable diagnostic code (`vmz::native_host::...`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// Umbrella native-host check report (deployment + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostCheckReport {
    /// Always [`NATIVE_HOST_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// WebView deployment under test.
    #[serde(rename = "webviewDeployment")]
    pub webview_deployment: WebViewDeploymentProfile,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeHostCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Local bundled WebSurface entry artifacts (Browser Direct reuse).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalBundledEntry {
    /// Always [`LOCAL_BUNDLE_SCHEMA`].
    pub schema: String,
    /// Relative path to the client JS entry.
    #[serde(rename = "clientJs")]
    pub client_js: String,
    /// Relative path to the DOM host bootstrap script.
    #[serde(rename = "domHost")]
    pub dom_host: String,
    /// Optional HTML shell path when the host does not synthesize one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    /// App-scheme entry URL loaded by the WebView.
    #[serde(rename = "entryUrl")]
    pub entry_url: String,
}

impl LocalBundledEntry {
    /// Demo local-bundle entry for fixtures and shell examples.
    pub fn example() -> Self {
        Self {
            schema: LOCAL_BUNDLE_SCHEMA.into(),
            client_js: "pages/index.client.js".into(),
            dom_host: "vmz-dom.js".into(),
            html: None,
            entry_url: "app://demo.app/".into(),
        }
    }
}

/// Deep link / universal link map entry into a route id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeepLinkEntry {
    /// Always [`DEEP_LINK_SCHEMA`].
    pub schema: String,
    /// URL scheme (e.g. `app`).
    pub scheme: String,
    /// Optional host for universal links.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    /// Path matched by the deep link.
    pub path: String,
    /// Target RouteId realized by the router.
    #[serde(rename = "routeId")]
    pub route_id: String,
}

impl DeepLinkEntry {
    /// Demo deep-link entry for fixtures and shell examples.
    pub fn example() -> Self {
        Self {
            schema: DEEP_LINK_SCHEMA.into(),
            scheme: "app".into(),
            host: Some("demo.app".into()),
            path: "/".into(),
            route_id: "pages/index".into(),
        }
    }
}

/// Platform adapter stub - shared shell schema with platform-specific packaging only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellPlatformAdapter {
    /// Platform id (`ios` / `android`).
    pub platform: String,
    /// Adapter kind (e.g. `webview_shell`).
    pub kind: String,
    /// Shared shell schema id this adapter must honor.
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
}

/// Native WebView shell manifest (algebraic contract; not Xcode/Gradle projects).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeWebViewShellManifest {
    /// Always [`SHELL_SCHEMA`].
    pub schema: String,
    /// Application identity for this shell.
    pub identity: ApplicationIdentity,
    /// Asset delivery mode (`local` / `remote` / `hybrid`).
    #[serde(rename = "assetMode")]
    pub asset_mode: String,
    /// Whether this shell reuses Browser View lowering (must stay true).
    #[serde(rename = "reusesBrowserLowering")]
    pub reuses_browser_lowering: bool,
    /// Plan schema provenance for the bundled WebSurface.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Local bundled entry artifacts.
    pub entry: LocalBundledEntry,
    /// Declared host hooks (must cover [`REQUIRED_SHELL_HOOKS`]).
    pub hooks: Vec<String>,
    /// Deep-link / universal-link map.
    #[serde(rename = "deepLinks", default)]
    pub deep_links: Vec<DeepLinkEntry>,
    /// Shell logging / redaction policy.
    pub logging: ShellLoggingPolicy,
    /// Per-platform packaging adapters sharing this shell schema.
    pub adapters: Vec<ShellPlatformAdapter>,
}

/// Logging policy for the native WebView shell.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellLoggingPolicy {
    /// Log level name (`info` / `warn` / ...).
    pub level: String,
    /// Whether sensitive fields must be redacted in host logs.
    #[serde(rename = "redactSensitive")]
    pub redact_sensitive: bool,
}

impl NativeWebViewShellManifest {
    /// Local-bundled shell example with required hooks and iOS/Android adapters.
    pub fn local_bundled_example() -> Self {
        Self {
            schema: SHELL_SCHEMA.into(),
            identity: ApplicationIdentity::example(),
            asset_mode: "local".into(),
            reuses_browser_lowering: true,
            plan_schema: crate::program::PLAN_SCHEMA.into(),
            entry: LocalBundledEntry::example(),
            hooks: REQUIRED_SHELL_HOOKS.iter().map(|s| (*s).into()).collect(),
            deep_links: vec![DeepLinkEntry::example()],
            logging: ShellLoggingPolicy { level: "info".into(), redact_sensitive: true },
            adapters: REQUIRED_SHELL_PLATFORMS
                .iter()
                .map(|p| ShellPlatformAdapter {
                    platform: (*p).into(),
                    kind: "webview_shell".into(),
                    shell_schema: SHELL_SCHEMA.into(),
                })
                .collect(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Shell-contract check report (manifest + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeShellCheckReport {
    /// Always [`SHELL_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// Shell manifest under test.
    pub shell: NativeWebViewShellManifest,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeShellCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Bridge call trace context (must redact sensitive data).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeTraceContext {
    /// Always [`BRIDGE_TRACE_SCHEMA`].
    pub schema: String,
    /// Correlation id joining request / response / host logs.
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    /// Optional RouteId active when the call was issued.
    #[serde(rename = "routeId", default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    /// Whether sensitive payload fields must be redacted in traces.
    #[serde(rename = "redactSensitive")]
    pub redact_sensitive: bool,
}

impl BridgeTraceContext {
    /// Example trace context with the given correlation id.
    pub fn example(correlation_id: &str) -> Self {
        Self {
            schema: BRIDGE_TRACE_SCHEMA.into(),
            correlation_id: correlation_id.into(),
            route_id: Some("pages/index".into()),
            redact_sensitive: true,
        }
    }
}

/// Versioned typed capability call envelope (not arbitrary JS injection).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeCapabilityCall {
    /// Always [`CAPABILITY_CALL_SCHEMA`].
    pub schema: String,
    /// Unique id for this call instance.
    #[serde(rename = "callId")]
    pub call_id: String,
    /// Target capability id (must be allowlisted).
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    /// Capability contract version expected by the caller.
    #[serde(rename = "capabilityVersion")]
    pub capability_version: String,
    /// Verified origin of the WebSurface issuer.
    pub origin: String,
    /// One-time nonce for replay protection.
    pub nonce: String,
    /// Monotonic sequence number within the bridge session.
    pub sequence: u64,
    /// Optional input payload schema id.
    #[serde(rename = "inputSchema", default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<String>,
    /// Optional output payload schema id.
    #[serde(rename = "outputSchema", default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<String>,
    /// Permissions asserted for this call.
    pub permissions: Vec<String>,
    /// Timeout bound in milliseconds.
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
    /// Whether the caller may cancel this call.
    pub cancellation: bool,
    /// Trace / correlation context for the call.
    pub trace: BridgeTraceContext,
}

impl NativeCapabilityCall {
    /// Example `camera.capture` call envelope for fixtures.
    pub fn camera_capture_example() -> Self {
        Self {
            schema: CAPABILITY_CALL_SCHEMA.into(),
            call_id: "call-camera-1".into(),
            capability_id: "camera.capture".into(),
            capability_version: "1".into(),
            origin: "app://demo.app".into(),
            nonce: "nonce-demo-1".into(),
            sequence: 1,
            input_schema: Some("vmz.native.camera.capture.in.v1".into()),
            output_schema: Some("vmz.native.camera.capture.out.v1".into()),
            permissions: vec!["camera".into()],
            timeout_ms: 30_000,
            cancellation: true,
            trace: BridgeTraceContext::example("corr-camera-1"),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// First-batch stub catalog (algebraic stubs; not real-device adapters yet).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeStubCatalog {
    /// Always [`BRIDGE_STUB_CATALOG_SCHEMA`].
    pub schema: String,
    /// Declared NativeBacked stub capabilities.
    pub stubs: Vec<NativeCapability>,
    /// Allowlisted capability ids derived from `stubs`.
    #[serde(rename = "allowlist")]
    pub allowlist: Vec<String>,
}

impl BridgeStubCatalog {
    /// Frozen first-batch stub set (camera / file / share / storage).
    pub fn first_batch() -> Self {
        let stubs = vec![
            NativeCapability::camera_capture_example(),
            NativeCapability {
                schema: NATIVE_CAPABILITY_SCHEMA.into(),
                id: "file.pick".into(),
                version: "1".into(),
                capability_class: "NativeBacked".into(),
                target_platforms: vec!["ios".into(), "android".into()],
                permissions: vec!["files".into()],
                input_schema: Some("vmz.native.file.pick.in.v1".into()),
                output_schema: Some("vmz.native.file.pick.out.v1".into()),
                errors: vec!["permission_denied".into(), "cancelled".into(), "unavailable".into()],
                lifecycle: Some("bound_to_region".into()),
                async_: true,
                cancellation: true,
                security: Some("allowlist+origin+nonce".into()),
                trace: true,
            },
            NativeCapability {
                schema: NATIVE_CAPABILITY_SCHEMA.into(),
                id: "share.send".into(),
                version: "1".into(),
                capability_class: "NativeBacked".into(),
                target_platforms: vec!["ios".into(), "android".into()],
                permissions: vec!["share".into()],
                input_schema: Some("vmz.native.share.send.in.v1".into()),
                output_schema: Some("vmz.native.share.send.out.v1".into()),
                errors: vec!["cancelled".into(), "unavailable".into()],
                lifecycle: Some("bound_to_region".into()),
                async_: true,
                cancellation: true,
                security: Some("allowlist+origin+nonce".into()),
                trace: true,
            },
            NativeCapability {
                schema: NATIVE_CAPABILITY_SCHEMA.into(),
                id: "storage.get".into(),
                version: "1".into(),
                capability_class: "NativeBacked".into(),
                target_platforms: vec!["ios".into(), "android".into()],
                permissions: vec!["storage".into()],
                input_schema: Some("vmz.native.storage.get.in.v1".into()),
                output_schema: Some("vmz.native.storage.get.out.v1".into()),
                errors: vec!["unavailable".into()],
                lifecycle: Some("app".into()),
                async_: true,
                cancellation: true,
                security: Some("allowlist+origin+nonce".into()),
                trace: true,
            },
            NativeCapability {
                schema: NATIVE_CAPABILITY_SCHEMA.into(),
                id: "storage.set".into(),
                version: "1".into(),
                capability_class: "NativeBacked".into(),
                target_platforms: vec!["ios".into(), "android".into()],
                permissions: vec!["storage".into()],
                input_schema: Some("vmz.native.storage.set.in.v1".into()),
                output_schema: Some("vmz.native.storage.set.out.v1".into()),
                errors: vec!["quota_exceeded".into(), "unavailable".into()],
                lifecycle: Some("app".into()),
                async_: true,
                cancellation: true,
                security: Some("allowlist+origin+nonce".into()),
                trace: true,
            },
        ];
        let allowlist: Vec<String> = stubs.iter().map(|s| s.id.clone()).collect();
        Self { schema: BRIDGE_STUB_CATALOG_SCHEMA.into(), stubs, allowlist }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Bridge-contract check report (stub catalog + sample calls + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeBridgeCheckReport {
    /// Always [`BRIDGE_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// Stub catalog under test.
    #[serde(rename = "stubCatalog")]
    pub stub_catalog: BridgeStubCatalog,
    /// Sample typed capability calls exercised by the check.
    #[serde(rename = "sampleCalls", default)]
    pub sample_calls: Vec<NativeCapabilityCall>,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeBridgeCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Persistence policy for WebView state across crash/restore (explicit, not JS heap).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersistencePolicy {
    /// Always [`PERSISTENCE_SCHEMA`].
    pub schema: String,
    /// Whether persistence is enabled for this host.
    pub enabled: bool,
    /// Persistence mode (e.g. `capability_backed` | `bundled_snapshot`) - never implicit JS memory.
    pub mode: String,
    /// Whether restore must force re-authentication.
    #[serde(rename = "reauthOnRestore")]
    pub reauth_on_restore: bool,
}

/// Update / rollback channel policy for host package delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdatePolicy {
    /// Always [`UPDATE_POLICY_SCHEMA`].
    pub schema: String,
    /// Update channel name (e.g. `store`).
    pub channel: String,
    /// Rollback strategy name (e.g. `previous_bundle`).
    pub rollback: String,
}

/// Offline resource policy for local/hybrid WebSurface delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflinePolicy {
    /// Always [`OFFLINE_POLICY_SCHEMA`].
    pub schema: String,
    /// Offline mode (e.g. `bundled_only` | `hybrid_cache`) - not `none` for production hosts.
    pub mode: String,
}

/// NativeAppHost lifecycle policy (events, restore rules, nested policies).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeAppLifecyclePolicy {
    /// Always [`LIFECYCLE_SCHEMA`].
    pub schema: String,
    /// Declared lifecycle event names (must cover [`REQUIRED_LIFECYCLE_EVENTS`]).
    pub events: Vec<String>,
    /// Hard rule: background must not equal destroy.
    #[serde(rename = "backgroundEqualsDestroy")]
    pub background_equals_destroy: bool,
    /// Hard rule: crash restore must not assume surviving JS heap.
    #[serde(rename = "crashRestoreAssumesJsHeap")]
    pub crash_restore_assumes_js_heap: bool,
    /// Whether regions dispose when the host reaches destroy.
    #[serde(rename = "disposeRegionsOnDestroy")]
    pub dispose_regions_on_destroy: bool,
    /// Crash/restore persistence policy.
    pub persistence: PersistencePolicy,
    /// Update / rollback channel policy.
    pub update: UpdatePolicy,
    /// Offline resource policy.
    pub offline: OfflinePolicy,
}

impl NativeAppLifecyclePolicy {
    /// Example lifecycle policy with required events and safe restore defaults.
    pub fn example() -> Self {
        Self {
            schema: LIFECYCLE_SCHEMA.into(),
            events: REQUIRED_LIFECYCLE_EVENTS.iter().map(|s| (*s).into()).collect(),
            background_equals_destroy: false,
            crash_restore_assumes_js_heap: false,
            dispose_regions_on_destroy: true,
            persistence: PersistencePolicy {
                schema: PERSISTENCE_SCHEMA.into(),
                enabled: true,
                mode: "capability_backed".into(),
                reauth_on_restore: true,
            },
            update: UpdatePolicy {
                schema: UPDATE_POLICY_SCHEMA.into(),
                channel: "store".into(),
                rollback: "previous_bundle".into(),
            },
            offline: OfflinePolicy {
                schema: OFFLINE_POLICY_SCHEMA.into(),
                mode: "bundled_only".into(),
            },
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Lifecycle-contract check report (policy + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeLifecycleCheckReport {
    /// Always [`LIFECYCLE_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// Lifecycle policy under test.
    pub lifecycle: NativeAppLifecyclePolicy,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeLifecycleCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// SSR first-paint policy for WebSurface inside NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SsrFirstPaintPolicy {
    /// Always [`SSR_FIRST_PAINT_SCHEMA`].
    pub schema: String,
    /// Whether SSR first-paint is enabled for this host.
    pub enabled: bool,
    /// SSR delivery mode: `bundled` | `remote` | `hybrid`.
    pub mode: String,
    /// Plan schema provenance for the SSR artifact.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Integrity evidence required for remote/hybrid SSR.
    #[serde(default)]
    pub integrity: String,
    /// Must stay false - bundled and remote SSR cannot share cookie/origin assumptions.
    #[serde(rename = "allowMixedCookieAssumptions", default)]
    pub allow_mixed_cookie_assumptions: bool,
}

/// `#server` transport binding - Native bridge must not bypass this.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerTransportPolicy {
    /// Always [`SERVER_TRANSPORT_SCHEMA`].
    pub schema: String,
    /// Transport scheme; must be `#server`.
    pub scheme: String,
    /// Server endpoint path / binding string.
    pub endpoint: String,
    /// Whether the native bridge is allowed to bypass `#server` (must stay false).
    #[serde(rename = "bridgeBypassesServer", default)]
    pub bridge_bypasses_server: bool,
}

/// Auth / session isolation for the WebView host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthSessionPolicy {
    /// Always [`AUTH_SESSION_SCHEMA`].
    pub schema: String,
    /// Auth mode string (e.g. `cookie+token`).
    pub mode: String,
    /// Session namespace isolating WebView cookies / tokens.
    #[serde(rename = "sessionNamespace")]
    pub session_namespace: String,
    /// Whether WebView crash forces re-authentication.
    #[serde(rename = "reauthOnWebViewCrash")]
    pub reauth_on_webview_crash: bool,
}

/// Push capability declaration (stub allowed for algebraic hosts).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushPolicy {
    /// Always [`PUSH_POLICY_SCHEMA`].
    pub schema: String,
    /// Capability id for push subscribe / receive.
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    /// Whether this entry is an algebraic stub (not a real device push adapter).
    pub stub: bool,
}

/// Network policy for NativeAppHost (HTTPS / cleartext).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkPolicy {
    /// Always [`NETWORK_POLICY_SCHEMA`].
    pub schema: String,
    /// Network mode string (e.g. `https_only`).
    pub mode: String,
    /// Whether cleartext HTTP is allowed (must stay false for production hosts).
    #[serde(rename = "allowCleartext", default)]
    pub allow_cleartext: bool,
}

/// NativeAppHost full-stack profile (SSR, `#server`, auth, push, network, delivery).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeFullstackProfile {
    /// Always [`FULLSTACK_SCHEMA`].
    pub schema: String,
    /// SSR first-paint policy.
    pub ssr: SsrFirstPaintPolicy,
    /// `#server` transport binding.
    #[serde(rename = "serverTransport")]
    pub server_transport: ServerTransportPolicy,
    /// Auth / session isolation policy.
    pub auth: AuthSessionPolicy,
    /// Push capability declaration.
    pub push: PushPolicy,
    /// Network / cleartext policy.
    pub network: NetworkPolicy,
    /// Delivery asset mode: `local` | `remote` | `hybrid`.
    #[serde(rename = "deliveryAssetMode")]
    pub delivery_asset_mode: String,
    /// Integrity evidence for remote/hybrid delivery assets.
    #[serde(rename = "deliveryIntegrity", default)]
    pub delivery_integrity: String,
}

impl NativeFullstackProfile {
    /// Example full-stack profile with bundled SSR and `#server` transport.
    pub fn example() -> Self {
        Self {
            schema: FULLSTACK_SCHEMA.into(),
            ssr: SsrFirstPaintPolicy {
                schema: SSR_FIRST_PAINT_SCHEMA.into(),
                enabled: true,
                mode: "bundled".into(),
                plan_schema: crate::program::PLAN_SCHEMA.into(),
                integrity: String::new(),
                allow_mixed_cookie_assumptions: false,
            },
            server_transport: ServerTransportPolicy {
                schema: SERVER_TRANSPORT_SCHEMA.into(),
                scheme: "#server".into(),
                endpoint: "#server/rpc".into(),
                bridge_bypasses_server: false,
            },
            auth: AuthSessionPolicy {
                schema: AUTH_SESSION_SCHEMA.into(),
                mode: "cookie+token".into(),
                session_namespace: "app://demo.app/session".into(),
                reauth_on_webview_crash: true,
            },
            push: PushPolicy {
                schema: PUSH_POLICY_SCHEMA.into(),
                capability_id: "push.subscribe".into(),
                stub: true,
            },
            network: NetworkPolicy {
                schema: NETWORK_POLICY_SCHEMA.into(),
                mode: "https_only".into(),
                allow_cleartext: false,
            },
            delivery_asset_mode: "local".into(),
            delivery_integrity: String::new(),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Full-stack contract check report (profile + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeFullstackCheckReport {
    /// Always [`FULLSTACK_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// Full-stack profile under test.
    pub fullstack: NativeFullstackProfile,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeFullstackCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Cross-boundary data contract between WebSurface and NativeSurface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceBoundary {
    /// Always [`NATIVE_SURFACE_BOUNDARY_SCHEMA`].
    pub schema: String,
    /// Whether boundary payloads must be serializable (no shared JS heap).
    pub serializable: bool,
    /// Boundary payload schema version string.
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    /// Whether every crossing must carry bridge / host trace context.
    #[serde(rename = "traceRequired")]
    pub trace_required: bool,
}

/// NativeSurface manifest (local surface driver - not a second semantic core).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceManifest {
    /// Always [`NATIVE_SURFACE_SCHEMA`].
    pub schema: String,
    /// Stable NativeSurfaceId for this surface instance.
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// Surface kind: `camera` | `map` | `video` for first high-value surfaces.
    pub kind: String,
    /// Owning region id that controls dispose / lifetime.
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    /// Lifetime binding (e.g. `bound_to_region`).
    pub lifetime: String,
    /// Whether the surface disposes when the owner region destroys.
    #[serde(rename = "disposeOnOwnerDestroy")]
    pub dispose_on_owner_destroy: bool,
    /// Whether the surface shares implicit WebView / JS state (must stay false).
    #[serde(rename = "sharesImplicitWebViewState", default)]
    pub shares_implicit_webview_state: bool,
    /// Must stay false - preview surface is not a capture capability.
    #[serde(rename = "confusedWithCapability", default)]
    pub confused_with_capability: bool,
    /// Must stay false - VPG/Plan remain the sole semantic IR.
    #[serde(rename = "isSemanticTruthSource", default)]
    pub is_semantic_truth_source: bool,
    /// Plan schema provenance for view operations reused by this surface.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Whether this surface reuses target-neutral View Operations.
    #[serde(rename = "reusesViewOperations")]
    pub reuses_view_operations: bool,
    /// WebSurface <-> NativeSurface boundary contract.
    pub boundary: NativeSurfaceBoundary,
    /// Related NativeBacked capability id (distinct from this surface).
    #[serde(rename = "relatedCapabilityId", default, skip_serializing_if = "Option::is_none")]
    pub related_capability_id: Option<String>,
}

impl NativeSurfaceManifest {
    /// Example camera preview surface bound to a page region.
    pub fn camera_preview_example() -> Self {
        Self {
            schema: NATIVE_SURFACE_SCHEMA.into(),
            surface_id: "surface:camera.preview:page.index".into(),
            kind: "camera".into(),
            owner_region_id: "region:pages/index:camera".into(),
            lifetime: "bound_to_region".into(),
            dispose_on_owner_destroy: true,
            shares_implicit_webview_state: false,
            confused_with_capability: false,
            is_semantic_truth_source: false,
            plan_schema: crate::program::PLAN_SCHEMA.into(),
            reuses_view_operations: true,
            boundary: NativeSurfaceBoundary {
                schema: NATIVE_SURFACE_BOUNDARY_SCHEMA.into(),
                serializable: true,
                schema_version: "1".into(),
                trace_required: true,
            },
            related_capability_id: Some("camera.capture".into()),
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Native-surface check report (manifest + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceCheckReport {
    /// Always [`NATIVE_SURFACE_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// NativeSurface manifest under test.
    pub surface: NativeSurfaceManifest,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeSurfaceCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Shared Host Profile schema pointers - identical for every platform adapter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiPlatformSharedContracts {
    /// Always [`MULTI_PLATFORM_SHARED_SCHEMA`].
    pub schema: String,
    /// Shared bridge protocol schema id.
    #[serde(rename = "bridgeSchema")]
    pub bridge_schema: String,
    /// Shared capability-call schema id.
    #[serde(rename = "capabilityCallSchema")]
    pub capability_call_schema: String,
    /// Shared NativeSurface schema id.
    #[serde(rename = "surfaceSchema")]
    pub surface_schema: String,
    /// Shared shell schema id.
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
    /// Shared WebView deployment schema id.
    #[serde(rename = "deploymentSchema")]
    pub deployment_schema: String,
    /// Shared full-stack profile schema id.
    #[serde(rename = "fullstackSchema")]
    pub fullstack_schema: String,
    /// Shared multi-platform test-contract schema id.
    #[serde(rename = "testContractSchema")]
    pub test_contract_schema: String,
}

impl MultiPlatformSharedContracts {
    /// Canonical shared schema pointers for the current generation.
    pub fn canonical() -> Self {
        Self {
            schema: MULTI_PLATFORM_SHARED_SCHEMA.into(),
            bridge_schema: BRIDGE_PROTOCOL_SCHEMA.into(),
            capability_call_schema: CAPABILITY_CALL_SCHEMA.into(),
            surface_schema: NATIVE_SURFACE_SCHEMA.into(),
            shell_schema: SHELL_SCHEMA.into(),
            deployment_schema: WEBVIEW_DEPLOYMENT_SCHEMA.into(),
            fullstack_schema: FULLSTACK_SCHEMA.into(),
            test_contract_schema: MULTI_PLATFORM_TEST_SCHEMA.into(),
        }
    }
}

/// Platform packaging adapter (stub only - not Xcode/Gradle semantics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiPlatformAdapter {
    /// Always [`MULTI_PLATFORM_ADAPTER_SCHEMA`].
    pub schema: String,
    /// Platform id (`ios` / `android`).
    pub platform: String,
    /// Must be [`MULTI_PLATFORM_ADAPTER_KIND`] (`packaging_stub`) for this generation.
    pub kind: String,
    /// Bridge schema id this adapter must honor (from shared contracts).
    #[serde(rename = "bridgeSchema")]
    pub bridge_schema: String,
    /// Capability-call schema id this adapter must honor.
    #[serde(rename = "capabilityCallSchema")]
    pub capability_call_schema: String,
    /// NativeSurface schema id this adapter must honor.
    #[serde(rename = "surfaceSchema")]
    pub surface_schema: String,
    /// Shell schema id this adapter must honor.
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
    /// Deployment schema id this adapter must honor.
    #[serde(rename = "deploymentSchema")]
    pub deployment_schema: String,
    /// Full-stack schema id this adapter must honor.
    #[serde(rename = "fullstackSchema")]
    pub fullstack_schema: String,
    /// Test-contract schema id this adapter must honor.
    #[serde(rename = "testContractSchema")]
    pub test_contract_schema: String,
    /// Packaging only - must not carry Host Profile / Program Graph semantics.
    #[serde(rename = "packagingOnly")]
    pub packaging_only: bool,
    /// Must stay false - adapters are not a second semantic core.
    #[serde(rename = "isSemanticTruthSource", default)]
    pub is_semantic_truth_source: bool,
}

impl MultiPlatformAdapter {
    /// Packaging-stub adapter for `platform` that mirrors `shared` schema pointers.
    pub fn packaging_stub(platform: &str, shared: &MultiPlatformSharedContracts) -> Self {
        Self {
            schema: MULTI_PLATFORM_ADAPTER_SCHEMA.into(),
            platform: platform.into(),
            kind: MULTI_PLATFORM_ADAPTER_KIND.into(),
            bridge_schema: shared.bridge_schema.clone(),
            capability_call_schema: shared.capability_call_schema.clone(),
            surface_schema: shared.surface_schema.clone(),
            shell_schema: shared.shell_schema.clone(),
            deployment_schema: shared.deployment_schema.clone(),
            fullstack_schema: shared.fullstack_schema.clone(),
            test_contract_schema: shared.test_contract_schema.clone(),
            packaging_only: true,
            is_semantic_truth_source: false,
        }
    }
}

/// Multi-platform Host Profile freeze (iOS + Android, shared schemas).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeMultiPlatformManifest {
    /// Always [`MULTI_PLATFORM_SCHEMA`].
    pub schema: String,
    /// Shared Host Profile schema pointers.
    pub shared: MultiPlatformSharedContracts,
    /// Platform ids covered by this freeze.
    pub platforms: Vec<String>,
    /// Per-platform packaging adapters.
    pub adapters: Vec<MultiPlatformAdapter>,
    /// Must stay false - no platform-private Host Profile fork.
    #[serde(rename = "allowsPlatformSemanticFork", default)]
    pub allows_platform_semantic_fork: bool,
}

impl NativeMultiPlatformManifest {
    /// Example iOS + Android freeze with packaging-stub adapters.
    pub fn ios_android_example() -> Self {
        let shared = MultiPlatformSharedContracts::canonical();
        Self {
            schema: MULTI_PLATFORM_SCHEMA.into(),
            adapters: REQUIRED_MULTI_PLATFORMS
                .iter()
                .map(|p| MultiPlatformAdapter::packaging_stub(p, &shared))
                .collect(),
            platforms: REQUIRED_MULTI_PLATFORMS.iter().map(|s| (*s).into()).collect(),
            shared,
            allows_platform_semantic_fork: false,
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Multi-platform check report (manifest + catalog + diagnostics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeMultiPlatformCheckReport {
    /// Always [`MULTI_PLATFORM_CHECK_SCHEMA`].
    pub schema: String,
    /// Protocol catalog snapshot used for this check.
    pub catalog: NativeHostProtocolCatalog,
    /// Multi-platform manifest under test.
    pub multi_platform: NativeMultiPlatformManifest,
    /// Findings produced by the check.
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// Overall status: `ready` | `incomplete` | `failed`.
    pub status: String,
}

impl NativeMultiPlatformCheckReport {
    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
