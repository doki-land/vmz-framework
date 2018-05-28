//! Native test protocol (T0) schema ids.

use serde::{Deserialize, Serialize};

/// Umbrella test protocol catalog id.
pub const TEST_PROTOCOL: &str = "vmz.test.protocol.v0";

pub const TEST_MANIFEST_SCHEMA: &str = "vmz.test.manifest.v0";
pub const TEST_REPORT_SCHEMA: &str = "vmz.test.report.v0";
pub const TEST_ACTION_SCHEMA: &str = "vmz.test.action.v0";
pub const TEST_ASSERTION_SCHEMA: &str = "vmz.test.assertion.v0";
pub const EXECUTION_PLAN_REF_SCHEMA: &str = "vmz.test.plan_ref.v0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestCatalog {
    pub schema: String,
    pub protocol: String,
    pub documents: Vec<TestDocumentKind>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TestDocumentKind {
    pub kind: String,
    pub schema: String,
}

impl TestCatalog {
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

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
