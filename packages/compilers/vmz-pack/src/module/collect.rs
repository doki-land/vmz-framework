//! 源码 → [`ModuleRecord`] 的收集器：只消费 Oak TypeScript AST，
//! 不做模块身份解析、链接与分包，也不引入任何正则模块语义识别。
//!
//! Oak 已实测的结构事实（决定下面的判定方式）：
//! - 语句头 `import(…)` 被解析为空 `ImportDeclaration` 加后随表达式语句，
//!   形成可配对的指纹；`require(…)` 不产生该指纹。
//! - 表达式位置 `import(…)` 的 `import` 关键字是 leaf，builder 丢弃后
//!   CallExpression 的 span 仍从 `import` 起算，与 callee 的 span 之间
//!   留下至少 `import(` 长度的间隙。
//! - `import.meta` 在语句头同空指纹，后随对象为 `meta` 的成员表达式。
//! - 静态 import/export 的说明符不在 AST 中，只有说明符文本；
//!   span 由语句区域内反查最后一次引号配对得到。

use vmz_oak_frontend_adapter::{
    OakFrontendDiagnostic, ScriptRole, ScriptShellInput, parse_script_ast,
};

use oak_typescript::ast::{
    ClassMember, ExportDeclaration, Expression, ExpressionKind, ImportSpecifier, ObjectProperty,
    Statement,
};

use super::record::{
    AssetFact, ExportFact, ImportBinding, ImportFact, ImportKind, ImportedName, ModuleFlags,
    ModuleRecord, StatementFact,
};
use crate::diag::PackDiagnostic;

/// 源码解析失败诊断码（致命，走 `Err`）。
const PARSE_FAILED: &str = "vmz::pack::module::parse_failed";
/// 动态 import 说明符不是字符串字面量，无法静态解析。
const DYNAMIC_IMPORT_UNRESOLVED: &str = "vmz::pack::module::dynamic_import_unresolved";
/// import 形态无法提取模块说明符（如 `import.meta`、残缺语句）。
const IMPORT_WITHOUT_SPECIFIER: &str = "vmz::pack::module::import_without_specifier";
/// 表达式位置动态 import 的最小 span 间隙：`import(` 的字节数。
const DYNAMIC_CALL_GAP: usize = "import(".len();

/// 解析源码并收集模块事实。
///
/// Oak 报告任何解析错误时返回 `Err`（每条 Oak 诊断映射为
/// `vmz::pack::module::parse_failed`），不静默降级为部分事实；
/// 成功时返回 [`ModuleRecord`]，非致命诊断在
/// [`ModuleRecord::diagnostics`] 内。
///
/// `path` 仅用于回填诊断的 `path` 字段，本层不解析路径语义。
pub fn parse_module(path: Option<&str>, source: &str) -> Result<ModuleRecord, Vec<PackDiagnostic>> {
    let parsed = parse_script_ast(&ScriptShellInput {
        content: source.to_string(),
        content_start: 0,
        role: ScriptRole::Client,
    });
    // 解析失败时 Oak 仍可能给出残缺 root，一律按失败处理。
    let Some(root) = parsed.root.filter(|_| parsed.ok) else {
        return Err(parse_failure(path, &parsed.diagnostics));
    };
    let mut collector = Collector::new(path, source);
    collector.walk_stmts(&root.statements);
    Ok(collector.record)
}

/// Oak 诊断 → 致命解析失败诊断。
fn parse_failure(path: Option<&str>, diagnostics: &[OakFrontendDiagnostic]) -> Vec<PackDiagnostic> {
    let mut failures: Vec<PackDiagnostic> = diagnostics
        .iter()
        .map(|d| {
            let mut diagnostic = PackDiagnostic::new(PARSE_FAILED, d.render_plain());
            if let Some(path) = path {
                diagnostic = diagnostic.with_path(path);
            }
            if let Some(span) = &d.span {
                diagnostic = diagnostic.with_span((span.start, span.end));
            }
            diagnostic
        })
        .collect();
    if failures.is_empty() {
        let mut diagnostic =
            PackDiagnostic::new(PARSE_FAILED, "Oak 未能构建脚本 AST 且没有诊断详情");
        if let Some(path) = path {
            diagnostic = diagnostic.with_path(path);
        }
        failures.push(diagnostic);
    }
    failures
}

