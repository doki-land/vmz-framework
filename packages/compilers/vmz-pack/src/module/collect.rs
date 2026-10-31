//! 源码 → [`ModuleRecord`] 的收集器：只消费 Oak TypeScript AST，
//! 不做模块身份解析、链接与分包，也不引入任何正则模块语义识别。
//!
//! Oak 已实测的结构事实（决定下面的判定方式）：
//! - 语句头 `import(…)` 被解析为空 `ImportDeclaration` 加后随表达式语句，
//!   形成可配对的指纹；`require(…)` 不产生该指纹。
//! - 表达式位置 `import(…)` 的 `import` 关键字是 leaf，builder 丢弃后
//!   CallExpression 的 span 仍从 `import` 起算，与 callee 的 span 之间
//!   留下至少 `import(` 长度的间隙。
//! - 两类 span 形状启发都必须由起点处的 `import` 原文佐证（词边界校验），
//!   防止注释前缀调用等残缺形状被误判成动态 import。
//! - `import.meta` 是正式 `MetaProperty` 节点；语句头 `import.meta` 解析为
//!   表达式语句，不再产生空指纹。
//! - 静态 import/export 的说明符在 AST 中带原文与含引号的字面量 span。
//! - `await` 是独立 `AwaitExpression` 节点；顶层 await 由 root 级
//!   `top_level_await_spans` 事实给出（见 `ModuleFlags::has_tla`）。一元
//!   关键字运算符在关键字后带空白时仍被 trivia 覆盖为空格，与
//!   `typeof`/`void`/`!`/`-` 同形不可区分。
//! - 变量声明按 `declarators` 给事实：每个 declarator 的 `binding_names`
//!   就是绑定名（多 declarator 与解构都展开），`pattern_text` 保留原文
//!   形态；含初始值的 enum、`for…of` 解构、`namespace` 体会被误建成残缺
//!   语句，模板字符串的插值表达式整体丢失。这些形态只按保守效果记录并给
//!   `statement_fact_incomplete` 诊断，不做猜测性还原。
//! - 类表达式是正式 `ClassExpression` 节点，成员与 `ClassDeclaration` 同构；
//!   `extends` 以 `TypeAnnotation::Reference { name: 原文 }` 承载运行时父类
//!   引用。匿名 `export default class` 仍落为空名 `ClassDeclaration`。

use vmz_oak_frontend_adapter::{
    OakFrontendDiagnostic, ScriptRole, ScriptShellInput, parse_script_ast,
};

use oak_typescript::ast::{
    ClassMember, ExportDeclaration, ExportSpecifier, Expression, ExpressionKind,
    ExpressionStatement, ImportSpecifier, ObjectProperty, Statement, TypeAnnotation, VariableKind,
};
use oak_typescript::scope::module_scope_facts;

use super::record::{
    AssetFact, ExportFact, ImportBinding, ImportFact, ImportKind, ImportedName, ModuleFlags,
    ModuleRecord, ScopeBindingFact, StatementEffect, StatementFact,
};
use crate::diag::PackDiagnostic;

/// 源码解析失败诊断码（致命，走 `Err`）。
const PARSE_FAILED: &str = "vmz::pack::module::parse_failed";
/// 动态 import 说明符不是字符串字面量，无法静态解析。
const DYNAMIC_IMPORT_UNRESOLVED: &str = "vmz::pack::module::dynamic_import_unresolved";
/// import 形态无法提取模块说明符（如 `import.meta`、残缺语句）。
const IMPORT_WITHOUT_SPECIFIER: &str = "vmz::pack::module::import_without_specifier";
/// Oak 无法给出完整语句事实（绑定名缺失、误解析形态等），
/// 链接层必须按副作用保守保留。
const STATEMENT_FACT_INCOMPLETE: &str = "vmz::pack::module::statement_fact_incomplete";
/// 表达式位置动态 import 的最小 span 间隙：`import(` 的字节数。
const DYNAMIC_CALL_GAP: usize = "import(".len();

