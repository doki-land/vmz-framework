//! Moved from `src/pipeline/secrets.rs` (cargo-cry: tests next to Cargo.toml).

use vmz_compiler::secrets::{collect_client_boundary_findings, collect_secret_requirements};

#[test]
fn collects_secret_binding_from_server_import() {
    let src = r#"
import { secret } from '#server/secrets';
const key = secret('PAYMENTS_API_KEY');
export default class CheckoutServer {
  async quote() { return key; }
}
"#;
    let reqs = collect_secret_requirements(src);
    assert_eq!(reqs.len(), 1);
    assert_eq!(reqs[0].binding_name, "PAYMENTS_API_KEY");
    assert_eq!(reqs[0].owner_capability.as_deref(), None);
}

#[test]
fn client_import_secrets_is_leak() {
    let src = r#"
import { secret } from '#server/secrets';
export default class Page {
  key = secret('API_KEY');
}
"#;
    let findings = collect_client_boundary_findings(src);
    assert!(findings.iter().any(|f| f.code == vmz_protocol::DIAG_SECRET_CLIENT_LEAK));
}

#[test]
fn client_register_mock_provider_forbidden() {
    let src = r#"
export default class Page {
  onMount() { registerMockProvider(ProductsCapability, local); }
}
"#;
    let findings = collect_client_boundary_findings(src);
    assert!(findings.iter().any(|f| f.code == vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN));
}