/// Oak span → 字节区间。
fn range(span: core::range::Range<usize>) -> (usize, usize) {
    (span.start, span.end)
}

/// 语句头 `import(…)` / `import.meta…` 空指纹：说明符与绑定全空。
fn is_empty_import(statement: &Statement) -> bool {
    matches!(statement, Statement::ImportDeclaration(d) if d.specifiers.is_empty() && d.module_specifier.is_empty())
}

/// 单语句体位置的空指纹（`if`/`while`/`for` 的无花括号体）。
fn hole_in_single_body(statement: &Statement) -> Option<(usize, usize)> {
    match statement {
        Statement::ImportDeclaration(d)
            if d.specifiers.is_empty() && d.module_specifier.is_empty() =>
        {
            Some(range(d.span.clone()))
        }
        _ => None,
    }
}

/// 语句列表中承载「空 import 指纹」的语句：其说明符出现在后一条语句里。
fn fingerprint_hole(statement: &Statement) -> Option<(usize, usize)> {
    match statement {
        Statement::ImportDeclaration(d)
            if d.specifiers.is_empty() && d.module_specifier.is_empty() =>
        {
            Some(range(d.span.clone()))
        }
        Statement::ExportDeclaration(e) => e.declaration.as_deref().and_then(hole_in_single_body),
        Statement::IfStatement(s) => hole_in_single_body(&s.consequent),
        Statement::WhileStatement(s) => hole_in_single_body(&s.body),
        Statement::ForStatement(s) => hole_in_single_body(&s.body),
        Statement::ForInStatement(s) => hole_in_single_body(&s.body),
        Statement::ForOfStatement(s) => hole_in_single_body(&s.body),
        _ => None,
    }
}

/// 声明语句的顶层名字（原样保留 Oak 的 `name` 字段，包括解构原始文本）。
fn declared_names(statement: &Statement) -> Vec<String> {
    let name = match statement {
        Statement::VariableDeclaration(d) => &d.name,
        Statement::FunctionDeclaration(d) => &d.name,
        Statement::ClassDeclaration(d) => &d.name,
        Statement::Interface(d) => &d.name,
        Statement::TypeAlias(d) => &d.name,
        Statement::Enum(d) => &d.name,
        Statement::Namespace(d) => &d.name,
        _ => return Vec::new(),
    };
    if name.is_empty() { Vec::new() } else { vec![name.clone()] }
}

/// 类型空间的导出声明（`export type Foo = string` 的声明级修饰符在 Oak 中
/// 丢失，只能按声明种类补判）。
fn is_type_declaration(statement: &Statement) -> bool {
    matches!(statement, Statement::TypeAlias(_) | Statement::Interface(_))
}

struct Collector<'a> {
    source: &'a str,
    path: Option<String>,
    record: ModuleRecord,
}

impl<'a> Collector<'a> {
    fn new(path: Option<&str>, source: &'a str) -> Self {
        Self {
            source,
            path: path.map(str::to_string),
            record: ModuleRecord {
                path: path.map(str::to_string),
                imports: Vec::new(),
                exports: Vec::new(),
                statements: Vec::new(),
                assets: Vec::new(),
                flags: ModuleFlags { has_tla: false, dynamic_import_nonliteral: false },
                diagnostics: Vec::new(),
            },
        }
    }

    fn diagnostic(&mut self, code: &str, message: &str, span: (usize, usize)) {
        let mut diagnostic = PackDiagnostic::new(code, message);
        if let Some(path) = &self.path {
            diagnostic = diagnostic.with_path(path.clone());
        }
        self.record.diagnostics.push(diagnostic.with_span(span));
    }

