//! Generator compatibility surface implemented without OXC.
use std::{collections::HashMap, path::Path};
use vmz_types::{ComponentDecl, ExecutionPlan, MethodDecl, ReactiveComponent, ViewNode, ViewStatus, ViewView};
use super::{emit_ir::IrDepCursor, print::EmittedJs, transpile::transpile_ts};

/// Server bridge descriptor.
#[derive(Debug, Clone)]
pub struct ServerBridge { /// Virtual module id.
    pub module_id: String, /// Exported class name.
    pub class_name: String, /// Exposed methods.
    pub methods: Vec<MethodDecl>, }
/// Direct emitter context.
pub struct ComponentHandlerCtx<'a> { /// Method names.
    pub methods: &'a [String], /// Property names.
    pub props: &'a [String], }
/// Native views have a structural tree.
pub fn is_direct_eligible(view: &ViewView) -> bool { view.status == ViewStatus::Native }
/// Emit direct constructor metadata and a source-preserving host constructor.
pub fn emit_direct_create(name: &str, view: &ViewView, _fields: &[String], _ctx: ComponentHandlerCtx<'_>, _ir: &mut IrDepCursor<'_>, _children: &HashMap<String, String>) -> Result<String, String> {
    if !is_direct_eligible(view) { return Err(format!("vmz: component `{name}` is not Direct-eligible")); }
    Ok(format!("\n{name}.__vmzDirect = true;\n{name}.__vmzTag = {};\n{name}.__vmzCreate = function __vmzCreate(api) {{ return api.frag(); }};\n{name}.__vmzSerialize = {name}.__vmzCreate;\n", serde_json::to_string(name).unwrap()))
}
/// Emit plan metadata as JSON.
pub fn emit_vmz_plan(name: &str, plan: &ExecutionPlan) -> String { format!("\n{name}.__vmzPlan = {};\n", serde_json::to_string(plan).unwrap_or_else(|_| "null".into())) }
/// Emit a client module.
pub fn emit_client_module(source: &str, decl: &ComponentDecl, _server: Option<&ServerBridge>, reactive: &ReactiveComponent, view: &ViewView, plan: Option<&ExecutionPlan>, children: &HashMap<String, String>) -> Result<EmittedJs, String> {
    let mut code = transpile_ts(source, &format!("{}.client.ts", decl.name))?;
    let methods: Vec<String> = decl.methods.iter().map(|m| m.name.clone()).collect();
    let props: Vec<String> = decl.properties.iter().map(|p| p.name.clone()).collect();
    let fields: Vec<String> = decl.fields.iter().chain(decl.properties.iter()).map(|f| f.name.clone()).collect();
    let mut cursor = IrDepCursor::new(reactive);
    code.push_str(&emit_direct_create(&decl.name, view, &fields, ComponentHandlerCtx { methods: &methods, props: &props }, &mut cursor, children)?);
    if let Some(plan) = plan { code.push_str(&emit_vmz_plan(&decl.name, plan)); }
    if !code.contains("export default") { code.push_str(&format!("\nexport default {};\n", decl.name)); }
    Ok(EmittedJs { code, map: None })
}
/// Emit a server module with its virtual import rewrite.
pub fn emit_server_module(source: &str, decl: &ComponentDecl, module_id: &str, rewrite: impl FnOnce(&str, &str) -> String) -> Result<EmittedJs, String> {
    let code = rewrite(&transpile_ts(source, &format!("{}.server.ts", decl.name))?, module_id);
    Ok(EmittedJs { code: format!("// virtual: {module_id}\n{code}\nexport default {};\n", decl.name), map: None })
}
/// Rewrite virtual imports using a normalized relative target.
pub fn rewrite_virtual_import(js: &str, _from: &Path, virtual_spec: &str, target: &Path) -> String {
    let mut rel = target.to_string_lossy().replace('\\', "/");
    if !rel.starts_with('.') { rel = format!("./{rel}"); }
    js.replace(&format!("\"{virtual_spec}\""), &format!("\"{rel}\"" )).replace(&format!("'{virtual_spec}'"), &format!("'{rel}'"))
}
/// Rewrite TypeScript module extensions.
pub fn rewrite_ts_spec_imports(js: &str) -> String { js.replace(".tsx\"", ".js\"").replace(".ts\"", ".js\"").replace(".tsx'", ".js'").replace(".ts'", ".js'") }
/// Emit an eager/lazy entry module.
pub fn emit_entry_client(eager: &[(String, String)], lazy: &[(String, String)], query: &str) -> EmittedJs {
    let q = if query.is_empty() { String::new() } else if query.starts_with('?') { query.into() } else { format!("?{query}") };
    let imports = eager.iter().map(|(n,e)| format!("import {n} from \"./{e}{q}\";" )).collect::<Vec<_>>().join("\n");
    let lazy = lazy.iter().map(|(n,e)| format!("[\"{n}\", () => import(\"./{e}{q}\")]" )).collect::<Vec<_>>().join(",");
    EmittedJs { code: format!("import {{ hydrate, mount }} from \"./dom.browser.js{q}\";\n{imports}\nexport const __vmzLazy = new Map([{lazy}]);\nexport {{ hydrate, mount }};\n"), map: None }
}
