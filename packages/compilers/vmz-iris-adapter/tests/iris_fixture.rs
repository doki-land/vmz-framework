//! End-to-end fixture: call `vmz_iris_adapter::generate_from_vos_schema` and
//! assert the resulting TypeScript client surface matches the host-neutral
//! contract documented in `iris-generator`.

const MINIMAL_SCHEMA: &str = r#"
table User {
    @@user_id: uuid,
    user_name: utf8,
    active: bool,
}
"#;

#[test]
fn adapter_produces_core_ts_files() {
    let result = vmz_iris_adapter::generate_from_vos_schema(MINIMAL_SCHEMA).unwrap();

    // Deterministic, populated fingerprint.
    assert!(!result.fingerprint.is_empty(), "fingerprint must be populated");
    assert_eq!(result.fingerprint.len(), 64, "SHA-256 hex is 64 chars");

    // Core generated files must be present.
    for name in ["browser.ts", "node.ts", "operations.ts", "metadata.ts", "models.ts", "index.ts"] {
        assert!(result.files.contains_key(name), "missing file: {name}");
    }
}

#[test]
fn browser_file_stays_host_neutral() {
    let result = vmz_iris_adapter::generate_from_vos_schema(MINIMAL_SCHEMA).unwrap();
    let browser = result.files.get("browser.ts").unwrap();

    // Browser surface imports the wasm/lightweight language crate.
    assert!(
        browser.contains("@yydb/iris-language"),
        "browser.ts must import @yydb/iris-language: {browser}"
    );

    // Browser surface must NOT leak Node/desktop imports.
    assert!(
        !browser.contains("@yydb/iris/node"),
        "browser.ts must not import @yydb/iris/node: {browser}"
    );
    assert!(
        !browser.contains("@yydb/iris/types"),
        "browser.ts must not import @yydb/iris/types: {browser}"
    );
}

#[test]
fn node_file_targets_desktop_runtime() {
    let result = vmz_iris_adapter::generate_from_vos_schema(MINIMAL_SCHEMA).unwrap();
    let node = result.files.get("node.ts").unwrap();

    assert!(
        node.contains("@yydb/iris/node") || node.contains("@yydb/iris/types"),
        "node.ts must reference desktop runtime: {node}"
    );
}

#[test]
fn fingerprint_is_stable() {
    let a = vmz_iris_adapter::generate_from_vos_schema(MINIMAL_SCHEMA).unwrap();
    let b = vmz_iris_adapter::generate_from_vos_schema(MINIMAL_SCHEMA).unwrap();
    assert_eq!(a.fingerprint, b.fingerprint, "same schema → same fingerprint");
    assert_eq!(a.files, b.files, "same schema → same file map");
}

#[test]
fn invalid_schema_returns_error_string() {
    let err = vmz_iris_adapter::generate_from_vos_schema("this is not valid VOS")
        .expect_err("should reject garbage");
    assert!(!err.is_empty());
}
