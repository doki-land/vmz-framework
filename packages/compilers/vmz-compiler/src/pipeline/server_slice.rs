//! Browser-sink proof for server capability slices (placement lowering gate).
//!
//! Thin v0: any `SecretRequirement` in the unit rejects browser sink.
//! Later: full call-graph / escape / effect closure.

use vmz_protocol::{DIAG_SERVER_SLICE_NOT_BROWSER_SAFE, SERVER_SLICE_PROOF_SCHEMA};
use vmz_types::ServerView;

/// Structured sink proof (binding names only — never values).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSliceProof {
    /// Schema id for this proof document.
    pub schema: &'static str,
    /// True when the slice may be compiled into a browser provider.
    pub browser_safe: bool,
    /// Rejected effect labels, e.g. `SecretRequirement(PAYMENTS_API_KEY)`.
    pub rejected_effects: Vec<String>,
    /// Secret binding names that blocked browser sink (never values).
    pub binding_names: Vec<String>,
}

impl ServerSliceProof {
    /// Prove whether this server view may be compiled into a browser provider.
    pub fn prove(server: &ServerView) -> Self {
        let binding_names: Vec<String> =
            server.secret_requirements.iter().map(|s| s.binding_name.clone()).collect();
        let rejected_effects: Vec<String> =
            binding_names.iter().map(|n| format!("SecretRequirement({n})")).collect();
        Self {
            schema: SERVER_SLICE_PROOF_SCHEMA,
            browser_safe: binding_names.is_empty(),
            rejected_effects,
            binding_names,
        }
    }

    /// Hard diagnostic message when Delivery requests browser sink of an unsafe slice.
    pub fn sink_refusal_message(&self, capability: Option<&str>) -> Option<String> {
        if self.browser_safe {
            return None;
        }
        let cap = capability.unwrap_or("(unit)");
        let effects = self.rejected_effects.join(", ");
        Some(format!(
            "{DIAG_SERVER_SLICE_NOT_BROWSER_SAFE}: capability `{cap}` cannot be emitted into WebArtifact; rejected: {effects}"
        ))
    }
}