    /// 遍历语句列表；空 import 指纹先与后一条表达式语句配对成动态 import
    /// 事实或诊断，再正常下钻（配对消费的表达式语句本身不含其它事实）。
    fn walk_stmts(&mut self, statements: &[Statement]) {
        for (index, statement) in statements.iter().enumerate() {
            if let Some(hole) = fingerprint_hole(statement) {
                match statements.get(index + 1) {
                    Some(Statement::ExpressionStatement(next)) => {
                        let span = (hole.0, next.span.end);
                        self.dynamic_pair(span, &next.expression);
                    }
                    _ => self.diagnostic(
                        IMPORT_WITHOUT_SPECIFIER,
                        "import 语句无法提取模块说明符",
                        hole,
                    ),
                }
            }
            self.walk_stmt(statement);
        }
    }

    /// 空指纹与后随表达式语句配对成动态 import 事实或诊断。
    fn dynamic_pair(&mut self, span: (usize, usize), expression: &Expression) {
        // `import.meta…`：对象为 `meta` 的成员表达式，没有模块说明符可取。
        if let ExpressionKind::MemberExpression { object, .. } = &*expression.kind {
            if let ExpressionKind::Identifier(name) = &*object.kind {
                if name == "meta" {
                    self.diagnostic(
                        IMPORT_WITHOUT_SPECIFIER,
                        "import.meta 不是模块导入，无说明符可取",
                        span,
                    );
                    return;
                }
            }
        }
        self.push_dynamic(span, expression);
    }

    /// 从说明符表达式产出动态 import 事实；非字面量记空说明符事实并诊断。
    fn push_dynamic(&mut self, span: (usize, usize), specifier_expr: &Expression) {
        let (specifier, specifier_span) = match &*specifier_expr.kind {
            ExpressionKind::StringLiteral(text) => {
                (text.clone(), Some(range(specifier_expr.span.clone())))
            }
            _ => {
                self.record.flags.dynamic_import_nonliteral = true;
                self.diagnostic(
                    DYNAMIC_IMPORT_UNRESOLVED,
                    "动态 import 的模块说明符不是字符串字面量，无法静态解析",
                    span,
                );
                (String::new(), None)
            }
        };
        self.record.imports.push(ImportFact {
            specifier,
            specifier_span,
            span,
            kind: ImportKind::Dynamic,
            type_only: false,
            bindings: Vec::new(),
        });
    }

    fn push_statement(&mut self, statement: &Statement) {
        self.record.statements.push(StatementFact {
            span: range(statement.span()),
            declared_names: declared_names(statement),
        });
    }

