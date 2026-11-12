//! N-API bridge for library artifact emit (`vmz lib`).
//!
//! 字符串进 / 字符串出，与 pack 桥同姿态：请求形状错误、编译失败都不抛
//! 异常，统一返回 `{ ok: false, diagnostics }`。成功时 `emitted` 是本次写出
//! 的产物绝对路径（`<Name>.js` / `<Name>.js.map` / `<Name>.css`）。

use std::collections::BTreeMap;
use std::path::PathBuf;

use napi_derive::napi;
use serde::{Deserialize, Serialize};
use vmz_compiler::pipeline::compile::CompileOptions;
use vmz_compiler::pipeline::library::{LibraryEntry, compile_library};

/// 请求形状拒绝的稳定诊断码。
const INVALID_REQUEST: &str = "vmz::napi::library::invalid_request";

/// 库产物请求：入口清单 + 输出目录。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequestWire {
    /// 入口清单（发布名 → `.vmz` 绝对路径）。
    entries: Vec<EntryWire>,
    /// 产物目录（绝对路径）。
    out_dir: String,
    /// 生产 emit 姿态（默认 false）。
    #[serde(default)]
    release: bool,
    /// `@vmz/core` 的 `dist` 目录；缺省时按编译器内置回退探测。
    #[serde(default)]
    runtime_dist: Option<String>,
}

/// 单个库入口。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EntryWire {
    /// 产物名（`<Name>.js` / `<Name>.css`）。
    name: String,
    /// 源 `.vmz` 文件绝对路径。
    path: String,
}

/// 库产物响应。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ResponseWire {
    /// 全部入口成功时为 true。
    ok: bool,
    /// 写出的产物绝对路径。
    emitted: Vec<String>,
    /// 编译诊断（失败原因逐条保留）。
    diagnostics: Vec<DiagnosticWire>,
}

/// 一条诊断。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticWire {
    /// `error` | `warning` | `advice`。
    severity: String,
    /// 稳定诊断码。
    code: String,
    /// 相关文件路径。
    path: String,
    /// 目录参数表（可缺省）。
    #[serde(skip_serializing_if = "Option::is_none")]
    args: Option<BTreeMap<String, String>>,
}

/// 编译一个包的库入口集，返回响应 JSON。
#[napi]
pub fn library_compile(request_json: String) -> String {
    let response = match run(&request_json) {
        Ok(response) => response,
        Err(diagnostics) => ResponseWire { ok: false, emitted: Vec::new(), diagnostics },
    };
    serde_json::to_string(&response)
        .unwrap_or_else(|_| "{\"ok\":false,\"emitted\":[],\"diagnostics\":[]}".to_string())
}

fn run(request_json: &str) -> Result<ResponseWire, Vec<DiagnosticWire>> {
    let request: RequestWire = serde_json::from_str(request_json)
        .map_err(|err| vec![invalid(format!("request json: {err}"))])?;
    if request.entries.is_empty() {
        return Err(vec![invalid("entries must not be empty")]);
    }
    if request.out_dir.trim().is_empty() {
        return Err(vec![invalid("outDir must not be empty")]);
    }

    let entries: Vec<LibraryEntry> = request
        .entries
        .into_iter()
        .map(|entry| LibraryEntry { name: entry.name, path: PathBuf::from(entry.path) })
        .collect();
    let options = CompileOptions {
        out_dir: PathBuf::from(&request.out_dir),
        release: request.release,
        tw: None,
        scss: Some(vmz_plugin_sasso::default_scss_compiler()),
        runtime_dist: request.runtime_dist.map(PathBuf::from),
    };

    let report =
        compile_library(&entries, &options).map_err(|err| vec![invalid(err.to_string())])?;
    let diagnostics: Vec<DiagnosticWire> = report.diagnostics.iter().map(map_diagnostic).collect();
    let ok = report.diagnostics.iter().all(|diagnostic| !diagnostic.is_error());
    Ok(ResponseWire {
        ok,
        emitted: report.emitted.iter().map(|path| path.display().to_string()).collect(),
        diagnostics,
    })
}

fn map_diagnostic(diagnostic: &vmz_compiler::ReportedDiagnostic) -> DiagnosticWire {
    let severity = match diagnostic.severity() {
        vmz_compiler::Severity::Error => "error",
        vmz_compiler::Severity::Warning => "warning",
        vmz_compiler::Severity::Advice => "advice",
    };
    DiagnosticWire {
        severity: severity.into(),
        code: diagnostic.code(),
        path: diagnostic.path().display().to_string(),
        args: diagnostic.args().cloned(),
    }
}

fn invalid(message: impl Into<String>) -> DiagnosticWire {
    DiagnosticWire {
        severity: "error".into(),
        code: INVALID_REQUEST.into(),
        path: String::new(),
        args: Some(BTreeMap::from([("message".to_string(), message.into())])),
    }
}
