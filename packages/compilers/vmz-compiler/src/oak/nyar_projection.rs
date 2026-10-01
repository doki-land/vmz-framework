//! Project `.vmz` + analyzed scripts into language-neutral [`NyarAnalysisInput`].
//!
//! Spans on the wire are adapter [`ByteSpan`] only — no `oxc_span` import here.
//! Script surfaces come from [`crate::analyze::analyze_script`] (Oak primary, oxc graft).
//! Static imports come from Oak TypeScript AST ([`collect_static_imports_via_oak`]).

use vmz_oak_frontend_adapter::{
    ByteSpan, NyarAnalysisInput, NyarHttpRoute, NyarImportDecl, NyarInternalType, NyarMember,
    NyarMemberKind, NyarProgramRole, NyarProgramUnit,
};
use vmz_types::{ComponentDecl, FieldDecl, FieldKind, MethodDecl};

use crate::analyze::AnalyzedScript;
use crate::oak::vmz_regions::project_parsed_vmz;
use crate::parse::analyze_oak::collect_static_imports;
use crate::sfc::{ParsedVmz, ScriptBlock, ScriptKind, parse_vmz};

/// Build Nyar analysis input from a parsed SFC and script analysis results.
pub fn project_nyar_analysis_input(
    parsed: &ParsedVmz,
    client: &AnalyzedScript,
    server: Option<&AnalyzedScript>,
) -> NyarAnalysisInput {
    let document = project_parsed_vmz(parsed);
    let mut programs = vec![program_unit(NyarProgramRole::Client, &parsed.client, &client.decl)];
    if let (Some(block), Some(analyzed)) = (&parsed.server, server) {
        programs.push(program_unit(NyarProgramRole::Server, block, &analyzed.decl));
    }
    NyarAnalysisInput { document, programs, has_server_boundary: parsed.server.is_some() }
}

/// Parse `.vmz`, analyze scripts (Oak-primary), and project for Nyar.
pub fn project_nyar_from_vmz(
    path: impl AsRef<std::path::Path>,
    source: impl Into<String>,
) -> Result<NyarAnalysisInput, crate::sfc::SfcError> {
    let parsed = parse_vmz(path, source)?;
    let client = crate::analyze::analyze_script(ScriptKind::Client, &parsed.client.content);
    let server = parsed
        .server
        .as_ref()
        .map(|s| crate::analyze::analyze_script(ScriptKind::Server, &s.content));
    Ok(project_nyar_analysis_input(&parsed, &client, server.as_ref()))
}

fn program_unit(
    role: NyarProgramRole,
    block: &ScriptBlock,
    decl: &ComponentDecl,
) -> NyarProgramUnit {
    let content_end = block.content_start + block.content.len();
    let kind = match role {
        NyarProgramRole::Client => ScriptKind::Client,
        NyarProgramRole::Server => ScriptKind::Server,
    };
    let imports = shift_imports(block.content_start, collect_static_imports(kind, &block.content));
    NyarProgramUnit {
        role,
        content_span: ByteSpan { start: block.content_start, end: content_end },
        component_name: decl.name.clone(),
        members: decl
            .properties
            .iter()
            .map(|f| member_from_field(block.content_start, f))
            .chain(decl.fields.iter().map(|f| member_from_field(block.content_start, f)))
            .chain(decl.methods.iter().map(|m| member_from_method(block.content_start, m)))
            .collect(),
        internal_types: decl
            .internal_classes
            .iter()
            .map(|c| NyarInternalType {
                name: c.name.clone(),
                name_span: abs_span(block.content_start, c.name_span.start, c.name_span.end),
            })
            .collect(),
        imports,
    }
}

fn shift_imports(content_start: usize, imports: Vec<NyarImportDecl>) -> Vec<NyarImportDecl> {
    imports
        .into_iter()
        .map(|mut imp| {
            imp.decl_span = ByteSpan {
                start: content_start + imp.decl_span.start,
                end: content_start + imp.decl_span.end,
            };
            imp.specifier_span = ByteSpan {
                start: content_start + imp.specifier_span.start,
                end: content_start + imp.specifier_span.end,
            };
            for bind in &mut imp.specifiers {
                bind.name_span = ByteSpan {
                    start: content_start + bind.name_span.start,
                    end: content_start + bind.name_span.end,
                };
            }
            imp
        })
        .collect()
}

fn member_from_field(content_start: usize, field: &FieldDecl) -> NyarMember {
    let kind = match field.kind {
        FieldKind::Prop => NyarMemberKind::Prop,
        FieldKind::State => NyarMemberKind::State,
    };
    NyarMember {
        name: field.name.clone(),
        kind,
        name_span: abs_span(content_start, field.name_span.start, field.name_span.end),
        decl_span: abs_span(content_start, field.span.start, field.span.end),
        type_text: field.type_text.clone(),
        is_async: false,
        http_route: None,
    }
}

fn member_from_method(content_start: usize, method: &MethodDecl) -> NyarMember {
    NyarMember {
        name: method.name.clone(),
        kind: NyarMemberKind::Method,
        name_span: abs_span(content_start, method.name_span.start, method.name_span.end),
        decl_span: abs_span(content_start, method.span.start, method.span.end),
        type_text: None,
        is_async: method.is_async,
        http_route: method
            .http
            .as_ref()
            .map(|h| NyarHttpRoute { verb: h.verb.clone(), path: h.path.clone() }),
    }
}

fn abs_span(content_start: usize, start: u32, end: u32) -> ByteSpan {
    ByteSpan {
        start: content_start + start as usize,
        end: content_start + end as usize,
    }
}
