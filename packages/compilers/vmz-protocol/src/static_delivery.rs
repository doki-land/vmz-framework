//! Static delivery wire — `StaticEmitPlan`, `AssetPlan`, and emitted manifest shapes.
//!
//! TS hosts (`static-emit`, `content-addressed-assets`) write these documents under
//! `dist/_vmz/`; Rust owns schema ids and serde shapes for N-API validation.

use serde::{Deserialize, Serialize};

/// Wire schema for the pre-emit static route/locale link plan.
pub const STATIC_EMIT_PLAN_SCHEMA: &str = "vmz.static.emit_plan.v0";

/// Wire schema for the pre-hash asset candidate plan.
pub const ASSET_PLAN_SCHEMA: &str = "vmz.asset.plan.v0";

/// Wire schema for the post-emit static delivery manifest.
pub const STATIC_DELIVERY_MANIFEST_SCHEMA: &str = "vmz.static.delivery_manifest.v0";

/// Wire schema for the post-hash content-addressed asset manifest.
pub const CONTENT_ADDRESSED_ASSETS_SCHEMA: &str = "vmz.content_addressed_assets.v0";

/// Wire schema for RouteId × LocaleId → href rows consumed by static-emit / serve-host.
pub const LOCALE_LINK_PLAN_SCHEMA: &str = "vmz.static.locale_link_plan.v0";

/// One RouteId × LocaleId href row (Plan-native link rewrite authority).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleLinkPlanRow {
    /// Stable RouteId carried on `data-vmz-route`.
    pub route_id: String,
    /// Target LocaleId for this href.
    pub locale_id: String,
    /// Browser path from route realization (not parsed from existing href).
    pub href: String,
}

/// Locale link rewrite table derived from route realization artifacts.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleLinkPlan {
    /// Always [`LOCALE_LINK_PLAN_SCHEMA`].
    pub schema: String,
    /// Ordered rows (routeId, localeId, href).
    #[serde(default)]
    pub rows: Vec<LocaleLinkPlanRow>,
}

impl LocaleLinkPlan {
    /// Empty plan with the frozen schema id.
    pub fn empty() -> Self {
        Self { schema: LOCALE_LINK_PLAN_SCHEMA.into(), rows: Vec::new() }
    }
}

/// Pre-hash asset candidate list (emit copies + manifest follows).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AssetPlan {
    /// Always [`ASSET_PLAN_SCHEMA`].
    pub schema: String,
    /// Layout pattern (`assets/<sha256>.<ext>`).
    pub layout: String,
    /// Whether emitted objects are immutable CDN candidates.
    pub immutable: bool,
    /// Logical dist-relative paths to hash (sorted).
    #[serde(default)]
    pub candidates: Vec<String>,
}

/// One hashed object in the content-addressed manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentAddressedAssetObject {
    /// Logical dist-relative path before hashing.
    pub logical_path: String,
    /// Hashed dist-relative path (`assets/<digest>.ext`).
    pub asset_path: String,
    /// SHA-256 hex digest of object bytes.
    pub digest: String,
    /// Object size in bytes.
    pub bytes: u64,
    /// True when the object is an immutable CDN candidate.
    pub immutable: bool,
}

/// Post-hash content-addressed asset manifest (`_vmz/content-addressed-assets.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ContentAddressedAssetsManifest {
    /// Always [`CONTENT_ADDRESSED_ASSETS_SCHEMA`].
    pub schema: String,
    /// Layout pattern (`assets/<sha256>.<ext>`).
    pub layout: String,
    /// Whether objects are immutable CDN candidates.
    pub immutable: bool,
    /// Number of objects in [`Self::objects`].
    pub object_count: u32,
    /// Hashed objects (sorted by logical path).
    #[serde(default)]
    pub objects: Vec<ContentAddressedAssetObject>,
    /// Legacy counter — HTML post-rewrite is forbidden; must stay `0`.
    #[serde(default)]
    pub rewritten_html: u32,
    /// Canonical digest of the manifest body (excluding this field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<String>,
}

/// One static route row inside [`StaticEmitPlan`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaticEmitRouteRow {
    /// Stable RouteId (page class or chunk id).
    pub route_id: String,
    /// Browser path for this generation.
    pub path: String,
    /// Deployment chunk id (`pages/...`).
    pub chunk_id: String,
    /// Dist-relative HTML path.
    pub html_path: String,
    /// Route classification (`Static`, …).
    pub classification: String,
    /// LocaleId when this row is locale-specific.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locale_id: Option<String>,
}

/// Pre-emit static delivery plan (`_vmz/static-emit-plan.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaticEmitPlan {
    /// Always [`STATIC_EMIT_PLAN_SCHEMA`].
    pub schema: String,
    /// Owning ApplicationId.
    pub application_id: String,
    /// Delivery profile id (`static`, …).
    pub delivery_profile: String,
    /// Site origin used for SEO absolutes.
    pub origin: String,
    /// Locale link rewrite authority (RouteId × LocaleId → href).
    pub locale_links: LocaleLinkPlan,
    /// Dist-relative path of the asset plan document.
    pub asset_plan_path: String,
    /// Per-route static generations planned/emitted.
    #[serde(default)]
    pub routes: Vec<StaticEmitRouteRow>,
}

/// Link from static delivery manifest to content-addressed assets.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaticDeliveryContentAddressedRef {
    /// Always [`CONTENT_ADDRESSED_ASSETS_SCHEMA`].
    pub schema: String,
    /// Digest of the linked content-addressed manifest.
    pub manifest_digest: String,
    /// Object count in the linked manifest.
    pub object_count: u32,
    /// Layout pattern echoed from the asset manifest.
    pub layout: String,
}

/// Post-emit static delivery manifest (`_vmz/static-delivery-manifest.json`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StaticDeliveryManifest {
    /// Always [`STATIC_DELIVERY_MANIFEST_SCHEMA`].
    pub schema: String,
    /// Owning ApplicationId.
    pub application_id: String,
    /// Delivery profile id.
    pub delivery_profile: String,
    /// Site origin.
    pub origin: String,
    /// Link to content-addressed assets (required for static closure).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_addressed_assets: Option<StaticDeliveryContentAddressedRef>,
    /// Canonical digest of the manifest body (excluding this field).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<String>,
}
