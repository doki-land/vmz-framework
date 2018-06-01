//! Same-app `<Link to={RouteId} params>` → `href` via Route Graph (not file paths).
//!
//! `to` is a stable RouteId. Renaming a page file or changing `path` must not require
//! editing Links; only RouteId rename (or class default-id change) does.
//!
//! Params object literals are parsed with oxc AST — no string-scan/splice for values.

use std::collections::BTreeMap;
use std::path::PathBuf;

use oxc_allocator::Allocator;
use oxc_ast::ast::{Expression, ObjectPropertyKind, PropertyKey};
use oxc_parser::Parser;
use oxc_span::SourceType;

use crate::sfc::{DataBlock, ParsedVmz};
use crate::template::{AttrValue, TemplateIr, TemplateNode};

/// One RouteNode projection used for Link href realization.
#[derive(Debug, Clone)]
pub struct RouteEntry {
    pub route_id: String,
    pub path_pattern: String,
    pub chunk_id: String,
    pub source: PathBuf,
    pub load: Option<String>,
}

/// Workspace RouteId → path pattern table (compile-time Link resolver input).
#[derive(Debug, Clone, Default)]
pub struct RouteTable {
    pub by_id: BTreeMap<String, RouteEntry>,
}

impl RouteTable {
    pub fn get(&self, route_id: &str) -> Option<&RouteEntry> {
        self.by_id.get(route_id)
    }

    pub fn insert(&mut self, entry: RouteEntry) -> Result<(), String> {
        if let Some(prev) = self.by_id.get(&entry.route_id) {
            return Err(format!(
                "duplicate RouteId `{}` ({} vs {})",
                entry.route_id,
                prev.source.display(),
                entry.source.display()
            ));
        }
        self.by_id.insert(entry.route_id.clone(), entry);
        Ok(())
    }
}

/// Minimal RouteContract fields from `<router>` JSON5 (safe data only).
#[derive(Debug, Clone, Default)]
pub struct RouteContractData {
    pub id: Option<String>,
    pub path: Option<String>,
    pub load: Option<String>,
}

/// Parse `<router>` JSON5 body and/or opening-tag attribute sugar into RouteContract.
///
/// - No block / empty contract → defaults (RouteId = class name, path from file route)
/// - Body JSON5 is the primary surface
/// - Empty body + `<router path="/x" id="…" load="…" />` desugars to the same fields
pub fn parse_route_contract(block: &DataBlock) -> Result<RouteContractData, String> {
    let body = block.content.trim();
    if !body.is_empty() {
        if block.lang.as_deref().is_some_and(|l| l != "json5") {
            return Err(format!(
                "unsupported `<router lang=\"{}\">`; first slice is JSON5 only",
                block.lang.as_deref().unwrap_or("")
            ));
        }
        let value: serde_json::Value =
            json5::from_str(body).map_err(|e| format!("invalid `<router>` JSON5: {e}"))?;
        let Some(obj) = value.as_object() else {
            return Err("`<router>` must be a JSON5 object".into());
        };
        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let path = obj
            .get("path")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        let load = obj
            .get("load")
            .and_then(|v| v.as_str())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        return Ok(RouteContractData { id, path, load });
    }

    // Attribute sugar only when body is empty (desugar → same RouteContract).
    let id = crate::sfc::parse_attr_value(&block.attrs, "id").filter(|s| !s.is_empty());
    let path = crate::sfc::parse_attr_value(&block.attrs, "path").filter(|s| !s.is_empty());
    let load = crate::sfc::parse_attr_value(&block.attrs, "load").filter(|s| !s.is_empty());
    Ok(RouteContractData { id, path, load })
}

/// Default RouteId when `<router>.id` is omitted: export default class name (file rename safe).
pub fn default_route_id(class_name: &str) -> String {
    class_name.trim().to_string()
}

