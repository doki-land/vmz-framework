//! native: Native WebView shell contract .
//!
//! Algebraic first version: freeze shell manifest (load/error/exit/deepLink/log),
//! local bundled Browser Direct entry, dual ios/android adapters sharing one schema.
//! No Xcode/Gradle projects yet — packaging adapters are stubs.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    AssetMode, DIAG_INVALID_PROFILE, DIAG_MISSING_DEEP_LINK, DIAG_MISSING_ENTRY_ARTIFACT,
    DIAG_MISSING_IDENTITY, DIAG_MISSING_LOG_POLICY, DIAG_MISSING_SHELL_HOOK,
    DIAG_PLATFORM_SEMANTIC_FORK, DIAG_REMOTE_ENTRY_DEFAULT, NativeHostDiagnostic,
    NativeHostProtocolCatalog, NativePlatformId, NativeShellCheckReport,
    NativeWebViewShellManifest, SHELL_CHECK_SCHEMA, SHELL_SCHEMA, ShellAdapterKind, ShellHook,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> NativeHostDiagnostic {
    NativeHostDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_shell(
    shell: &NativeWebViewShellManifest,
    root: &Path,
    out: &mut Vec<NativeHostDiagnostic>,
) {
    if shell.schema != SHELL_SCHEMA {
        out.push(diag(
            "schema",
            vmz_protocol::Severity::Error,
            format!("shell schema must be `{SHELL_SCHEMA}`"),
            DIAG_INVALID_PROFILE,
        ));
    }
    if shell.identity.application_id.trim().is_empty() || shell.identity.origin.trim().is_empty() {
        out.push(diag(
            "identity",
            vmz_protocol::Severity::Error,
            "shell requires applicationId + origin",
            DIAG_MISSING_IDENTITY,
        ));
    }
    if !shell.reuses_browser_lowering {
        out.push(diag(
            "reusesBrowserLowering",
            vmz_protocol::Severity::Error,
            "WebView shell must reuse Browser lowering",
            DIAG_INVALID_PROFILE,
        ));
    }
    if shell.asset_mode != AssetMode::Local {
        out.push(diag(
            "assetMode",
            vmz_protocol::Severity::Error,
            "native shell requires assetMode=local (bundled)",
            DIAG_REMOTE_ENTRY_DEFAULT,
        ));
    }
    let entry_url = shell.entry.entry_url.to_ascii_lowercase();
    if entry_url.starts_with("http://") || entry_url.starts_with("https://") {
        out.push(diag(
            "entry.entryUrl",
            vmz_protocol::Severity::Error,
            "remote http(s) entry must not be native default; use app:// or file:// local bundle",
            DIAG_REMOTE_ENTRY_DEFAULT,
        ));
    }
    if !(entry_url.starts_with("app://") || entry_url.starts_with("file://")) {
        out.push(diag(
            "entry.entryUrl",
            vmz_protocol::Severity::Error,
            format!("unsupported entryUrl `{}`", shell.entry.entry_url),
            DIAG_REMOTE_ENTRY_DEFAULT,
        ));
    }

    for hook in ShellHook::ALL {
        if !shell.hooks.iter().any(|h| h == hook) {
            out.push(diag(
                "hooks",
                vmz_protocol::Severity::Error,
                format!("missing required shell hook `{hook}`"),
                DIAG_MISSING_SHELL_HOOK,
            ));
        }
    }

    if shell.deep_links.is_empty() {
        out.push(diag(
            "deepLinks",
            vmz_protocol::Severity::Error,
            "native shell requires at least one deep link map entry",
            DIAG_MISSING_DEEP_LINK,
        ));
    }

    if !shell.logging.redact_sensitive {
        out.push(diag(
            "logging",
            vmz_protocol::Severity::Error,
            "shell logging must redactSensitive=true",
            DIAG_MISSING_LOG_POLICY,
        ));
    }
    // Closed [`ShellLogLevel`] validates at deserialize.

    for plat in NativePlatformId::ALL {
        let row = shell.adapters.iter().find(|a| a.platform == *plat);
        match row {
            None => out.push(diag(
                "adapters",
                vmz_protocol::Severity::Error,
                format!("missing `{plat}` webview-shell adapter"),
                DIAG_PLATFORM_SEMANTIC_FORK,
            )),
            Some(a) => {
                if a.kind != ShellAdapterKind::WebviewShell {
                    out.push(diag(
                        &format!("adapters.{plat}"),
                        vmz_protocol::Severity::Error,
                        format!("adapter kind must be webview-shell, got `{}`", a.kind),
                        DIAG_PLATFORM_SEMANTIC_FORK,
                    ));
                }
                if a.shell_schema != SHELL_SCHEMA {
                    out.push(diag(
                        &format!("adapters.{plat}"),
                        vmz_protocol::Severity::Error,
                        format!(
                            "platform `{plat}` must share shell schema `{SHELL_SCHEMA}`, got `{}`",
                            a.shell_schema
                        ),
                        DIAG_PLATFORM_SEMANTIC_FORK,
                    ));
                }
            }
        }
    }
    for a in &shell.adapters {
        if a.shell_schema != SHELL_SCHEMA {
            out.push(diag(
                &format!("adapters.{}", a.platform),
                vmz_protocol::Severity::Error,
                format!("platform semantic fork: shellSchema `{}`", a.shell_schema),
                DIAG_PLATFORM_SEMANTIC_FORK,
            ));
        }
    }

    let search_roots = [root.join("dist"), root.to_path_buf(), root.join("out")];
    let mut found_client = false;
    let mut found_dom = false;
    let mut client_has_marker = false;
    for base in &search_roots {
        let client = base.join(&shell.entry.client_js);
        let dom = base.join(&shell.entry.dom_host);
        if client.is_file() {
            found_client = true;
            if let Ok(text) = fs::read_to_string(&client) {
                if text.contains("__vmzDirect") {
                    client_has_marker = true;
                }
            }
        }
        if dom.is_file() {
            found_dom = true;
        }
    }
    let dist = root.join("dist");
    if dist.is_dir() {
        if !found_client {
            out.push(diag(
                &shell.entry.client_js,
                vmz_protocol::Severity::Error,
                format!("missing local bundled client artifact `{}`", shell.entry.client_js),
                DIAG_MISSING_ENTRY_ARTIFACT,
            ));
        } else if !client_has_marker {
            out.push(diag(
                &shell.entry.client_js,
                vmz_protocol::Severity::Error,
                "client artifact missing __vmzDirect — shell must reuse Browser Direct emit",
                DIAG_MISSING_ENTRY_ARTIFACT,
            ));
        }
        if !found_dom {
            out.push(diag(
                &shell.entry.dom_host,
                vmz_protocol::Severity::Error,
                format!("missing DOM host artifact `{}`", shell.entry.dom_host),
                DIAG_MISSING_ENTRY_ARTIFACT,
            ));
        }
    }
}

fn load_or_example_shell(
    root: &Path,
    diags: &mut Vec<NativeHostDiagnostic>,
) -> NativeWebViewShellManifest {
    let path = root.join("native-shell.json");
    if path.is_file() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<NativeWebViewShellManifest>(&text) {
                Ok(s) => return s,
                Err(e) => diags.push(diag(
                    "native-shell.json",
                    vmz_protocol::Severity::Error,
                    format!("invalid NativeWebViewShellManifest JSON: {e}"),
                    DIAG_INVALID_PROFILE,
                )),
            },
            Err(e) => diags.push(diag(
                "native-shell.json",
                vmz_protocol::Severity::Error,
                format!("cannot read native-shell.json: {e}"),
                DIAG_INVALID_PROFILE,
            )),
        }
    }
    NativeWebViewShellManifest::local_bundled_example()
}

/// native check for a workspace root (optional `native-shell.json`).
pub fn check_native_shell_contract(root: &Path) -> NativeShellCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = NativeHostProtocolCatalog::v0();
    let shell = load_or_example_shell(root, &mut diagnostics);
    validate_shell(&shell, root, &mut diagnostics);

    let foul = root.join("native-shell.fork.foul.json");
    if foul.is_file() {
        if let Ok(text) = fs::read_to_string(&foul) {
            if let Ok(bad) = serde_json::from_str::<NativeWebViewShellManifest>(&text) {
                validate_shell(&bad, root, &mut diagnostics);
            } else if text.contains("ios.private") || text.contains("androidOnlySemantics") {
                diagnostics.push(diag(
                    "native-shell.fork.foul.json",
                    vmz_protocol::Severity::Error,
                    "platform-private shell semantics are forbidden",
                    DIAG_PLATFORM_SEMANTIC_FORK,
                ));
            }
        }
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    NativeShellCheckReport {
        schema: SHELL_CHECK_SCHEMA.into(),
        catalog,
        shell,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
