//! Locale runtime emit: `none` strategy prefers Host preference before SSR data-locale.

use vmz_generator::js::{LocaleExport, emit_locale_runtime_module};

#[test]
fn none_strategy_reads_local_storage_before_data_locale() {
    let js = emit_locale_runtime_module(
        "en-us",
        &[LocaleExport {
            export_name: "hello".into(),
            variants: vec![("en-us".into(), "Hi".into()), ("zh-hans".into(), "你好".into())],
            has_params: false,
        }],
    )
    .code;
    let none = js
        .find("strategy === \"none\"")
        .expect("must branch on routing.strategy none");
    let after_none = &js[none..];
    let pref = after_none
        .find("localStorage.getItem(\"vmz.locale\")")
        .expect("none branch must read vmz.locale");
    let data_locale = js
        .find("getAttribute(\"data-locale\")")
        .expect("must still fall back to data-locale");
    assert!(
        none + pref < data_locale,
        "for strategy none, localStorage preference must run before data-locale fallback"
    );
}
