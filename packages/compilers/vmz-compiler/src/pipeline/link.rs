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
use vmz_types::RouteTabDecl;

/// One RouteNode projection used for Link href realization.
#[derive(Debug, Clone)]
pub struct RouteEntry {
    /// Stable RouteId referenced by `<Link to={...}>`.
    pub route_id: String,
    /// URL path pattern with optional `:param` segments.
    pub path_pattern: String,
    /// Deployment chunk id for the page module.
    pub chunk_id: String,
    /// Absolute path of the `.vmz` that owns this route.
    pub source: PathBuf,
    /// Optional load strategy hint from `<router>`.
    pub load: Option<String>,
    /// Optional bottom-nav slot from `<router>.tab`.
    pub tab: Option<RouteTabDecl>,
}

/// Workspace RouteId → path pattern table (compile-time Link resolver input).
#[derive(Debug, Clone, Default)]
pub struct RouteTable {
    /// RouteId → entry map (insertion rejects duplicates).
    pub by_id: BTreeMap<String, RouteEntry>,
}

impl RouteTable {
    /// Look up a route by stable RouteId.
    pub fn get(&self, route_id: &str) -> Option<&RouteEntry> {
        self.by_id.get(route_id)
    }

    /// Look up a page route by deployment chunk id.
    pub fn get_by_chunk(&self, chunk_id: &str) -> Option<&RouteEntry> {
        self.by_id.values().find(|e| e.chunk_id == chunk_id)
    }

    /// Insert a route; errors if the RouteId already exists.
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
    /// Explicit RouteId override when present.
    pub id: Option<String>,
    /// Explicit path pattern override when present.
    pub path: Option<String>,
    /// Optional load strategy (`eager`, `lazy`, …).
    pub load: Option<String>,
    /// Optional bottom-nav slot (`order` / `label` / `icon`).
    pub tab: Option<RouteTabDecl>,
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
        reject_wechat_tab_keys(obj.keys())?;
        let tab = match obj.get("tab") {
            None => None,
            Some(v) => Some(parse_route_tab(v)?),
        };
        return Ok(RouteContractData { id, path, load, tab });
    }

    // Attribute sugar only when body is empty (desugar → same RouteContract).
    let id = crate::sfc::parse_attr_value(&block.attrs, "id").filter(|s| !s.is_empty());
    let path = crate::sfc::parse_attr_value(&block.attrs, "path").filter(|s| !s.is_empty());
    let load = crate::sfc::parse_attr_value(&block.attrs, "load").filter(|s| !s.is_empty());
    if crate::sfc::parse_attr_value(&block.attrs, "tab").is_some() {
        return Err("`<router>.tab` is JSON5/YAML only (not attribute sugar)".into());
    }
    Ok(RouteContractData { id, path, load, tab: None })
}

fn reject_wechat_tab_keys<'a>(keys: impl Iterator<Item = &'a String>) -> Result<(), String> {
    for k in keys {
        if matches!(k.as_str(), "tabBar" | "iconPath" | "selectedIconPath" | "pagePath" | "custom")
        {
            return Err(format!(
                "`<router>.{k}` is WeChat tabBar JSON; use `tab: {{ order, label, icon }}`"
            ));
        }
    }
    Ok(())
}

fn parse_route_tab(value: &serde_json::Value) -> Result<RouteTabDecl, String> {
    let Some(obj) = value.as_object() else {
        return Err("`<router>.tab` must be an object".into());
    };
    for k in obj.keys() {
        if !matches!(k.as_str(), "order" | "label" | "icon" | "selectedIcon") {
            if matches!(
                k.as_str(),
                "text" | "pagePath" | "iconPath" | "selectedIconPath" | "custom"
            ) {
                return Err(format!(
                    "`<router>.tab.{k}` is WeChat tabBar JSON; use order/label/icon"
                ));
            }
            return Err(format!("unknown `<router>.tab.{k}`"));
        }
    }
    let order = obj
        .get("order")
        .ok_or_else(|| "`<router>.tab.order` is required".to_string())
        .and_then(parse_tab_order)?;
    let label = obj
        .get("label")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "`<router>.tab.label` must be a non-empty string".to_string())?
        .to_string();
    let icon = obj
        .get("icon")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "`<router>.tab.icon` must be a project-relative asset path".to_string())?;
    let icon = parse_tab_asset(icon, "icon")?;
    let selected_icon = match obj.get("selectedIcon") {
        None => None,
        Some(v) => {
            let s = v
                .as_str()
                .ok_or_else(|| "`<router>.tab.selectedIcon` must be a string".to_string())?;
            Some(parse_tab_asset(s, "selectedIcon")?)
        }
    };
    Ok(RouteTabDecl { order, label, icon, selected_icon })
}

fn parse_tab_order(value: &serde_json::Value) -> Result<u32, String> {
    let n = if let Some(u) = value.as_u64() {
        u
    } else if let Some(i) = value.as_i64() {
        if i < 0 {
            return Err("`<router>.tab.order` must be >= 0".into());
        }
        i as u64
    } else if let Some(f) = value.as_f64() {
        if !f.is_finite() || f.fract() != 0.0 || f < 0.0 {
            return Err("`<router>.tab.order` must be a non-negative integer".into());
        }
        f as u64
    } else {
        return Err("`<router>.tab.order` must be a non-negative integer".into());
    };
    u32::try_from(n).map_err(|_| "`<router>.tab.order` is out of range".to_string())
}

