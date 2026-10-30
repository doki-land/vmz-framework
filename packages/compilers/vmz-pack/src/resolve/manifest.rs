//! package.json 读取：一次性给出 `name`/`version` 与字段访问。

use super::json::Json;
use crate::diag::PackDiagnostic;
use std::path::Path;

const CODE_BAD_MANIFEST: &str = "vmz::pack::resolve::bad_manifest";

/// 已读取的 package.json。文件缺失按「遗留空包」处理（无 exports/imports，
/// 身份 version 为空）；文件存在但不可读或非法 JSON 直接报 `bad_manifest`。
pub(crate) struct Manifest {
    raw: Option<Json>,
}

impl Manifest {
    pub(crate) fn load(dir: &Path) -> Result<Self, PackDiagnostic> {
        let path = dir.join("package.json");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self { raw: None });
            }
            Err(err) => {
                return Err(PackDiagnostic::new(
                    CODE_BAD_MANIFEST,
                    format!("读取 package.json 失败：{err}"),
                )
                .with_path(path.display().to_string()));
            }
        };
        let raw: Json = serde_json::from_str(&text).map_err(|err| {
            PackDiagnostic::new(CODE_BAD_MANIFEST, format!("package.json 不是合法 JSON：{err}"))
                .with_path(path.display().to_string())
        })?;
        if !matches!(raw, Json::Object(_)) {
            return Err(PackDiagnostic::new(CODE_BAD_MANIFEST, "package.json 顶层必须是对象")
                .with_path(path.display().to_string()));
        }
        Ok(Self { raw: Some(raw) })
    }

    pub(crate) fn name(&self) -> Option<&str> {
        self.raw.as_ref()?.get("name")?.as_str()
    }

    pub(crate) fn version(&self) -> Option<&str> {
        self.raw.as_ref()?.get("version")?.as_str()
    }

    pub(crate) fn field(&self, key: &str) -> Option<&Json> {
        self.raw.as_ref()?.get(key)
    }
}
