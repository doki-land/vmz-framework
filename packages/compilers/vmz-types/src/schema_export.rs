//! JSON Schema export for Program / Reactive / Plan IR documents.
//!
//! Uses `schemars` derived from the same `Serialize` types that emit
//! `*.program.json` / `*.reactive.json`. Hosts (CLI / N-API / LSP) call
//! [`ir_schema_catalog`] for a single handshake document.

use schemars::{JsonSchema, Schema, schema_for};
use serde::{Deserialize, Serialize};
use serde_json::json;
use vmz_protocol::{PLAN_SCHEMA, PROGRAM_SCHEMA, REACTIVE_SCHEMA};

/// Catalog document id for the IR JSON Schema export handshake.
pub const IR_SCHEMA_CATALOG: &str = "vmz.ir.schema_catalog.v0";

/// Closed IR document kind inside [`IrSchemaCatalog`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum IrDocumentKind {
    /// Program Graph document (`*.program.json`).
    Program,
    /// Reactive view document (`*.reactive.json`).
    Reactive,
    /// Execution Plan document (embedded / `vmz.plan.v0`).
    Plan,
}

impl IrDocumentKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Program => "program",
            Self::Reactive => "reactive",
            Self::Plan => "plan",
        }
    }
}

/// One document entry inside [`IrSchemaCatalog`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrSchemaEntry {
    /// Document kind (closed unit enum).
    pub kind: IrDocumentKind,
    /// Wire schema id written into instances (`vmz.program.v0`, ...).
    pub schema_id: String,
    /// Draft JSON Schema describing that document's shape.
    pub json_schema: Schema,
}

/// Handshake catalog listing IR document schemas for tools and validators.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrSchemaCatalog {
    /// Always [`IR_SCHEMA_CATALOG`].
    pub schema: String,
    /// Ordered document schemas this native build publishes.
    pub documents: Vec<IrSchemaEntry>,
}

fn with_meta(mut schema: Schema, id: &str, title: &str) -> Schema {
    schema.insert("$id".into(), json!(id));
    schema.insert("title".into(), json!(title));
    schema.insert("description".into(), json!(format!("VMZ IR document schema `{id}`")));
    schema
}

/// JSON Schema root for [`crate::ProgramModule`] (`$id` = [`PROGRAM_SCHEMA`]).
pub fn program_module_schema() -> Schema {
    with_meta(schema_for!(crate::ProgramModule), PROGRAM_SCHEMA, "ProgramModule")
}

/// JSON Schema root for [`crate::ReactiveModule`] (`$id` = [`REACTIVE_SCHEMA`]).
pub fn reactive_module_schema() -> Schema {
    with_meta(schema_for!(crate::ReactiveModule), REACTIVE_SCHEMA, "ReactiveModule")
}

/// JSON Schema root for [`crate::ExecutionPlan`] (`$id` = [`PLAN_SCHEMA`]).
pub fn execution_plan_schema() -> Schema {
    with_meta(schema_for!(crate::ExecutionPlan), PLAN_SCHEMA, "ExecutionPlan")
}

/// Pretty-printed JSON Schema for [`crate::ProgramModule`].
pub fn program_module_schema_json() -> String {
    serde_json::to_string_pretty(&program_module_schema()).unwrap_or_else(|_| "{}".into())
}

/// Pretty-printed JSON Schema for [`crate::ReactiveModule`].
pub fn reactive_module_schema_json() -> String {
    serde_json::to_string_pretty(&reactive_module_schema()).unwrap_or_else(|_| "{}".into())
}

/// Pretty-printed JSON Schema for [`crate::ExecutionPlan`].
pub fn execution_plan_schema_json() -> String {
    serde_json::to_string_pretty(&execution_plan_schema()).unwrap_or_else(|_| "{}".into())
}

/// Frozen IR schema catalog for the current generation.
pub fn ir_schema_catalog() -> IrSchemaCatalog {
    IrSchemaCatalog {
        schema: IR_SCHEMA_CATALOG.into(),
        documents: vec![
            IrSchemaEntry {
                kind: IrDocumentKind::Program,
                schema_id: PROGRAM_SCHEMA.into(),
                json_schema: program_module_schema(),
            },
            IrSchemaEntry {
                kind: IrDocumentKind::Reactive,
                schema_id: REACTIVE_SCHEMA.into(),
                json_schema: reactive_module_schema(),
            },
            IrSchemaEntry {
                kind: IrDocumentKind::Plan,
                schema_id: PLAN_SCHEMA.into(),
                json_schema: execution_plan_schema(),
            },
        ],
    }
}

/// Pretty-printed [`IrSchemaCatalog`] JSON for N-API / CLI dump.
pub fn ir_schema_catalog_json() -> String {
    serde_json::to_string_pretty(&ir_schema_catalog()).unwrap_or_else(|_| "{}".into())
}

/// Marker used only so `schema_for!` stays next to export helpers in docs.
#[allow(dead_code)]
fn _schema_export_bounds()
where
    crate::ProgramModule: JsonSchema,
    crate::ReactiveModule: JsonSchema,
    crate::ExecutionPlan: JsonSchema,
{
}