    fn walk_stmt(&mut self, statement: &Statement) {
        match statement {
            Statement::VariableDeclaration(d) => {
                self.push_statement(statement);
                if let Some(value) = &d.value {
                    self.walk_expr(value);
                }
            }
            Statement::FunctionDeclaration(d) => {
                self.push_statement(statement);
                self.walk_stmts(&d.body);
            }
            Statement::ClassDeclaration(d) => {
                self.push_statement(statement);
                for member in &d.body {
                    match member {
                        ClassMember::Property { initializer, .. } => {
                            if let Some(value) = initializer {
                                self.walk_expr(value);
                            }
                        }
                        ClassMember::Method { body, .. } => self.walk_stmts(body),
                    }
                }
            }
            // 纯类型与枚举声明：只有声明事实，无可下钻的运行时语句。
            Statement::Interface(_) | Statement::TypeAlias(_) | Statement::Enum(_) => {
                self.push_statement(statement);
            }
            Statement::Namespace(d) => {
                self.push_statement(statement);
                self.walk_stmts(&d.body);
            }
            Statement::ExpressionStatement(s) => self.walk_expr(&s.expression),
            Statement::ImportDeclaration(d) => {
                // 空指纹残片：列表配对已产出事实或诊断，其余位置不重复处理。
                if is_empty_import(statement) {
                    return;
                }
                let kind = if d.specifiers.is_empty() {
                    ImportKind::SideEffect
                } else {
                    ImportKind::Static
                };
                let bindings = d
                    .specifiers
                    .iter()
                    .map(|specifier| match specifier {
                        ImportSpecifier::Default(local) => ImportBinding {
                            local: local.clone(),
                            imported: ImportedName::Default,
                            inline_type_only: false,
                            span: None,
                        },
                        ImportSpecifier::Namespace(local) => ImportBinding {
                            local: local.clone(),
                            imported: ImportedName::Namespace,
                            inline_type_only: false,
                            span: None,
                        },
                        ImportSpecifier::Named { local, imported, type_modifier } => {
                            ImportBinding {
                                local: local.clone(),
                                imported: ImportedName::Name(imported.clone()),
                                inline_type_only: type_modifier.is_some(),
                                span: None,
                            }
                        }
                    })
                    .collect();
                let span = range(d.span.clone());
                let specifier_span = self.scan_specifier(span, &d.module_specifier);
                self.record.imports.push(ImportFact {
                    specifier: d.module_specifier.clone(),
                    specifier_span,
                    span,
                    kind,
                    type_only: d.is_type_only(),
                    bindings,
                });
            }
            Statement::ExportDeclaration(e) => self.walk_export(e),
            Statement::ReturnStatement(s) => {
                if let Some(argument) = &s.argument {
                    self.walk_expr(argument);
                }
            }
            Statement::ThrowStatement(s) => self.walk_expr(&s.argument),
            Statement::IfStatement(s) => {
                self.walk_expr(&s.test);
                self.walk_stmt(&s.consequent);
                if let Some(alternate) = &s.alternate {
                    self.walk_stmt(alternate);
                }
            }
            Statement::WhileStatement(s) => {
                self.walk_expr(&s.test);
                self.walk_stmt(&s.body);
            }
            Statement::DoWhileStatement(s) => {
                self.walk_stmt(&s.body);
                self.walk_expr(&s.test);
            }
            Statement::ForStatement(s) => {
                if let Some(initializer) = &s.initializer {
                    self.walk_stmt(initializer);
                }
                if let Some(test) = &s.test {
                    self.walk_expr(test);
                }
                if let Some(incrementor) = &s.incrementor {
                    self.walk_expr(incrementor);
                }
                self.walk_stmt(&s.body);
            }
            Statement::ForInStatement(s) => {
                self.walk_stmt(&s.left);
                self.walk_expr(&s.right);
                self.walk_stmt(&s.body);
            }
            Statement::ForOfStatement(s) => {
                self.walk_stmt(&s.left);
                self.walk_expr(&s.right);
                self.walk_stmt(&s.body);
            }
            Statement::SwitchStatement(s) => {
                self.walk_expr(&s.discriminant);
                for case in &s.cases {
                    if let Some(test) = &case.test {
                        self.walk_expr(test);
                    }
                    self.walk_stmts(&case.consequent);
                }
            }
            Statement::TryStatement(s) => {
                self.walk_stmts(&s.block);
                if let Some(handler) = &s.handler {
                    self.walk_stmts(&handler.body);
                }
                if let Some(finalizer) = &s.finalizer {
                    self.walk_stmts(finalizer);
                }
            }
            Statement::BlockStatement(s) => self.walk_stmts(&s.statements),
            Statement::BreakStatement(_) | Statement::ContinueStatement(_) => {}
        }
    }

