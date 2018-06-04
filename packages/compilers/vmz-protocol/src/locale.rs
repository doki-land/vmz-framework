//! `/locales` application i18n protocol.
//!
//! Freezes LocaleManifest / MessageCatalog / LocaleContext / FormatterContext /
//! LocaleTransition / LocaleRouteRealization / PageMeta / LocaleDeliveryResolution /
//! tooling (explain/diff/extract/pseudo) / conformance check schemas and diagnostics.
//! Locale/Message are VPG query views, not a competing I18n IR.

use serde::{Deserialize, Serialize};

/// Umbrella locale protocol id for handshake / catalog.
pub const LOCALE_PROTOCOL: &str = "vmz.locale.protocol.v0";

/// Schema id for the compiled LocaleManifest document.
pub const LOCALE_MANIFEST_SCHEMA: &str = "vmz.locale.manifest.v0";

/// Schema id for a per-locale MessageCatalog artifact.
pub const MESSAGE_CATALOG_SCHEMA: &str = "vmz.locale.message_catalog.v0";

/// Schema id for one Message node projected onto the Program Graph.
pub const MESSAGE_NODE_SCHEMA: &str = "vmz.locale.message_node.v0";

/// Schema id for the static locale check report.
pub const LOCALE_CHECK_SCHEMA: &str = "vmz.locale.check.v0";

/// Schema id for generated typed `#locales/...` module descriptors.
pub const LOCALE_TYPED_MODULE_SCHEMA: &str = "vmz.locale.typed_module.v0";

/// Schema id for locale-aware rename / workspace-edit plans.
pub const LOCALE_RENAME_SCHEMA: &str = "vmz.locale.rename.v0";

/// Schema id for the Application Execution Context locale slice.
pub const LOCALE_APPLICATION_CONTEXT_SCHEMA: &str = "vmz.locale.application_context.v0";

/// Schema id for deterministic number/date/plural formatting context.
pub const LOCALE_FORMATTER_CONTEXT_SCHEMA: &str = "vmz.locale.formatter_context.v0";

/// Schema id for an atomic language-switch plan / result.
pub const LOCALE_TRANSITION_SCHEMA: &str = "vmz.locale.transition.v0";

/// Schema id for runtime / SSR parity check reports.
pub const LOCALE_RUNTIME_CHECK_SCHEMA: &str = "vmz.locale.runtime_check.v0";

/// Schema id for whole-message fallback resolution provenance.
pub const LOCALE_FALLBACK_RESOLUTION_SCHEMA: &str = "vmz.locale.fallback_resolution.v0";

/// Schema id for RouteId x LocaleId -> path realization (LocaleId is not part of RouteId).
pub const LOCALE_ROUTE_REALIZATION_SCHEMA: &str = "vmz.locale.route_realization.v0";

/// Schema id for locale-aware PageMeta (canonical / hreflang / html lang+dir).
pub const LOCALE_PAGE_META_SCHEMA: &str = "vmz.locale.page_meta.v0";

/// Schema id for `<Link to=RouteId>` resolution that keeps the current locale.
pub const LOCALE_LINK_RESOLUTION_SCHEMA: &str = "vmz.locale.link_resolution.v0";

/// Schema id for router / meta / cache-key check reports.
pub const LOCALE_ROUTER_CHECK_SCHEMA: &str = "vmz.locale.router_check.v0";

/// Schema id for multi-host LocaleDeliveryResolution documents.
pub const LOCALE_DELIVERY_RESOLUTION_SCHEMA: &str = "vmz.locale.delivery_resolution.v0";

/// Schema id for per-locale / per-route message chunk manifests.
pub const LOCALE_CHUNK_MANIFEST_SCHEMA: &str = "vmz.locale.chunk_manifest.v0";

/// Schema id for signed Native optional locale packs (catalog + formatter only).
pub const LOCALE_NATIVE_PACK_SCHEMA: &str = "vmz.locale.native_pack.v0";

/// Schema id for Mini Program cross-subpackage message dependency proofs.
pub const LOCALE_MINI_PACKAGE_PROOF_SCHEMA: &str = "vmz.locale.mini_package_proof.v0";

/// Schema id for server ErrorCode envelopes (no translated strings across the boundary).
pub const LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA: &str = "vmz.locale.server_error_envelope.v0";

/// Schema id for multi-host delivery check reports.
pub const LOCALE_DELIVERY_CHECK_SCHEMA: &str = "vmz.locale.delivery_check.v0";

/// Schema id for message explain documents.
pub const LOCALE_EXPLAIN_SCHEMA: &str = "vmz.locale.explain.v0";

