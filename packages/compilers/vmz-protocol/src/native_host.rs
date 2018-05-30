//! NativeAppHost / WebView deployment contracts .
//!
//! Freezes WebViewDeploymentProfile, NativeCapability, bridge protocol,
//! application identity, and security/version fields.
//! WebView reuses Browser lowering — no new View IR / no arbitrary JS bridge.

use serde::{Deserialize, Serialize};

/// Umbrella native-host protocol.
pub const NATIVE_HOST_PROTOCOL: &str = "vmz.native_host.protocol.v0";

pub const WEBVIEW_DEPLOYMENT_SCHEMA: &str = "vmz.native_host.webview_deployment.v0";
pub const NATIVE_CAPABILITY_SCHEMA: &str = "vmz.native_host.capability.v0";
pub const BRIDGE_PROTOCOL_SCHEMA: &str = "vmz.native_host.bridge.v0";
pub const APPLICATION_IDENTITY_SCHEMA: &str = "vmz.native_host.application_identity.v0";
pub const NATIVE_HOST_CHECK_SCHEMA: &str = "vmz.native_host.check.v0";

/// minimal WebView shell + local bundled entry contract.
pub const SHELL_SCHEMA: &str = "vmz.native_host.shell.v0";
pub const SHELL_CHECK_SCHEMA: &str = "vmz.native_host.shell_check.v0";
pub const DEEP_LINK_SCHEMA: &str = "vmz.native_host.deep_link.v0";
pub const LOCAL_BUNDLE_SCHEMA: &str = "vmz.native_host.local_bundle.v0";

/// typed capability call + permission / nonce / cancel / trace.
pub const CAPABILITY_CALL_SCHEMA: &str = "vmz.native_host.capability_call.v0";
pub const BRIDGE_TRACE_SCHEMA: &str = "vmz.native_host.bridge_trace.v0";
pub const BRIDGE_STUB_CATALOG_SCHEMA: &str = "vmz.native_host.bridge_stub_catalog.v0";
pub const BRIDGE_CHECK_SCHEMA: &str = "vmz.native_host.bridge_check.v0";

/// app lifecycle + persistence + update/offline policies.
pub const LIFECYCLE_SCHEMA: &str = "vmz.native_host.lifecycle.v0";
pub const PERSISTENCE_SCHEMA: &str = "vmz.native_host.persistence.v0";
pub const UPDATE_POLICY_SCHEMA: &str = "vmz.native_host.update_policy.v0";
pub const OFFLINE_POLICY_SCHEMA: &str = "vmz.native_host.offline_policy.v0";
pub const LIFECYCLE_CHECK_SCHEMA: &str = "vmz.native_host.lifecycle_check.v0";

/// SSR first-paint + #server transport + auth/session + network/delivery.
pub const FULLSTACK_SCHEMA: &str = "vmz.native_host.fullstack.v0";
pub const SSR_FIRST_PAINT_SCHEMA: &str = "vmz.native_host.ssr_first_paint.v0";
pub const SERVER_TRANSPORT_SCHEMA: &str = "vmz.native_host.server_transport.v0";
pub const AUTH_SESSION_SCHEMA: &str = "vmz.native_host.auth_session.v0";
pub const PUSH_POLICY_SCHEMA: &str = "vmz.native_host.push_policy.v0";
pub const NETWORK_POLICY_SCHEMA: &str = "vmz.native_host.network_policy.v0";
pub const FULLSTACK_CHECK_SCHEMA: &str = "vmz.native_host.fullstack_check.v0";

/// NativeSurfaceId + ownership / lifetime contract.
pub const NATIVE_SURFACE_SCHEMA: &str = "vmz.native_host.native_surface.v0";
pub const NATIVE_SURFACE_ID_SCHEMA: &str = "vmz.native_host.native_surface_id.v0";
pub const NATIVE_SURFACE_BOUNDARY_SCHEMA: &str = "vmz.native_host.native_surface_boundary.v0";
pub const NATIVE_SURFACE_CHECK_SCHEMA: &str = "vmz.native_host.native_surface_check.v0";

