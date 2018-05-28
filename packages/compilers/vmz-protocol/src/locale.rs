//! `/locales` application i18n protocol (doc 28 · I0–I5).
//!
//! Freezes LocaleManifest / MessageCatalog / LocaleContext / FormatterContext /
//! LocaleTransition / LocaleRouteRealization / PageMeta / LocaleDeliveryResolution /
//! tooling (explain/diff/extract/pseudo) / conformance check schemas and diagnostics.
//! Locale/Message are VPG query views — not a competing I18n IR.

use serde::{Deserialize, Serialize};

/// Umbrella locale protocol.
pub const LOCALE_PROTOCOL: &str = "vmz.locale.protocol.v0";

pub const LOCALE_MANIFEST_SCHEMA: &str = "vmz.locale.manifest.v0";
pub const MESSAGE_CATALOG_SCHEMA: &str = "vmz.locale.message_catalog.v0";
pub const MESSAGE_NODE_SCHEMA: &str = "vmz.locale.message_node.v0";
pub const LOCALE_CHECK_SCHEMA: &str = "vmz.locale.check.v0";
pub const LOCALE_TYPED_MODULE_SCHEMA: &str = "vmz.locale.typed_module.v0";
pub const LOCALE_RENAME_SCHEMA: &str = "vmz.locale.rename.v0";
/// I2: Application Execution Context locale slice.
pub const LOCALE_APPLICATION_CONTEXT_SCHEMA: &str = "vmz.locale.application_context.v0";
/// I2: deterministic number/date/plural formatting context.
pub const LOCALE_FORMATTER_CONTEXT_SCHEMA: &str = "vmz.locale.formatter_context.v0";
/// I2: atomic language switch plan / result.
pub const LOCALE_TRANSITION_SCHEMA: &str = "vmz.locale.transition.v0";
/// I2: runtime / SSR parity check report.
pub const LOCALE_RUNTIME_CHECK_SCHEMA: &str = "vmz.locale.runtime_check.v0";
/// I2: whole-message fallback resolution provenance.
pub const LOCALE_FALLBACK_RESOLUTION_SCHEMA: &str = "vmz.locale.fallback_resolution.v0";
/// I3: RouteId × LocaleId → path realization (LocaleId not in RouteId).
pub const LOCALE_ROUTE_REALIZATION_SCHEMA: &str = "vmz.locale.route_realization.v0";
/// I3: locale-aware PageMeta (canonical / hreflang / html lang+dir).
pub const LOCALE_PAGE_META_SCHEMA: &str = "vmz.locale.page_meta.v0";
/// I3: `<Link to=RouteId>` resolution retaining current locale.
pub const LOCALE_LINK_RESOLUTION_SCHEMA: &str = "vmz.locale.link_resolution.v0";
/// I3: router / meta / cache-key check report.
pub const LOCALE_ROUTER_CHECK_SCHEMA: &str = "vmz.locale.router_check.v0";
/// I4: multi-host LocaleDeliveryResolution.
pub const LOCALE_DELIVERY_RESOLUTION_SCHEMA: &str = "vmz.locale.delivery_resolution.v0";
/// I4: per-locale / per-route message chunk manifest.
pub const LOCALE_CHUNK_MANIFEST_SCHEMA: &str = "vmz.locale.chunk_manifest.v0";
/// I4: signed Native optional locale pack (catalog+formatter only).
pub const LOCALE_NATIVE_PACK_SCHEMA: &str = "vmz.locale.native_pack.v0";
/// I4: Mini Program cross-subpackage message dependency proof.
pub const LOCALE_MINI_PACKAGE_PROOF_SCHEMA: &str = "vmz.locale.mini_package_proof.v0";
/// I4: server ErrorCode envelope (no translated strings across boundary).
pub const LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA: &str = "vmz.locale.server_error_envelope.v0";
/// I4: multi-host delivery check report.
pub const LOCALE_DELIVERY_CHECK_SCHEMA: &str = "vmz.locale.delivery_check.v0";
/// I5: message explain document.
pub const LOCALE_EXPLAIN_SCHEMA: &str = "vmz.locale.explain.v0";
/// I5: locale-to-locale catalog diff.
pub const LOCALE_DIFF_SCHEMA: &str = "vmz.locale.diff.v0";
/// I5: hardcoded text extract / sink check.
pub const LOCALE_EXTRACT_SCHEMA: &str = "vmz.locale.extract.v0";
/// I5: pseudo-localization catalog (dev/test only).
pub const LOCALE_PSEUDO_SCHEMA: &str = "vmz.locale.pseudo.v0";
/// I5: cross-host conformance report.
pub const LOCALE_CONFORMANCE_SCHEMA: &str = "vmz.locale.conformance.v0";