/// 校验 `start` 处的源码原文以 `import` 关键字起头且带词边界。
/// span 形状启发（空指纹配对、`import(` 前缀间隙）必须由原文佐证，
/// 否则注释前缀调用等残缺形状会被误判成动态 import。
fn is_import_keyword_at(source: &str, start: usize) -> bool {
    let Some(rest) = source.as_bytes().get(start..) else {
        return false;
    };
    let Some(after) = rest.strip_prefix(b"import") else {
        return false;
    };
    !matches!(after.first(), Some(c) if c.is_ascii_alphanumeric() || *c == b'_' || *c == b'$')
}

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
    collector.record_top(&root.statements);
    // TLA 资格直接取 Oak root 级正式事实，不扫语句树、不猜测。
    collector.record.flags.has_tla = root.has_top_level_await();
    // scope 事实直接取 Oak 正式投影：builder 未开启类型擦除（默认关闭），
    // 值引用与遮蔽排除由上游保证；`incomplete` 原样透传，本层不做名字匹配补洞。
    let scope = module_scope_facts(&root);
    collector.record.scope_incomplete = scope.incomplete;
    collector.record.scope_bindings = scope
        .bindings
        .into_iter()
        .map(|binding| ScopeBindingFact {
            name: binding.name,
            declaration: range(binding.declaration),
            references: binding.references.into_iter().map(range).collect(),
            has_type_references: binding.has_type_references,
            rename_unsafe: binding.rename_unsafe,
        })
        .collect();
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
    matches!(statement, Statement::ImportDeclaration(d) if d.specifiers.is_empty() && d.module_specifier.value.is_empty())
}