pub const DIAG_MISSING_SURFACE_ID: &str = "vmz::native_host::missing_surface_id";
pub const DIAG_MISSING_OWNER_REGION: &str = "vmz::native_host::missing_owner_region";
pub const DIAG_MISSING_SURFACE_LIFETIME: &str = "vmz::native_host::missing_surface_lifetime";
pub const DIAG_IMPLICIT_STATE_SHARE: &str = "vmz::native_host::implicit_state_share";
pub const DIAG_SURFACE_IS_CAPABILITY: &str = "vmz::native_host::surface_is_capability";
pub const DIAG_SURFACE_IS_SEMANTIC_TRUTH: &str = "vmz::native_host::surface_is_semantic_truth";

/// first high-value surface kinds .
pub const HIGH_VALUE_SURFACE_KINDS: &[&str] = &["camera", "map", "video"];

/// iOS/Android share one Host Profile contract set (algebraic — no real Xcode/Gradle).
pub const MULTI_PLATFORM_SCHEMA: &str = "vmz.native_host.multi_platform.v0";
pub const MULTI_PLATFORM_SHARED_SCHEMA: &str = "vmz.native_host.multi_platform_shared.v0";
pub const MULTI_PLATFORM_ADAPTER_SCHEMA: &str = "vmz.native_host.multi_platform_adapter.v0";
pub const MULTI_PLATFORM_TEST_SCHEMA: &str = "vmz.native_host.multi_platform_test.v0";
pub const MULTI_PLATFORM_CHECK_SCHEMA: &str = "vmz.native_host.multi_platform_check.v0";

pub const DIAG_MISSING_PLATFORM_ADAPTER: &str = "vmz::native_host::missing_platform_adapter";
pub const DIAG_PLATFORM_PRIVATE_SCHEMA: &str = "vmz::native_host::platform_private_schema";
pub const DIAG_ADAPTER_IS_SEMANTIC_CORE: &str = "vmz::native_host::adapter_is_semantic_core";

/// Platforms that must share one bridge/surface/deployment/test contract .
pub const REQUIRED_MULTI_PLATFORMS: &[&str] = &["ios", "android"];

/// adapter kind — packaging stub only; real Xcode/Gradle are later packaging/conformance.
pub const MULTI_PLATFORM_ADAPTER_KIND: &str = "packaging_stub";

pub const DIAG_MISSING_SSR_FIRST_PAINT: &str = "vmz::native_host::missing_ssr_first_paint";
pub const DIAG_MISSING_SERVER_TRANSPORT: &str = "vmz::native_host::missing_server_transport";
pub const DIAG_BRIDGE_BYPASSES_SERVER: &str = "vmz::native_host::bridge_bypasses_server";
pub const DIAG_MISSING_AUTH_SESSION: &str = "vmz::native_host::missing_auth_session";
pub const DIAG_MISSING_NETWORK_POLICY: &str = "vmz::native_host::missing_network_policy";
pub const DIAG_REMOTE_WITHOUT_INTEGRITY: &str = "vmz::native_host::remote_without_integrity";
pub const DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS: &str =
    "vmz::native_host::mixed_ssr_cookie_assumptions";

pub const DIAG_MISSING_LIFECYCLE_EVENT: &str = "vmz::native_host::missing_lifecycle_event";
pub const DIAG_BACKGROUND_IS_DESTROY: &str = "vmz::native_host::background_is_destroy";
pub const DIAG_CRASH_ASSUMES_JS_HEAP: &str = "vmz::native_host::crash_assumes_js_heap";
pub const DIAG_MISSING_PERSISTENCE: &str = "vmz::native_host::missing_persistence";
pub const DIAG_MISSING_UPDATE_POLICY: &str = "vmz::native_host::missing_update_policy";
pub const DIAG_MISSING_OFFLINE_POLICY: &str = "vmz::native_host::missing_offline_policy";

