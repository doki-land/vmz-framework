//! `0.1.18` completion gate: protocol `SourceSpan` is offset-only (path + UTF-8 bytes).

use schemars::schema_for;
use serde_json::{Value, json};
use vmz_protocol::SourceSpan;

#[test]
fn source_span_wire_round_trip_is_path_and_byte_offsets() {
    let span = SourceSpan { path: "src/App.vmz".into(), start: 12, end: 40 };
    let value = serde_json::to_value(&span).expect("serialize");
    assert_eq!(
        value,
        json!({
            "path": "src/App.vmz",
            "start": 12,
            "end": 40,
        })
    );
    let back: SourceSpan = serde_json::from_value(value).expect("deserialize");
    assert_eq!(back, span);
}

#[test]
fn source_span_schema_fixture_forbids_line_column_properties() {
    let schema = schema_for!(SourceSpan);
    let root = schema.to_value();
    let props = source_span_properties(&root);
    let keys: std::collections::BTreeSet<&str> =
        props.as_object().expect("properties object").keys().map(|k| k.as_str()).collect();
    assert_eq!(keys, ["end", "path", "start"].into_iter().collect());
    assert!(props.get("line").is_none());
    assert!(props.get("column").is_none());
    assert!(props.get("lineNumber").is_none());
    assert!(props.get("character").is_none());

    let required = root
        .pointer("/required")
        .or_else(|| root.pointer("/definitions/SourceSpan/required"))
        .or_else(|| {
            // schemars 1 may nest under `$defs`
            root.get("$defs").and_then(|d| d.get("SourceSpan")).and_then(|s| s.get("required"))
        });
    let required = required.expect("SourceSpan required list");
    let required_set: Vec<&str> =
        required.as_array().expect("required array").iter().filter_map(|v| v.as_str()).collect();
    for key in ["path", "start", "end"] {
        assert!(required_set.contains(&key), "missing required {key} in {required_set:?}");
    }
}

#[test]
fn source_span_rejects_unknown_line_column_fields_on_strict_shape_check() {
    // Wire contract: only path/start/end are meaningful. Extra keys must not be
    // treated as protocol fields (serde default deny_unknown_fields is off; assert
    // the canonical serialized shape stays three keys).
    let span = SourceSpan { path: "a.vmz".into(), start: 0, end: 1 };
    let map = serde_json::to_value(&span).unwrap();
    let obj = map.as_object().unwrap();
    assert_eq!(obj.len(), 3);
    assert!(obj.contains_key("path"));
    assert!(obj.contains_key("start"));
    assert!(obj.contains_key("end"));
}

fn source_span_properties(root: &Value) -> &Value {
    if let Some(props) = root.get("properties") {
        return props;
    }
    if let Some(props) = root.pointer("/definitions/SourceSpan/properties") {
        return props;
    }
    if let Some(props) =
        root.get("$defs").and_then(|d| d.get("SourceSpan")).and_then(|s| s.get("properties"))
    {
        return props;
    }
    panic!("SourceSpan properties not found in schema: {root}");
}
