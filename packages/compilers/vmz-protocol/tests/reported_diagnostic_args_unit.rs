//! `0.1.21` completion gate: `ReportedDiagnostic` wire truth is `code + args + span`
//! (no natural-language `message` as protocol identity).

use std::collections::BTreeMap;

use serde_json::json;
use vmz_protocol::{ReportedDiagnostic, SourceSpan};

#[test]
fn reported_diagnostic_wire_round_trips_code_args_span() {
    let mut args = BTreeMap::new();
    args.insert("name".into(), "count".into());
    args.insert("expected".into(), "number".into());

    let diag = ReportedDiagnostic::error("src/App.vmz", "vmz::type::mismatch")
        .with_args(args.clone())
        .with_source_span(SourceSpan { path: "src/App.vmz".into(), start: 10, end: 15 });

    let value = serde_json::to_value(&diag).expect("serialize");
    assert_eq!(value["path"], "src/App.vmz");
    assert_eq!(value["severity"], "error");
    assert!(value.get("message").is_none());
    assert_eq!(value["code"], "vmz::type::mismatch");
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
    assert_eq!(back.message(), "");
    assert_eq!(back.code_string().as_deref(), Some("vmz::type::mismatch"));
    assert_eq!(back.args(), Some(&args));
    let span = back.source_span().expect("span");
    assert_eq!(span.start, 10);
    assert_eq!(span.end, 15);
}

#[test]
fn reported_diagnostic_omits_empty_args_on_wire() {
    let diag = ReportedDiagnostic::coded_error("a.vmz", "vmz::parse::error");
    let value = serde_json::to_value(&diag).expect("serialize");
    assert!(value.get("args").is_none());
    assert!(value.get("message").is_none());
    assert_eq!(value["code"], "vmz::parse::error");
}

#[test]
fn reported_diagnostic_code_args_span_locale_invariant() {
    // Simulates two hosts formatting different locales: structured fields must match.
    let a = ReportedDiagnostic::error("x.vmz", "vmz::template::jsx_rejected")
        .with_arg("detail", "attr={expr}")
        .with_source_span(SourceSpan { path: "x.vmz".into(), start: 4, end: 12 });
    let b = ReportedDiagnostic::error("x.vmz", "vmz::template::jsx_rejected")
        .with_arg("detail", "attr={expr}")
        .with_source_span(SourceSpan { path: "x.vmz".into(), start: 4, end: 12 });
    let va = serde_json::to_value(&a).unwrap();
    let vb = serde_json::to_value(&b).unwrap();
    assert_eq!(va["code"], vb["code"]);
    assert_eq!(va["args"], vb["args"]);
    assert_eq!(va["span"], vb["span"]);
    assert!(va.get("message").is_none());
}
