//! Emit JS modules for client / server — oxc transpile + `#server` stubs +
//! Direct `__vmzCreate` / `__vmzSerialize` / `__vmzPlan` (Gate 3: no production `render()`).

use std::path::Path;

use vmz_types::{MethodDecl, ReactiveComponent, ViewView};

use crate::analyze::AnalyzedScript;
use crate::emit_direct::{emit_direct_create, emit_vmz_plan, is_direct_eligible};
use crate::emit_ir::IrDepCursor;
use crate::plan_build::build_execution_plan;
use crate::reactive_build::build_reactive_module;
use crate::structural_build::build_native_view;
use crate::template::{AttrValue, TemplateAttr, TemplateIr};
use crate::transpile::transpile_ts;

/// Options when co-located `<script server>` is compiled into a client-facing stub.
#[derive(Debug, Clone)]
pub struct ServerBridge {
    pub module_id: String,
    pub class_name: String,
    pub methods: Vec<MethodDecl>,
}

pub fn emit_client_js(
    client_source: &str,
    client: &AnalyzedScript,
    template: &TemplateIr,
    server: Option<&ServerBridge>,
) -> Result<String, String> {
    emit_client_js_with_ir(client_source, client, template, server, None, None, None)
}

/// Emit client JS; when `reactive` is provided, Direct bind deps come from that view.
/// When `view` is provided (Native View), Direct create consumes it.
/// When `plan` is provided, `__vmzPlan` matches `*.program.json` (L3).
/// Gate 3: production products never emit `prototype.render` / blueprint.
pub fn emit_client_js_with_ir(
    client_source: &str,
    client: &AnalyzedScript,
    template: &TemplateIr,
    server: Option<&ServerBridge>,
    reactive: Option<&ReactiveComponent>,
    view: Option<&ViewView>,
    plan: Option<&vmz_types::ExecutionPlan>,
) -> Result<String, String> {
    let owned = if reactive.is_none() {
        Some(build_reactive_module(&format!("{}.client", client.decl.name), &client.decl, template))
    } else {
        None
    };
    let comp = reactive
        .or_else(|| owned.as_ref().and_then(|m| m.components.first()))
        .expect("reactive component");

    let owned_view = if view.is_none() { Some(build_native_view(template, comp)) } else { None };
    let view = view.or_else(|| owned_view.as_ref()).expect("native view");

    let owned_fields: std::collections::HashSet<String> = client
        .decl
        .fields
        .iter()
        .chain(client.decl.props.iter())
        .filter(|f| !f.name.starts_with('#'))
        .map(|f| f.name.clone())
        .collect();
    let barrier = crate::write_barrier::rewrite_static_path_writes(client_source, &owned_fields);
    let mut js = transpile_ts(&barrier.source, &format!("{}.client.ts", client.decl.name))?;
    js = inject_props_constructor(&js, &client.decl.name);

    if let Some(bridge) = server {
        js = strip_imports_from_module(&js, &bridge.module_id);
        let stub = emit_server_client_stub(bridge);
        js = format!("{stub}\n{js}");
    }

    let mut field_names: Vec<String> =
        client.decl.props.iter().chain(client.decl.fields.iter()).map(|f| f.name.clone()).collect();
    field_names.sort();
    field_names.dedup();

    // Gate 3: production emit is Direct-only — no blueprint `render()`.
    if !is_direct_eligible(view) {
        return Err(format!(
            "vmz: component `{}` is not Direct-eligible; production blueprint render() was removed (Gate 3)",
            client.decl.name
        ));
    }
    {
        let mut ir_direct = IrDepCursor::new(comp);
        js.push_str(&emit_direct_create(&client.decl.name, view, &field_names, &mut ir_direct));
        let owned_plan;
        let plan_ref = match plan {
            Some(p) => p,
            None => {
                owned_plan = build_execution_plan(view);
                &owned_plan
            }
        };
        if plan_ref.status != vmz_types::PlanStatus::Empty {
            js.push_str(&emit_vmz_plan(&client.decl.name, plan_ref));
        }
    }
    js.push_str(&emit_props_runtime(&client.decl));
    js.push_str(&emit_method_rw(&client.decl));
    let async_wraps = emit_async_task_wraps(&client.decl);
    if !async_wraps.is_empty() {
        if !js.contains("import { __vmzRunTask }") && !js.contains("import {__vmzRunTask}") {
            js = format!("import {{ __vmzRunTask }} from \"vmz:dom\";\n{js}");
        }
        js.push_str(&async_wraps);
    }
    if barrier.rewritten > 0 {
        // L4 WriteBarrier first slice: nested static path writes notify without Proxy.
        js.push_str(&format!("\n{}.__vmzWriteBarrier = true;\n", client.decl.name));
    }
    if !js.contains("export default") {
        js.push_str(&format!("\nexport default {};\n", client.decl.name));
    }
    Ok(js)
}

