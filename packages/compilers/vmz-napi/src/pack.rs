//! N-API bridge for the `vmz-pack` packing chain (frozen contract `v0`).
//!
//! Two string-in / string-out functions: `packPlan` (plan only) and
//! `packWrite` (plan + emit to `outDir`). The request/response JSON shapes
//! are defined by the wire structs below; every conversion is a plain Rust
//! function independent of napi so it is unit-testable without a Node host.
//!
//! `plan.styles` carries one entry per aggregated CSS artifact
//! (`fileName` / `url` / `modules` / `sourcePaths`); the CSS text itself
//! stays Rust-side and only `packWrite` materializes it on disk.
//!
//! Error posture: JSON parse failure, missing fields, unknown fields,
//! invalid `target` or `uses` not covering every entry logical all collapse
//! into a single `{ ok: false }` response carrying
//! `vmz::napi::pack::invalid_request`. `plan_emit` / `write_emit` error
//! diagnostics are forwarded verbatim with `ok: false`; a successful
//! `plan_emit` with non-empty diagnostics (warnings) returns `ok: true`
//! with the plan. Nothing here panics and nothing throws through N-API.
//! Graph-level diagnostics (entry canonicalization / read failures) mean a
//! requested entry is absent from the plan, so they are surfaced as
//! `ok: false` instead of silently producing a partial plan.

use std::path::{Path, PathBuf};

use napi_derive::napi;
use serde::{Deserialize, Serialize};
use vmz_pack::diag::PackDiagnostic;
use vmz_pack::emit::{EmitOptions, EmitPlan};
use vmz_pack::link::EntryUse;
use vmz_pack::resolve::Target;

/// Stable diagnostic code for every request-shape rejection at this boundary.
const INVALID_REQUEST: &str = "vmz::napi::pack::invalid_request";

// ---------------------------------------------------------------------------
// Request wire
// ---------------------------------------------------------------------------

/// Packed request: entries + target + root + per-entry export uses + public base.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestWire {
    entries: Vec<EntryWire>,
    target: String,
    root: String,
    uses: Vec<UseWire>,
    public_base: String,
}

/// One logical entry with its absolute file path.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryWire {
    logical: String,
    path: String,
}

/// Export usage declaration for one logical entry; `usedExports: null`
/// keeps every export live (maps to `EntryUse::used_exports == None`).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UseWire {
    logical: String,
    used_exports: Option<Vec<String>>,
}

// ---------------------------------------------------------------------------
// Response wire (mirrors `EmitPlan` field-for-field, no new semantics)
// ---------------------------------------------------------------------------

/// Unified response for `packPlan` / `packWrite`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseWire {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    plan: Option<PlanWire>,
    diagnostics: Vec<DiagnosticWire>,
}

/// Serialized `vmz_pack::emit::EmitPlan` minus its diagnostics field
/// (those go to the top-level `diagnostics` array).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlanWire {
    artifacts: Vec<ArtifactWire>,
    styles: Vec<StyleWire>,
    assets: Vec<AssetWire>,
    entry_files: Vec<EntryFileWire>,
    dynamic_files: Vec<DynamicFileWire>,
    manifest_json: String,
}

/// One chunk artifact (`ChunkArtifact`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactWire {
    chunk_id: String,
    file_name: String,
    code: String,
    modules: Vec<String>,
    imports: Vec<String>,
    dynamic: Vec<String>,
}

/// One aggregated CSS artifact (`StyleArtifact`). `content` stays Rust-side:
/// the wire carries identity and provenance, `packWrite` writes the file.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleWire {
    file_name: String,
    url: String,
    modules: Vec<String>,
    source_paths: Vec<String>,
}

/// One asset artifact (`AssetArtifact`).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssetWire {
    module_path: String,
    specifier: String,
    file_name: String,
    url: String,
    source_path: String,
}

/// Logical entry → emitted file (`EmitPlan::entry_files` tuple pair).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct EntryFileWire {
    logical: String,
    file: String,
}

/// Dynamic import edge file mapping (`EmitPlan::dynamic_files` tuple pair).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DynamicFileWire {
    from: String,
    to: String,
}

