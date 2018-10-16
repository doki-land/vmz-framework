//! Bridge to `tailwind-rs` (git `dev`): Canonical Style Module + reference CSS.

use oxc_diagnostics::OxcDiagnostic;
use oxc_span::Span;
use serde::{Deserialize, Serialize};
use tailwind::{
    CandidateInput, CompileRequest, CompileResponse, Engine, EngineOptions, SourceRef, ThemeInput,
};
use tailwind_css::serialize_module;
use vmz_compiler::ReportedDiagnostic;

use crate::TwCollection;

/// Result of lowering a collection through the neutral TW engine.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngineLowering {
    /// Raw engine compile response (candidates → module).
    pub response: CompileResponse,
    /// Reference CSS only — not a VMZ deployment artifact.
    pub reference_css: String,
}

/// Compile registered tokens via `tailwind::Engine` with optional theme overrides.
pub fn compile_registrations(
    registrations: &[vmz_compiler::TwRegistration],
    theme: ThemeInput,
) -> EngineLowering {
    let mut seen = std::collections::BTreeSet::new();
    let mut candidates = Vec::new();
    for r in registrations {
        if r.token.is_empty() || !seen.insert(r.token.clone()) {
            continue;
        }
        candidates.push(CandidateInput::new(
            r.token.clone(),
            SourceRef::new(r.path.to_string_lossy().into_owned()),
        ));
    }
    let response = Engine::new().compile(CompileRequest {
        candidates,
        theme,
        options: EngineOptions { collect_stats: true },
        ..Default::default()
    });
    let reference_css = serialize_module(&response.module);
    EngineLowering { response, reference_css }
}

/// Compile static tokens via `tailwind::Engine` with optional theme overrides.
///
/// Prefer [`compile_registrations`] for production (provenance per path).
pub fn compile_collection(collection: &TwCollection, theme: ThemeInput) -> EngineLowering {
    let regs: Vec<_> = collection
        .static_tokens
        .iter()
        .map(|t| vmz_compiler::TwRegistration {
            token: t.clone(),
            path: collection.path.clone(),
            kind: vmz_compiler::TwRegKind::StyleTw,
        })
        .collect();
    compile_registrations(&regs, theme)
}

/// Map engine diagnostics onto oxc [`ReportedDiagnostic`], attaching token spans when known.
pub fn map_engine_diagnostics(
    collection: &TwCollection,
    lowering: &EngineLowering,
) -> Vec<ReportedDiagnostic> {
    let mut out = Vec::new();
    for d in &lowering.response.diagnostics {
        let span = d.candidate_key.as_ref().and_then(|key| span_for_token(collection, key));
        let msg = format!("[{}] {}", d.code.as_str(), d.message);
        let mut diag = match d.severity {
            tailwind::Severity::Error => OxcDiagnostic::error(msg),
            tailwind::Severity::Warning => OxcDiagnostic::warn(msg),
            tailwind::Severity::Info => {
                OxcDiagnostic::error(msg).with_severity(oxc_diagnostics::Severity::Advice)
            }
        };
        diag = diag.with_error_code_scope("vmz.tw");
        if let Some(span) = span {
            diag = diag.with_label(span);
        }
        out.push(ReportedDiagnostic {
            path: collection.path.clone(),
            diagnostic: diag,
            args: None,
        });
    }
    out
}

fn span_for_token(collection: &TwCollection, candidate_key: &str) -> Option<Span> {
    for site in &collection.sites {
        for hit in &site.tokens {
            if hit.token == candidate_key {
                return Some(hit.span);
            }
        }
    }
    // Candidate key may equal the full token string from Engine (stable_key default = token).
    None
}
