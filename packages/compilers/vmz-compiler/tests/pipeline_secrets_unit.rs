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

#[test]
fn preserves_server_alias_namespace_default_imports_and_first_owner() {
    let source = r#"
import { secret as binding, unrelated } from '#server/secrets/nested';
import defaultBinding from '#server/secrets';
import * as vault from '#server/secrets';
class Server {
  outer() {
    binding('ALIAS');
    defaultBinding('DEFAULT');
    vault.secret('NAMESPACE');
    class Nested { inner() { binding('INNER'); } }
    secret('BARE');
    const callback = () => binding('CALLBACK');
  }
  next() { binding('ALIAS'); binding('NEXT'); }
}
unrelated('IGNORE');
vault['secret']('IGNORE_COMPUTED');
other.secret('IGNORE_OTHER');
"#;
    let requirements = collect_secret_requirements(source);
    let actual: Vec<_> = requirements
        .iter()
        .map(|requirement| {
            (requirement.binding_name.as_str(), requirement.owner_capability.as_deref())
        })
        .collect();
    assert_eq!(
        actual,
        vec![
            ("ALIAS", Some("outer")),
            ("DEFAULT", Some("outer")),
            ("NAMESPACE", Some("outer")),
            ("INNER", Some("inner")),
            ("BARE", Some("outer")),
            ("CALLBACK", Some("outer")),
            ("NEXT", Some("next")),
        ]
    );
    assert!(requirements.iter().all(|requirement| requirement.module_id.is_none()));
}

#[test]
fn only_collects_static_cooked_string_and_template_arguments() {
    let source = r#"
import { secret } from '#server/secrets';
secret('API\u005fKEY');
secret(`TEMPLATE_KEY`);
secret(('PAREN_KEY'));
secret('');
secret(`DYNAMIC_${name}`);
secret(name);
secret('PREFIX_' + name);
secret(...names);
"#;
    let requirements = collect_secret_requirements(source);
    let actual: Vec<_> =
        requirements.iter().map(|requirement| requirement.binding_name.as_str()).collect();
    assert_eq!(actual, vec!["API_KEY", "TEMPLATE_KEY", "PAREN_KEY", ""]);
}

#[test]
fn bare_secret_requires_server_module_and_client_named_binding() {
    assert!(collect_secret_requirements("secret('IGNORED');").is_empty());
    assert!(collect_client_boundary_findings("secret('IGNORED');").is_empty());
    let server = "import '#server/secrets'; secret('BARE');";
    assert_eq!(collect_secret_requirements(server)[0].binding_name, "BARE");
    assert_eq!(collect_client_boundary_findings(server).len(), 1);
    for source in [
        "import vault from '#server/secrets'; vault('KEY'); vault.secret('KEY'); secret('KEY');",
        "import * as vault from '#server/secrets'; vault.secret('KEY'); secret('KEY');",
    ] {
        assert_eq!(collect_client_boundary_findings(source).len(), 1, "{source}");
    }
    assert!(
        collect_secret_requirements(
            "import { secret } from '#server/secrets-other'; secret('IGNORED');"
        )
        .is_empty()
    );
}

#[test]
fn client_findings_keep_first_utf8_import_and_call_spans_without_values() {
    let source = "/* 中文 */\nimport { secret as binding } from '#server/secrets';\nbinding('DO_NOT_LEAK');\nbinding('SECOND_VALUE');\nregisterMockProvider(capability, local);\nregisterMockProvider(capability, other);\noverrideCapability(capability, local);";
    let findings = collect_client_boundary_findings(source);
    assert_eq!(findings.len(), 4, "{findings:?}");
    for (finding, fragment) in findings.iter().zip([
        "import { secret as binding } from '#server/secrets';",
        "binding('DO_NOT_LEAK')",
        "registerMockProvider(capability, local)",
        "overrideCapability(capability, local)",
    ]) {
        let start = source.find(fragment).unwrap();
        assert_eq!(finding.span.start as usize, start, "{finding:?}");
        assert_eq!(finding.span.end as usize, start + fragment.len(), "{finding:?}");
        assert!(!finding.message.contains("DO_NOT_LEAK"));
        assert!(!finding.message.contains("SECOND_VALUE"));
    }
}

#[test]
fn client_detects_nested_mock_calls_but_not_members_or_similar_names() {
    let source = r#"
import fixture from '#server/fixtures/data';
import other from './server/fixtures/data';
class Client {
  run() {
    const config = { provider: registerMockProvider(capability, local) };
    return [overrideCapability(capability, local)];
  }
}
"#;
    let findings = collect_client_boundary_findings(source);
    assert_eq!(findings.len(), 4, "{findings:?}");
    assert!(
        findings
            .iter()
            .all(|finding| finding.code == vmz_protocol::DIAG_CLIENT_MOCK_PROVIDER_FORBIDDEN)
    );
    let negative = "import data from '#client/fixtures/data'; namespace.registerMockProvider(capability, local); overrideCapabilityOther();";
    let negative_findings = collect_client_boundary_findings(negative);
    assert!(negative_findings.is_empty(), "{negative_findings:?}");
}

#[test]
fn oak_ast_must_preserve_security_calls_in_object_initializers() {
    use oak_typescript::ast::{ClassMember, ExpressionKind, ObjectProperty, Statement};
    use vmz_oak_frontend_adapter::{ScriptRole, ScriptShellInput, parse_script_ast};

    let source = r#"
import { secret as binding } from '#server/secrets';
class Client {
  run() {
    const config = { key: binding('API_KEY'), provider: registerMockProvider(capability, local) };
  }
}
"#;
    let findings = collect_client_boundary_findings(source);
    assert_eq!(findings.len(), 3, "legacy security baseline: {findings:?}");
    let parsed = parse_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    });
    assert!(parsed.ok, "{:?}", parsed.diagnostics);
    let root = parsed.root.expect("Oak must produce the complete security fixture root");
    let class = root
        .statements
        .iter()
        .find_map(|statement| match statement {
            Statement::ClassDeclaration(class) => Some(class),
            _ => None,
        })
        .expect("class must be present");
    let body = class
        .body
        .iter()
        .find_map(|member| match member {
            ClassMember::Method { name, body, .. } if name == "run" => Some(body),
            _ => None,
        })
        .expect("method must be present");
    let initializer = body
        .iter()
        .find_map(|statement| match statement {
            Statement::VariableDeclaration(declaration) if declaration.name == "config" => {
                declaration.value.as_ref()
            }
            _ => None,
        })
        .expect("Oak must not discard the object initializer containing secret/mock calls");
    let ExpressionKind::ObjectLiteral { properties } = initializer.kind.as_ref() else {
        panic!("security initializer must remain an object literal: {initializer:?}");
    };
    let calls: Vec<_> = properties
        .iter()
        .filter_map(|property| match property {
            ObjectProperty::Property { value, .. } => match value.kind.as_ref() {
                ExpressionKind::CallExpression { func, .. } => match func.kind.as_ref() {
                    ExpressionKind::Identifier(name) => Some(name.as_str()),
                    _ => None,
                },
                _ => None,
            },
            _ => None,
        })
        .collect();
    assert_eq!(calls, vec!["binding", "registerMockProvider"]);
}