/// `PackDiagnostic` with `path` / `span` omitted when absent.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticWire {
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    span: Option<(usize, usize)>,
}

// ---------------------------------------------------------------------------
// Pure conversions (no napi dependency)
// ---------------------------------------------------------------------------

fn diagnostic_to_wire(diagnostic: &PackDiagnostic) -> DiagnosticWire {
    DiagnosticWire {
        code: diagnostic.code.clone(),
        message: diagnostic.message.clone(),
        path: diagnostic.path.clone(),
        span: diagnostic.span,
    }
}

fn diagnostics_to_wire(diagnostics: &[PackDiagnostic]) -> Vec<DiagnosticWire> {
    diagnostics.iter().map(diagnostic_to_wire).collect()
}

fn plan_to_wire(plan: &EmitPlan) -> PlanWire {
    PlanWire {
        artifacts: plan
            .artifacts
            .iter()
            .map(|artifact| ArtifactWire {
                chunk_id: artifact.chunk_id.clone(),
                file_name: artifact.file_name.clone(),
                code: artifact.code.clone(),
                modules: artifact.modules.clone(),
                imports: artifact.imports.clone(),
                dynamic: artifact.dynamic.clone(),
            })
            .collect(),
        styles: plan
            .styles
            .iter()
            .map(|style| StyleWire {
                file_name: style.file_name.clone(),
                url: style.url.clone(),
                modules: style.modules.clone(),
                source_paths: style.source_paths.clone(),
            })
            .collect(),
        assets: plan
            .assets
            .iter()
            .map(|asset| AssetWire {
                module_path: asset.module_path.clone(),
                specifier: asset.specifier.clone(),
                file_name: asset.file_name.clone(),
                url: asset.url.clone(),
                source_path: asset.source_path.clone(),
            })
            .collect(),
        entry_files: plan
            .entry_files
            .iter()
            .map(|(logical, file)| EntryFileWire { logical: logical.clone(), file: file.clone() })
            .collect(),
        dynamic_files: plan
            .dynamic_files
            .iter()
            .map(|(from, to)| DynamicFileWire { from: from.clone(), to: to.clone() })
            .collect(),
        manifest_json: plan.manifest_json.clone(),
    }
}

/// Strict `target` spelling → `vmz_pack::resolve::Target`; anything else is
/// rejected (no default, no guessing).
fn target_from_str(raw: &str) -> Option<Target> {
    match raw {
        "browser" => Some(Target::Browser),
        "node" => Some(Target::Node),
        _ => None,
    }
}

fn invalid_request(message: String) -> ResponseWire {
    ResponseWire {
        ok: false,
        plan: None,
        diagnostics: vec![DiagnosticWire {
            code: INVALID_REQUEST.to_string(),
            message,
            path: None,
            span: None,
        }],
    }
}

fn failed(diagnostics: Vec<PackDiagnostic>) -> ResponseWire {
    ResponseWire { ok: false, plan: None, diagnostics: diagnostics_to_wire(&diagnostics) }
}

fn succeeded(plan: &EmitPlan) -> ResponseWire {
    ResponseWire {
        ok: true,
        plan: Some(plan_to_wire(plan)),
        diagnostics: diagnostics_to_wire(&plan.diagnostics),
    }
}

/// Serialize a response; the shape is String/Vec only, so failure is
/// structurally impossible — degrade to an explicit `invalid_request`
/// rather than panicking across the N-API boundary.
fn serialize(response: &ResponseWire) -> String {
    match serde_json::to_string(response) {
        Ok(json) => json,
        Err(err) => {
            serde_json::to_string(&invalid_request(format!("response serialization failed: {err}")))
                .expect("static string-only response shape cannot fail serialization")
        }
    }
}

/// Outcome of running the pack chain on a parsed request.
enum Chain {
    /// Request rejected before the chain (or graph-level entry failure).
    Failed(Vec<PackDiagnostic>),
    /// `plan_emit` produced a complete plan.
    Planned(EmitPlan),
}