/// Required lifecycle events .
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

pub const DIAG_MISSING_NONCE: &str = "vmz::native_host::missing_nonce";
pub const DIAG_MISSING_ORIGIN: &str = "vmz::native_host::missing_origin";
pub const DIAG_MISSING_PERMISSION: &str = "vmz::native_host::missing_permission";
pub const DIAG_MISSING_CANCEL: &str = "vmz::native_host::missing_cancel";
pub const DIAG_MISSING_TRACE: &str = "vmz::native_host::missing_trace";
pub const DIAG_MISSING_TIMEOUT: &str = "vmz::native_host::missing_timeout";
pub const DIAG_UNKNOWN_STUB: &str = "vmz::native_host::unknown_stub";
pub const DIAG_CALL_NOT_ALLOWLISTED: &str = "vmz::native_host::call_not_allowlisted";

/// First-batch NativeBacked stubs .
pub const FIRST_BATCH_STUB_IDS: &[&str] =
    &["camera.capture", "file.pick", "share.send", "storage.get", "storage.set"];

pub const DIAG_MISSING_ENTRY_ARTIFACT: &str = "vmz::native_host::missing_entry_artifact";
pub const DIAG_MISSING_SHELL_HOOK: &str = "vmz::native_host::missing_shell_hook";
pub const DIAG_PLATFORM_SEMANTIC_FORK: &str = "vmz::native_host::platform_semantic_fork";
pub const DIAG_REMOTE_ENTRY_DEFAULT: &str = "vmz::native_host::remote_entry_default";
pub const DIAG_MISSING_DEEP_LINK: &str = "vmz::native_host::missing_deep_link";
pub const DIAG_MISSING_LOG_POLICY: &str = "vmz::native_host::missing_log_policy";

/// Required shell host hooks for .
pub const REQUIRED_SHELL_HOOKS: &[&str] = &["load", "error", "exit", "deepLink", "log"];

/// Platforms that must share one shell schema (no semantic fork).
pub const REQUIRED_SHELL_PLATFORMS: &[&str] = &["ios", "android"];

pub const DIAG_ARBITRARY_BRIDGE: &str = "vmz::native_host::arbitrary_bridge";
pub const DIAG_MISSING_IDENTITY: &str = "vmz::native_host::missing_identity";
pub const DIAG_MISSING_ALLOWLIST: &str = "vmz::native_host::missing_allowlist";
pub const DIAG_UNSUPPORTED_CAPABILITY: &str = "vmz::native_host::unsupported_capability";
pub const DIAG_INVALID_PROFILE: &str = "vmz::native_host::invalid_profile";
pub const DIAG_REMOTE_URL_DEFAULT: &str = "vmz::native_host::remote_url_default";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostDocumentKind {
    pub kind: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostProtocolCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<NativeHostDocumentKind>,
    pub diagnostics: Vec<String>,
    /// Capability classes .
    #[serde(rename = "capabilityClasses")]
    pub capability_classes: Vec<String>,
    /// Forbidden arbitrary-bridge patterns (must fail check).
    #[serde(rename = "forbiddenBridgePatterns")]
    pub forbidden_bridge_patterns: Vec<String>,
    /// first-batch capability stub ids.
    #[serde(rename = "firstBatchStubIds", default)]
    pub first_batch_stub_ids: Vec<String>,
    /// required lifecycle events.
    #[serde(rename = "requiredLifecycleEvents", default)]
    pub required_lifecycle_events: Vec<String>,
    /// high-value NativeSurface kinds.
    #[serde(rename = "highValueSurfaceKinds", default)]
    pub high_value_surface_kinds: Vec<String>,
    /// platforms that must share one Host Profile contract set.
    #[serde(rename = "requiredMultiPlatforms", default)]
    pub required_multi_platforms: Vec<String>,
}

