//! Client / server JS module assembly via oxc transpile + Direct / meta append.

use std::path::Path;

use vmz_types::{ComponentDecl, ExecutionPlan, MethodDecl, PlanStatus, ReactiveComponent, ViewView};

use super::emit_direct::{emit_direct_create, emit_vmz_plan, is_direct_eligible};
use super::emit_ir::IrDepCursor;
use super::transpile::transpile_ts;

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

/// JS emit result (code + optional source map JSON).
#[derive(Debug, Clone)]
pub struct EmittedJs {
    /// Module source.
    pub code: String,
    /// Source map JSON when produced.
    pub map: Option<String>,
}

/// Emit client JS from barrier-rewritten source + analyzed decl + Native View / Reactive / Plan.
///
/// Caller (`vmz-compiler`) must apply WriteBarrier and build Reactive/View/Plan IR.
pub fn emit_client_module(
    client_source: &str,
    decl: &ComponentDecl,
    server: Option<&ServerBridge>,
    reactive: &ReactiveComponent,
    view: &ViewView,
    plan: Option<&ExecutionPlan>,
) -> Result<EmittedJs, String> {
    let map_name = format!("{}.client.js.map", decl.name);
    let transpiled = super::transpile::transpile_ts_with_map(
        client_source,
        &format!("{}.client.ts", decl.name),
        Some(Path::new(&map_name)),
    )?;
    let mut js = transpiled.code;
    let has_source_constructor = decl.methods.iter().any(|method| method.name == "constructor");
    js = inject_props_constructor(&js, &decl.name, has_source_constructor);

    if let Some(bridge) = server {
        js = strip_imports_from_module(&js, &bridge.module_id);
        let stub = emit_server_client_stub(bridge);
        js = format!("{stub}\n{js}");
    }

    let mut field_names: Vec<String> =
        decl.properties.iter().chain(decl.fields.iter()).map(|f| f.name.clone()).collect();
    field_names.sort();
    field_names.dedup();

    if !is_direct_eligible(view) {
        return Err(format!(
            "vmz: component `{}` is not Direct-eligible; production blueprint render() was removed (production Direct emit)",
            decl.name
        ));
    }
    {
        let mut ir_direct = IrDepCursor::new(reactive);
        js.push_str(&emit_direct_create(&decl.name, view, &field_names, &mut ir_direct));
        if let Some(plan_ref) = plan {
            if plan_ref.status != PlanStatus::Empty {
                let emit_plan = std::env::var("VMZ_EMIT_PLAN")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                if emit_plan {
                    js.push_str(&emit_vmz_plan(&decl.name, plan_ref));
                }
            }
        }
    }
    js.push_str(&emit_props_runtime(decl, !has_source_constructor));
    js.push_str(&emit_method_rw(decl));
    let async_wraps = emit_async_task_wraps(decl);
    if !async_wraps.is_empty() {
        if !js.contains("import { __vmzRunTask }") && !js.contains("import {__vmzRunTask}") {
            js = format!("import {{ __vmzRunTask }} from \"vmz:dom\";\n{js}");
        }
        js.push_str(&async_wraps);
    }
    if client_source.contains("__vmzWritePath") || client_source.contains("__vmzArrayMutate") {
        js.push_str(&format!("\n{}.__vmzWriteBarrier = true;\n", decl.name));
    }
    if !js.contains("export default") {
        js.push_str(&format!("\nexport default {};\n", decl.name));
    }
    if transpiled.map.is_some() {
        js.push_str(&format!("\n//# sourceMappingURL={map_name}\n"));
    }
    Ok(EmittedJs { code: js, map: transpiled.map })
}

fn emit_method_rw(decl: &ComponentDecl) -> String {
    if decl.methods.is_empty() {
        return String::new();
    }
    let mut entries = Vec::new();
    for m in &decl.methods {
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        let reads = m.reads.iter().map(|r| format!("{r:?}")).collect::<Vec<_>>().join(", ");
        let writes = m.writes.iter().map(|w| format!("{w:?}")).collect::<Vec<_>>().join(", ");
        let calls = m.calls.iter().map(|c| format!("{c:?}")).collect::<Vec<_>>().join(", ");
        entries.push(format!(
            "  {name:?}: {{ reads: [{reads}], writes: [{writes}], calls: [{calls}], opaque: {opaque}, async: {async_} }}",
            name = m.name,
            opaque = if m.opaque_callee { "true" } else { "false" },
            async_ = if m.is_async { "true" } else { "false" },
        ));
    }
    if entries.is_empty() {
        return String::new();
    }
    format!(
        "\n{name}.__vmzMethodRw = {{\n{entries}\n}};\n",
        name = decl.name,
        entries = entries.join(",\n")
    )
}