/// Parse + validate the request, then run graph → link → chunks → plan_emit.
/// Never panics; every failure is a diagnostic vector for the response.
fn run_chain(request_json: &str) -> Result<Chain, ResponseWire> {
    let request: RequestWire = match serde_json::from_str(request_json) {
        Ok(request) => request,
        Err(err) => return Err(invalid_request(err.to_string())),
    };
    let Some(target) = target_from_str(&request.target) else {
        return Err(invalid_request(format!(
            "invalid target `{}`: expected \"browser\" or \"node\"",
            request.target
        )));
    };
    let missing: Vec<&str> = request
        .entries
        .iter()
        .map(|entry| entry.logical.as_str())
        .filter(|logical| !request.uses.iter().any(|use_wire| &use_wire.logical == *logical))
        .collect();
    if !missing.is_empty() {
        return Err(invalid_request(format!(
            "uses must cover every entry logical; missing: {}",
            missing.join(", ")
        )));
    }

    let entries: Vec<(String, PathBuf)> = request
        .entries
        .iter()
        .map(|entry| (entry.logical.clone(), PathBuf::from(&entry.path)))
        .collect();
    let entry_uses: Vec<EntryUse> = request
        .uses
        .iter()
        .map(|use_wire| EntryUse {
            entry_logical: use_wire.logical.clone(),
            used_exports: use_wire.used_exports.clone(),
        })
        .collect();

    let graph = vmz_pack::graph::build_graph(&entries, target, Path::new(&request.root));
    if !graph.diagnostics.is_empty() {
        return Ok(Chain::Failed(graph.diagnostics.clone()));
    }
    let link_plan = vmz_pack::link::link(&graph, &entry_uses);
    let chunk_plan = vmz_pack::chunk::plan_chunks(&graph, &link_plan);
    let options = EmitOptions { public_base: request.public_base.clone() };
    match vmz_pack::emit::plan_emit(&graph, &link_plan, &chunk_plan, &options) {
        Err(diagnostics) => Ok(Chain::Failed(diagnostics)),
        Ok(plan) => Ok(Chain::Planned(plan)),
    }
}

/// `packPlan` core: request JSON in, response JSON out.
fn pack_plan_core(request_json: &str) -> String {
    match run_chain(request_json) {
        Err(response) => serialize(&response),
        Ok(Chain::Failed(diagnostics)) => serialize(&failed(diagnostics)),
        Ok(Chain::Planned(plan)) => serialize(&succeeded(&plan)),
    }
}

/// `packWrite` core: same chain, then `write_emit` into `out_dir`.
fn pack_write_core(request_json: &str, out_dir: &str) -> String {
    match run_chain(request_json) {
        Err(response) => serialize(&response),
        Ok(Chain::Failed(diagnostics)) => serialize(&failed(diagnostics)),
        Ok(Chain::Planned(plan)) => match vmz_pack::emit::write_emit(&plan, Path::new(out_dir)) {
            Ok(()) => serialize(&succeeded(&plan)),
            Err(diagnostics) => serialize(&failed(diagnostics)),
        },
    }
}

// ---------------------------------------------------------------------------
// N-API surface (string in / string out, never throws)
// ---------------------------------------------------------------------------

/// vmz-pack plan-only entry (`v0` contract). Request and response are JSON
/// strings; failures are reported in-band as `ok: false` diagnostics.
#[napi]
pub fn pack_plan(request_json: String) -> String {
    pack_plan_core(&request_json)
}

/// vmz-pack plan + write entry (`v0` contract). Same JSON shapes as
/// [`pack_plan`]; artifacts are written under `out_dir` on success.
#[napi]
pub fn pack_write(request_json: String, out_dir: String) -> String {
    pack_write_core(&request_json, &out_dir)
}