impl NativeHostProtocolCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Patterns that must never be the bridge contract .
pub const FORBIDDEN_BRIDGE_PATTERNS: &[&str] = &[
    "window.native",
    "window.webkit.messageHandlers",
    "arbitraryObject",
    "postMessage(rawValue)",
    "eval(",
];

/// Application identity for a native host package.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplicationIdentity {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: String,
    pub origin: String,
    #[serde(rename = "bundleId", default, skip_serializing_if = "Option::is_none")]
    pub bundle_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

impl ApplicationIdentity {
    pub fn example() -> Self {
        Self {
            schema: APPLICATION_IDENTITY_SCHEMA.into(),
            application_id: "demo.app".into(),
            origin: "app://demo.app".into(),
            bundle_id: Some("com.vmz.demo".into()),
            version: Some("0.0.0".into()),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Native capability declaration (versioned, schema'd — not arbitrary injection).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeCapability {
    pub schema: String,
    pub id: String,
    pub version: String,
    /// `PureWeb` | `NativeBacked` | `NativeSurface` | `ServerBacked` | `Unsupported`
    #[serde(rename = "capabilityClass")]
    pub capability_class: String,
    #[serde(rename = "targetPlatforms", default)]
    pub target_platforms: Vec<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(rename = "inputSchema", default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<String>,
    #[serde(rename = "outputSchema", default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<String>,
    #[serde(default)]
    pub errors: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lifecycle: Option<String>,
    #[serde(rename = "async", default)]
    pub async_: bool,
    #[serde(default)]
    pub cancellation: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub security: Option<String>,
    #[serde(default)]
    pub trace: bool,
}

impl NativeCapability {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Versioned bridge protocol between WebSurface and NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeProtocolManifest {
    pub schema: String,
    pub version: String,
    /// Must be typed capability calls — never arbitrary object injection.
    pub mode: String,
    #[serde(rename = "requireOrigin")]
    pub require_origin: bool,
    #[serde(rename = "requireNonce")]
    pub require_nonce: bool,
    #[serde(rename = "requireAllowlist")]
    pub require_allowlist: bool,
    #[serde(rename = "forbidEval")]
    pub forbid_eval: bool,
    #[serde(rename = "capabilityIds", default)]
    pub capability_ids: Vec<String>,
}

impl BridgeProtocolManifest {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// WebView deployment profile — Delivery for WebSurface inside NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WebViewDeploymentProfile {
    pub schema: String,
    /// `local` | `remote` | `hybrid` — remote must not be silent default.
    #[serde(rename = "assetMode")]
    pub asset_mode: String,
    pub identity: ApplicationIdentity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub csp: Option<String>,
    #[serde(rename = "bridge")]
    pub bridge: BridgeProtocolManifest,
    #[serde(rename = "capabilities", default)]
    pub capabilities: Vec<NativeCapability>,
    /// Provenance: Browser/Web plan schema this WebSurface artifact lowers from.
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Browser artifact reuse — WebView does not invent a second View lowering.
    #[serde(rename = "reusesBrowserLowering")]
    pub reuses_browser_lowering: bool,
    #[serde(rename = "updateChannel", default, skip_serializing_if = "Option::is_none")]
    pub update_channel: Option<String>,
    #[serde(rename = "rollbackPolicy", default, skip_serializing_if = "Option::is_none")]
    pub rollback_policy: Option<String>,
    #[serde(rename = "offlinePolicy", default, skip_serializing_if = "Option::is_none")]
    pub offline_policy: Option<String>,
}

impl WebViewDeploymentProfile {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostDiagnostic {
    pub path: String,
    pub severity: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeHostCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    #[serde(rename = "webviewDeployment")]
    pub webview_deployment: WebViewDeploymentProfile,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    /// `ready` | `incomplete` | `failed`
    pub status: String,
}

impl NativeHostCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Local bundled WebSurface entry artifacts (Browser Direct reuse).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocalBundledEntry {
    pub schema: String,
    #[serde(rename = "clientJs")]
    pub client_js: String,
    #[serde(rename = "domHost")]
    pub dom_host: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
    #[serde(rename = "entryUrl")]
    pub entry_url: String,
}

impl LocalBundledEntry {
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

/// Deep link / universal link map entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeepLinkEntry {
    pub schema: String,
    pub scheme: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub host: Option<String>,
    pub path: String,
    #[serde(rename = "routeId")]
    pub route_id: String,
}

impl DeepLinkEntry {
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

/// Platform adapter stub — shared schema, platform-specific packaging only.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellPlatformAdapter {
    pub platform: String,
    pub kind: String,
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
}

/// Native WebView shell manifest (algebraic — not Xcode/Gradle projects).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeWebViewShellManifest {
    pub schema: String,
    pub identity: ApplicationIdentity,
    #[serde(rename = "assetMode")]
    pub asset_mode: String,
    #[serde(rename = "reusesBrowserLowering")]
    pub reuses_browser_lowering: bool,
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    pub entry: LocalBundledEntry,
    pub hooks: Vec<String>,
    #[serde(rename = "deepLinks", default)]
    pub deep_links: Vec<DeepLinkEntry>,
    pub logging: ShellLoggingPolicy,
    pub adapters: Vec<ShellPlatformAdapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShellLoggingPolicy {
    pub level: String,
    #[serde(rename = "redactSensitive")]
    pub redact_sensitive: bool,
}

impl NativeWebViewShellManifest {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// shell check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeShellCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    pub shell: NativeWebViewShellManifest,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeShellCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Bridge call trace context (must redact sensitive data).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeTraceContext {
    pub schema: String,
    #[serde(rename = "correlationId")]
    pub correlation_id: String,
    #[serde(rename = "routeId", default, skip_serializing_if = "Option::is_none")]
    pub route_id: Option<String>,
    #[serde(rename = "redactSensitive")]
    pub redact_sensitive: bool,
}

impl BridgeTraceContext {
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
    pub schema: String,
    #[serde(rename = "callId")]
    pub call_id: String,
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    #[serde(rename = "capabilityVersion")]
    pub capability_version: String,
    pub origin: String,
    pub nonce: String,
    pub sequence: u64,
    #[serde(rename = "inputSchema", default, skip_serializing_if = "Option::is_none")]
    pub input_schema: Option<String>,
    #[serde(rename = "outputSchema", default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<String>,
    pub permissions: Vec<String>,
    #[serde(rename = "timeoutMs")]
    pub timeout_ms: u64,
    pub cancellation: bool,
    pub trace: BridgeTraceContext,
}

impl NativeCapabilityCall {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// First-batch stub catalog (algebraic — not real-device adapters yet).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BridgeStubCatalog {
    pub schema: String,
    pub stubs: Vec<NativeCapability>,
    #[serde(rename = "allowlist")]
    pub allowlist: Vec<String>,
}

impl BridgeStubCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// bridge check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeBridgeCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    #[serde(rename = "stubCatalog")]
    pub stub_catalog: BridgeStubCatalog,
    #[serde(rename = "sampleCalls", default)]
    pub sample_calls: Vec<NativeCapabilityCall>,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeBridgeCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Persistence policy for WebView state across crash/restore (explicit, not JS heap).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PersistencePolicy {
    pub schema: String,
    pub enabled: bool,
    /// e.g. `capability_backed` | `bundled_snapshot` — never implicit JS memory.
    pub mode: String,
    #[serde(rename = "reauthOnRestore")]
    pub reauth_on_restore: bool,
}

/// Update / rollback channel policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct UpdatePolicy {
    pub schema: String,
    pub channel: String,
    pub rollback: String,
}

/// Offline resource policy for local/hybrid delivery.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OfflinePolicy {
    pub schema: String,
    /// e.g. `bundled_only` | `hybrid_cache` — not `none` for .
    pub mode: String,
}

/// NativeAppHost lifecycle policy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeAppLifecyclePolicy {
    pub schema: String,
    pub events: Vec<String>,
    /// Hard rule: background ≠ destroy.
    #[serde(rename = "backgroundEqualsDestroy")]
    pub background_equals_destroy: bool,
    /// Hard rule: crash restore must not assume JS heap.
    #[serde(rename = "crashRestoreAssumesJsHeap")]
    pub crash_restore_assumes_js_heap: bool,
    #[serde(rename = "disposeRegionsOnDestroy")]
    pub dispose_regions_on_destroy: bool,
    pub persistence: PersistencePolicy,
    pub update: UpdatePolicy,
    pub offline: OfflinePolicy,
}

impl NativeAppLifecyclePolicy {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// lifecycle check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeLifecycleCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    pub lifecycle: NativeAppLifecyclePolicy,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeLifecycleCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// SSR first-paint policy for WebSurface inside NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SsrFirstPaintPolicy {
    pub schema: String,
    pub enabled: bool,
    /// `bundled` | `remote` | `hybrid`
    pub mode: String,
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    /// Integrity evidence required for remote/hybrid SSR.
    #[serde(default)]
    pub integrity: String,
    /// Must stay false — bundled and remote SSR cannot share cookie/origin assumptions.
    #[serde(rename = "allowMixedCookieAssumptions", default)]
    pub allow_mixed_cookie_assumptions: bool,
}

/// `#server` transport binding — Native bridge must not bypass this.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerTransportPolicy {
    pub schema: String,
    /// Must be `#server`.
    pub scheme: String,
    pub endpoint: String,
    #[serde(rename = "bridgeBypassesServer", default)]
    pub bridge_bypasses_server: bool,
}

/// Auth / session isolation for WebView host.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuthSessionPolicy {
    pub schema: String,
    pub mode: String,
    #[serde(rename = "sessionNamespace")]
    pub session_namespace: String,
    #[serde(rename = "reauthOnWebViewCrash")]
    pub reauth_on_webview_crash: bool,
}

/// Push capability declaration (stub ok for ).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PushPolicy {
    pub schema: String,
    #[serde(rename = "capabilityId")]
    pub capability_id: String,
    pub stub: bool,
}

