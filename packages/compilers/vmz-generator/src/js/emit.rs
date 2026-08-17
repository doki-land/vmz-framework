//! Client / server JS module assembly via oxc transpile + Direct / meta append.

use std::path::Path;

use vmz_types::{
    ComponentDecl, ExecutionPlan, MethodDecl, PlanStatus, ReactiveComponent, ViewView,
};

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
        use super::ast_util::print_member_assign;
        js.push_str(&print_member_assign(&decl.name, "__vmzWriteBarrier", |b| b.bool_lit(true)));
    }
    if !js.contains("export default") {
        use super::ast_util::print_export_default;
        js.push_str(&format!("\n{}", print_export_default(&decl.name)));
    }
    if transpiled.map.is_some() {
        js.push_str(&format!("\n//# sourceMappingURL={map_name}\n"));
    }
    Ok(EmittedJs { code: js, map: transpiled.map })
}

fn emit_method_rw(decl: &ComponentDecl) -> String {
    use oxc_allocator::{Allocator, ArenaVec};

    use super::ast_util::JsAst;

    if decl.methods.is_empty() {
        return String::new();
    }

    let allocator = Allocator::default();
    let b = JsAst::new(&allocator);
    let mut props = ArenaVec::new_in(&b.ast);

    for m in &decl.methods {
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        let reads: Vec<&str> = m.reads.iter().map(|s| s.as_str()).collect();
        let writes: Vec<&str> = m.writes.iter().map(|s| s.as_str()).collect();
        let calls: Vec<&str> = m.calls.iter().map(|s| s.as_str()).collect();
        let entry = ArenaVec::from_iter_in(
            [
                b.prop("reads", b.str_array(&reads)),
                b.prop("writes", b.str_array(&writes)),
                b.prop("calls", b.str_array(&calls)),
                b.prop("opaque", b.bool_lit(m.opaque_callee)),
                b.prop("async", b.bool_lit(m.is_async)),
            ],
            &b.ast,
        );
        props.push(b.str_key_prop(&m.name, b.object(entry)));
    }

    if props.is_empty() {
        return String::new();
    }

    let stmt = b.assign_member_stmt(&decl.name, "__vmzMethodRw", b.object(props));
    let body = ArenaVec::from_iter_in([stmt], &b.ast);
    format!("\n{}", b.print_stmts(body))
}

fn emit_async_task_wraps(decl: &ComponentDecl) -> String {
    use super::ast_util::{js_string_literal, oxc_reprint_module};

    let mut out = String::new();
    for m in &decl.methods {
        if !m.is_async {
            continue;
        }
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        let key = js_string_literal(&m.name);
        out.push_str(&format!(
            "\n{{\n  const __m = {comp}.prototype.{method};\n  {comp}.prototype.{method} = function (...args) {{\n    return __vmzRunTask(this, {key}, (_signal, _meta) => __m.apply(this, args));\n  }};\n}}\n",
            comp = decl.name,
            method = m.name,
        ));
    }
    if out.is_empty() {
        return out;
    }
    oxc_reprint_module(out.trim_start()).map(|c| format!("\n{c}")).unwrap_or(out)
}

fn emit_props_runtime(decl: &ComponentDecl, ctor_applies_props: bool) -> String {
    use oxc_allocator::{Allocator, ArenaVec};

    use super::ast_util::JsAst;

    let prop_names: Vec<&str> = decl.properties.iter().map(|p| p.name.as_str()).collect();
    let state_names: Vec<&str> =
        decl.fields.iter().filter(|f| !f.name.starts_with('#')).map(|f| f.name.as_str()).collect();

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
            body.push_str(
                &format!("  this.{name} = {init};\n", name = f.name, init = init.trim(),),
            );
        }
    }

    let allocator = Allocator::default();
    let b = JsAst::new(&allocator);
    let mut stmts = ArenaVec::new_in(&b.ast);
    stmts.push(b.assign_member_stmt(&decl.name, "__vmzProps", b.str_array(&prop_names)));
    stmts.push(b.assign_member_stmt(&decl.name, "__vmzState", b.str_array(&state_names)));
    stmts.push(b.assign_member_stmt(
        &decl.name,
        "__vmzCtorAppliesProps",
        b.bool_lit(ctor_applies_props),
    ));
    let mut meta = b.print_stmts(stmts);

    // ApplyProps body still embeds author init expressions as text; outer shell stays string
    // until init_text is parsed as oxc Expression in a follow-up.
    meta.push_str(&format!(
        "{name}.prototype.__vmzApplyProps = function __vmzApplyProps(props = {{}}) {{\n{body}}};\n",
        name = decl.name,
        body = body,
    ));
    format!("\n{meta}")
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
        use super::ast_util::print_export_default;
        js.push_str(&format!("\n{}", print_export_default(&decl.name)));
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
    use super::ast_util::{js_string_literal, oxc_reprint_module};

    let mut methods = String::new();
    for m in &bridge.methods {
        if m.is_private || m.name == "constructor" {
            continue;
        }
        let id = js_string_literal(&bridge.module_id);
        let name = js_string_literal(&m.name);
        methods.push_str(&format!(
            "  static {method}(...args) {{\n    return callServer({id}, {name}, args);\n  }}\n",
            method = m.name,
        ));
    }
    let raw = format!(
        "import {{ callServer }} from \"vmz:runtime\";\n\nexport class {name} {{\n{methods}}}\n",
        name = bridge.class_name,
        methods = methods,
    );
    oxc_reprint_module(&raw).unwrap_or(raw)
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
            spec = serde_json::to_string(&format!("./{entry}{q}"))
                .unwrap_or_else(|_| format!("\"./{entry}{q}\""))
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
 * Generated by vmz-generator - do not edit by hand.
 */
import {{ registerComponents, hydrate, mount }} from {dom};
{imports}
registerComponents({{ {eager_list} }});
const __vmzLazy = new Map([
{lazy_block}
]);
export {{ hydrate, mount, __vmzLazy }};
"#,
        dom = serde_json::to_string(&format!("./vmz-dom.js{q}"))
            .unwrap_or_else(|_| "\"./vmz-dom.js\"".into()),
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
    if out.is_empty() { ".".into() } else { out.join("/") }
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