// ---------------------------------------------------------------------------
// Tests (pure functions, no Node host)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};
    use std::fs;

    /// Minimal three-file project: entry.js → lib.js → util.js.
    fn temp_tree(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("vmz-napi-pack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/util.js"), "export const VALUE = 1;\n").unwrap();
        fs::write(
            root.join("src/lib.js"),
            "import { VALUE } from \"./util.js\";\nexport function greet() { return VALUE; }\n",
        )
        .unwrap();
        fs::write(
            root.join("src/entry.js"),
            "import { greet } from \"./lib.js\";\nexport function main() { return greet(); }\n",
        )
        .unwrap();
        root
    }

    fn request(root: &Path, target: &str, uses: Value) -> String {
        json!({
            "entries": [{ "logical": "main", "path": root.join("src").join("entry.js").display().to_string() }],
            "target": target,
            "root": root.display().to_string(),
            "uses": uses,
            "publicBase": "/_vmz/"
        })
        .to_string()
    }

    fn full_uses() -> Value {
        json!([{ "logical": "main", "usedExports": ["main"] }])
    }

    fn parse(json: &str) -> Value {
        serde_json::from_str(json).expect("response must always be valid JSON")
    }

    #[test]
    fn pack_plan_success_shape() {
        let root = temp_tree("plan");
        let response = parse(&pack_plan_core(&request(&root, "browser", full_uses())));
        assert_eq!(response["ok"], Value::Bool(true));
        let artifacts = response["plan"]["artifacts"].as_array().unwrap();
        assert!(!artifacts.is_empty(), "entry chunk expected");
        let entry = artifacts
            .iter()
            .find(|artifact| {
                artifact["chunkId"].as_str().is_some_and(|id| id.starts_with("entry/"))
            })
            .expect("entry artifact");
        // File name shape: `<slug>-<hash8>.js` (hash from the emit layer, not hardcoded).
        let file_name = entry["fileName"].as_str().unwrap();
        let stem = file_name.strip_suffix(".js").expect("js suffix");
        let hash = stem.rsplit('-').next().expect("hash segment");
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "hex fingerprint: {hash}");
        assert!(
            stem[..stem.len() - hash.len() - 1].starts_with("entry-"),
            "slug from entry chunk id: {stem}"
        );
        // entryFiles maps the logical name onto that file.
        let entry_files = response["plan"]["entryFiles"].as_array().unwrap();
        assert!(
            entry_files
                .iter()
                .any(|ef| ef["logical"] == "main" && ef["file"] == Value::String(file_name.into()))
        );
        // Chunk members carry the normalized module paths.
        let modules = entry["modules"].as_array().unwrap();
        assert!(modules.iter().any(|m| m.as_str().unwrap().ends_with("src/lib.js")
            || m.as_str().unwrap().replace('\\', "/").ends_with("src/lib.js")));
        // manifestJson is a JSON string under the frozen `v0` namespace.
        let manifest: Value =
            serde_json::from_str(response["plan"]["manifestJson"].as_str().unwrap()).unwrap();
        assert_eq!(manifest["version"], "v0");
    }

    #[test]
    fn pack_write_emits_files() {
        let root = temp_tree("write");
        let out = root.join("dist");
        let response = parse(&pack_write_core(
            &request(&root, "browser", full_uses()),
            &out.to_string_lossy(),
        ));
        assert_eq!(response["ok"], Value::Bool(true));
        let artifacts = response["plan"]["artifacts"].as_array().unwrap();
        assert!(!artifacts.is_empty());
        for artifact in artifacts {
            let path = out.join(artifact["fileName"].as_str().unwrap());
            assert!(path.is_file(), "artifact written: {}", path.display());
        }
        assert!(out.join("manifest.json").is_file());
    }

    /// CSS 项目：entry → theme.css + lib.js；lib → base.css + theme.css。
    /// 执行序 lib 先于 entry，去重先到先得 → 级联 base 在前、theme 在后。
    fn temp_tree_css(name: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("vmz-napi-pack-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/theme.css"), "body { color: red; }\n").unwrap();
        fs::write(root.join("src/base.css"), "body { color: blue; }\n").unwrap();
        fs::write(
            root.join("src/lib.js"),
            "import \"./base.css\";\nimport \"./theme.css\";\nexport const L = 1;\n",
        )
        .unwrap();
        fs::write(
            root.join("src/entry.js"),
            "import \"./theme.css\";\nimport { L } from \"./lib.js\";\nexport function main() { return L; }\n",
        )
        .unwrap();
        root
    }

    fn forward(value: &str) -> String {
        value.replace('\\', "/")
    }

    #[test]
    fn pack_plan_styles_wire_shape() {
        let root = temp_tree_css("styles-plan");
        let response = parse(&pack_plan_core(&request(&root, "browser", full_uses())));
        assert_eq!(response["ok"], Value::Bool(true));
        let styles = response["plan"]["styles"].as_array().unwrap();
        // 同一 chunk 聚合为一个 CSS 产物；同身份去重先到先得。
        assert_eq!(styles.len(), 1);
        let style = &styles[0];
        let file_name = style["fileName"].as_str().unwrap();
        let stem = file_name.strip_suffix(".css").expect("css suffix");
        let hash = stem.strip_prefix("style-").expect("style- prefix");
        assert_eq!(hash.len(), 8);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()), "hex fingerprint: {hash}");
        assert_eq!(style["url"], Value::String(format!("/_vmz/{file_name}")));
        // sourcePaths 按执行序去重：lib 的边先跑，base 在前、theme 在后。
        let source_paths: Vec<String> = style["sourcePaths"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| forward(p.as_str().unwrap()))
            .collect();
        assert_eq!(source_paths.len(), 2);
        assert!(source_paths[0].ends_with("src/base.css"));
        assert!(source_paths[1].ends_with("src/theme.css"));
        // modules 为贡献级联的来源模块路径（有序）。
        let modules = style["modules"].as_array().unwrap();
        assert!(!modules.is_empty());
        assert!(modules.iter().any(|m| forward(m.as_str().unwrap()).ends_with("src/lib.js")));
        // content 不上 wire：文本只走 packWrite。
        assert!(style.get("content").is_none());
    }

    #[test]
    fn pack_write_materializes_css() {
        let root = temp_tree_css("styles-write");
        let out = root.join("dist");
        let response = parse(&pack_write_core(
            &request(&root, "browser", full_uses()),
            &out.to_string_lossy(),
        ));
        assert_eq!(response["ok"], Value::Bool(true));
        let styles = response["plan"]["styles"].as_array().unwrap();
        assert_eq!(styles.len(), 1);
        let path = out.join(styles[0]["fileName"].as_str().unwrap());
        assert!(path.is_file(), "css artifact written: {}", path.display());
        let css = fs::read_to_string(&path).unwrap();
        // 级联顺序是合同：base（蓝）先于 theme（红）。
        let blue = css.find("color: blue").expect("base.css inlined");
        let red = css.find("color: red").expect("theme.css inlined");
        assert!(blue < red, "cascade order: {css}");
        // theme.css 去重：两个模块都引用，只拼接一次。
        assert_eq!(css.matches("color: red").count(), 1);
        // JS 产物不含 CSS import 文本。
        for artifact in response["plan"]["artifacts"].as_array().unwrap() {
            let code =
                fs::read_to_string(out.join(artifact["fileName"].as_str().unwrap())).unwrap();
            assert!(!code.contains(".css"), "css import removed from js: {code}");
        }
    }

    #[test]
    fn invalid_json_is_invalid_request() {
        let response = parse(&pack_plan_core("{not json"));
        assert_eq!(response["ok"], Value::Bool(false));
        assert!(response.get("plan").is_none());
        assert_eq!(response["diagnostics"][0]["code"], INVALID_REQUEST);
    }

    #[test]
    fn missing_uses_is_invalid_request() {
        let root = temp_tree("missing-uses");
        // `uses` present but not covering the entry logical.
        let response = parse(&pack_plan_core(&request(&root, "browser", json!([]))));
        assert_eq!(response["ok"], Value::Bool(false));
        assert_eq!(response["diagnostics"][0]["code"], INVALID_REQUEST);
        // `uses` field absent entirely.
        let json = json!({
            "entries": [{ "logical": "main", "path": root.join("src").join("entry.js").display().to_string() }],
            "target": "browser",
            "root": root.display().to_string(),
            "publicBase": "/_vmz/"
        })
        .to_string();
        let response = parse(&pack_plan_core(&json));
        assert_eq!(response["ok"], Value::Bool(false));
        assert_eq!(response["diagnostics"][0]["code"], INVALID_REQUEST);
    }

    #[test]
    fn invalid_target_is_invalid_request() {
        let root = temp_tree("bad-target");
        let response = parse(&pack_plan_core(&request(&root, "deno", full_uses())));
        assert_eq!(response["ok"], Value::Bool(false));
        assert_eq!(response["diagnostics"][0]["code"], INVALID_REQUEST);
    }
}
