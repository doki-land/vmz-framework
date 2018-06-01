//! JSON Schema export for Program / Reactive documents (schemars).

use schemars::schema_for;

/// JSON Schema root for [`crate::ProgramModule`].
pub fn program_module_schema() -> schemars::schema::RootSchema {
    schema_for!(crate::ProgramModule)
}

/// JSON Schema root for [`crate::ReactiveModule`].
pub fn reactive_module_schema() -> schemars::schema::RootSchema {
    schema_for!(crate::ReactiveModule)
}

/// Pretty-printed JSON Schema for [`crate::ProgramModule`].
pub fn program_module_schema_json() -> String {
    serde_json::to_string_pretty(&program_module_schema()).unwrap_or_else(|_| "{}".into())
}

/// Pretty-printed JSON Schema for [`crate::ReactiveModule`].
pub fn reactive_module_schema_json() -> String {
    serde_json::to_string_pretty(&reactive_module_schema()).unwrap_or_else(|_| "{}".into())
}