    /// export 语句 → [`ExportFact`]，并继续下钻被包裹的声明。
    fn walk_export(&mut self, export: &ExportDeclaration) {
        let span = range(export.span.clone());
        let type_only = export.is_type_only();
        match (&export.declaration, &export.source) {
            (Some(declaration), None) => {
                if export.is_default() {
                    let local = match declaration.as_ref() {
                        Statement::ClassDeclaration(d) if !d.name.is_empty() => {
                            Some(d.name.clone())
                        }
                        Statement::FunctionDeclaration(d) if !d.name.is_empty() => {
                            Some(d.name.clone())
                        }
                        _ => None,
                    };
                    self.record.exports.push(ExportFact::Default { local, span });
                } else {
                    let type_only = type_only || is_type_declaration(declaration);
                    for name in declared_names(declaration) {
                        self.record.exports.push(ExportFact::Local {
                            local: name.clone(),
                            exported: name,
                            type_only,
                            span,
                        });
                    }
                }
                self.walk_stmt(declaration);
            }
            (None, Some(source)) => {
                let source_span = self.scan_specifier(span, source);
                if export.specifiers.is_empty() {
                    // `export * from '…'` 与 `export {} from '…'` 在 Oak AST 中同形。
                    self.record.exports.push(ExportFact::ReexportAll {
                        source: source.clone(),
                        source_span,
                        span,
                    });
                } else {
                    for specifier in &export.specifiers {
                        self.record.exports.push(ExportFact::ReexportNamed {
                            source: source.clone(),
                            source_span,
                            local: specifier.local.clone(),
                            exported: specifier.exported.clone(),
                            type_only: type_only || specifier.is_inline_type_only(),
                            span,
                        });
                    }
                }
            }
            (Some(declaration), Some(source)) => {
                // Oak 实测该形态为 `export * as ns from '…'`：declaration 是标识符表达式语句。
                let source_span = self.scan_specifier(span, source);
                if let Statement::ExpressionStatement(expression) = declaration.as_ref() {
                    if let ExpressionKind::Identifier(namespace) = &*expression.expression.kind {
                        self.record.exports.push(ExportFact::ReexportNamespace {
                            source: source.clone(),
                            source_span,
                            namespace: namespace.clone(),
                            type_only,
                            span,
                        });
                    }
                }
            }
            (None, None) => {
                for specifier in &export.specifiers {
                    self.record.exports.push(ExportFact::Local {
                        local: specifier.local.clone(),
                        exported: specifier.exported.clone(),
                        type_only: type_only || specifier.is_inline_type_only(),
                        span,
                    });
                }
            }
        }
    }

