//! Document collection / mount / route plan protocol.
//!
//! Author input is `documents/documents.config.{json,json5,ts,js}` (declaration
//! object). Rust degrades that input to [`DocumentRoutePlan`]; TypeScript hosts
//! must not re-interpret the same author file.

use serde::{Deserialize, Serialize};

use crate::ReportedDiagnostic;

/// Schema id for the normalized DocumentRoutePlan consumed by hosts.
pub const DOCUMENT_ROUTE_PLAN_SCHEMA: &str = "vmz.document.route_plan.v0";

/// Schema id for the compiled DocumentManifest document (filesystem projection).
pub const DOCUMENT_MANIFEST_SCHEMA: &str = "vmz.document.manifest.v0";

/// Hard: documents config missing under `/documents`.
pub const DIAG_DOCUMENT_CONFIG_MISSING: &str = "document::config::missing";

/// Hard: documents config failed to parse or is not a declaration object.
pub const DIAG_DOCUMENT_CONFIG_INVALID: &str = "document::config::invalid";

/// Soft/hard: `defaultLocale` missing or not listed in `locales`.
pub const DIAG_DOCUMENT_CONFIG_DEFAULT_LOCALE: &str = "document::config::default_locale";

/// Hard: silent whole-page fallback is forbidden.
pub const DIAG_DOCUMENT_FALLBACK_SILENT: &str = "document::fallback::silent_forbidden";

/// One collection entry inside a documents config / route plan.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCollectionPlan {
    /// Stable collection id (`default`, …).
    pub id: String,
    /// Source root relative to `documents/` (`.` = collection root).
    pub source_root: String,
    /// Public mount path (`/docs`, `/d`, `/`).
    pub route_base: String,
}

/// Mount projection derived from a collection (integrated vs standalone).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMountPlan {
    /// Owning collection id.
    pub collection_id: String,
    /// Public mount path.
    pub route_base: String,
    /// `integrated` when `route_base != "/"`, else `standalone`.
    pub mode: String,
}

/// Normalized document routing plan (config only; page tree scan stays host-side for now).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRoutePlan {
    /// Always [`DOCUMENT_ROUTE_PLAN_SCHEMA`].
    pub schema: String,
    /// Workspace-relative or absolute path of the author config, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    /// Default LocaleId from config (optional when config omitted).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_locale: Option<String>,
    /// LocaleId → human label.
    #[serde(default)]
    pub locale_labels: std::collections::BTreeMap<String, String>,
    /// Declared collections (defaults applied when empty).
    #[serde(default)]
    pub collections: Vec<DocumentCollectionPlan>,
    /// Mount rows derived from collections.
    #[serde(default)]
    pub mounts: Vec<DocumentMountPlan>,
    /// Author `fallback: true` is forbidden; surfaced as a diagnostic, not a plan feature.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub silent_fallback_requested: bool,
    /// Structured diagnostics from parse / normalize / validate.
    #[serde(default)]
    pub diagnostics: Vec<ReportedDiagnostic>,
}

impl DocumentRoutePlan {
    /// True when any diagnostic has severity `error`.
    pub fn has_errors(&self) -> bool {
        self.diagnostics.iter().any(|d| d.is_error())
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