/// Network policy for NativeAppHost.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NetworkPolicy {
    pub schema: String,
    pub mode: String,
    #[serde(rename = "allowCleartext", default)]
    pub allow_cleartext: bool,
}

/// NativeAppHost full-stack profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeFullstackProfile {
    pub schema: String,
    pub ssr: SsrFirstPaintPolicy,
    #[serde(rename = "serverTransport")]
    pub server_transport: ServerTransportPolicy,
    pub auth: AuthSessionPolicy,
    pub push: PushPolicy,
    pub network: NetworkPolicy,
    /// `local` | `remote` | `hybrid` delivery of WebSurface assets.
    #[serde(rename = "deliveryAssetMode")]
    pub delivery_asset_mode: String,
    #[serde(rename = "deliveryIntegrity", default)]
    pub delivery_integrity: String,
}

impl NativeFullstackProfile {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// fullstack check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeFullstackCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    pub fullstack: NativeFullstackProfile,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeFullstackCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// Cross-boundary data contract between WebSurface and NativeSurface.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceBoundary {
    pub schema: String,
    pub serializable: bool,
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    #[serde(rename = "traceRequired")]
    pub trace_required: bool,
}

/// NativeSurface manifest (local Surface driver — not a second semantic core).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceManifest {
    pub schema: String,
    #[serde(rename = "surfaceId")]
    pub surface_id: String,
    /// `camera` | `map` | `video` for first high-value surface.
    pub kind: String,
    #[serde(rename = "ownerRegionId")]
    pub owner_region_id: String,
    pub lifetime: String,
    #[serde(rename = "disposeOnOwnerDestroy")]
    pub dispose_on_owner_destroy: bool,
    #[serde(rename = "sharesImplicitWebViewState", default)]
    pub shares_implicit_webview_state: bool,
    /// Must stay false — preview surface ≠ capture capability.
    #[serde(rename = "confusedWithCapability", default)]
    pub confused_with_capability: bool,
    /// Must stay false — VPG/Plan remain sole semantic IR.
    #[serde(rename = "isSemanticTruthSource", default)]
    pub is_semantic_truth_source: bool,
    #[serde(rename = "planSchema")]
    pub plan_schema: String,
    #[serde(rename = "reusesViewOperations")]
    pub reuses_view_operations: bool,
    pub boundary: NativeSurfaceBoundary,
    /// Related NativeBacked capability id (distinct from this surface).
    #[serde(rename = "relatedCapabilityId", default, skip_serializing_if = "Option::is_none")]
    pub related_capability_id: Option<String>,
}