fn emit_async_task_wraps(decl: &ComponentDecl) -> String {
    let mut out = String::new();
    for m in &decl.methods {
        if !m.is_async {
            continue;
        }
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        out.push_str(&format!(
            "\n{{\n  const __m = {comp}.prototype.{method};\n  {comp}.prototype.{method} = function (...args) {{\n    return __vmzRunTask(this, {key:?}, (_signal, _meta) => __m.apply(this, args));\n  }};\n}}\n",
            comp = decl.name,
            method = m.name,
            key = m.name,
        ));
    }
    out
}

fn emit_props_runtime(decl: &ComponentDecl, ctor_applies_props: bool) -> String {
    let prop_names: Vec<_> = decl.properties.iter().map(|p| format!("{:?}", p.name)).collect();
    let state_names: Vec<_> = decl
        .fields
        .iter()
        .filter(|f| !f.name.starts_with('#'))
        .map(|f| format!("{:?}", f.name))
        .collect();

    let mut body = String::new();
    for p in &decl.properties {
        if let Some(init) = &p.init_text {
            body.push_str(&format!(
                "  this.{name} = props.{name} !== undefined ? props.{name} : {init};\n",
                name = p.name,
                init = init.trim(),
            ));
        } else {
            body.push_str(&format!(
                "  if (props.{name} !== undefined) this.{name} = props.{name};\n",
                name = p.name,
            ));
        }
    }
    for f in &decl.fields {
        if f.name.starts_with('#') {
            continue;
        }
        if let Some(init) = &f.init_text {
            body.push_str(&format!(
                "  this.{name} = {init};\n",
                name = f.name,
                init = init.trim(),
            ));
        }
    }

    format!(
        "\n{name}.__vmzProps = [{props}];\n{name}.__vmzState = [{state}];\n{name}.__vmzCtorAppliesProps = {ctor_applies_props};\n{name}.prototype.__vmzApplyProps = function __vmzApplyProps(props = {{}}) {{\n{body}}};\n",
        name = decl.name,
        props = prop_names.join(", "),
        state = state_names.join(", "),
        body = body,
    )
}

fn inject_props_constructor(js: &str, class_name: &str, has_source_constructor: bool) -> String {
    if has_source_constructor {
        return js.to_string();
    }
    let needle = format!("class {class_name}");
    let Some(idx) = js.find(&needle) else {
        return js.to_string();
    };
    let after_name = idx + needle.len();
    let rest = &js[after_name..];
    let Some(rel) = rest.find('{') else {
        return js.to_string();
    };
    let body_start = after_name + rel + 1;
    let ctor = "\n\tconstructor(props = {}) {\n\t\tif (typeof this.__vmzApplyProps === \"function\") this.__vmzApplyProps(props);\n\t}\n";
    let mut out = String::with_capacity(js.len() + ctor.len());
    out.push_str(&js[..body_start]);
    out.push_str(ctor);
    out.push_str(&js[body_start..]);
    out
}

/// Emit server JS: strip HTTP surface, transpile, rewrite `#server` imports.
pub fn emit_server_module(
    server_source: &str,
    decl: &ComponentDecl,
    module_id: &str,
    rewrite_imports: impl FnOnce(&str, &str) -> String,
) -> Result<EmittedJs, String> {
    let stripped = strip_http_surface(server_source);
    let mut js = transpile_ts(&stripped, &format!("{}.server.ts", decl.name))?;
    js = rewrite_imports(&js, module_id);
    js = format!("// virtual: {module_id}\n{js}");
    if !js.contains("export default") {
        js.push_str(&format!("\nexport default {};\n", decl.name));
    }
    Ok(EmittedJs { code: js, map: None })
}