fn parse_tab_asset(raw: &str, field: &str) -> Result<String, String> {
    let t = raw.trim().replace('\\', "/");
    if t.is_empty() {
        return Err(format!("`<router>.tab.{field}` must be a project-relative asset path"));
    }
    if t.starts_with('/') || t.contains("://") || t.split('/').any(|s| s == ".." || s.is_empty()) {
        return Err(format!(
            "`<router>.tab.{field}` must be a project-relative posix path (no URL, no `..`)"
        ));
    }
    Ok(t)
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

/// Plan-only layout chain for a page chunk: optional `Application` shell, then nested
/// `pages/**/Layout` ancestors that exist in `known_chunks` (outer → inner).
pub fn layout_chain_for_page(
    page_chunk_id: &str,
    known_chunks: &std::collections::BTreeSet<String>,
) -> Vec<String> {
    let mut chain = nested_layout_chain(page_chunk_id, known_chunks);
    if known_chunks.contains("Application") {
        chain.insert(0, "Application".into());
    }
    chain
}

fn nested_layout_chain(
    page_chunk_id: &str,
    known_chunks: &std::collections::BTreeSet<String>,
) -> Vec<String> {
    let rel = page_chunk_id.strip_prefix("pages/").unwrap_or(page_chunk_id);
    let mut parts: Vec<&str> = rel.split('/').filter(|p| !p.is_empty()).collect();
    if !parts.is_empty() {
        parts.pop();
    }
    let mut chain = Vec::new();
    // i = parts.len() … 0 → walk from page dir up to pages/
    for i in (0..=parts.len()).rev() {
        let dir_parts = &parts[..i.min(parts.len())];
        let layout_chunk = if dir_parts.is_empty() {
            "pages/Layout".to_string()
        } else {
            format!("pages/{}/Layout", dir_parts.join("/"))
        };
        if known_chunks.contains(&layout_chunk) {
            chain.push(layout_chunk);
        }
    }
    chain.reverse();
    chain
}

/// Collision key for Browser HTTP paths (`:id` and `[id]` are the same slot).
pub fn path_collision_key(pattern: &str) -> Result<String, String> {
    let pat = pattern.trim();
    if pat.is_empty() {
        return Err("route path pattern is empty".into());
    }
    if !pat.starts_with('/') {
        return Err(format!("route path must be an absolute HTTP path, got {pat:?}"));
    }
    if pat == "/" {
        return Ok("/".into());
    }
    let mut out: Vec<String> = Vec::new();
    for seg in pat.trim_start_matches('/').split('/') {
        if seg.is_empty() || is_route_group_dir(seg) {
            continue;
        }
        if let Some(name) = seg.strip_prefix("[...").and_then(|r| r.strip_suffix(']')) {
            out.push(format!("[...{name}]"));
            continue;
        }
        if let Some(name) = seg.strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
            out.push(format!("[{name}]"));
            continue;
        }
        if let Some(name) = seg.strip_prefix(':') {
            out.push(format!("[{name}]"));
            continue;
        }
        out.push(seg.to_ascii_lowercase());
    }
    if out.is_empty() { Ok("/".into()) } else { Ok(format!("/{}", out.join("/"))) }
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
    let mut by_http_path: BTreeMap<String, (String, PathBuf)> = BTreeMap::new();
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
        let collision = match path_collision_key(&path_pattern) {
            Ok(k) => k,
            Err(e) => {
                errors.push(format!("{}: {e}", path.display()));
                continue;
            }
        };
        if let Some((prev_id, prev_src)) = by_http_path.get(&collision) {
            errors.push(format!(
                "duplicate Browser path `{collision}` ({prev_id} @ {} vs {route_id} @ {})",
                prev_src.display(),
                path.display()
            ));
            continue;
        }
        by_http_path.insert(collision, (route_id.clone(), path.clone()));
        if let Err(e) = table.insert(RouteEntry {
            route_id,
            path_pattern,
            chunk_id: chunk_id.clone(),
            source: path.clone(),
            load: contract.load,
            tab: contract.tab,
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
                if let Some(err) = link_resolve_error(attrs, table) {
                    out.push(err)
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

#[cfg(test)]
mod layout_chain_tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn layout_chain_outer_to_inner_with_application() {
        let known: BTreeSet<String> =
            ["Application", "pages/Layout", "pages/shop/Layout", "pages/shop/offer"]
                .into_iter()
                .map(String::from)
                .collect();
        assert_eq!(
            layout_chain_for_page("pages/shop/offer", &known),
            vec![
                "Application".to_string(),
                "pages/Layout".to_string(),
                "pages/shop/Layout".to_string(),
            ]
        );
    }

    #[test]
    fn layout_chain_skips_missing_ancestors() {
        let known: BTreeSet<String> =
            ["pages/shop/Layout", "pages/shop/offer"].into_iter().map(String::from).collect();
        assert_eq!(
            layout_chain_for_page("pages/shop/offer", &known),
            vec!["pages/shop/Layout".to_string()]
        );
    }
}
