//! Parse / validate static delivery artifacts (`StaticEmitPlan`, `AssetPlan`, …).

use vmz_protocol::{
    ASSET_PLAN_SCHEMA, CONTENT_ADDRESSED_ASSETS_SCHEMA, ContentAddressedAssetsManifest,
    STATIC_DELIVERY_MANIFEST_SCHEMA, STATIC_EMIT_PLAN_SCHEMA, StaticDeliveryManifest,
    StaticEmitPlan,
};

use crate::error::ArtifactError;

/// Parse and validate `_vmz/static-emit-plan.json`.
pub fn parse_static_emit_plan(text: &str) -> Result<StaticEmitPlan, ArtifactError> {
    let doc: StaticEmitPlan = serde_json::from_str(text)?;
    validate_static_emit_plan(&doc)?;
    Ok(doc)
}

/// Validate schema id and locale link plan shape.
pub fn validate_static_emit_plan(doc: &StaticEmitPlan) -> Result<(), ArtifactError> {
    if doc.schema != STATIC_EMIT_PLAN_SCHEMA {
        return Err(ArtifactError::Schema(doc.schema.clone()));
    }
    if doc.locale_links.schema != vmz_protocol::LOCALE_LINK_PLAN_SCHEMA {
        return Err(ArtifactError::Schema(doc.locale_links.schema.clone()));
    }
    Ok(())
}

/// Parse and validate `_vmz/asset-plan.json`.
pub fn parse_asset_plan(text: &str) -> Result<vmz_protocol::AssetPlan, ArtifactError> {
    let doc: vmz_protocol::AssetPlan = serde_json::from_str(text)?;
    validate_asset_plan(&doc)?;
    Ok(doc)
}

/// Validate asset plan schema id.
pub fn validate_asset_plan(doc: &vmz_protocol::AssetPlan) -> Result<(), ArtifactError> {
    if doc.schema != ASSET_PLAN_SCHEMA {
        return Err(ArtifactError::Schema(doc.schema.clone()));
    }
    Ok(())
}

/// Parse and validate `_vmz/content-addressed-assets.json`.
pub fn parse_content_addressed_assets(text: &str) -> Result<ContentAddressedAssetsManifest, ArtifactError> {
    let doc: ContentAddressedAssetsManifest = serde_json::from_str(text)?;
    validate_content_addressed_assets(&doc)?;
    Ok(doc)
}

/// Validate content-addressed manifest schema id.
pub fn validate_content_addressed_assets(doc: &ContentAddressedAssetsManifest) -> Result<(), ArtifactError> {
    if doc.schema != CONTENT_ADDRESSED_ASSETS_SCHEMA {
        return Err(ArtifactError::Schema(doc.schema.clone()));
    }
    Ok(())
}

/// Parse and validate `_vmz/static-delivery-manifest.json` (minimal closure fields).
pub fn parse_static_delivery_manifest(text: &str) -> Result<StaticDeliveryManifest, ArtifactError> {
    let doc: StaticDeliveryManifest = serde_json::from_str(text)?;
    validate_static_delivery_manifest(&doc)?;
    Ok(doc)
}

/// Validate static delivery manifest schema id and content-addressed link.
pub fn validate_static_delivery_manifest(doc: &StaticDeliveryManifest) -> Result<(), ArtifactError> {
    if doc.schema != STATIC_DELIVERY_MANIFEST_SCHEMA {
        return Err(ArtifactError::Schema(doc.schema.clone()));
    }
    let Some(link) = &doc.content_addressed_assets else {
        return Err(ArtifactError::Message(
            "StaticDeliveryManifest missing contentAddressedAssets link".into(),
        ));
    };
    if link.schema != CONTENT_ADDRESSED_ASSETS_SCHEMA {
        return Err(ArtifactError::Schema(link.schema.clone()));
    }
    if link.manifest_digest.is_empty() {
        return Err(ArtifactError::Message(
            "StaticDeliveryManifest contentAddressedAssets.manifestDigest is empty".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const EMIT_PLAN: &str = r#"{
  "schema": "vmz.static.emit_plan.v0",
  "applicationId": "demo",
  "deliveryProfile": "static",
  "origin": "https://example.test",
  "localeLinks": {
    "schema": "vmz.static.locale_link_plan.v0",
    "rows": [
      { "routeId": "AboutPage", "localeId": "en-us", "href": "/en-us/about" }
    ]
  },
  "assetPlanPath": "_vmz/asset-plan.json",
  "routes": []
}"#;

    const ASSET_PLAN: &str = r#"{
  "schema": "vmz.asset.plan.v0",
  "layout": "assets/<sha256>.<ext>",
  "immutable": true,
  "candidates": ["entry-client.js", "vmz.css"]
}"#;

    const CONTENT_MANIFEST: &str = r#"{
  "schema": "vmz.content_addressed_assets.v0",
  "layout": "assets/<sha256>.<ext>",
  "immutable": true,
  "objectCount": 1,
  "objects": [
    {
      "logicalPath": "entry-client.js",
      "assetPath": "assets/abc123.js",
      "digest": "abc123",
      "bytes": 10,
      "immutable": true
    }
  ],
  "rewrittenHtml": 0,
  "manifestDigest": "deadbeef"
}"#;

    const DELIVERY_MANIFEST: &str = r#"{
  "schema": "vmz.static.delivery_manifest.v0",
  "applicationId": "demo",
  "deliveryProfile": "static",
  "origin": "https://example.test",
  "contentAddressedAssets": {
    "schema": "vmz.content_addressed_assets.v0",
    "manifestDigest": "deadbeef",
    "objectCount": 1,
    "layout": "assets/<sha256>.<ext>"
  }
}"#;

    #[test]
    fn static_emit_plan_fixture_parses() {
        parse_static_emit_plan(EMIT_PLAN).expect("emit plan");
    }

    #[test]
    fn asset_plan_fixture_parses() {
        parse_asset_plan(ASSET_PLAN).expect("asset plan");
    }

    #[test]
    fn content_addressed_fixture_parses() {
        parse_content_addressed_assets(CONTENT_MANIFEST).expect("content addressed");
    }

    #[test]
    fn static_delivery_manifest_requires_asset_link() {
        parse_static_delivery_manifest(DELIVERY_MANIFEST).expect("delivery manifest");
        let bad = DELIVERY_MANIFEST.replace("\"manifestDigest\": \"deadbeef\"", "\"manifestDigest\": \"\"");
        assert!(parse_static_delivery_manifest(&bad).is_err());
    }
}
