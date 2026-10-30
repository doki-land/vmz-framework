//! Pack 共享诊断形状：模块事实层与解析层统一产出，不发明平行诊断类型。

use serde::Serialize;

/// 结构化 Pack 诊断。`path` 为相关文件（相对或绝对，由调用方归一），
/// `span` 为源文件内 UTF-8 字节区间（inclusive start, exclusive end）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PackDiagnostic {
    /// 稳定诊断码，如 `vmz::pack::module::parse_failed`。
    pub code: String,
    /// 人类可读信息。
    pub message: String,
    /// 相关源文件路径。
    pub path: Option<String>,
    /// UTF-8 字节区间。
    pub span: Option<(usize, usize)>,
}

impl PackDiagnostic {
    /// 创建无 span 的诊断。
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self { code: code.into(), message: message.into(), path: None, span: None }
    }

    /// 附带相关文件路径。
    pub fn with_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    /// 附带源码字节 span。
    pub fn with_span(mut self, span: (usize, usize)) -> Self {
        self.span = Some(span);
        self
    }
}