fn emit_method_rw(decl: &vmz_types::ComponentDecl) -> String {
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
            "  {name:?}: {{ reads: [{reads}], writes: [{writes}], calls: [{calls}], opaque: {opaque} }}",
            name = m.name,
            opaque = if m.opaque_callee { "true" } else { "false" },
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

/// Lift async effects into `__vmzRunTask` (AsyncTask 入图 first slice).
/// Matches resource projection: `is_async` methods that become reactive effects.
fn emit_async_task_wraps(decl: &vmz_types::ComponentDecl) -> String {
    let mut out = String::new();
    for m in &decl.methods {
        if !m.is_async {
            continue;
        }
        if m.reads.is_empty() && m.writes.is_empty() && m.calls.is_empty() && !m.opaque_callee {
            continue;
        }
        // Prototype wrap keeps method body AST untouched; signal is available to future lifts.
        out.push_str(&format!(
            "\n{{\n  const __m = {comp}.prototype.{method};\n  {comp}.prototype.{method} = function (...args) {{\n    return __vmzRunTask(this, {key:?}, (_signal, _meta) => __m.apply(this, args));\n  }};\n}}\n",
            comp = decl.name,
            method = m.name,
            key = m.name,
        ));
    }
    out
}

/// Apply props after `new` (field inits run before constructor body; props must win + re-init state).
fn emit_props_runtime(decl: &vmz_types::ComponentDecl) -> String {
    let prop_names: Vec<_> = decl.props.iter().map(|p| format!("{:?}", p.name)).collect();
    let state_names: Vec<_> = decl
        .fields
        .iter()
        .filter(|f| !f.name.starts_with('#'))
        .map(|f| format!("{:?}", f.name))
        .collect();

    let mut body = String::new();
    for p in &decl.props {
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

    format!(
        "\n{name}.__vmzProps = [{props}];\n{name}.__vmzState = [{state}];\n{name}.__vmzCtorAppliesProps = true;\n{name}.prototype.__vmzApplyProps = function __vmzApplyProps(props = {{}}) {{\n{body}}};\n",
        name = decl.name,
        props = prop_names.join(", "),
        state = state_names.join(", "),
        body = body,
    )
}

/// Insert `constructor(props)` that calls `__vmzApplyProps` (fields run before body).
fn inject_props_constructor(js: &str, class_name: &str) -> String {
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
    let peek_end = (body_start + 240).min(js.len());
    if js[body_start..peek_end].contains("constructor(") {
        return js.to_string();
    }
    let ctor = "\n\tconstructor(props = {}) {\n\t\tif (typeof this.__vmzApplyProps === \"function\") this.__vmzApplyProps(props);\n\t}\n";
    let mut out = String::with_capacity(js.len() + ctor.len());
    out.push_str(&js[..body_start]);
    out.push_str(ctor);
    out.push_str(&js[body_start..]);
    out
}

pub fn emit_server_js(
    server_source: &str,
    server: &AnalyzedScript,
    module_id: &str,
) -> Result<String, String> {
    // Decorators are compile-time route metadata; strip before JS emit (Node has no @Get).
    let stripped = strip_http_surface(server_source);
    let mut js = transpile_ts(&stripped, &format!("{}.server.ts", server.decl.name))?;
    js = crate::virtual_server::rewrite_imports_to_relative(&js, module_id);
    js = format!("// virtual: {module_id}\n{js}");
    if !js.contains("export default") {
        js.push_str(&format!("\nexport default {};\n", server.decl.name));
    }
    Ok(js)
}

/// Remove `vmz:http` imports and `@Get(...)` / `@Post(...)` decorators from server source.
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

/// Client-side surface for `XxxServer.method()` ?static methods ? `callServer`.
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

/// Convenience: rewrite `vmz:runtime` only.
pub fn rewrite_runtime_import(js: &str, from_file: &Path, runtime_file: &Path) -> String {
    rewrite_virtual_import(js, from_file, "vmz:runtime", runtime_file)
}

fn pathdiff_string(from_dir: &Path, target: &Path) -> String {
    use std::path::Component;
    let from_parts: Vec<_> =
        from_dir.components().filter(|c| !matches!(c, Component::CurDir)).collect();
    let to_parts: Vec<_> = target.components().collect();
    // Prefer simple string join with / for ESM.
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

pub(crate) fn collect_deps_oxc(expr: &str, fields: &[String], scope: &[String]) -> Vec<String> {
    crate::field_rw::collect_template_deps(expr, fields, scope)
}

/// Top-level `a ? b : c` → (test, consequent, alternate).
pub(crate) fn split_ternary_parts(expr: &str) -> Option<(String, String, String)> {
    use oxc::span::GetSpan;

    let src = format!("({expr})");
    let allocator = oxc::allocator::Allocator::default();
    let ret = oxc::parser::Parser::new(&allocator, &src, oxc::span::SourceType::ts()).parse();
    if !ret.diagnostics.is_empty() {
        return None;
    }
    let body = ret.program.body.first()?;
    let oxc::ast::ast::Statement::ExpressionStatement(es) = body else {
        return None;
    };
    let mut top = &es.expression;
    while let oxc::ast::ast::Expression::ParenthesizedExpression(p) = top {
        top = &p.expression;
    }
    let oxc::ast::ast::Expression::ConditionalExpression(cond) = top else {
        return None;
    };
    let slice = |span: oxc::span::Span| -> Option<String> {
        let s = span.start as usize;
        let e = span.end as usize;
        if s < e && e <= src.len() { Some(src[s..e].trim().to_string()) } else { None }
    };
    let test = slice(cond.test.span())?;
    let cons = slice(cond.consequent.span())?;
    let alt = slice(cond.alternate.span())?;
    if test.is_empty() || cons.is_empty() || alt.is_empty() {
        return None;
    }
    Some((test, cons, alt))
}

pub(crate) fn looks_like_ternary(expr: &str) -> bool {
    let chars: Vec<char> = expr.chars().collect();
    for i in 0..chars.len() {
        if chars[i] == '?' && (i + 1 >= chars.len() || chars[i + 1] != '.') {
            return true;
        }
    }
    false
}

pub(crate) fn is_component_tag(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_ascii_uppercase())
}

pub(crate) fn is_event_attr(name: &str) -> bool {
    let bytes = name.as_bytes();
    bytes.len() >= 3 && bytes[..2].eq_ignore_ascii_case(b"on") && bytes[2].is_ascii_uppercase()
}

/// Trusted raw HTML binding (`html={expr}`) — not a DOM attribute.
pub(crate) fn is_html_attr(name: &str) -> bool {
    name == "html"
}

pub(crate) fn sanitize_interp(expr: &str) -> String {
    let e = expr.trim();
    e.strip_prefix("this.").unwrap_or(e).to_string()
}

/// Rewrite bare field idents to `this.field`.
pub(crate) fn bind_field_idents(
    expr: &str,
    fields: &[String],
    scope: &[String],
    aliases: &[(String, String)],
) -> String {
    if fields.is_empty() && scope.is_empty() && aliases.is_empty() {
        return expr.trim().to_string();
    }
    let mut out = String::new();
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c.is_ascii_alphabetic() || c == '_' || c == '$' {
            let start = i;
            i += 1;
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric() || chars[i] == '_' || chars[i] == '$')
            {
                i += 1;
            }
            let ident: String = chars[start..i].iter().collect();
            let preceded_by_this = start >= 5 && {
                let prev: String = chars[start.saturating_sub(5)..start].iter().collect();
                prev.ends_with("this.")
            };
            if let Some((_, to)) = aliases.iter().find(|(from, _)| from == &ident) {
                out.push_str(to);
            } else if !preceded_by_this
                && !scope.iter().any(|s| s == &ident)
                && fields.iter().any(|f| f == &ident)
            {
                out.push_str("this.");
                out.push_str(&ident);
            } else {
                out.push_str(&ident);
            }
        } else {
            out.push(c);
            i += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze::analyze_script;
    use crate::sfc::ScriptKind;
    use crate::template::parse_template;

    #[test]
    fn emits_onmount_and_server_stub() {
        let src = r#"
import type { User } from '#server/db/users';
import { UserCardServer } from '#server/components/UserCard';
export default class UserCard {
  user!: User;
  async onMount() {
    this.user = await UserCardServer.fetchUser();
  }
}
"#;
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template("<p>{user.name}</p>");
        let bridge = ServerBridge {
            module_id: "#server/components/UserCard".into(),
            class_name: "UserCardServer".into(),
            methods: vec![MethodDecl {
                name: "fetchUser".into(),
                is_async: true,
                is_static: false,
                is_private: false,
                http: None,
                reads: vec![],
                writes: vec![],
                calls: vec![],
                opaque_callee: false,
                star_reasons: Vec::new(),
                span: oxc::span::Span::default(),
            }],
        };
        let js = emit_client_js(src, &client, &ir, Some(&bridge)).unwrap();
        assert!(js.contains("onMount"));
        assert!(js.contains("UserCardServer.fetchUser"));
        assert!(js.contains("callServer"));
        assert!(js.contains("vmz:runtime"));
        assert!(js.contains("static fetchUser"));
        assert!(!js.contains("from \"#server/components/UserCard\""));
        assert!(!js.contains("prototype.render"));
        assert!(js.contains("__vmzApplyProps"));
        assert!(js.contains("constructor(props = {})"));
        assert!(js.contains("__vmzCtorAppliesProps = true"));
        assert!(js.contains("__vmzDirect = true"));
        assert!(js.contains("api.bindText(this,"));
        assert!(js.contains("\"user.name\""));
        assert!(js.contains("__vmzMethodRw"));
        assert!(js.contains("\"onMount\""));
        assert!(js.contains("writes:"));
        assert!(js.contains("__vmzRunTask"), "{js}");
        assert!(js.contains("vmz:dom"), "{js}");
        assert_eq!(js.matches("export default").count(), 1);
    }

    #[test]
    fn emit_consumes_shared_reactive_view_deps() {
        use crate::reactive_build::build_reactive_module;

        let src = "export default class Card { user = { name: \"a\", bio: \"b\" }; }";
        let client = analyze_script(ScriptKind::Client, src);
        let tpl = parse_template("<h2>{user.name}</h2><p>{user.bio}</p>");
        let reactive = build_reactive_module("Card.vmz", &client.decl, &tpl);
        let comp = &reactive.components[0];
        let js = emit_client_js_with_ir(src, &client, &tpl, None, Some(comp), None, None).unwrap();
        assert!(js.contains("\"user.name\"") || js.contains("'user.name'"), "{js}");
        assert!(js.contains("\"user.bio\"") || js.contains("'user.bio'"), "{js}");
        // IR BindingId must be emitted on Direct binds (hot path keys).
        let name_id = comp
            .bindings
            .iter()
            .find(|b| {
                b.reads.iter().any(|r| {
                    r.to_stable_string(&comp.state_slots, &comp.properties, &comp.exprs)
                        == "user.name"
                })
            })
            .map(|b| b.id.0)
            .expect("user.name binding");
        let bio_id = comp
            .bindings
            .iter()
            .find(|b| {
                b.reads.iter().any(|r| {
                    r.to_stable_string(&comp.state_slots, &comp.properties, &comp.exprs)
                        == "user.bio"
                })
            })
            .map(|b| b.id.0)
            .expect("user.bio binding");
        assert!(
            js.contains(&format!("api.bindText(this, {name_id},")),
            "missing bindingId {name_id}: {js}"
        );
        assert!(
            js.contains(&format!("api.bindText(this, {bio_id},")),
            "missing bindingId {bio_id}: {js}"
        );
    }

    #[test]
    fn emits_if_directive() {
        let src = "export default class Card { user = null; }";
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template(r#"<p if={!user}>Loading</p><div if={user}>{user.name}</div>"#);
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("api.ifBlock(this,"), "{js}");
        assert!(js.contains("!this.user") || js.contains("!(this.user)"), "{js}");
        assert!(js.contains("\"user\""), "{js}");
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn emits_conditional_bind_cf() {
        let src = "export default class T { enabled = true; user = { name: \"a\" }; account = { name: \"b\" }; }";
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template(r#"{enabled ? user.name : account.name}"#);
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("api.bindText(this,"), "{js}");
        assert!(js.contains("stable:"), "{js}");
        assert!(js.contains("branches:"), "{js}");
        assert!(js.contains("user.name"), "{js}");
        assert!(js.contains("account.name"), "{js}");
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn if_deps_come_from_control_region_only() {
        let src = "export default class T { show = true; aText = \"A\"; bText = \"B\"; }";
        let client = analyze_script(ScriptKind::Client, src);
        let tpl = parse_template(r#"<div><p if={show}>{aText}</p><p else>{bText}</p></div>"#);
        let js = emit_client_js(src, &client, &tpl, None).unwrap();
        // Structural if deps = stable cond only (show), not body texts.
        assert!(
            js.contains("api.ifBlock(this,") && js.contains("[\"show\"]"),
            "if deps must be region stable only: {js}"
        );
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn emits_if_else_elseif_and_each_key() {
        let src = r#"
export default class Card {
  user = null;
  error = null;
  tags = [];
}
"#;
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template(
            r#"<p if={!user}>Loading</p><p else-if={error}>{error}</p><div else><li each={tags} as="tag" key={tag}>{tag}</li></div>"#,
        );
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("api.ifBlock(this,"), "{js}");
        assert!(js.contains("this.error") || js.contains("(this.error)"), "{js}");
        assert!(js.contains("api.eachBlock(this,"), "{js}");
        assert!(js.contains("createItem:") || js.contains("createItem"), "{js}");
        assert!(js.contains("box") && js.contains(".item"), "{js}");
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn emits_apply_props_for_initial_count() {
        let src = r#"
export default class CounterButton {
  public initial: number = 0;
  count = this.initial;
}
"#;
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template("<button>{count}</button>");
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("__vmzProps = [\"initial\"]"));
        assert!(js.contains("__vmzState = [\"count\"]"));
        assert!(js.contains("this.count = this.initial"));
        assert!(js.contains("props.initial !== undefined"));
    }

    #[test]
    fn emits_component_and_event_handler() {
        let src = r#"
export default class IndexPage {
  count = 0;
}
"#;
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template(
            r#"<main><CounterButton /><button type="button" onClick={() => count++}>{count}</button></main>"#,
        );
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("api.component(this,"), "{js}");
        assert!(js.contains("\"CounterButton\""), "{js}");
        assert!(js.contains("api.on(") || js.contains("api.on(e"), "{js}");
        assert!(js.contains("this.count++"), "{js}");
        assert!(js.contains("api.bindText(this,"), "{js}");
        assert!(js.contains("\"count\""), "{js}");
        assert!(!js.contains("this.() =>"));
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn emits_client_idle_directive() {
        let src = "export default class IndexPage { title = 'x'; }";
        let client = analyze_script(ScriptKind::Client, src);
        let ir = parse_template(r#"<LikeButton client:idle label="Like" />"#);
        let js = emit_client_js(src, &client, &ir, None).unwrap();
        assert!(js.contains("api.component(this,"), "{js}");
        assert!(js.contains("\"idle\"") || js.contains("'idle'"), "{js}");
        assert!(js.contains("Like") || js.contains("\"label\""), "{js}");
        assert!(!js.contains("prototype.render"), "{js}");
    }

    #[test]
    fn emits_server_methods_and_hash_imports() {
        let src = r#"
import type { User } from '#server/db/users';
import { UsersRepository } from '#server/db/users';
import { Get } from 'vmz:http';
export default class UserCardServer {
  #users = new UsersRepository();
  @Get('/api/users/me')
  async fetchUser(): Promise<User> {
    return this.#users.findDefault();
  }
}
"#;
        let server = analyze_script(ScriptKind::Server, src);
        let js = emit_server_js(src, &server, "#server/components/UserCard").unwrap();
        assert!(js.contains("async fetchUser()"));
        assert!(js.contains("../db/users.js"));
        assert!(js.contains("// virtual: #server/components/UserCard"));
        assert!(js.contains("#users"));
        assert!(!js.contains("@Get"));
        assert!(!js.contains("vmz:http"));
        assert_eq!(js.matches("export default").count(), 1);
    }
}