/// File-route path pattern from chunk id (`pages/products/[id]` → `/products/[id]`).
/// Used only when `<router>.path` is omitted — never as a Link `to` value.
/// Skips URL-invisible route groups `(name)` and boundary role stems
/// (`Layout` / `Loading` / `Error` / `NotFound`).
pub fn path_pattern_from_chunk(chunk_id: &str) -> String {
    let rel = chunk_id.strip_prefix("pages/").unwrap_or(chunk_id);
    let parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
    let mut segs: Vec<String> = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        if is_route_group_dir(p) {
            continue;
        }
        if *p == "index" && i == parts.len() - 1 {
            continue;
        }
        // Boundary roles are not routable pages; pattern unused when skipped in collect.
        if is_route_boundary_stem(p) {
            continue;
        }
        segs.push((*p).to_string());
    }
    if segs.is_empty() { "/".into() } else { format!("/{}", segs.join("/")) }
}

fn is_route_group_dir(seg: &str) -> bool {
    seg.starts_with('(') && seg.ends_with(')') && seg.len() > 2
}

fn is_route_boundary_stem(stem: &str) -> bool {
    matches!(stem, "Layout" | "Loading" | "Error" | "NotFound")
}

/// True when a pages/** chunk is a group boundary file, not a navigable page.
pub fn is_route_boundary_chunk(chunk_id: &str) -> bool {
    let rel = chunk_id.strip_prefix("pages/").unwrap_or(chunk_id);
    let stem = rel.rsplit('/').next().unwrap_or(rel);
    is_route_boundary_stem(stem)
}

/// Build route table from discovered page units + already-parsed SFCs.
/// `parsed_pages`: (path, parsed, class_name, chunk_id)
pub fn collect_route_table(
    parsed_pages: &[(PathBuf, ParsedVmz, String, String)],
) -> Result<RouteTable, Vec<String>> {
    let mut table = RouteTable::default();
    let mut errors = Vec::new();
    for (path, parsed, class_name, chunk_id) in parsed_pages {
        if is_route_boundary_chunk(chunk_id) {
            continue;
        }
        let contract = match &parsed.router {
            Some(block) => match parse_route_contract(block) {
                Ok(c) => c,
                Err(e) => {
                    errors.push(format!("{}: {e}", path.display()));
                    continue;
                }
            },
            None => RouteContractData::default(),
        };
        let route_id = contract.id.clone().unwrap_or_else(|| default_route_id(class_name));
        if route_id.starts_with('/') {
            errors.push(format!("{}: RouteId must not be a path ({route_id:?})", path.display()));
            continue;
        }
        let path_pattern =
            contract.path.clone().unwrap_or_else(|| path_pattern_from_chunk(chunk_id));
        if let Err(e) = table.insert(RouteEntry {
            route_id,
            path_pattern,
            chunk_id: chunk_id.clone(),
            source: path.clone(),
            load: contract.load,
        }) {
            errors.push(e);
        }
    }
    if errors.is_empty() { Ok(table) } else { Err(errors) }
}

/// Resolve Link href from RouteId + static params against the route table.
pub fn resolve_link_href(
    route_id: &str,
    params: &BTreeMap<String, String>,
    table: &RouteTable,
) -> Result<String, String> {
    let id = route_id.trim();
    if id.is_empty() {
        return Err("Link `to` is empty".into());
    }
    if id.starts_with('/') {
        return Err(format!("Link must use RouteId, not path {id:?}"));
    }
    let Some(entry) = table.get(id) else {
        return Err(format!("unknown RouteId {id:?}"));
    };
    realize_path_pattern(&entry.path_pattern, params)
}

/// Fill `/products/[id]` or `/users/:id` with static params.
pub fn realize_path_pattern(
    pattern: &str,
    params: &BTreeMap<String, String>,
) -> Result<String, String> {
    let pat = pattern.trim();
    if pat.is_empty() {
        return Err("route path pattern is empty".into());
    }
    if !pat.starts_with('/') {
        return Err(format!("route path must be absolute, got {pat:?}"));
    }
    if pat == "/" {
        return Ok("/".into());
    }

    let mut out: Vec<String> = Vec::new();
    for seg in pat.trim_start_matches('/').split('/') {
        if seg.is_empty() {
            continue;
        }
        if let Some(name) = seg.strip_prefix("[...").and_then(|r| r.strip_suffix(']')) {
            let Some(val) = params.get(name) else {
                return Err(format!("Link params missing catch-all `{name}`"));
            };
            for part in val.split('/').filter(|s| !s.is_empty()) {
                out.push(part.to_string());
            }
            continue;
        }
        if let Some(name) = seg.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            let Some(val) = params.get(name) else {
                return Err(format!("Link params missing `{name}`"));
            };
            if val.is_empty() || val.contains('/') {
                return Err(format!("Link param `{name}` is invalid"));
            }
            out.push(val.clone());
            continue;
        }
        if let Some(name) = seg.strip_prefix(':') {
            let Some(val) = params.get(name) else {
                return Err(format!("Link params missing `{name}`"));
            };
            if val.is_empty() || val.contains('/') {
                return Err(format!("Link param `{name}` is invalid"));
            }
            out.push(val.clone());
            continue;
        }
        out.push(seg.to_string());
    }
    if out.is_empty() { Ok("/".into()) } else { Ok(format!("/{}", out.join("/"))) }
}

