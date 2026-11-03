//! Pack wire 回归：根绝对 URL 动态 import 是发射层原样保留的支持形态
//! （`vmz::pack::emit::dynamic_url_kept`），链接诊断升级过滤不得把它当成
//! 未解析文件边打成 `ok: false`；静态根绝对说明符缺失目标仍必须失败。

use std::fs;
use std::path::PathBuf;

use serde_json::{Value, json};

fn temp_tree(name: &str, files: &[(&str, &str)]) -> PathBuf {
    let root =
        std::env::temp_dir().join(format!("vmz-napi-pack-url-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    for (path, content) in files {
        let full = root.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, content).unwrap();
    }
    fs::canonicalize(root).unwrap()
}

fn request(root: &PathBuf) -> String {
    json!({
        "entries": [{ "logical": "main", "path": root.join("src/entry.js").display().to_string() }],
        "target": "browser",
        "root": root.display().to_string(),
        "uses": [{ "logical": "main", "execution": "full", "exports": { "kind": "all" } }],
        "publicBase": "/"
    })
    .to_string()
}

fn parse(raw: &str) -> Value {
    serde_json::from_str(raw).expect("response must always be valid JSON")
}

/// `import('/dom.browser.js')`（站点运行时 URL，可带缓存破坏查询）必须
/// `ok: true`，产物保留 URL 原文，诊断族是保留而非解析失败。
#[test]
fn root_absolute_dynamic_import_kept_verbatim_on_the_wire() {
    let root = temp_tree(
        "kept",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            (
                "src/entry.js",
                "const face = () => import(/* @vite-ignore */ '/dom.browser.js');\nexport const load = face;\n",
            ),
        ],
    );
    let response = parse(&vmz_napi::pack::pack_plan(request(&root)));
    assert_eq!(response["ok"], Value::Bool(true), "{response}");

    let artifacts = response["plan"]["artifacts"].as_array().unwrap();
    assert!(
        artifacts.iter().any(|a| a["code"].as_str().unwrap().contains("'/dom.browser.js'")),
        "URL 原文必须保留在产物里：{artifacts:?}"
    );

    let codes: Vec<&str> = response["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect();
    assert!(codes.iter().any(|code| *code == "vmz::pack::emit::dynamic_url_kept"), "{codes:?}");
    assert!(
        !codes.iter().any(|code| code.starts_with("vmz::pack::resolve::not_found")),
        "{codes:?}"
    );
    let _ = fs::remove_dir_all(&root);
}

/// 对照：静态根绝对说明符指向缺失文件仍是构建失败（悬空 import 不得放行）。
#[test]
fn root_absolute_static_import_missing_target_still_fails() {
    let root = temp_tree(
        "staticmissing",
        &[
            ("package.json", r#"{"name":"app","version":"0.0.0"}"#),
            ("src/entry.js", "import { missing } from '/ghost.js';\nexport const x = missing;\n"),
        ],
    );
    let response = parse(&vmz_napi::pack::pack_plan(request(&root)));
    assert_eq!(response["ok"], Value::Bool(false), "{response}");
    assert!(response.get("plan").is_none(), "{response}");
    let codes: Vec<&str> = response["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap())
        .collect();
    assert!(codes.iter().any(|code| *code == "vmz::pack::resolve::not_found"), "{codes:?}");
    let _ = fs::remove_dir_all(&root);
}