/// Shared formatter data version recorded in Delivery / Resume digests.
pub const FORMATTER_DATA_VERSION: &str = "vmz.formatter.cldr.v0";

/// I0 diagnostics (doc 28 §12).
pub const DIAG_LOCALE_MANIFEST_MISSING: &str = "vmz::locale::manifest_missing";
pub const DIAG_LOCALE_ID_INVALID: &str = "vmz::locale::id_invalid";
pub const DIAG_LOCALE_ID_COLLISION: &str = "vmz::locale::id_collision";
pub const DIAG_LOCALE_DEFAULT_MISSING: &str = "vmz::locale::default_missing";
pub const DIAG_LOCALE_FALLBACK_CYCLE: &str = "vmz::locale::fallback_cycle";
pub const DIAG_LOCALE_FALLBACK_UNKNOWN: &str = "vmz::locale::fallback_unknown";
pub const DIAG_LOCALE_DIR_ORPHAN: &str = "vmz::locale::dir_orphan";
pub const DIAG_LOCALE_DIR_MISSING: &str = "vmz::locale::dir_missing";
pub const DIAG_LOCALE_LAYOUT_ILLEGAL: &str = "vmz::locale::layout_illegal";
pub const DIAG_MESSAGE_MISSING_DEFAULT: &str = "vmz::locale::message_missing_default";
pub const DIAG_MESSAGE_MISSING_VARIANT: &str = "vmz::locale::message_missing_variant";
pub const DIAG_MESSAGE_PARAMETER_MISMATCH: &str = "vmz::locale::message_parameter_mismatch";
pub const DIAG_MESSAGE_SYNTAX_INVALID: &str = "vmz::locale::message_syntax_invalid";
pub const DIAG_MESSAGE_ARRAY_FORBIDDEN: &str = "vmz::locale::message_array_forbidden";
pub const DIAG_MESSAGE_UNUSED: &str = "vmz::locale::message_unused";
pub const DIAG_MESSAGE_HTML_FORBIDDEN: &str = "vmz::locale::message_html_forbidden";
pub const DIAG_CATALOG_PARSE: &str = "vmz::locale::catalog_parse";
pub const DIAG_CATALOG_CONFLICT: &str = "vmz::locale::catalog_conflict";
/// I2 diagnostics (doc 28 §8 / §5 / §12).
pub const DIAG_FORMATTER_CONTEXT_INCOMPLETE: &str = "vmz::locale::formatter_context_incomplete";
pub const DIAG_FORMATTER_VERSION_MISMATCH: &str = "vmz::locale::formatter_version_mismatch";
pub const DIAG_LOCALE_DIGEST_MISMATCH: &str = "vmz::locale::digest_mismatch";
pub const DIAG_LOCALE_TRANSITION_PARTIAL: &str = "vmz::locale::transition_partial";
pub const DIAG_LOCALE_TRANSITION_UNSUPPORTED: &str = "vmz::locale::transition_unsupported";
pub const DIAG_LOCALE_TRANSITION_LOAD_FAILED: &str = "vmz::locale::transition_load_failed";
pub const DIAG_LOCALE_MACHINE_DEFAULT_FORBIDDEN: &str = "vmz::locale::machine_default_forbidden";
pub const DIAG_MESSAGE_MIXED_LOCALE: &str = "vmz::locale::message_mixed_locale";
pub const DIAG_LOCALE_STALE_GENERATION: &str = "vmz::locale::stale_generation";
/// I3 diagnostics (doc 28 §6 / §10 / §12).
pub const DIAG_LOCALE_ROUTE_COLLISION: &str = "vmz::locale::route_collision";
pub const DIAG_LOCALE_CANONICAL_MISSING: &str = "vmz::locale::canonical_missing";
pub const DIAG_LOCALE_HREFLANG_INCOMPLETE: &str = "vmz::locale::hreflang_incomplete";
pub const DIAG_LOCALE_META_LOCALE_MISMATCH: &str = "vmz::locale::meta_locale_mismatch";
pub const DIAG_LOCALE_LINK_HARDCODED_PATH: &str = "vmz::locale::link_hardcoded_path";
pub const DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT: &str = "vmz::locale::cache_key_steals_content";
pub const DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT: &str =
    "vmz::locale::prefix_omit_without_redirect";
