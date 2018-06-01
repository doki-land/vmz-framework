//! `vmz test` wire schemas shared by native check and Node harnesses.
//!
//! Manifest / report / action / assertion documents, plus a stable reference to
//! the Execution Plan under test. Semantics stay in the compiler and `@vmz/test`;
//! this module only freezes schema ids for handshake and JSON interchange.

use serde::{Deserialize, Serialize};

/// Umbrella test protocol catalog id.
pub const TEST_PROTOCOL: &str = "vmz.test.protocol.v0";

/// Schema id for a compiled test suite manifest.
pub const TEST_MANIFEST_SCHEMA: &str = "vmz.test.manifest.v0";

/// Schema id for a finished run report (pass / fail / skips).
pub const TEST_REPORT_SCHEMA: &str = "vmz.test.report.v0";

/// Schema id for one harness action (`mount`, `click`, `write`, ...).
pub const TEST_ACTION_SCHEMA: &str = "vmz.test.action.v0";

/// Schema id for one assertion (`text`, `state`, `nodeIdentity`, ...).
pub const TEST_ASSERTION_SCHEMA: &str = "vmz.test.assertion.v0";

/// Schema id for a pointer at the Execution Plan identity under test.
pub const EXECUTION_PLAN_REF_SCHEMA: &str = "vmz.test.plan_ref.v0";

/// Handshake catalog listing test document kinds and their schema ids.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestCatalog {
    /// Always [`TEST_PROTOCOL`].
    pub schema: String,
    /// Same as `schema` (parity with other domain catalogs).
    pub protocol: String,
    /// Document kinds this protocol generation publishes.
    pub documents: Vec<TestDocumentKind>,
}

/// One document kind entry inside [`TestCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestDocumentKind {
    /// Kind id (`manifest`, `report`, `action`, `assertion`, `plan_ref`).
    pub kind: String,
    /// Schema id for that kind.
    pub schema: String,
}

impl TestCatalog {
    /// Frozen catalog for the current test protocol generation.
    pub fn v0() -> Self {
        Self {
            schema: TEST_PROTOCOL.into(),
            protocol: TEST_PROTOCOL.into(),
            documents: vec![
                TestDocumentKind { kind: "manifest".into(), schema: TEST_MANIFEST_SCHEMA.into() },
                TestDocumentKind { kind: "report".into(), schema: TEST_REPORT_SCHEMA.into() },
                TestDocumentKind { kind: "action".into(), schema: TEST_ACTION_SCHEMA.into() },
                TestDocumentKind { kind: "assertion".into(), schema: TEST_ASSERTION_SCHEMA.into() },
                TestDocumentKind {
                    kind: "plan_ref".into(),
                    schema: EXECUTION_PLAN_REF_SCHEMA.into(),
                },
            ],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
