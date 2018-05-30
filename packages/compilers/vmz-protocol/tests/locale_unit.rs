//! Moved from `src/locale.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_protocol::*;

#[test]
fn catalog_freezes_i0_schemas() {
    let c = LocaleProtocolCatalog::v0();
    assert_eq!(c.protocol, LOCALE_PROTOCOL);
    assert!(c.documents.iter().any(|d| d.kind == "manifest" && d.schema == LOCALE_MANIFEST_SCHEMA));
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
        c.documents
            .iter()
            .any(|d| d.kind == "application_context"
                && d.schema == LOCALE_APPLICATION_CONTEXT_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "formatter_context" && d.schema == LOCALE_FORMATTER_CONTEXT_SCHEMA)
    );
    assert!(
        c.documents.iter().any(|d| d.kind == "transition" && d.schema == LOCALE_TRANSITION_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_FORMATTER_CONTEXT_INCOMPLETE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_DIGEST_MISMATCH));
    let app = LocaleApplicationContext::example_zh_hans();
    let fmt = LocaleFormatterContext::from_application(&app, None);
    assert_eq!(fmt.formatter_data_version, FORMATTER_DATA_VERSION);
    assert_eq!(fmt.locale_id, "zh-hans");
    assert_eq!(fmt.time_zone, "Asia/Shanghai");
}