impl NativeSurfaceManifest {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// native surface check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeSurfaceCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    pub surface: NativeSurfaceManifest,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeSurfaceCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// shared Host Profile schemas — identical for every platform adapter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiPlatformSharedContracts {
    pub schema: String,
    #[serde(rename = "bridgeSchema")]
    pub bridge_schema: String,
    #[serde(rename = "capabilityCallSchema")]
    pub capability_call_schema: String,
    #[serde(rename = "surfaceSchema")]
    pub surface_schema: String,
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
    #[serde(rename = "deploymentSchema")]
    pub deployment_schema: String,
    #[serde(rename = "fullstackSchema")]
    pub fullstack_schema: String,
    #[serde(rename = "testContractSchema")]
    pub test_contract_schema: String,
}

impl MultiPlatformSharedContracts {
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

/// platform packaging adapter (stub only — not Xcode/Gradle semantics).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MultiPlatformAdapter {
    pub schema: String,
    pub platform: String,
    /// Must be `packaging_stub` for first version.
    pub kind: String,
    #[serde(rename = "bridgeSchema")]
    pub bridge_schema: String,
    #[serde(rename = "capabilityCallSchema")]
    pub capability_call_schema: String,
    #[serde(rename = "surfaceSchema")]
    pub surface_schema: String,
    #[serde(rename = "shellSchema")]
    pub shell_schema: String,
    #[serde(rename = "deploymentSchema")]
    pub deployment_schema: String,
    #[serde(rename = "fullstackSchema")]
    pub fullstack_schema: String,
    #[serde(rename = "testContractSchema")]
    pub test_contract_schema: String,
    /// Packaging only — must not carry Host Profile / Program Graph semantics.
    #[serde(rename = "packagingOnly")]
    pub packaging_only: bool,
    /// Must stay false — adapters are not a second semantic core.
    #[serde(rename = "isSemanticTruthSource", default)]
    pub is_semantic_truth_source: bool,
}

impl MultiPlatformAdapter {
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

/// multi-platform Host Profile freeze (iOS + Android, shared schemas).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeMultiPlatformManifest {
    pub schema: String,
    pub shared: MultiPlatformSharedContracts,
    pub platforms: Vec<String>,
    pub adapters: Vec<MultiPlatformAdapter>,
    /// Must stay false — no platform-private Host Profile fork.
    #[serde(rename = "allowsPlatformSemanticFork", default)]
    pub allows_platform_semantic_fork: bool,
}

impl NativeMultiPlatformManifest {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// multi-platform check report.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NativeMultiPlatformCheckReport {
    pub schema: String,
    pub catalog: NativeHostProtocolCatalog,
    pub multi_platform: NativeMultiPlatformManifest,
    #[serde(default)]
    pub diagnostics: Vec<NativeHostDiagnostic>,
    pub status: String,
}

impl NativeMultiPlatformCheckReport {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
