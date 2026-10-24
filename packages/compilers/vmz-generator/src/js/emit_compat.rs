//! Client / server JS module assembly: Oak transpile + Direct emit + component meta.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;

use vmz_types::{
    ComponentDecl, ExecutionPlan, MethodDecl, PlanStatus, ReactiveComponent, ViewNode, ViewView,
};

use super::emit_direct::{
    ComponentHandlerCtx, emit_direct_create, emit_vmz_plan, is_direct_eligible,
};
use super::emit_ir::IrDepCursor;
use super::module_rewrite::rewrite_module_specifiers;
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

fn q(s: &str) -> String {
    serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into())
}

fn str_array(items: &[&str]) -> String {
    format!("[{}]", items.iter().map(|s| q(s)).collect::<Vec<_>>().join(", "))
}

fn collect_component_tags(nodes: &[ViewNode], out: &mut BTreeSet<String>) {
    for node in nodes {
        match node {
            ViewNode::Component { tag, children, .. } => {
                out.insert(tag.clone());
                collect_component_tags(children, out);
            }
            ViewNode::Element { children, .. } | ViewNode::Slot { children, .. } => {
                collect_component_tags(children, out);
            }
            ViewNode::If { branches, .. } => {
                for br in branches {
                    collect_component_tags(std::slice::from_ref(&br.body), out);
                }
            }
            ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
        }
    }
}

/// Emit client JS from barrier-rewritten source + analyzed decl + Native View / Reactive / Plan.
///
/// `child_ctors`: tag -> relative import specifier (e.g. `./components/Child.client.js`).
/// Empty map keeps string-tag registry fallback (unit tests without a graph).
pub fn emit_client_module(
    client_source: &str,
    decl: &ComponentDecl,
    server: Option<&ServerBridge>,
    reactive: &ReactiveComponent,
    view: &ViewView,
    plan: Option<&ExecutionPlan>,
    child_ctors: &HashMap<String, String>,
) -> Result<EmittedJs, String> {
    let mut js = transpile_ts(client_source, &format!("{}.client.ts", decl.name))?;
    let has_source_constructor = decl.methods.iter().any(|method| method.name == "constructor")
        || js.contains("constructor(");
    js = inject_props_constructor(&js, &decl.name, has_source_constructor);

    if let Some(bridge) = server {
        js = strip_imports_from_module(&js, &bridge.module_id);
        let stub = emit_server_client_stub(bridge);
        js = format!("{stub}\n{js}");
    }

    let mut used_tags = BTreeSet::new();
    collect_component_tags(&view.roots, &mut used_tags);
    let mut child_imports = String::new();
    for tag in &used_tags {
        let Some(rel) = child_ctors.get(tag) else {
            continue;
        };
        let spec = if rel.starts_with('.') { rel.clone() } else { format!("./{rel}") };
        child_imports.push_str(&format!("import {tag} from {};\n", q(&spec)));
    }
    if !child_imports.is_empty() {
        js = format!("{child_imports}{js}");
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
    let handler_ctx = ComponentHandlerCtx { methods: &method_names, props: &prop_names };

    if !is_direct_eligible(view) {
        return Err(format!(
            "vmz: component `{}` is not Direct-eligible; production blueprint render() was removed (production Direct emit)",
            decl.name
        ));
    }
    let mut ir_direct = IrDepCursor::new(reactive);
    js.push_str(&emit_direct_create(
        &decl.name,
        view,
        &field_names,
        handler_ctx,
        &mut ir_direct,
        child_ctors,
    )?);
    if let Some(plan_ref) = plan
        && plan_ref.status != PlanStatus::Empty
    {
        js.push_str(&emit_vmz_plan(&decl.name, plan_ref));
    }

    js.push_str(&emit_props_runtime(decl, !has_source_constructor));
    js.push_str(&emit_method_rw(decl));
    let async_wraps = emit_async_task_wraps(decl);
    if !async_wraps.is_empty() {
        if !js.contains("__vmzRunTask }") && !js.contains("__vmzRunTask}") {
            js = format!("import {{ __vmzRunTask }} from \"vmz:dom\";\n{js}");
        }
        js.push_str(&async_wraps);
    }
    if !js.contains("export default") {
        js.push_str(&format!("\nexport default {};\n", decl.name));
    }
    Ok(EmittedJs { code: js, map: None })
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
        let reads: Vec<&str> = m.reads.iter().map(|s| s.as_str()).collect();
        let writes: Vec<&str> = m.writes.iter().map(|s| s.as_str()).collect();
        let calls: Vec<&str> = m.calls.iter().map(|s| s.as_str()).collect();
        entries.push(format!(
            "{}: {{reads: {}, writes: {}, calls: {}, opaque: {}, async: {}}}",
            q(&m.name),
            str_array(&reads),
            str_array(&writes),
            str_array(&calls),
            m.opaque_callee,
            m.is_async,
        ));
    }
    if entries.is_empty() {
        return String::new();
    }
    format!("\n{}.__vmzMethodRw = {{{}}};\n", decl.name, entries.join(", "))
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
            "\n{{\n  const __m = {comp}.prototype.{method};\n  {comp}.prototype.{method} = function (...args) {{\n    return __vmzRunTask(this, {key}, (_signal, _meta) => __m.apply(this, args));\n  }};\n}}\n",
            comp = decl.name,
            method = m.name,
            key = q(&m.name),
        ));
    }
    out
}