/// Schema id for locale-to-locale catalog diffs.
pub const LOCALE_DIFF_SCHEMA: &str = "vmz.locale.diff.v0";

/// Schema id for hardcoded-text extract / sink checks.
pub const LOCALE_EXTRACT_SCHEMA: &str = "vmz.locale.extract.v0";

/// Schema id for pseudo-localization catalogs (dev/test only).
pub const LOCALE_PSEUDO_SCHEMA: &str = "vmz.locale.pseudo.v0";

/// Schema id for cross-host locale conformance reports.
pub const LOCALE_CONFORMANCE_SCHEMA: &str = "vmz.locale.conformance.v0";

/// Shared formatter data version recorded in Delivery / Resume digests.
pub const FORMATTER_DATA_VERSION: &str = "vmz.formatter.cldr.v0";

/// Soft (warning for now): `/locales` manifest file is missing — LocaleId policy undeclared.
/// Still never silent; production profiles may elevate to error later.
pub const DIAG_LOCALE_MANIFEST_MISSING: &str = "vmz::locale::manifest_missing";

/// Hard: LocaleId failed ASCII BCP-47 normalization (case / separators / shape).
pub const DIAG_LOCALE_ID_INVALID: &str = "vmz::locale::id_invalid";

/// Hard: two LocaleIds collide after normalization.
pub const DIAG_LOCALE_ID_COLLISION: &str = "vmz::locale::id_collision";

/// Hard: `defaultLocale` is missing from the declared locales list.
pub const DIAG_LOCALE_DEFAULT_MISSING: &str = "vmz::locale::default_missing";

/// Hard: fallback graph contains a cycle.
pub const DIAG_LOCALE_FALLBACK_CYCLE: &str = "vmz::locale::fallback_cycle";

/// Hard: fallback entry names an unknown LocaleId.
pub const DIAG_LOCALE_FALLBACK_UNKNOWN: &str = "vmz::locale::fallback_unknown";

/// Hard: a locale directory exists with no matching manifest entry.
pub const DIAG_LOCALE_DIR_ORPHAN: &str = "vmz::locale::dir_orphan";

/// Hard: a manifest LocaleId has no corresponding `/locales/<id>` directory.
pub const DIAG_LOCALE_DIR_MISSING: &str = "vmz::locale::dir_missing";

/// Hard: locale directory layout violates the frozen contract.
pub const DIAG_LOCALE_LAYOUT_ILLEGAL: &str = "vmz::locale::layout_illegal";

/// Hard: message exists for a variant locale but not for the default locale.
pub const DIAG_MESSAGE_MISSING_DEFAULT: &str = "vmz::locale::message_missing_default";

/// Hard: required locale variant is missing for a message id.
pub const DIAG_MESSAGE_MISSING_VARIANT: &str = "vmz::locale::message_missing_variant";

/// Hard: message parameter names/types diverge across locales.
pub const DIAG_MESSAGE_PARAMETER_MISMATCH: &str = "vmz::locale::message_parameter_mismatch";

/// Hard: message template syntax is invalid.
pub const DIAG_MESSAGE_SYNTAX_INVALID: &str = "vmz::locale::message_syntax_invalid";

/// Hard: message value is an array (forbidden catalog shape).
pub const DIAG_MESSAGE_ARRAY_FORBIDDEN: &str = "vmz::locale::message_array_forbidden";

/// Advice (suppressible): message id is never referenced from the Program Graph.
pub const DIAG_MESSAGE_UNUSED: &str = "vmz::locale::message_unused";

/// Hard: raw HTML markup inside a message value is forbidden.
pub const DIAG_MESSAGE_HTML_FORBIDDEN: &str = "vmz::locale::message_html_forbidden";

/// Hard: message catalog file failed to parse.
pub const DIAG_CATALOG_PARSE: &str = "vmz::locale::catalog_parse";

/// Hard: conflicting definitions for the same message id.
pub const DIAG_CATALOG_CONFLICT: &str = "vmz::locale::catalog_conflict";

/// Hard: formatter context is missing required fields for deterministic format.
pub const DIAG_FORMATTER_CONTEXT_INCOMPLETE: &str = "vmz::locale::formatter_context_incomplete";

/// Hard: formatter data version disagrees between Delivery and Resume.
pub const DIAG_FORMATTER_VERSION_MISMATCH: &str = "vmz::locale::formatter_version_mismatch";

/// Hard: locale digest in the artifact does not match the compiled catalog.
pub const DIAG_LOCALE_DIGEST_MISMATCH: &str = "vmz::locale::digest_mismatch";

/// Hard: language transition completed only partially (mixed generation).
pub const DIAG_LOCALE_TRANSITION_PARTIAL: &str = "vmz::locale::transition_partial";

