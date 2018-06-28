//! Client / server JS emit — orchestration only; printers live in `vmz-generator`.

use std::path::Path;

use vmz_generator::js::{
    EmittedJs, ServerBridge as GenServerBridge, emit_client_module, emit_server_module,
};
use vmz_types::{MethodDecl, ReactiveComponent, ViewView};

use crate::analyze::AnalyzedScript;
use crate::plan_build::build_execution_plan;
use crate::reactive_build::build_reactive_module;
use crate::structural_build::build_native_view;
use crate::template::{AttrValue, TemplateAttr, TemplateIr};

pub use vmz_generator::js::{
    bind_field_idents, collect_deps_oxc, emit_direct_create, emit_vmz_plan, event_dom_type,
    is_component_tag, is_direct_eligible, is_event_attr, is_html_attr, looks_like_ternary,
    rewrite_ts_spec_imports, rewrite_virtual_import, sanitize_interp, split_ternary_parts,
};

/// Options when co-located `<script server>` is compiled into a client-facing stub.
#[derive(Debug, Clone)]
pub struct ServerBridge {
    /// Virtual `#server/...` module id for the stub import.
    pub module_id: String,
    /// Server class name exported by the stub.
    pub class_name: String,
    /// Server methods exposed to the client bridge.
    pub methods: Vec<MethodDecl>,
}

impl From<&ServerBridge> for GenServerBridge {
    fn from(b: &ServerBridge) -> Self {
        GenServerBridge {
            module_id: b.module_id.clone(),
            class_name: b.class_name.clone(),
            methods: b.methods.clone(),
        }
    }
}

/// Emit client JS from analyzed script + template (no Reactive / View / Plan IR).
pub fn emit_client_js(
    client_source: &str,
    client: &AnalyzedScript,
    template: &TemplateIr,
    server: Option<&ServerBridge>,
) -> Result<String, String> {
    emit_client_js_with_ir(client_source, client, template, server, None, None, None)
}

/// Emit client JS; when `reactive` / `view` / `plan` are provided, Direct emit consumes them.
/// Returns `(js, optional source map JSON)`.
pub fn emit_client_js_with_ir_mapped(
    client_source: &str,
    client: &AnalyzedScript,
    template: &TemplateIr,
    server: Option<&ServerBridge>,
    reactive: Option<&ReactiveComponent>,
    view: Option<&ViewView>,
    plan: Option<&vmz_types::ExecutionPlan>,
) -> Result<(String, Option<String>), String> {
    let owned = if reactive.is_none() {
        Some(build_reactive_module(&format!("{}.client", client.decl.name), &client.decl, template))
    } else {
        None
    };
    let comp = reactive
        .or_else(|| owned.as_ref().and_then(|m| m.components.first()))
        .expect("reactive component");

    let owned_view =
        if view.is_none() { Some(build_native_view(template, comp, None)) } else { None };
    let view = view.or(owned_view.as_ref()).expect("native view");

    let owned_fields: std::collections::HashSet<String> = client
        .decl
        .fields
        .iter()
        .chain(client.decl.properties.iter())
        .filter(|f| !f.name.starts_with('#'))
        .map(|f| f.name.clone())
        .collect();
    let barrier = crate::write_barrier::rewrite_static_path_writes(client_source, &owned_fields);

    let bridge = server.map(GenServerBridge::from);

    let owned_plan;
    let plan_ref = match plan {
        Some(p) => Some(p),
        None => {
            owned_plan = build_execution_plan(view);
            Some(&owned_plan)
        }
    };

    let mut emitted =
        emit_client_module(&barrier.source, &client.decl, bridge.as_ref(), comp, view, plan_ref)?;
    if barrier.rewritten > 0 && !emitted.code.contains("__vmzWriteBarrier") {
        emitted.code.push_str(&format!("\n{}.__vmzWriteBarrier = true;\n", client.decl.name));
    }
    Ok((emitted.code, emitted.map))
}

/// Emit client JS; when `reactive` / `view` / `plan` are provided, Direct emit consumes them.
pub fn emit_client_js_with_ir(
    client_source: &str,
    client: &AnalyzedScript,
    template: &TemplateIr,
    server: Option<&ServerBridge>,
    reactive: Option<&ReactiveComponent>,
    view: Option<&ViewView>,
    plan: Option<&vmz_types::ExecutionPlan>,
) -> Result<String, String> {
    Ok(emit_client_js_with_ir_mapped(
        client_source,
        client,
        template,
        server,
        reactive,
        view,
        plan,
    )?
    .0)
}

/// Emit server JS via generator (+ virtual `#server` import rewrite).
pub fn emit_server_js(
    server_source: &str,
    server: &AnalyzedScript,
    module_id: &str,
) -> Result<String, String> {
    let EmittedJs { code, .. } =
        emit_server_module(server_source, &server.decl, module_id, |js, id| {
            crate::virtual_server::rewrite_imports_to_relative(js, id)
        })?;
    Ok(code)
}

/// Convenience: rewrite `vmz:runtime` only.
pub fn rewrite_runtime_import(js: &str, from_file: &Path, runtime_file: &Path) -> String {
    rewrite_virtual_import(js, from_file, "vmz:runtime", runtime_file)
}

pub(crate) fn attr_interp(attrs: &[TemplateAttr], name: &str) -> Option<String> {
    attrs.iter().find_map(|a| {
        if a.name == name {
            if let AttrValue::Interp(e) = &a.value {
                return Some(e.clone());
            }
        }
        None
    })
}

pub(crate) fn attr_static(attrs: &[TemplateAttr], name: &str) -> Option<String> {
    attrs.iter().find_map(|a| {
        if a.name == name {
            if let AttrValue::Static(s) = &a.value {
                return Some(s.clone());
            }
        }
        None
    })
}

pub(crate) fn has_bare_attr(attrs: &[TemplateAttr], name: &str) -> bool {
    attrs.iter().any(|a| a.name == name && matches!(&a.value, AttrValue::Static(s) if s.is_empty()))
}