fn emit_props_runtime(decl: &ComponentDecl, ctor_applies_props: bool) -> String {
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

    let mut meta = String::new();
    meta.push_str(&format!("\n{}.__vmzProps = {};\n", decl.name, str_array(&prop_names)));
    meta.push_str(&format!("{}.__vmzState = {};\n", decl.name, str_array(&state_names)));
    meta.push_str(&format!("{}.__vmzCtorAppliesProps = {ctor_applies_props};\n", decl.name));
    meta.push_str(&format!(
        "{name}.prototype.__vmzApplyProps = function __vmzApplyProps(props = {{}}) {{\n{body}}};\n",
        name = decl.name,
    ));
    meta
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
    let mut methods = String::new();
    for m in &bridge.methods {
        if m.is_private || m.name == "constructor" {
            continue;
        }
        methods.push_str(&format!(
            "  static {method}(...args) {{\n    return callServer({id}, {name}, args);\n  }}\n",
            method = m.name,
            id = q(&bridge.module_id),
            name = q(&m.name),
        ));
    }
    format!(
        "import {{ callServer }} from \"vmz:runtime\";\n\nexport class {name} {{\n{methods}}}\n",
        name = bridge.class_name,
        methods = methods,
    )
}

/// Rewrite a virtual import spec to a path relative to the importing file.
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
///
/// Uses Oak CST-level [`rewrite_module_specifiers`] so only the specifier string
/// itself is replaced — other text on the same line (comments, literals) and
/// dynamic `import("…")` calls included. When Oak cannot parse the module the
/// source is returned unchanged rather than risk a text-level false positive.
pub fn rewrite_ts_spec_imports(js: &str) -> String {
    let remap = |spec: &str| -> Option<String> {
        if let Some(without_ext) = spec.strip_suffix(".tsx") {
            Some(format!("{without_ext}.js"))
        } else if let Some(without_ext) = spec.strip_suffix(".ts") {
            Some(format!("{without_ext}.js"))
        } else {
            None
        }
    };

    rewrite_module_specifiers(js, remap).unwrap_or_else(|| js.to_string())
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
    let lazy_regs: Vec<String> = lazy
        .iter()
        .map(|(name, entry)| {
            let spec = serde_json::to_string(&format!("./{entry}{q}"))
                .unwrap_or_else(|_| format!("\"./{entry}{q}\""));
            format!("[{name:?}, () => import({spec})]")
        })
        .collect();
    let code = format!(
        r#"/**
 * Generated by vmz-generator - do not edit by hand.
 */
import {{ hydrate, mount }} from {dom};
{imports}
const __vmzLazy = new Map([
{lazy_block}
]);
export {{ hydrate, mount, __vmzLazy }};
"#,
        dom = serde_json::to_string(&format!("./dom.browser.js{q}"))
            .unwrap_or_else(|_| "\"./dom.browser.js\"".into()),
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