/// Hard: requested language transition is unsupported on this host.
pub const DIAG_LOCALE_TRANSITION_UNSUPPORTED: &str = "vmz::locale::transition_unsupported";

/// Hard: loading catalogs/chunks for a language transition failed.
pub const DIAG_LOCALE_TRANSITION_LOAD_FAILED: &str = "vmz::locale::transition_load_failed";

/// Hard: machine/runtime must not invent a default LocaleId when negotiation fails.
pub const DIAG_LOCALE_MACHINE_DEFAULT_FORBIDDEN: &str = "vmz::locale::machine_default_forbidden";

/// Hard: a single render mixed message strings from different LocaleIds.
pub const DIAG_MESSAGE_MIXED_LOCALE: &str = "vmz::locale::message_mixed_locale";

/// Hard: client resume used a stale locale generation.
pub const DIAG_LOCALE_STALE_GENERATION: &str = "vmz::locale::stale_generation";

/// Hard: realized locale paths collide for distinct RouteId x LocaleId pairs.
pub const DIAG_LOCALE_ROUTE_COLLISION: &str = "vmz::locale::route_collision";

/// Hard: canonical URL / locale is missing from PageMeta.
pub const DIAG_LOCALE_CANONICAL_MISSING: &str = "vmz::locale::canonical_missing";

/// Hard: hreflang alternate set is incomplete for declared locales.
pub const DIAG_LOCALE_HREFLANG_INCOMPLETE: &str = "vmz::locale::hreflang_incomplete";

/// Hard: PageMeta locale disagrees with the active LocaleId.
pub const DIAG_LOCALE_META_LOCALE_MISMATCH: &str = "vmz::locale::meta_locale_mismatch";

/// Hard: `<Link>` used a hardcoded path instead of RouteId (drops locale).
pub const DIAG_LOCALE_LINK_HARDCODED_PATH: &str = "vmz::locale::link_hardcoded_path";

/// Hard: cache key includes content that should vary only by locale digest.
pub const DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT: &str = "vmz::locale::cache_key_steals_content";

/// Hard: default locale omits URL prefix but no redirect policy was declared.
pub const DIAG_LOCALE_PREFIX_OMIT_WITHOUT_REDIRECT: &str =
    "vmz::locale::prefix_omit_without_redirect";

/// Hard: delivery shipped a full multi-locale bundle where chunking is required.
pub const DIAG_LOCALE_DELIVERY_FULL_BUNDLE: &str = "vmz::locale::delivery_full_bundle";

/// Hard: locale chunk content hash disagrees with the chunk manifest.
pub const DIAG_LOCALE_CHUNK_HASH_MISMATCH: &str = "vmz::locale::chunk_hash_mismatch";

/// Hard: Native locale pack is missing a required signature.
pub const DIAG_LOCALE_NATIVE_PACK_UNSIGNED: &str = "vmz::locale::native_pack_unsigned";

/// Hard: Native locale pack contains executable JS (only catalog/formatter allowed).
pub const DIAG_LOCALE_NATIVE_PACK_HAS_JS: &str = "vmz::locale::native_pack_has_js";

/// Hard: Native locale pack application id does not match the host app.
pub const DIAG_LOCALE_NATIVE_PACK_APP_MISMATCH: &str = "vmz::locale::native_pack_app_mismatch";

/// Hard: Mini Program cross-subpackage message dependency is unproven.
pub const DIAG_LOCALE_MINI_CROSS_PACKAGE_UNPROVEN: &str =
    "vmz::locale::mini_cross_package_unproven";

/// Hard: server returned a translated user string instead of an ErrorCode envelope.
pub const DIAG_LOCALE_SERVER_TRANSLATED_ERROR: &str = "vmz::locale::server_translated_error";

/// Hard: server formatted a message without a FormatterContext.
pub const DIAG_LOCALE_SERVER_FORMAT_WITHOUT_CONTEXT: &str =
    "vmz::locale::server_format_without_context";

/// Hard: host-rendered message diverges from the compiled catalog for the same id.
pub const DIAG_LOCALE_HOST_MESSAGE_DIVERGENCE: &str = "vmz::locale::host_message_divergence";

/// Hard: dynamic message id expression is not closed over a known set of ids.
pub const DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED: &str = "vmz::locale::message_dynamic_id_unbounded";

/// Advice (suppressible): author-facing hardcoded text should become a message id.
pub const DIAG_LOCALE_HARDCODED_TEXT: &str = "vmz::locale::hardcoded_text";