/// I4 diagnostics (doc 28 §9 / §10 / §12).
pub const DIAG_LOCALE_DELIVERY_FULL_BUNDLE: &str = "vmz::locale::delivery_full_bundle";
pub const DIAG_LOCALE_CHUNK_HASH_MISMATCH: &str = "vmz::locale::chunk_hash_mismatch";
pub const DIAG_LOCALE_NATIVE_PACK_UNSIGNED: &str = "vmz::locale::native_pack_unsigned";
pub const DIAG_LOCALE_NATIVE_PACK_HAS_JS: &str = "vmz::locale::native_pack_has_js";
pub const DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH: &str = "vmz::locale::native_pack_app_mismatch";
pub const DIAG_LOCALE_MINI_CROSS_PACKAGE_UNPROVEN: &str =
    "vmz::locale::mini_cross_package_unproven";
pub const DIAG_LOCALE_SERVER_TRANSLATED_ERROR: &str = "vmz::locale::server_translated_error";
pub const DIAG_LOCALE_SERVER_FORMAT_WITHOUT_CONTEXT: &str =
    "vmz::locale::server_format_without_context";
pub const DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE: &str = "vmz::locale::host_message_divergence";
/// I5 diagnostics (doc 28 §12 / §13).
pub const DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED: &str = "vmz::locale::message_dynamic_id_unbounded";
pub const DIAG_LOCALE_HARDCODED_TEXT: &str = "vmz::locale::hardcoded_text";
pub const DIAG_LOCALE_PSEUDO_PRODUCTION_FORBIDDEN: &str =
    "vmz::locale::pseudo_production_forbidden";
pub const DIAG_LOCALE_CONFORMANCE_DIVERGENCE: &str = "vmz::locale::conformance_divergence";
pub const DIAG_LOCALE_EXPLAIN_UNKNOWN: &str = "vmz::locale::explain_unknown";