/// Parse static string entries from a params object expression via oxc AST.
/// Returns `None` when the expression is not a fully static object of string literals.
pub fn parse_static_link_params(expr: &str) -> Option<BTreeMap<String, String>> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Some(BTreeMap::new());
    }
    let src = if trimmed.starts_with('{') {
        format!("({trimmed})")
    } else {
        format!("({{ {trimmed} }})")
    };
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, &src, SourceType::ts()).parse();
    if ret.panicked {
        return None;
    }
    let mut visitor = StaticParamsVisitor { result: None, failed: false };
    oxc_ast_visit::Visit::visit_program(&mut visitor, &ret.program);
    if visitor.failed {
        return None;
    }
    visitor.result
}

struct StaticParamsVisitor {
    result: Option<BTreeMap<String, String>>,
    failed: bool,
}

impl<'a> oxc_ast_visit::Visit<'a> for StaticParamsVisitor {
    fn visit_object_expression(&mut self, it: &oxc_ast::ast::ObjectExpression<'a>) {
        if self.result.is_some() || self.failed {
            return;
        }
        let mut out = BTreeMap::new();
        for prop in &it.properties {
            let ObjectPropertyKind::ObjectProperty(p) = prop else {
                self.failed = true;
                return;
            };
            if p.method || p.shorthand || p.kind != oxc_ast::ast::PropertyKind::Init {
                self.failed = true;
                return;
            }
            let key = match &p.key {
                PropertyKey::StaticIdentifier(id) => id.name.to_string(),
                PropertyKey::StringLiteral(s) => s.value.as_str().to_string(),
                PropertyKey::Identifier(id) => id.name.to_string(),
                _ => {
                    self.failed = true;
                    return;
                }
            };
            let Expression::StringLiteral(lit) = &p.value else {
                self.failed = true;
                return;
            };
            out.insert(key, lit.value.as_str().to_string());
        }
        self.result = Some(out);
    }
}

/// Validate same-app `<Link>` against RouteTable (graph identity, not filesystem probes).
pub fn check_template_links(ir: &TemplateIr, table: &RouteTable) -> Vec<String> {
    let mut out = Vec::new();
    walk_links(&ir.roots, table, &mut out);
    out
}

fn walk_links(nodes: &[TemplateNode], table: &RouteTable, out: &mut Vec<String>) {
    for node in nodes {
        let TemplateNode::Element { tag, attrs, children } = node else {
            continue;
        };
        if tag == "Link" {
            let has_app = attrs.iter().any(|a| a.name == "application");
            if !has_app {
                match link_resolve_error(attrs, table) {
                    Some(err) => out.push(err),
                    None => {}
                }
            }
        }
        walk_links(children, table, out);
    }
}

fn link_resolve_error(
    attrs: &[crate::template::TemplateAttr],
    table: &RouteTable,
) -> Option<String> {
    let to = attrs.iter().find_map(|a| match (&a.name[..], &a.value) {
        ("to", AttrValue::Static(s)) => Some(s.as_str()),
        _ => None,
    })?;
    let params = match attrs.iter().find_map(|a| match (&a.name[..], &a.value) {
        ("params", AttrValue::Interp(e)) => Some(e.as_str()),
        _ => None,
    }) {
        None => BTreeMap::new(),
        Some(expr) => match parse_static_link_params(expr) {
            Some(map) => map,
            None => {
                return Some(format!(
                    "<Link to={to:?}> params must be a static string object (dynamic Link not in this slice)"
                ));
            }
        },
    };
    resolve_link_href(to, &params, table).err()
}