/// Hard: pseudo-localization catalog must not ship in production Delivery.
pub const DIAG_LOCALE_PSEUDO_PRODUCTION_FORBIDDEN: &str =
    "vmz::locale::pseudo_production_forbidden";

/// Hard: cross-host locale conformance found a divergence.
pub const DIAG_LOCALE_CONFORMANCE_DIVERGENCE: &str = "vmz::locale::conformance_divergence";

/// Hard: explain target (message id / locale) is unknown.
pub const DIAG_LOCALE_EXPLAIN_UNKNOWN: &str = "vmz::locale::explain_unknown";

/// Reserved first-level names under `/locales` (not LocaleId directories).
pub const RESERVED_TOP: &[&str] = &["locales.json5", "locales.json", "package.json"];

/// One document kind entry inside [`LocaleProtocolCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleDocumentKind {
    /// Kind id (`manifest`, `message_catalog`, `transition`, ...).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

/// Handshake catalog for the locale protocol domain.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleProtocolCatalog {
    /// Always [`LOCALE_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this generation publishes.
    pub documents: Vec<LocaleDocumentKind>,
    /// Stable diagnostic codes callers may see.
    pub diagnostics: Vec<String>,
    /// Virtual module prefix authors must use (`#locales/`).
    pub virtual_module_prefix: String,
}

impl LocaleProtocolCatalog {
    /// Frozen catalog for the current locale protocol generation.
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

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}

/// One LocaleId entry inside an author manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct LocaleEntry {
    /// Normalized LocaleId (`zh-hans`, `en-us`, ...).
    pub id: String,
    /// Human label for UI language pickers (may be non-ASCII).
    pub label: String,
    /// Text direction: `ltr` or `rtl`.
    #[serde(default = "default_ltr")]
    pub direction: String,
}

fn default_ltr() -> String {
    "ltr".into()
}

/// How LocaleId appears in public URLs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleRoutingPolicy {
    /// Strategy id (`prefix`, ...).
    pub strategy: String,
    /// Whether the default locale keeps its prefix: `include` | `omit`.
    #[serde(default = "default_include")]
    pub default_prefix: String,
}

fn default_include() -> String {
    "include".into()
}

/// Author-facing manifest shape (`locales/locales.json5`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleManifestFile {
    /// Author schema version integer.
    pub schema_version: u32,
    /// Default LocaleId for negotiation and optional prefix omit.
    pub default_locale: String,
    /// Declared locales for this application.
    pub locales: Vec<LocaleEntry>,
    /// Fallback chains keyed by LocaleId.
    #[serde(default)]
    pub fallback: std::collections::BTreeMap<String, Vec<String>>,
    /// Optional URL routing policy.
    #[serde(default)]
    pub routing: Option<LocaleRoutingPolicy>,
    /// Missing-message policy: `error` | other host-defined modes.
    #[serde(default = "default_missing")]
    pub missing: String,
}

fn default_missing() -> String {
    "error".into()
}

impl LocaleManifestFile {
    /// Fixture with `zh-hans` / `zh-hant` / `en-us` for checks and examples.
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

/// Application Execution Context locale slice carried across SSR and client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleApplicationContext {
    /// Always [`LOCALE_APPLICATION_CONTEXT_SCHEMA`].
    pub schema: String,
    /// Owning ApplicationId.
    pub application_id: String,
    /// Delivery id that produced this context.
    pub delivery_id: String,
    /// Active LocaleId.
    pub locale_id: String,
    /// IANA time zone id for formatting.
    pub time_zone: String,
    /// Optional calendar id (`gregory`, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calendar: Option<String>,
    /// Optional numbering system (`latn`, ...).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub numbering_system: Option<String>,
    /// Text direction: `ltr` or `rtl`.
    pub direction: String,
    /// Monotonic generation used to detect stale resume.
    pub generation: u64,
}

impl LocaleApplicationContext {
    /// Example context for the `zh-hans` fixture application.
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

/// Deterministic formatter context shared by SSR and client.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LocaleFormatterContext {
    /// Always [`LOCALE_FORMATTER_CONTEXT_SCHEMA`].
    pub schema: String,
    /// LocaleId used for CLDR lookup.
    pub locale_id: String,
    /// IANA time zone id.
    pub time_zone: String,
    /// Calendar id (defaults to `gregory` when derived from application context).
    pub calendar: String,
    /// Numbering system id (defaults to `latn` when derived).
    pub numbering_system: String,
    /// Optional ISO currency code for currency formatting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Formatter data version pin ([`FORMATTER_DATA_VERSION`]).
    pub formatter_data_version: String,
}

impl LocaleFormatterContext {
    /// Build a formatter context from an application locale slice.
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
