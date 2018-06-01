//! Server boundary protocol: secrets, mock-provider evidence, browser-sink proof.
//!
//! Freezes schema ids and diagnostic codes for `#server/secrets`, `secret(...)`,
//! and Delivery decisions that place a server slice into the browser. Values of
//! secrets never appear on the wire; only binding identities do.

use serde::{Deserialize, Serialize};

/// Umbrella server-boundary protocol.
pub const SERVER_PROTOCOL: &str = "vmz.server.protocol.v0";

/// `SecretRequirement` graph node (binding identity only; never secret values).
pub const SECRET_REQUIREMENT_SCHEMA: &str = "vmz.secret.requirement.v0";

/// Browser-sink / placement proof report for a compiled server slice.
pub const SERVER_SLICE_PROOF_SCHEMA: &str = "vmz.server.slice_proof.v0";

/// Hard: explicit client mock provider / capability override / server fixture into browser.
pub const DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN: &str = "vmz::server::client_mock_provider_forbidden";

/// Hard: `#server/secrets` or `secret(...)` used from client / browser domain.
pub const DIAG_SECRET_CLIENT_LEAK: &str = "vmz::server::secret_client_leak";

/// Hard: Delivery asked to compile a server slice into browser but closure is not browser-safe.
pub const DIAG_SERVER_SLICE_NOT_BROWSER_SAFE: &str = "vmz::server::server_slice_not_browser_safe";

/// Hard: `secret(name)` cannot form a binding, or required binding is missing in the host.
pub const DIAG_SECRET_BINDING_MISSING: &str = "vmz::server::secret_binding_missing";

/// Advice (suppressible): client data may duplicate an existing server capability.
pub const DIAG_CLIENT_DATA_MAY_DUPLICATE_CAPABILITY: &str =
    "vmz::server::client_data_may_duplicate_capability";

/// Protocol catalog for handshake / gates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerProtocolCatalog {
    /// `SERVER_PROTOCOL`
    pub schema: String,
    /// Same as schema (locale/dx parity).
    pub protocol: String,
    /// Document kinds + schemas.
    pub documents: Vec<ServerDocumentKind>,
    /// Stable diagnostic codes.
    pub diagnostics: Vec<String>,
    /// Compiler-known virtual module for secret bindings.
    pub secrets_module: String,
}

/// One catalog document entry.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServerDocumentKind {
    /// Document kind id.
    pub kind: String,
    /// Schema id.
    pub schema: String,
}

impl ServerProtocolCatalog {
    /// Current frozen catalog.
    pub fn v0() -> Self {
        Self {
            schema: SERVER_PROTOCOL.into(),
            protocol: SERVER_PROTOCOL.into(),
            documents: vec![
                ServerDocumentKind {
                    kind: "secret_requirement".into(),
                    schema: SECRET_REQUIREMENT_SCHEMA.into(),
                },
                ServerDocumentKind {
                    kind: "slice_proof".into(),
                    schema: SERVER_SLICE_PROOF_SCHEMA.into(),
                },
            ],
            diagnostics: vec![
                DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN.into(),
                DIAG_SECRET_CLIENT_LEAK.into(),
                DIAG_SERVER_SLICE_NOT_BROWSER_SAFE.into(),
                DIAG_SECRET_BINDING_MISSING.into(),
                DIAG_CLIENT_DATA_MAY_DUPLICATE_CAPABILITY.into(),
            ],
            secrets_module: "#server/secrets".into(),
        }
    }

    /// Pretty JSON for N-API / gates.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
}
