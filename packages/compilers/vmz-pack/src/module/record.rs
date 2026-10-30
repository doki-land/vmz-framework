//! 模块事实记录形状：Oak TypeScript AST 的结构化投影。
//!
//! 这里只记录「源码里确实出现了什么」，不做模块身份解析、链接与分包；
//! 所有 span 均为源文件内 UTF-8 字节区间（inclusive start, exclusive end），
//! 与 [`PackDiagnostic::span`] 同口径，可直接用 `&source[span.0..span.1]` 切片。

use crate::diag::PackDiagnostic;

/// 一个模块经 Oak AST 提取后的全部事实。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleRecord {
    /// 模块路径，由调用方传入；本层不解析路径语义。
    pub path: Option<String>,
    /// import 事实，覆盖静态、副作用与动态形态。
    pub imports: Vec<ImportFact>,
    /// export / re-export 事实。
    pub exports: Vec<ExportFact>,
    /// 声明语句事实（含被 `export` 包裹的声明）。
    pub statements: Vec<StatementFact>,
    /// 资源引用事实（`new URL('<literal>', …)` 形态）。
    pub assets: Vec<AssetFact>,
    /// 模块级标志。
    pub flags: ModuleFlags,
    /// 非致命诊断；解析失败走 `Err`，不进入本结构。
    pub diagnostics: Vec<PackDiagnostic>,
}

impl ModuleRecord {
    /// 空记录：图占位节点与读取/解析失败时的最小形状。
    pub fn empty(path: Option<String>) -> Self {
        Self {
            path,
            imports: Vec::new(),
            exports: Vec::new(),
            statements: Vec::new(),
            assets: Vec::new(),
            flags: ModuleFlags { has_tla: false, dynamic_import_nonliteral: false },
            diagnostics: Vec::new(),
        }
    }
}

/// import 的结构形态。
#[derive(Debug, Clone, PartialEq)]
pub enum ImportKind {
    /// 静态绑定导入 `import … from '…'`。
    Static,
    /// 仅副作用导入 `import '…'`；`import {} from '…'` 在 Oak AST 中与之同形，同样归入本类。
    SideEffect,
    /// 动态导入 `import('…')`。
    Dynamic,
}

/// 绑定的来源名称形态。
#[derive(Debug, Clone, PartialEq)]
pub enum ImportedName {
    /// 默认导出 `default`。
    Default,
    /// 具名导出。
    Name(String),
    /// 命名空间 `*`。
    Namespace,
}

/// 单个 import 绑定。
#[derive(Debug, Clone, PartialEq)]
pub struct ImportBinding {
    /// 引入到本模块的名字。
    pub local: String,
    /// 被引入的来源名字。
    pub imported: ImportedName,
    /// 绑定内联 `type` 修饰（`{ type X }`）。
    pub inline_type_only: bool,
    /// 绑定自身 span。Oak AST 的 `ImportSpecifier` 不携带 span，恒为 `None`，
    /// 只有语句级 span 与内联 `type` 修饰符可用。
    pub span: Option<(usize, usize)>,
}

/// 一条 import 事实。
#[derive(Debug, Clone, PartialEq)]
pub struct ImportFact {
    /// 模块说明符原文（引号内文本，未做转义译码）；动态非字面量形态为空串。
    pub specifier: String,
    /// 说明符字面量的源码 span（含引号）；取不到时为 `None`。
    pub specifier_span: Option<(usize, usize)>,
    /// 整条 import 语句（或动态 import 表达式）的 span。
    pub span: (usize, usize),
    /// 结构形态。
    pub kind: ImportKind,
    /// 声明级 `import type …`（绑定内联 `type` 见 [`ImportBinding::inline_type_only`]）。
    pub type_only: bool,
    /// 绑定列表；副作用与动态导入为空。
    pub bindings: Vec<ImportBinding>,
}

/// 一条 export / re-export 事实。
#[derive(Debug, Clone, PartialEq)]
pub enum ExportFact {
    /// 导出本模块名字：`export <decl>` 或 `export { local [as exported] }`。
    Local {
        /// 被导出的本模块名字。
        local: String,
        /// 对外名字。
        exported: String,
        /// 类型导出（`export type`、TypeAlias/Interface 声明或内联 `type` 绑定）。
        type_only: bool,
        /// 所在 export 语句 span（specifier 自身无 span，故取整句）。
        span: (usize, usize),
    },
    /// `export default …`。
    Default {
        /// 具名默认导出的本模块名字（`export default class Foo {}`）；
        /// 表达式与匿名声明为 `None`。
        local: Option<String>,
        /// 所在 export 语句 span。
        span: (usize, usize),
    },
    /// 具名重导出 `export { local as exported } from '…'`。
    ReexportNamed {
        /// 来源模块说明符。
        source: String,
        /// 来源说明符字面量 span（含引号）。
        source_span: Option<(usize, usize)>,
        /// 来源模块中的名字。
        local: String,
        /// 对外名字。
        exported: String,
        /// 类型重导出（声明级 `export type` 或内联 `type` 绑定）。
        type_only: bool,
        /// 所在 export 语句 span。
        span: (usize, usize),
    },
    /// 星号重导出 `export * from '…'`。
    ReexportAll {
        /// 来源模块说明符。
        source: String,
        /// 来源说明符字面量 span（含引号）。
        source_span: Option<(usize, usize)>,
        /// 所在 export 语句 span。
        span: (usize, usize),
    },
    /// 命名空间重导出 `export * as ns from '…'`。
    ReexportNamespace {
        /// 来源模块说明符。
        source: String,
        /// 来源说明符字面量 span（含引号）。
        source_span: Option<(usize, usize)>,
        /// 对外命名空间名字。
        namespace: String,
        /// 类型重导出标志。
        type_only: bool,
        /// 所在 export 语句 span。
        span: (usize, usize),
    },
}

/// 一条声明语句事实。
#[derive(Debug, Clone, PartialEq)]
pub struct StatementFact {
    /// 声明自身的 span（`export` 包裹时是被包裹声明的 span）。
    pub span: (usize, usize),
    /// 声明的顶层名字。解构声明在 Oak 中整体存为原始文本
    /// （如 `"{ a }"`）原样记录；多变量声明只保留第一个名字（Oak 限制）。
    pub declared_names: Vec<String>,
}

/// 一条资源引用事实。
#[derive(Debug, Clone, PartialEq)]
pub struct AssetFact {
    /// 资源路径字面量（`new URL` 的第一个实参）。
    pub specifier: String,
    /// 资源路径字面量 span（含引号）。
    pub specifier_span: Option<(usize, usize)>,
    /// 整个 `new URL(...)` 表达式 span。
    pub span: (usize, usize),
}

/// 模块级标志。
#[derive(Debug, Clone, PartialEq)]
pub struct ModuleFlags {
    /// 模块是否含顶层 await（TLA）。
    ///
    /// **恒为 `false`**：Oak AST 无法可靠判定 TLA——`await` 关键字后存在空白时，
    /// builder 的一元运算符字段被 trivia 叶覆盖为空格，与 `typeof x` / `void 0`
    /// 完全同形；只有 `await(…)` 无空白形态会留下 `"await"`。不可靠即不猜测。
    pub has_tla: bool,
    /// 存在无法静态解析说明符的动态 import（对应
    /// `vmz::pack::module::dynamic_import_unresolved` 诊断）。
    pub dynamic_import_nonliteral: bool,
}
