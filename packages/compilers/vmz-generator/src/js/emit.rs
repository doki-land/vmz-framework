//! Client / server JS module assembly via oxc transpile + Direct / meta append.

use std::path::Path;

use vmz_types::{
    ComponentDecl, ExecutionPlan, MethodDecl, PlanStatus, ReactiveComponent, ViewView,
};

use super::emit_direct::{emit_direct_create, emit_vmz_plan, is_direct_eligible};
use super::emit_ir::IrDepCursor;
use super::print::EmittedJs;
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

/// Emit client JS from barrier-rewritten source + analyzed decl + Native View / Reactive / Plan.
///
/// Assembles transpile + Direct/meta. Caller (`vmz-compiler`) rewrites virtual
/// imports then runs [`super::print::print_js_source`] so minify and sourcemap
/// apply to the final module (one oxc print).
pub fn emit_client_module(
    client_source: &str,
    decl: &ComponentDecl,
    server: Option<&ServerBridge>,
    reactive: &ReactiveComponent,
    view: &ViewView,
    plan: Option<&ExecutionPlan>,
) -> Result<EmittedJs, String> {
    let mut js = transpile_ts(client_source, &format!("{}.client.ts", decl.name))?;
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

    let method_names: Vec<String> = decl
        .methods
        .iter()
        .filter(|m| !m.is_private && !m.is_static && m.name != "constructor")
        .map(|m| m.name.clone())
        .collect();
    let prop_names: Vec<String> = decl.properties.iter().map(|f| f.name.clone()).collect();
    let handler_ctx = super::emit_direct::ComponentHandlerCtx {
        methods: &method_names,
        props: &prop_names,
    };

    if !is_direct_eligible(view) {
        return Err(format!(
            "vmz: component `{}` is not Direct-eligible; production blueprint render() was removed (production Direct emit)",
            decl.name
        ));
    }
    {
        let mut ir_direct = IrDepCursor::new(reactive);
        js.push_str(&emit_direct_create(
            &decl.name,
            view,
            &field_names,
            handler_ctx,
            &mut ir_direct,
        )?);
        if let Some(plan_ref) = plan
            && plan_ref.status != PlanStatus::Empty
        {
            let emit_plan = std::env::var("VMZ_EMIT_PLAN")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            if emit_plan {
                js.push_str(&emit_vmz_plan(&decl.name, plan_ref));
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
    Ok(EmittedJs { code: js, map: None })
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
    use super::ast_util::{js_string_literal, oxc_reprint_module_required};

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
    format!("\n{}", oxc_reprint_module_required(out.trim_start(), "async task wraps"))
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
    let verbs = ["Get", "Post", "Put", "Delete", "Patch"];
    let mut out = String::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("import ")
            && (trimmed.contains("\"vmz:http\"") || trimmed.contains("'vmz:http'"))
        {
            continue;
        }
        if let Some(rest) = strip_leading_http_decorators(trimmed, &verbs) {
            if rest.is_empty() {
                // Decorator-only line (method follows on the next line).
                continue;
            }
            let indent_len = line.len() - line.trim_start().len();
            out.push_str(&line[..indent_len]);
            out.push_str(rest);
            out.push('\n');
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Strip leading `@Get(...)` / `@Post` HTTP surface decorators.
/// Returns `Some(rest)` when at least one was removed (`rest` may be empty).
fn strip_leading_http_decorators<'a>(trimmed: &'a str, verbs: &[&str]) -> Option<&'a str> {
    let mut s = trimmed;
    let mut stripped_any = false;
    loop {
        if !s.starts_with('@') {
            break;
        }
        let after_at = &s[1..];
        let Some(verb) = verbs.iter().find(|v| after_at.starts_with(*v)) else {
            break;
        };
        let after_verb = &after_at[verb.len()..];
        let after_call = if after_verb.starts_with('(') {
            match close_paren_index(after_verb) {
                Some(i) => after_verb[i + 1..].trim_start(),
                None => return None,
            }
        } else {
            after_verb.trim_start()
        };
        s = after_call;
        stripped_any = true;
    }
    if stripped_any { Some(s) } else { None }
}

fn close_paren_index(s: &str) -> Option<usize> {
    let mut depth = 0usize;
    let mut in_str: Option<char> = None;
    let mut escaped = false;
    for (i, ch) in s.char_indices() {
        if let Some(q) = in_str {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == q {
                in_str = None;
            }
            continue;
        }
        match ch {
            '\'' | '"' | '`' => in_str = Some(ch),
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

fn emit_server_client_stub(bridge: &ServerBridge) -> String {
    use super::ast_util::{js_string_literal, oxc_reprint_module_required};

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
    oxc_reprint_module_required(&raw, "server client stub")
}

/// Rewrite virtual import specs (`vmz:runtime`, `vmz:dom`) to relative paths via oxc AST.
pub fn rewrite_virtual_import(
    js: &str,
    from_file: &Path,
    virtual_spec: &str,
    target: &Path,
) -> String {
    let from_dir = from_file.parent().unwrap_or(Path::new("."));
    let rel = pathdiff_string(from_dir, target);
    let spec = if rel.starts_with('.') { rel } else { format!("./{rel}") };
    let want = virtual_spec.to_string();
    super::module_rewrite::rewrite_module_specifiers_required(
        js,
        |s| if s == want { Some(spec.clone()) } else { None },
        "rewrite_virtual_import",
    )
}

/// Author may write `from './foo.ts'`; Node ESM under `dist/` needs `.js` (oxc AST).
pub fn rewrite_ts_spec_imports(js: &str) -> String {
    super::module_rewrite::rewrite_module_specifiers_required(
        js,
        |spec| {
            if let Some(stem) = spec.strip_suffix(".tsx").or_else(|| spec.strip_suffix(".ts")) {
                // Keep absolute / protocol / query forms; only rewrite extension.
                Some(format!("{stem}.js"))
            } else {
                None
            }
        },
        "rewrite_ts_spec_imports",
    )
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
        dom = serde_json::to_string(&format!("./dom.browser.js{q}"))
            .unwrap_or_else(|_| "\"./dom.browser.js\"".into()),
        eager_list = eager_regs.join(", "),
        lazy_block = lazy_regs.join(",\n"),
    );
    let code = super::ast_util::oxc_reprint_module_required(&code, "eager/lazy entry-client");
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