/// Reserved first-level names under `/locales` (not LocaleId directories).
pub const RESERVED_TOP: &[&str] = &["locales.json5", "locales.json", "package.json"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleDocumentKind {
    pub kind: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleProtocolCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<LocaleDocumentKind>,
    pub diagnostics: Vec<String>,
    /// Virtual module prefix authors must use (`#locales/`).
    #[serde(rename = "virtualModulePrefix")]
    pub virtual_module_prefix: String,
}

impl LocaleProtocolCatalog {
    pub fn v0() -> Self {
        Self {
            schema: LOCALE_PROTOCOL.into(),
            protocol: LOCALE_PROTOCOL.into(),
            documents: vec![
                LocaleDocumentKind {
                    kind: "manifest".into(),
                    schema: LOCALE_MANIFEST_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "message_catalog".into(),
                    schema: MESSAGE_CATALOG_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "message_node".into(),
                    schema: MESSAGE_NODE_SCHEMA.into(),
                },
                LocaleDocumentKind { kind: "check".into(), schema: LOCALE_CHECK_SCHEMA.into() },
                LocaleDocumentKind {
                    kind: "typed_module".into(),
                    schema: LOCALE_TYPED_MODULE_SCHEMA.into(),
                },
                LocaleDocumentKind { kind: "rename".into(), schema: LOCALE_RENAME_SCHEMA.into() },
                LocaleDocumentKind {
                    kind: "application_context".into(),
                    schema: LOCALE_APPLICATION_CONTEXT_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "formatter_context".into(),
                    schema: LOCALE_FORMATTER_CONTEXT_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "transition".into(),
                    schema: LOCALE_TRANSITION_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "runtime_check".into(),
                    schema: LOCALE_RUNTIME_CHECK_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "fallback_resolution".into(),
                    schema: LOCALE_FALLBACK_RESOLUTION_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "route_realization".into(),
                    schema: LOCALE_ROUTE_REALIZATION_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "page_meta".into(),
                    schema: LOCALE_PAGE_META_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "link_resolution".into(),
                    schema: LOCALE_LINK_RESOLUTION_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "router_check".into(),
                    schema: LOCALE_ROUTER_CHECK_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "delivery_resolution".into(),
                    schema: LOCALE_DELIVERY_RESOLUTION_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "chunk_manifest".into(),
                    schema: LOCALE_CHUNK_MANIFEST_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "native_pack".into(),
                    schema: LOCALE_NATIVE_PACK_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "mini_package_proof".into(),
                    schema: LOCALE_MINI_PACKAGE_PROOF_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "server_error_envelope".into(),
                    schema: LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA.into(),
                },
                LocaleDocumentKind {
                    kind: "delivery_check".into(),
                    schema: LOCALE_DELIVERY_CHECK_SCHEMA.into(),
                },
                LocaleDocumentKind { kind: "explain".into(), schema: LOCALE_EXPLAIN_SCHEMA.into() },
                LocaleDocumentKind { kind: "diff".into(), schema: LOCALE_DIFF_SCHEMA.into() },
                LocaleDocumentKind { kind: "extract".into(), schema: LOCALE_EXTRACT_SCHEMA.into() },
                LocaleDocumentKind { kind: "pseudo".into(), schema: LOCALE_PSEUDO_SCHEMA.into() },
                LocaleDocumentKind {
                    kind: "conformance".into(),
                    schema: LOCALE_CONFORMANCE_SCHEMA.into(),
                },
            ],
            diagnostics: vec![
                DIAG_LOCALE_MANIFEST_MISSING.into(),
                DIAG_LOCALE_ID_INVALID.into(),
                DIAG_LOCALE_ID_COLLISION.into(),
                DIAG_LOCALE_DEFAULT_MISSING.into(),
                DIAG_LOCALE_FALLBACK_CYCLE.into(),
                DIAG_LOCALE_FALLBACK_UNKNOWN.into(),
                DIAG_LOCALE_DIR_ORPHAN.into(),
                DIAG_LOCALE_DIR_MISSING.into(),
                DIAG_LOCALE_LAYOUT_ILLEGAL.into(),
                DIAG_MESSAGE_MISSING_DEFAULT.into(),
                DIAG_MESSAGE_MISSING_VARIANT.into(),
                DIAG_MESSAGE_PARAMETER_MISMATCH.into(),
                DIAG_MESSAGE_SYNTAX_INVALID.into(),
                DIAG_MESSAGE_ARRAY_FORBIDDEN.into(),
                DIAG_MESSAGE_UNUSED.into(),
                DIAG_MESSAGE_HTML_FORBIDDEN.into(),
                DIAG_CATALOG_PARSE.into(),
                DIAG_CATALOG_CONFLICT.into(),
                DIAG_FORMATTER_CONTEXT_INCOMPLETE.into(),
                DIAG_FORMATTER_VERSION_MISMATCH.into(),
                DIAG_LOCALE_DIGEST_MISMATCH.into(),
                DIAG_LOCALE_TRANSITION_PARTIAL.into(),
                DIAG_LOCALE_TRANSITION_UNSUPPORTED.into(),
                DIAG_LOCALE_TRANSITION_LOAD_FAILED.into(),
                DIAG_LOCALE_MACHINE_DEFAULT_FORBIDDEN.into(),
                DIAG_MESSAGE_MIXED_LOCALE.into(),
                DIAG_LOCALE_STALE_GENERATION.into(),
                DIAG_LOCALE_ROUTE_COLLISION.into(),
                DIAG_LOCALE_CANONICAL_MISSING.into(),
                DIAG_LOCALE_HREFLANG_INCOMPLETE.into(),
                DIAG_LOCALE_META_LOCALE_MISMATCH.into(),
                DIAG_LOCALE_LINK_HARDCODED_PATH.into(),
                DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT.into(),
                DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT.into(),
                DIAG_LOCALE_DELIVERY_FULL_BUNDLE.into(),
                DIAG_LOCALE_CHUNK_HASH_MISMATCH.into(),
                DIAG_LOCALE_NATIVE_PACK_UNSIGNED.into(),
                DIAG_LOCALE_NATIVE_PACK_HAS_JS.into(),
                DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH.into(),
                DIAG_LOCALE_MINI_CROSS_PACKAGE_UNPROVEN.into(),
                DIAG_LOCALE_SERVER_TRANSLATED_ERROR.into(),
                DIAG_LOCALE_SERVER_FORMAT_WITHOUT_CONTEXT.into(),
                DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE.into(),
                DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED.into(),
                DIAG_LOCALE_HARDCODED_TEXT.into(),
                DIAG_LOCALE_PSEUDO_PRODUCTION_FORBIDDEN.into(),
                DIAG_LOCALE_CONFORMANCE_DIVERGENCE.into(),
                DIAG_LOCALE_EXPLAIN_UNKNOWN.into(),
            ],
            virtual_module_prefix: "#locales/".into(),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleEntry {
    pub id: String,
    pub label: String,
    #[serde(default = "default_ltr")]
    pub direction: String,
}

fn default_ltr() -> String {
    "ltr".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleRoutingPolicy {
    pub strategy: String,
    #[serde(rename = "defaultPrefix", default = "default_include")]
    pub default_prefix: String,
}

fn default_include() -> String {
    "include".into()
}

/// Author-facing manifest shape (`locales/locales.json5`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleManifestFile {
    #[serde(rename = "schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "defaultLocale")]
    pub default_locale: String,
    pub locales: Vec<LocaleEntry>,
    #[serde(default)]
    pub fallback: std::collections::BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub routing: Option<LocaleRoutingPolicy>,
    #[serde(default = "default_missing")]
    pub missing: String,
}

fn default_missing() -> String {
    "error".into()
}

impl LocaleManifestFile {
    pub fn example_three_locales() -> Self {
        let mut fallback = std::collections::BTreeMap::new();
        fallback.insert("zh-hant".into(), vec!["zh-hans".into()]);
        fallback.insert("en-us".into(), vec![]);
        Self {
            schema_version: 1,
            default_locale: "zh-hans".into(),
            locales: vec![
                LocaleEntry {
                    id: "zh-hans".into(),
                    label: "简体中文".into(),
                    direction: "ltr".into(),
                },
                LocaleEntry {
                    id: "zh-hant".into(),
                    label: "繁體中文".into(),
                    direction: "ltr".into(),
                },
                LocaleEntry {
                    id: "en-us".into(),
                    label: "English".into(),
                    direction: "ltr".into(),
                },
            ],
            fallback,
            routing: Some(LocaleRoutingPolicy {
                strategy: "prefix".into(),
                default_prefix: "include".into(),
            }),
            missing: "error".into(),
        }
    }
}

/// Application Execution Context locale slice (doc 28 §5).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleApplicationContext {
    pub schema: String,
    #[serde(rename = "applicationId")]
    pub application_id: String,
    #[serde(rename = "deliveryId")]
    pub delivery_id: String,
    #[serde(rename = "localeId")]
    pub locale_id: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "numberingSystem")]
    pub numbering_system: Option<String>,
    pub direction: String,
    pub generation: u64,
}

impl LocaleApplicationContext {
    pub fn example_zh_hans() -> Self {
        Self {
            schema: LOCALE_APPLICATION_CONTEXT_SCHEMA.into(),
            application_id: "app.locales-fixture".into(),
            delivery_id: "delivery.web".into(),
            locale_id: "zh-hans".into(),
            time_zone: "Asia/Shanghai".into(),
            calendar: Some("gregory".into()),
            numbering_system: Some("latn".into()),
            direction: "ltr".into(),
            generation: 1,
        }
    }
}

/// Deterministic formatter context shared by SSR and client (doc 28 §8).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleFormatterContext {
    pub schema: String,
    #[serde(rename = "localeId")]
    pub locale_id: String,
    #[serde(rename = "timeZone")]
    pub time_zone: String,
    pub calendar: String,
    #[serde(rename = "numberingSystem")]
    pub numbering_system: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    #[serde(rename = "formatterDataVersion")]
    pub formatter_data_version: String,
}

