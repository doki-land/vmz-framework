//! Moved from `src/pipeline/server_slice.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::server_slice::ServerSliceProof;
use vmz_protocol::DIAG_SERVER_SLICE_NOT_BROWSER_SAFE;
use vmz_types::{SecretRequirement, ServerView, StubStatus};

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
