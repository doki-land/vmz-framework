//! Browser-sink proof for server capability slices (placement lowering gate).
//!
//! Thin v0: any `SecretRequirement` in the unit rejects browser sink.
//! Later: full call-graph / escape / effect closure.

use vmz_protocol::{DIAG_SERVER_SLICE_NOT_BROWSER_SAFE, SERVER_SLICE_PROOF_SCHEMA};
use vmz_types::ServerView;

/// Structured sink proof (binding names only — never values).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerSliceProof {
    pub schema: &'static str,
    pub browser_safe: bool,
    /// Rejected effect labels, e.g. `SecretRequirement(PAYMENTS_API_KEY)`.
    pub rejected_effects: Vec<String>,
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

#[cfg(test)]
mod tests {
    use super::*;
    use vmz_types::{SecretRequirement, StubStatus};

    #[test]
    fn empty_secrets_are_browser_safe() {
        let proof = ServerSliceProof::prove(&ServerView::default());
        assert!(proof.browser_safe);
        assert!(proof.sink_refusal_message(None).is_none());
    }

    #[test]
    fn secret_requirement_rejects_browser_sink() {
        let server = ServerView {
            status: StubStatus::Partial,
            secret_requirements: vec![SecretRequirement {
                binding_name: "PAYMENTS_API_KEY".into(),
                owner_capability: Some("quote".into()),
                module_id: Some("#server/pages/checkout".into()),
            }],
            ..Default::default()
        };
        let proof = ServerSliceProof::prove(&server);
        assert!(!proof.browser_safe);
        let msg = proof.sink_refusal_message(Some("CheckoutServer.quote")).unwrap();
        assert!(msg.contains(DIAG_SERVER_SLICE_NOT_BROWSER_SAFE));
        assert!(msg.contains("PAYMENTS_API_KEY"));
        assert!(!msg.contains("sk_")); // never a value
    }
}
