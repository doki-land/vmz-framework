//! `0.1.18` completion gate: `ReportedDiagnostic` wire is `code + args + span`
//! (natural-language `message` remains transitional until `0.1.21`).

use std::collections::BTreeMap;

use serde_json::json;
use vmz_protocol::{ReportedDiagnostic, SourceSpan};

#[test]
fn reported_diagnostic_wire_round_trips_code_args_span() {
    let mut args = BTreeMap::new();
    args.insert("name".into(), "count".into());
    args.insert("expected".into(), "number".into());

    let diag = ReportedDiagnostic::error("src/App.vmz", "type mismatch for `{name}`")
        .with_code("vmz::type/mismatch")
        .with_args(args.clone())
        .with_source_span(SourceSpan { path: "src/App.vmz".into(), start: 10, end: 15 });

    let value = serde_json::to_value(&diag).expect("serialize");
    assert_eq!(value["path"], "src/App.vmz");
    assert_eq!(value["severity"], "error");
    assert_eq!(value["message"], "type mismatch for `{name}`");
    assert_eq!(value["code"], "vmz::type/mismatch");
    assert_eq!(
        value["args"],
        json!({
            "expected": "number",
            "name": "count",
        })
    );
    assert_eq!(
        value["span"],
        json!({
            "path": "src/App.vmz",
            "start": 10,
            "end": 15,
        })
    );

    let back: ReportedDiagnostic = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back.path().to_string_lossy(), "src/App.vmz");
    assert_eq!(back.message(), "type mismatch for `{name}`");
    assert_eq!(back.code_string().as_deref(), Some("vmz::type/mismatch"));
    assert_eq!(back.args(), Some(&args));
    let span = back.source_span().expect("span");
    assert_eq!(span.start, 10);
    assert_eq!(span.end, 15);
}

#[test]
fn reported_diagnostic_omits_empty_args_on_wire() {
    let diag = ReportedDiagnostic::coded_error("a.vmz", "boom", "vmz::parse/error");
    let value = serde_json::to_value(&diag).expect("serialize");
    assert!(value.get("args").is_none());
    assert_eq!(value["code"], "vmz::parse/error");
}