impl LocaleFormatterContext {
    pub fn from_application(app: &LocaleApplicationContext, currency: Option<&str>) -> Self {
        Self {
            schema: LOCALE_FORMATTER_CONTEXT_SCHEMA.into(),
            locale_id: app.locale_id.clone(),
            time_zone: app.time_zone.clone(),
            calendar: app.calendar.clone().unwrap_or_else(|| "gregory".into()),
            numbering_system: app.numbering_system.clone().unwrap_or_else(|| "latn".into()),
            currency: currency.map(|s| s.to_string()),
            formatter_data_version: FORMATTER_DATA_VERSION.into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_freezes_i0_schemas() {
        let c = LocaleProtocolCatalog::v0();
        assert_eq!(c.protocol, LOCALE_PROTOCOL);
        assert!(
            c.documents.iter().any(|d| d.kind == "manifest" && d.schema == LOCALE_MANIFEST_SCHEMA)
        );
        assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_FALLBACK_CYCLE));
        assert_eq!(c.virtual_module_prefix, "#locales/");
        let m = LocaleManifestFile::example_three_locales();
        assert_eq!(m.locales.len(), 3);
        assert_eq!(m.default_locale, "zh-hans");
    }

    #[test]
    fn catalog_freezes_i2_runtime_schemas() {
        let c = LocaleProtocolCatalog::v0();
        assert!(
            c.documents.iter().any(|d| d.kind == "application_context"
                && d.schema == LOCALE_APPLICATION_CONTEXT_SCHEMA)
        );
        assert!(
            c.documents
                .iter()
                .any(|d| d.kind == "formatter_context"
                    && d.schema == LOCALE_FORMATTER_CONTEXT_SCHEMA)
        );
        assert!(
            c.documents
                .iter()
                .any(|d| d.kind == "transition" && d.schema == LOCALE_TRANSITION_SCHEMA)
        );
        assert!(c.diagnostics.iter().any(|d| d == DIAG_FORMATTER_CONTEXT_INCOMPLETE));
        assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_DIGEST_MISMATCH));
        let app = LocaleApplicationContext::example_zh_hans();
        let fmt = LocaleFormatterContext::from_application(&app, None);
        assert_eq!(fmt.formatter_data_version, FORMATTER_DATA_VERSION);
        assert_eq!(fmt.locale_id, "zh-hans");
        assert_eq!(fmt.time_zone, "Asia/Shanghai");
    }
}