/// 单语句体位置的空指纹（`if`/`while`/`for` 的无花括号体）。
fn hole_in_single_body(statement: &Statement) -> Option<(usize, usize)> {
    match statement {
        Statement::ImportDeclaration(d)
            if d.specifiers.is_empty() && d.module_specifier.value.is_empty() =>
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
            if d.specifiers.is_empty() && d.module_specifier.value.is_empty() =>
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

/// 声明语句引入的全部绑定名：多 declarator 与解构都按 Oak 的
/// `binding_names` 展开，去重保序。
fn declared_names(statement: &Statement) -> Vec<String> {
    if let Statement::VariableDeclaration(d) = statement {
        let mut names: Vec<String> = Vec::new();
        for declarator in &d.declarators {
            for binding in &declarator.binding_names {
                if !binding.is_empty() && !names.contains(binding) {
                    names.push(binding.clone());
                }
            }
        }
        return names;
    }
    let name = match statement {
        Statement::FunctionDeclaration(d) => &d.name,
        Statement::ClassDeclaration(d) => &d.name,
        Statement::Interface(d) => &d.name,
        Statement::TypeAlias(d) => &d.name,
        Statement::Enum(d) => &d.name,
        Statement::Namespace(d) => &d.name,
        _ => return Vec::new(),
    };
    if name.is_empty() { Vec::new() } else { vec![name.to_string()] }
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
                scope_bindings: Vec::new(),
                scope_incomplete: false,
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
                    Some(Statement::ExpressionStatement(next))
                        if is_import_keyword_at(self.source, hole.0) =>
                    {
                        let span = (hole.0, next.span.end);
                        self.push_dynamic(span, &next.expression);
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

    /// 顶层语句 → [`StatementFact`]：只记模块顶层，嵌套声明并入所在顶层语句。
    /// 与动态 import 空指纹配对的表达式语句不成事实（其效果由动态边承载）。
    fn record_top(&mut self, statements: &[Statement]) {
        for (index, statement) in statements.iter().enumerate() {
            if index > 0
                && matches!(statement, Statement::ExpressionStatement(_))
                && fingerprint_hole(&statements[index - 1])
                    .is_some_and(|hole| is_import_keyword_at(self.source, hole.0))
            {
                continue;
            }
            match statement {
                Statement::ImportDeclaration(_) => {}
                Statement::ExportDeclaration(export) => {
                    let Some(declaration) = export.declaration.as_deref() else {
                        continue;
                    };
                    if export.is_default()
                        && matches!(declaration, Statement::ExpressionStatement(_))
                    {
                        // `export default <表达式>`：事实 span 取整条 export 语句，
                        // 与 `ExportFact::Default { local: None }` 的 span 对齐。
                        self.push_fact(declaration, range(export.span.clone()));
                    } else {
                        self.push_fact(declaration, range(declaration.span()));
                    }
                }
                other => self.push_fact(other, range(other.span())),
            }
        }
    }

    fn push_fact(&mut self, statement: &Statement, span: (usize, usize)) {
        let (effect, incomplete) = self.statement_effect(statement);
        if incomplete {
            self.diagnostic(
                STATEMENT_FACT_INCOMPLETE,
                "Oak 无法给出该语句的完整事实，链接层按副作用保守保留",
                span,
            );
        }
        let mut referenced_names = Vec::new();
        collect_refs_statement(statement, &mut referenced_names);
        self.record.statements.push(StatementFact {
            span,
            declared_names: declared_names(statement),
            referenced_names,
            effect,
        });
    }

    /// 语句效果分类：判定不了即非纯（保守）。
    fn statement_effect(&self, statement: &Statement) -> (StatementEffect, bool) {
        match statement {
            Statement::Interface(_) | Statement::TypeAlias(_) => (StatementEffect::Pure, false),
            Statement::VariableDeclaration(d) => {
                if d.is_declare() {
                    return (StatementEffect::Pure, false);
                }
                // 绑定名缺失才是真正的 AST 缺事实，保守保留并诊断。
                if d.declarators.iter().any(|declarator| declarator.binding_names.is_empty()) {
                    return (StatementEffect::SideEffect, true);
                }
                // 解构会触发属性读取（可能是 getter），不按初值形态判纯。
                if d.declarators.iter().any(|declarator| declarator.pattern_text.is_some()) {
                    return (StatementEffect::SideEffect, false);
                }
                let mut pure = true;
                for declarator in &d.declarators {
                    match &declarator.value {
                        Some(value) => pure &= expr_pure(value),
                        // `const x` 缺初值是语法错误（Oak 已带诊断），不再谎报事实缺口。
                        None => {
                            return if matches!(d.kind, VariableKind::Const) {
                                (StatementEffect::SideEffect, false)
                            } else {
                                (StatementEffect::Init, false)
                            };
                        }
                    }
                }
                if !pure {
                    (StatementEffect::SideEffect, false)
                } else if matches!(d.kind, VariableKind::Const) {
                    (StatementEffect::Pure, false)
                } else {
                    (StatementEffect::Init, false)
                }
            }
            Statement::FunctionDeclaration(d) => {
                if d.is_declare() {
                    (StatementEffect::Pure, false)
                } else if !d.decorators.is_empty() {
                    (StatementEffect::SideEffect, false)
                } else {
                    (StatementEffect::Pure, d.params.iter().any(|p| p.binding_names.is_empty()))
                }
            }
            Statement::ClassDeclaration(d) => {
                if d.is_declare() {
                    return (StatementEffect::Pure, false);
                }
                let mut incomplete = false;
                let mut side_effect = !d.decorators.is_empty();
                for member in &d.body {
                    match member {
                        ClassMember::Property { decorators, name, initializer, .. } => {
                            if !decorators.is_empty() {
                                side_effect = true;
                            }
                            if name.is_empty() {
                                incomplete = true;
                                side_effect = true;
                            }
                            if initializer.as_ref().is_some_and(|v| !expr_pure(v)) {
                                side_effect = true;
                            }
                        }
                        ClassMember::Method { decorators, name, .. } => {
                            if !decorators.is_empty() {
                                side_effect = true;
                            }
                            if name.is_empty() {
                                incomplete = true;
                                side_effect = true;
                            }
                        }
                    }
                }
                if side_effect {
                    (StatementEffect::SideEffect, incomplete)
                } else {
                    (StatementEffect::Init, incomplete)
                }
            }
            Statement::Enum(d) => {
                if d.is_declare() {
                    return (StatementEffect::Pure, false);
                }
                let mut incomplete = false;
                let mut side_effect = !d.decorators.is_empty();
                if d.name.is_empty() {
                    incomplete = true;
                    side_effect = true;
                }
                for member in &d.members {
                    if member.name.is_empty() {
                        incomplete = true;
                        side_effect = true;
                    }
                    if member.initializer.as_ref().is_some_and(|v| !expr_pure(v)) {
                        side_effect = true;
                    }
                }
                if side_effect {
                    (StatementEffect::SideEffect, incomplete)
                } else {
                    (StatementEffect::Init, false)
                }
            }
            Statement::Namespace(d) => {
                if d.is_declare() {
                    (StatementEffect::Pure, false)
                } else if !d.decorators.is_empty() {
                    (StatementEffect::SideEffect, false)
                } else {
                    self.combine_effects(&d.body)
                }
            }
            Statement::ExpressionStatement(s) => {
                if !s.decorators.is_empty() {
                    return (StatementEffect::SideEffect, false);
                }
                if self.expression_statement_misparsed(s) {
                    (StatementEffect::SideEffect, true)
                } else if expr_pure(&s.expression) {
                    (StatementEffect::Pure, false)
                } else {
                    (StatementEffect::SideEffect, false)
                }
            }
            Statement::BlockStatement(s) => self.combine_effects(&s.statements),
            // 其余控制流语句：顶层出现即按副作用保守处理。
            _ => (StatementEffect::SideEffect, false),
        }
    }

    fn combine_effects(&self, statements: &[Statement]) -> (StatementEffect, bool) {
        let mut effect = StatementEffect::Pure;
        let mut incomplete = false;
        for statement in statements {
            let (inner, inner_incomplete) = self.statement_effect(statement);
            incomplete |= inner_incomplete;
            effect = match (effect, inner) {
                (StatementEffect::SideEffect, _) | (_, StatementEffect::SideEffect) => {
                    StatementEffect::SideEffect
                }
                (StatementEffect::Init, _) | (_, StatementEffect::Init) => StatementEffect::Init,
                _ => StatementEffect::Pure,
            };
        }
        (effect, incomplete)
    }

    /// Oak 误解析指纹：表达式语句的表达式 span 与语句 span（去尾分号/空白）
    /// 不重合，即语句里还有表达式未覆盖的原文（`for (…)`、`namespace` 等
    /// 被误建成残缺标识符/成员表达式的形态）。
    fn expression_statement_misparsed(&self, statement: &ExpressionStatement) -> bool {
        let bytes = self.source.as_bytes();
        let mut end = statement.span.end.min(bytes.len());
        while end > statement.span.start
            && (bytes[end - 1] == b';' || bytes[end - 1].is_ascii_whitespace())
        {
            end -= 1;
        }
        !(statement.expression.span.start == statement.span.start
            && statement.expression.span.end == end)
    }

    fn walk_stmt(&mut self, statement: &Statement) {
        match statement {
            Statement::VariableDeclaration(d) => {
                for declarator in &d.declarators {
                    if let Some(value) = &declarator.value {
                        self.walk_expr(value);
                    }
                }
            }
            Statement::FunctionDeclaration(d) => {
                self.walk_stmts(&d.body);
            }
            Statement::ClassDeclaration(d) => {
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
            // 纯类型与枚举声明：无可下钻的运行时语句。
            Statement::Interface(_) | Statement::TypeAlias(_) | Statement::Enum(_) => {}
            Statement::Namespace(d) => {
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
                        ImportSpecifier::Default { local, .. } => ImportBinding {
                            local: local.clone(),
                            imported: ImportedName::Default,
                            inline_type_only: false,
                            span: None,
                        },
                        ImportSpecifier::Namespace { local, .. } => ImportBinding {
                            local: local.clone(),
                            imported: ImportedName::Namespace,
                            inline_type_only: false,
                            span: None,
                        },
                        ImportSpecifier::Named { local, imported, type_modifier, .. } => {
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
                let specifier_span = if d.module_specifier.value.is_empty() {
                    None
                } else {
                    Some(range(d.module_specifier.span.clone()))
                };
                self.record.imports.push(ImportFact {
                    specifier: d.module_specifier.value.clone(),
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
                let source_span =
                    if source.value.is_empty() { None } else { Some(range(source.span.clone())) };
                if export.specifiers.is_empty() {
                    // `export {} from '…'`：无对外名字，仅来源模块被执行。
                    self.record.exports.push(ExportFact::ReexportAll {
                        source: source.value.clone(),
                        source_span,
                        span,
                    });
                } else {
                    for specifier in &export.specifiers {
                        match specifier {
                            ExportSpecifier::All { .. } => {
                                self.record.exports.push(ExportFact::ReexportAll {
                                    source: source.value.clone(),
                                    source_span,
                                    span,
                                });
                            }
                            ExportSpecifier::Namespace { exported, .. } => {
                                self.record.exports.push(ExportFact::ReexportNamespace {
                                    source: source.value.clone(),
                                    source_span,
                                    namespace: exported.clone(),
                                    type_only,
                                    span,
                                });
                            }
                            ExportSpecifier::Named { local, exported, .. } => {
                                self.record.exports.push(ExportFact::ReexportNamed {
                                    source: source.value.clone(),
                                    source_span,
                                    local: local.clone(),
                                    exported: exported.clone(),
                                    type_only: type_only || specifier.is_inline_type_only(),
                                    span,
                                });
                            }
                        }
                    }
                }
            }
            (Some(declaration), Some(source)) => {
                // 兼容形态：若 Oak 仍以 declaration 承载命名空间重导出，按标识符取名。
                let source_span =
                    if source.value.is_empty() { None } else { Some(range(source.span.clone())) };
                if let Statement::ExpressionStatement(expression) = declaration.as_ref() {
                    if let ExpressionKind::Identifier(namespace) = &*expression.expression.kind {
                        self.record.exports.push(ExportFact::ReexportNamespace {
                            source: source.value.clone(),
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
                    if let ExportSpecifier::Named { local, exported, .. } = specifier {
                        self.record.exports.push(ExportFact::Local {
                            local: local.clone(),
                            exported: exported.clone(),
                            type_only: type_only || specifier.is_inline_type_only(),
                            span,
                        });
                    }
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
                // 留有被丢弃的 `import(` 前缀间隙；间隙形状必须由起点处的
                // `import` 原文佐证，`require('…')` 与注释前缀调用等形状据此排除。
                else if args.is_empty()
                    && func.span.start >= expression.span.start + DYNAMIC_CALL_GAP
                    && is_import_keyword_at(self.source, expression.span.start)
                {
                    self.push_dynamic(range(expression.span.clone()), func);
                }
                self.walk_expr(func);
                for argument in args {
                    self.walk_expr(argument);
                }
            }
            ExpressionKind::NewExpression { func, args } => {
                // 只有规范形态 `new URL('<literal>', import.meta.url)` 才是资源
                // 引用：第二参必须是正式的 `import.meta.url` 成员表达式。
                // 单参 `new URL('<lit>')` 相对文档基址解析，不是模块相对资源。
                if matches!(&*func.kind, ExpressionKind::Identifier(name) if name == "URL")
                    && args.len() >= 2
                    && is_import_meta_url(&args[1])
                {
                    if let ExpressionKind::StringLiteral(specifier) = &*args[0].kind {
                        self.record.assets.push(AssetFact {
                            specifier: specifier.clone(),
                            specifier_span: Some(range(args[0].span.clone())),
                            span: range(expression.span.clone()),
                        });
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
            ExpressionKind::SequenceExpression(expressions) => {
                for part in expressions {
                    self.walk_expr(part);
                }
            }
            ExpressionKind::MemberExpression { object, property, .. } => {
                self.walk_expr(object);
                self.walk_expr(property);
            }
            ExpressionKind::ArrowFunction { body, .. } => self.walk_stmt(body),
            ExpressionKind::FunctionExpression { body, .. } => self.walk_stmts(body),
            // 类表达式与 `ClassDeclaration` 同构下钻：初值仍是表达式，
            // 方法体是函数作用域边界，内部仍可能承载动态 import 等事实。
            ExpressionKind::ClassExpression { body, .. } => {
                for member in body {
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
            ExpressionKind::ObjectLiteral { properties } => {
                for property in properties {
                    match property {
                        ObjectProperty::Property { value, .. } => self.walk_expr(value),
                        // A method body is a real function boundary; its statements
                        // still carry module facts (e.g. dynamic `import(...)`).
                        ObjectProperty::Method { body, .. } => self.walk_stmts(body),
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
            | ExpressionKind::MetaProperty { .. }
            // JSX 在本 crate 中关闭（jsx: false），不可达。
            | ExpressionKind::JsxElement(_)
            | ExpressionKind::JsxFragment(_)
            | ExpressionKind::JsxSelfClosingElement(_) => {}
        }
    }
}

/// 表达式是否为正式的 `import.meta.url` 成员访问（非计算、非可选链）。
fn is_import_meta_url(expression: &Expression) -> bool {
    let ExpressionKind::MemberExpression { object, property, computed, optional } =
        &*expression.kind
    else {
        return false;
    };
    !computed
        && !optional
        && matches!(
            &*object.kind,
            ExpressionKind::MetaProperty { meta, property }
                if meta == "import" && property == "meta"
        )
        && matches!(&*property.kind, ExpressionKind::Identifier(name) if name == "url")
}

/// 表达式在模块求值时是否可证明无副作用（保守：判不了即非纯）。
fn expr_pure(expression: &Expression) -> bool {
    match &*expression.kind {
        ExpressionKind::Identifier(_)
        | ExpressionKind::NumericLiteral(_)
        | ExpressionKind::StringLiteral(_)
        | ExpressionKind::BigIntLiteral(_)
        | ExpressionKind::BooleanLiteral(_)
        | ExpressionKind::NullLiteral
        | ExpressionKind::RegexLiteral(_) => true,
        ExpressionKind::TemplateString(text) => !text.contains("${"),
        ExpressionKind::MemberExpression { object, property, .. } => {
            expr_pure(object) && expr_pure(property)
        }
        ExpressionKind::BinaryExpression { left, right, .. } => expr_pure(left) && expr_pure(right),
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            expr_pure(test) && expr_pure(consequent) && expr_pure(alternate)
        }
        ExpressionKind::UnaryExpression { operator, argument } => {
            // Oak 实测：关键字后带空白的一元算子（含 `await x`、`delete o.k`）
            // operator 被 trivia 覆盖为空格，与 `typeof`/`void` 同形不可区分，
            // 只有无空格形态留下真实算子文本；判不了即非纯。
            matches!(operator.as_str(), "typeof" | "void" | "!" | "-" | "+" | "~")
                && expr_pure(argument)
        }
        ExpressionKind::SpreadElement(inner) | ExpressionKind::NonNullExpression(inner) => {
            expr_pure(inner)
        }
        ExpressionKind::AsExpression { expression, .. }
        | ExpressionKind::TypeAssertionExpression { expression, .. } => expr_pure(expression),
        // 闭包创建本身纯；体内引用与调用只在执行时发生。
        ExpressionKind::ArrowFunction { .. } | ExpressionKind::FunctionExpression { .. } => true,
        ExpressionKind::ObjectLiteral { properties } => {
            properties.iter().all(|property| match property {
                ObjectProperty::Property { value, .. } => expr_pure(value),
                // Method creation is a closure, like `FunctionExpression`.
                ObjectProperty::Method { .. } => true,
                ObjectProperty::Spread(value) => expr_pure(value),
            })
        }
        ExpressionKind::ArrayLiteral { elements } => elements.iter().all(expr_pure),
        // 调用/构造/赋值/更新/await/yield/tagged template/动态 import/JSX：非纯。
        _ => false,
    }
}

/// 收集语句子树中的标识符引用（含嵌套函数/类体与属性名，保守多收录）。
fn collect_refs_statement(statement: &Statement, names: &mut Vec<String>) {
    match statement {
        Statement::VariableDeclaration(d) => {
            for declarator in &d.declarators {
                if let Some(value) = &declarator.value {
                    collect_refs_expression(value, names);
                }
            }
        }
        Statement::FunctionDeclaration(d) => {
            for body in &d.body {
                collect_refs_statement(body, names);
            }
        }
        Statement::ClassDeclaration(d) => {
            push_heritage_reference(&d.extends, names);
            for decorator in &d.decorators {
                collect_refs_expression(&decorator.expression, names);
            }
            for member in &d.body {
                match member {
                    ClassMember::Property { decorators, initializer, .. } => {
                        for decorator in decorators {
                            collect_refs_expression(&decorator.expression, names);
                        }
                        if let Some(value) = initializer {
                            collect_refs_expression(value, names);
                        }
                    }
                    ClassMember::Method { decorators, body, .. } => {
                        for decorator in decorators {
                            collect_refs_expression(&decorator.expression, names);
                        }
                        for statement in body {
                            collect_refs_statement(statement, names);
                        }
                    }
                }
            }
        }
        Statement::ExpressionStatement(s) => collect_refs_expression(&s.expression, names),
        Statement::ExportDeclaration(e) => {
            if let Some(declaration) = &e.declaration {
                collect_refs_statement(declaration, names);
            }
        }
        Statement::Enum(d) => {
            for member in &d.members {
                if let Some(value) = &member.initializer {
                    collect_refs_expression(value, names);
                }
            }
        }
        Statement::Namespace(d) => {
            for statement in &d.body {
                collect_refs_statement(statement, names);
            }
        }
        Statement::ReturnStatement(s) => {
            if let Some(argument) = &s.argument {
                collect_refs_expression(argument, names);
            }
        }
        Statement::ThrowStatement(s) => collect_refs_expression(&s.argument, names),
        Statement::IfStatement(s) => {
            collect_refs_expression(&s.test, names);
            collect_refs_statement(&s.consequent, names);
            if let Some(alternate) = &s.alternate {
                collect_refs_statement(alternate, names);
            }
        }
        Statement::WhileStatement(s) => {
            collect_refs_expression(&s.test, names);
            collect_refs_statement(&s.body, names);
        }
        Statement::DoWhileStatement(s) => {
            collect_refs_statement(&s.body, names);
            collect_refs_expression(&s.test, names);
        }
        Statement::ForStatement(s) => {
            if let Some(initializer) = &s.initializer {
                collect_refs_statement(initializer, names);
            }
            if let Some(test) = &s.test {
                collect_refs_expression(test, names);
            }
            if let Some(incrementor) = &s.incrementor {
                collect_refs_expression(incrementor, names);
            }
            collect_refs_statement(&s.body, names);
        }
        Statement::ForInStatement(s) => {
            collect_refs_statement(&s.left, names);
            collect_refs_expression(&s.right, names);
            collect_refs_statement(&s.body, names);
        }
        Statement::ForOfStatement(s) => {
            collect_refs_statement(&s.left, names);
            collect_refs_expression(&s.right, names);
            collect_refs_statement(&s.body, names);
        }
        Statement::SwitchStatement(s) => {
            collect_refs_expression(&s.discriminant, names);
            for case in &s.cases {
                if let Some(test) = &case.test {
                    collect_refs_expression(test, names);
                }
                for statement in &case.consequent {
                    collect_refs_statement(statement, names);
                }
            }
        }
        Statement::TryStatement(s) => {
            for statement in &s.block {
                collect_refs_statement(statement, names);
            }
            if let Some(handler) = &s.handler {
                for statement in &handler.body {
                    collect_refs_statement(statement, names);
                }
            }
            if let Some(finalizer) = &s.finalizer {
                for statement in finalizer {
                    collect_refs_statement(statement, names);
                }
            }
        }
        Statement::BlockStatement(s) => {
            for statement in &s.statements {
                collect_refs_statement(statement, names);
            }
        }
        // 类型与模块声明不产生运行时引用；break/continue 无引用。
        Statement::Interface(_)
        | Statement::TypeAlias(_)
        | Statement::ImportDeclaration(_)
        | Statement::BreakStatement(_)
        | Statement::ContinueStatement(_) => {}
    }
}

fn collect_refs_expression(expression: &Expression, names: &mut Vec<String>) {
    match &*expression.kind {
        ExpressionKind::Identifier(name) => push_unique_name(names, name),
        ExpressionKind::MemberExpression { object, property, .. } => {
            collect_refs_expression(object, names);
            collect_refs_expression(property, names);
        }
        ExpressionKind::CallExpression { func, args } => {
            collect_refs_expression(func, names);
            for argument in args {
                collect_refs_expression(argument, names);
            }
        }
        ExpressionKind::NewExpression { func, args } => {
            collect_refs_expression(func, names);
            for argument in args {
                collect_refs_expression(argument, names);
            }
        }
        ExpressionKind::UnaryExpression { argument, .. }
        | ExpressionKind::UpdateExpression { argument, .. }
        | ExpressionKind::SpreadElement(argument)
        | ExpressionKind::AwaitExpression(argument)
        | ExpressionKind::NonNullExpression(argument) => collect_refs_expression(argument, names),
        ExpressionKind::BinaryExpression { left, right, .. }
        | ExpressionKind::AssignmentExpression { left, right, .. } => {
            collect_refs_expression(left, names);
            collect_refs_expression(right, names);
        }
        ExpressionKind::ConditionalExpression { test, consequent, alternate } => {
            collect_refs_expression(test, names);
            collect_refs_expression(consequent, names);
            collect_refs_expression(alternate, names);
        }
        ExpressionKind::AsExpression { expression, .. }
        | ExpressionKind::TypeAssertionExpression { expression, .. } => {
            collect_refs_expression(expression, names);
        }
        ExpressionKind::ArrowFunction { body, .. } => collect_refs_statement(body, names),
        ExpressionKind::FunctionExpression { body, .. } => {
            for statement in body {
                collect_refs_statement(statement, names);
            }
        }
        // 类表达式与 `ClassDeclaration` 同构收集：heritage 引用、成员装饰器、
        // 字段初值与方法体（方法体是函数作用域边界，内部引用保守收录）。
        ExpressionKind::ClassExpression { extends, body, .. } => {
            push_heritage_reference(extends, names);
            for member in body {
                match member {
                    ClassMember::Property { decorators, initializer, .. } => {
                        for decorator in decorators {
                            collect_refs_expression(&decorator.expression, names);
                        }
                        if let Some(value) = initializer {
                            collect_refs_expression(value, names);
                        }
                    }
                    ClassMember::Method { decorators, body, .. } => {
                        for decorator in decorators {
                            collect_refs_expression(&decorator.expression, names);
                        }
                        for statement in body {
                            collect_refs_statement(statement, names);
                        }
                    }
                }
            }
        }
        ExpressionKind::ObjectLiteral { properties } => {
            for property in properties {
                match property {
                    ObjectProperty::Property { value, .. } => collect_refs_expression(value, names),
                    ObjectProperty::Method { body, .. } => {
                        for statement in body {
                            collect_refs_statement(statement, names);
                        }
                    }
                    ObjectProperty::Spread(value) => collect_refs_expression(value, names),
                }
            }
        }
        ExpressionKind::ArrayLiteral { elements } => {
            for element in elements {
                collect_refs_expression(element, names);
            }
        }
        ExpressionKind::TaggedTemplateExpression { tag, template } => {
            collect_refs_expression(tag, names);
            collect_refs_expression(template, names);
        }
        ExpressionKind::ImportExpression { module_specifier } => {
            collect_refs_expression(module_specifier, names);
        }
        ExpressionKind::YieldExpression(value) => {
            if let Some(value) = value {
                collect_refs_expression(value, names);
            }
        }
        // 字面量与 JSX（本 crate 关闭）无引用。
        _ => {}
    }
}

fn push_unique_name(names: &mut Vec<String>, name: &str) {
    if !name.is_empty() && !names.iter().any(|existing| existing == name) {
        names.push(name.to_string());
    }
}

/// `extends` 在上游是 `TypeAnnotation::Reference { name: 原文, args: [] }`：
/// 取首段标识符作为引用名（`ns.Base` 取 `ns`、`mix(A)` 取 `mix`），
/// 其余原文不是可匹配的绑定名，不收录。
fn push_heritage_reference(extends: &Option<TypeAnnotation>, names: &mut Vec<String>) {
    let Some(TypeAnnotation::Reference { name, .. }) = extends else {
        return;
    };
    let head: String =
        name.chars().take_while(|c| c.is_alphanumeric() || *c == '_' || *c == '$').collect();
    push_unique_name(names, &head);
}