    fn walk_expr(&mut self, expression: &Expression) {
        match &*expression.kind {
            ExpressionKind::CallExpression { func, args } => {
                // `() => import('…')`：builder 把箭头函数体停在 `import` 上，
                // 实参被重挂为对箭头函数的调用，箭头体内保留空指纹。
                if let ExpressionKind::ArrowFunction { body, .. } = &*func.kind {
                    if is_empty_import(body) {
                        if let Some(argument) = args.first() {
                            self.push_dynamic(range(expression.span.clone()), argument);
                        }
                    }
                }
                // 表达式位置 `import('…')` / `import(v)`：callee 与语句起点之间
                // 留有被丢弃的 `import(` 前缀间隙；`require('…')` 同形，无法区分。
                else if args.is_empty() && func.span.start >= expression.span.start + DYNAMIC_CALL_GAP {
                    self.push_dynamic(range(expression.span.clone()), func);
                }
                self.walk_expr(func);
                for argument in args {
                    self.walk_expr(argument);
                }
            }
            ExpressionKind::NewExpression { func, args } => {
                if let ExpressionKind::Identifier(name) = &*func.kind {
                    if name == "URL" {
                        if let Some(first) = args.first() {
                            if let ExpressionKind::StringLiteral(specifier) = &*first.kind {
                                self.record.assets.push(AssetFact {
                                    specifier: specifier.clone(),
                                    specifier_span: Some(range(first.span.clone())),
                                    span: range(expression.span.clone()),
                                });
                            }
                        }
                    }
                }
                self.walk_expr(func);
                for argument in args {
                    self.walk_expr(argument);
                }
            }
            // 死变体兜底：若 Oak 未来构造出 `ImportExpression`，按动态 import 语义取事实。
            ExpressionKind::ImportExpression { module_specifier } => {
                self.push_dynamic(range(expression.span.clone()), module_specifier);
            }
            ExpressionKind::UnaryExpression { argument, .. } | ExpressionKind::UpdateExpression { argument, .. } => {
                self.walk_expr(argument);
            }
            ExpressionKind::BinaryExpression { left, right, .. } | ExpressionKind::AssignmentExpression { left, right, .. } => {
                self.walk_expr(left);
                self.walk_expr(right);
            }
            ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
                self.walk_expr(test);
                self.walk_expr(consequent);
                self.walk_expr(alternate);
            }
            ExpressionKind::MemberExpression { object, property, .. } => {
                self.walk_expr(object);
                self.walk_expr(property);
            }
            ExpressionKind::ArrowFunction { body, .. } => self.walk_stmt(body),
            ExpressionKind::FunctionExpression { body, .. } => self.walk_stmts(body),
            ExpressionKind::ObjectLiteral { properties } => {
                for property in properties {
                    match property {
                        ObjectProperty::Property { value, .. } => self.walk_expr(value),
                        ObjectProperty::Spread(value) => self.walk_expr(value),
                    }
                }
            }
            ExpressionKind::ArrayLiteral { elements } => {
                for element in elements {
                    self.walk_expr(element);
                }
            }
            ExpressionKind::TaggedTemplateExpression { tag, template } => {
                self.walk_expr(tag);
                self.walk_expr(template);
            }
            ExpressionKind::SpreadElement(inner)
            | ExpressionKind::AwaitExpression(inner)
            | ExpressionKind::NonNullExpression(inner)
            | ExpressionKind::TypeAssertionExpression { expression: inner, .. }
            | ExpressionKind::AsExpression { expression: inner, .. } => self.walk_expr(inner),
            ExpressionKind::YieldExpression(value) => {
                if let Some(value) = value {
                    self.walk_expr(value);
                }
            }
            ExpressionKind::Identifier(_)
            | ExpressionKind::NumericLiteral(_)
            | ExpressionKind::StringLiteral(_)
            | ExpressionKind::BigIntLiteral(_)
            | ExpressionKind::BooleanLiteral(_)
            | ExpressionKind::NullLiteral
            | ExpressionKind::RegexLiteral(_)
            | ExpressionKind::TemplateString(_)
            // JSX 在本 crate 中关闭（jsx: false），不可达。
            | ExpressionKind::JsxElement(_)
            | ExpressionKind::JsxFragment(_)
            | ExpressionKind::JsxSelfClosingElement(_) => {}
        }
    }

    /// 在语句区域内反查说明符字面量 span（含引号）。
    ///
    /// 说明符是 import/export 语句的最后一个子句，因此从区域尾部向前
    /// 逐个引号位置尝试配对，取内文等于 `specifier` 的最后一次匹配；
    /// 转义与注释中的同形引号会因内文不等被跳过，取不到则返回 `None`。
    fn scan_specifier(&self, span: (usize, usize), specifier: &str) -> Option<(usize, usize)> {
        let bytes = self.source.as_bytes();
        let start = span.0.min(bytes.len());
        let end = span.1.min(bytes.len());
        for close in (start..end).rev() {
            let quote = bytes[close];
            if quote != b'\'' && quote != b'"' {
                continue;
            }
            // 从 closing 引号向前找配对 opening 引号（按前置反斜杠奇偶判转义）。
            let mut open = close;
            while open > start {
                open -= 1;
                if bytes[open] != quote {
                    continue;
                }
                let mut backslashes = 0usize;
                let mut cursor = open;
                while cursor > start && bytes[cursor - 1] == b'\\' {
                    backslashes += 1;
                    cursor -= 1;
                }
                if backslashes % 2 == 1 {
                    continue;
                }
                if &self.source[open + 1..close] == specifier {
                    return Some((open, close + 1));
                }
                // 内文不等 → 继续向前找更早的引号作为 opening。
            }
        }
        None
    }
}