fn strip_http_surface(source: &str) -> String {
    let mut out = String::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ")
            && (trimmed.contains("\"vmz:http\"") || trimmed.contains("'vmz:http'"))
        {
            continue;
        }
        if trimmed.starts_with('@')
            && ["Get", "Post", "Put", "Delete", "Patch"].iter().any(|v| trimmed[1..].starts_with(v))
        {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

fn emit_server_client_stub(bridge: &ServerBridge) -> String {
    let mut methods = String::new();
    for m in &bridge.methods {
        if m.is_private || m.name == "constructor" {
            continue;
        }
        methods.push_str(&format!(
            "  static {name}(...args) {{\n    return callServer({id:?}, {name:?}, args);\n  }}\n",
            name = m.name,
            id = bridge.module_id,
        ));
    }
    format!(
        "import {{ callServer }} from \"vmz:runtime\";\n\nexport class {name} {{\n{methods}}}\n",
        name = bridge.class_name,
        methods = methods,
    )
}

/// Rewrite virtual import specs (`vmz:runtime`, `vmz:dom`) to relative paths.
pub fn rewrite_virtual_import(
    js: &str,
    from_file: &Path,
    virtual_spec: &str,
    target: &Path,
) -> String {
    let from_dir = from_file.parent().unwrap_or(Path::new("."));
    let rel = pathdiff_string(from_dir, target);
    let spec = if rel.starts_with('.') { rel } else { format!("./{rel}") };
    js.replace(&format!("\"{virtual_spec}\""), &format!("\"{spec}\""))
        .replace(&format!("'{virtual_spec}'"), &format!("'{spec}'"))
}

/// Author may write `from './foo.ts'`; Node ESM under `dist/` needs `.js`.
pub fn rewrite_ts_spec_imports(js: &str) -> String {
    let mut out = String::new();
    for line in js.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("import ") || trimmed.starts_with("export ") {
            out.push_str(
                &line
                    .replace(".tsx\"", ".js\"")
                    .replace(".tsx'", ".js'")
                    .replace(".ts\"", ".js\"")
                    .replace(".ts'", ".js'"),
            );
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

/// Eager/lazy entry module for serve / static hosts.
pub fn emit_entry_client(
    eager: &[(String, String)],
    lazy: &[(String, String)],
    cache_query: &str,
) -> EmittedJs {
    let q = if cache_query.is_empty() {
        String::new()
    } else if cache_query.starts_with('?') {
        cache_query.to_string()
    } else {
        format!("?{cache_query}")
    };
    let mut imports = String::new();
    for (name, entry) in eager {
        imports.push_str(&format!(
            "import {name} from {spec};\n",
            spec = serde_json::to_string(&format!("./{entry}{q}")).unwrap_or_else(|_| format!("\"./{entry}{q}\""))
        ));
    }
    let eager_regs: Vec<String> = eager.iter().map(|(n, _)| n.clone()).collect();
    let lazy_regs: Vec<String> = lazy
        .iter()
        .map(|(name, entry)| {
            let spec = serde_json::to_string(&format!("./{entry}{q}"))
                .unwrap_or_else(|_| format!("\"./{entry}{q}\""));
            format!("  [{name:?}, () => import({spec})]")
        })
        .collect();
    let code = format!(
        r#"/**
 * Generated by vmz-generator — do not edit by hand.
 */
import {{ registerComponents, hydrate, mount }} from {dom};
{imports}
registerComponents({{ {eager_list} }});
const __vmzLazy = new Map([
{lazy_block}
]);
export {{ hydrate, mount, __vmzLazy }};
"#,
        dom = serde_json::to_string(&format!("./vmz-dom.js{q}")).unwrap_or_else(|_| "\"./vmz-dom.js\"".into()),
        eager_list = eager_regs.join(", "),
        lazy_block = lazy_regs.join(",\n"),
    );
    EmittedJs { code, map: None }
}

fn pathdiff_string(from_dir: &Path, target: &Path) -> String {
    use std::path::Component;
    let from_parts: Vec<_> =
        from_dir.components().filter(|c| !matches!(c, Component::CurDir)).collect();
    let to_parts: Vec<_> = target.components().collect();
    let from_s: Vec<String> = from_parts
        .iter()
        .map(|c| c.as_os_str().to_string_lossy().replace('\\', "/"))
        .filter(|s| !s.is_empty())
        .collect();
    let to_s: Vec<String> =
        to_parts.iter().map(|c| c.as_os_str().to_string_lossy().replace('\\', "/")).collect();
    let mut i = 0;
    while i < from_s.len() && i < to_s.len() && from_s[i] == to_s[i] {
        i += 1;
    }
    let mut out = Vec::new();
    for _ in i..from_s.len() {
        out.push("..".to_string());
    }
    for p in &to_s[i..] {
        out.push(p.clone());
    }
    if out.is_empty() {
        ".".into()
    } else {
        out.join("/")
    }
}

fn strip_imports_from_module(js: &str, module_id: &str) -> String {
    let mut out = String::new();
    for line in js.lines() {
        let trimmed = line.trim();
        let is_import = trimmed.starts_with("import ")
            && (trimmed.contains(&format!("\"{module_id}\""))
                || trimmed.contains(&format!("'{module_id}'")));
        if is_import {
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}
