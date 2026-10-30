//! 解析身份层：specifier + importer 上下文 → 唯一模块身份。
//!
//! 只回答「这个 specifier 在这个 importer、这个 target 下指向哪个物理文件、
//! 属于哪个包实例」，不读取模块语义（import/export 语义归 `module` 层）。
//!
//! # 身份口径
//!
//! - [`Resolved::path`] 一律 `canonicalize` 后的真实文件（跟随符号链接，
//!   pnpm 链接包由此得到真实包根）。
//! - `?` 查询与 `#` 片段不是文件身份的一部分：解析入口先按首个出现处
//!   剥离再解析；`#` 开头的 `imports` 说明符在剥离之前分流，不受影响。
//! - 包实例身份 [`PackageIdentity`] = canonical 包根 + `name` + `version`；
//!   同名不同物理根或不同版本即不同实例，**不得**仅按裸 specifier 或包名
//!   作为缓存键或输出单位。解析结果同时依赖 importer 与 target，缓存键必须
//!   由调用方把 importer、target 与本层给出的身份组合，不能只用 specifier。
//! - 相对/绝对 specifier 不附带包身份（importer 已唯一区分上下文）；
//!   `#imports` 的相对目标附带**定义 imports 的包**的实例身份（不同版本的
//!   同名包对 `#x` 定义可以不同），裸目标附带目标包身份；裸 specifier 解析
//!   一律附带命中的包实例身份。
//!
//! # 条件解析取舍（对齐 Node ESM 语义）
//!
//! - 条件**激活集合**由 [`Target`] 决定：Browser = `browser`/`import`/`default`，
//!   Node = `node`/`import`/`default`。匹配**顺序**是 package.json 里作者的
//!   书写顺序（Node 把条件顺序交给作者，解析器不重排；上面列出的顺序只是
//!   对作者的推荐书写顺序）。
//! - `require` 不在激活集合内：本层为 ESM 模块图建立身份，`require` 分支被
//!   **跳过**并继续按作者顺序向后匹配（通常落到 `default`）；只有所有条件键
//!   都无一适用时才报 `unsupported_condition`。CJS require 语义属于后续链接/
//!   转换阶段，不属于本层的身份判定。
//! - `null` 目标 = 明确禁止：立即报 `forbidden`，不继续向后、不回退。
//!   数组目标取第一个可解析项；数组中的 `null` 同样立即禁止；条件不适用的
//!   项跳过继续；空数组视为禁止。
//! - 条件一旦命中即选定：随后目标文件不存在报 `not_found`，不回溯其它条件。
//!
//! # 封装
//!
//! - 包有 `exports` 时只认 `exports`：子路径未导出报 `encapsulated`，
//!   **绝不**回退 `main` / `src/` / `lib/` 猜路径；`exports` 优先于一切
//!   legacy 字段。
//! - 无 `exports` 的遗留包才回退 `main`/`module`/`browser` 与常规文件查找；
//!   深层子路径按常规文件查找（没有 exports 就没有封装）。
//! - `#` specifier 只经所属包的 `imports` 解析，不落地为文件猜测。
//!
//! # 规范模糊点的实现取舍
//!
//! - 顶层 `"exports": null` 视为 `{ ".": null }` 语法糖：主入口被显式禁止，
//!   其余子路径按未导出处理（从严，不回退 legacy 字段）。
//! - legacy 入口字段优先级：Browser = `browser` → `module` → `main`，
//!   Node = `main` → `module`（Node 官方只认 `main`，`module` 是打包器通行
//!   的 ESM 入口约定）。只取字符串形式；object 形式 `browser` 是模块图别名
//!   映射，属于链接层事实，不在本层处理。字段目标文件缺失时顺延下一字段，
//!   最终 `index.*` 兜底。
//! - `package.json` 缺失按遗留空包处理（无 exports/imports，`index.*` 兜底，
//!   身份 version 为空）；存在但非法 → `bad_manifest`。

mod fields;
mod files;
mod json;
mod manifest;
mod walk;

use crate::diag::PackDiagnostic;
use fields::{FieldFailure, TargetRef};
use manifest::Manifest;
use std::path::{Path, PathBuf};

const CODE_INVALID_SPECIFIER: &str = "vmz::pack::resolve::invalid_specifier";
const CODE_NOT_FOUND: &str = "vmz::pack::resolve::not_found";
const CODE_ENCAPSULATED: &str = "vmz::pack::resolve::encapsulated";
const CODE_FORBIDDEN: &str = "vmz::pack::resolve::forbidden";
const CODE_UNSUPPORTED_CONDITION: &str = "vmz::pack::resolve::unsupported_condition";
const CODE_BAD_EXPORTS: &str = "vmz::pack::resolve::bad_exports";
const CODE_BAD_MANIFEST: &str = "vmz::pack::resolve::bad_manifest";

/// `#imports` 递归深度上限（防止 imports 自引用循环）。
const MAX_IMPORTS_DEPTH: u32 = 16;

/// 解析目标平台：决定 `exports`/`imports` 条件激活集合与 legacy 字段优先级。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    /// 浏览器 client 图。
    Browser,
    /// Node SSR / 构建期执行。
    Node,
}

impl Target {
    /// 本 target 激活的条件键（列出的是对作者的推荐书写顺序）。
    ///
    /// 实际匹配仍按 package.json 中作者的书写顺序逐键判定，这里只决定
    /// 哪些键参与匹配：`require` 不在任何集合内。
    pub fn conditions(&self) -> &'static [&'static str] {
        match self {
            Target::Browser => &["browser", "import", "default"],
            Target::Node => &["node", "import", "default"],
        }
    }
}

/// 一次解析请求：specifier + importer 上下文 + 目标平台 + 项目根兜底。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolveRequest {
    /// 相对 / 绝对 / 裸包 / 包子路径 / `#imports` specifier。
    pub specifier: String,
    /// 导入方文件路径（用于 `node_modules` 上溯与相对解析）。
    pub importer: PathBuf,
    /// 目标平台（条件分流）。
    pub target: Target,
    /// 项目根（importer 上溯找不到时的兜底上溯点）。
    pub root: PathBuf,
}

/// 包实例身份 = canonical 物理包根 + `name` + `version`。
///
/// 同名不同版本或不同物理根即不同实例，不得混用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageIdentity {
    /// 包名（`package.json` `name`，缺失时回退 specifier 的包段）。
    pub name: String,
    /// canonicalize 后的物理包根。
    pub root: PathBuf,
    /// `package.json` `version`（缺失或无 manifest 为空）。
    pub version: Option<String>,
}

/// 解析结果：canonical 真实文件 + 所属包实例（相对解析为 `None`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// canonicalize 后的真实文件路径。
    pub path: PathBuf,
    /// 解析命中的包实例身份。
    pub package: Option<PackageIdentity>,
}

/// 由文件路径回溯其最近的 `package.json`，得到所属包实例身份。
/// 不在任何包下的文件返回 `None`；manifest 缺失或损坏同样返回 `None`，
/// 不阻断图构建（文件身份仍是 canonical 路径本身）。
pub fn package_of_path(file: &Path) -> Option<PackageIdentity> {
    let dir = walk::find_owning_package_root(file.parent()?)?;
    let root = std::fs::canonicalize(&dir).ok()?;
    let manifest = manifest::Manifest::load(&root).ok()?;
    let name = manifest
        .name()
        .map(str::to_string)
        .or_else(|| root.file_name().map(|segment| segment.to_string_lossy().into_owned()))?;
    Some(PackageIdentity { name, root, version: manifest.version().map(str::to_string) })
}

/// 解析一个 specifier。
///
/// 错误一律为 [`PackDiagnostic`]，code 形如 `vmz::pack::resolve::*`，
/// `path` 指向 importer 或包根。
pub fn resolve(req: &ResolveRequest) -> Result<Resolved, PackDiagnostic> {
    let spec = req.specifier.as_str();
    if spec.is_empty() {
        return Err(diag(CODE_INVALID_SPECIFIER, "specifier 不能为空", &req.importer));
    }
    if spec.starts_with('#') {
        return resolve_hash(req, spec, 0);
    }
    // 身份规则：`?` 查询与 `#` 片段按首个出现处剥离，剥离后才是文件路径；
    // 裸包名段不含这两个字符，剥离发生在拆分包段之前（相对与子路径同样适用）。
    let spec = strip_query_and_fragment(spec);
    let importer_dir = req.importer.parent().unwrap_or_else(|| Path::new("."));
    if is_relative_spec(spec) || spec.starts_with('/') || Path::new(spec).is_absolute() {
        let base =
            if is_relative_spec(spec) { importer_dir.join(spec) } else { PathBuf::from(spec) };
        let path = files::resolve_file(&base).ok_or_else(|| {
            diag(
                CODE_NOT_FOUND,
                format!("`{spec}` 未命中任何候选文件（扩展与 `index.*`）"),
                &req.importer,
            )
        })?;
        return Ok(Resolved { path, package: None });
    }
    resolve_bare(req, importer_dir, spec)
}

/// 裸 specifier：node_modules 上溯 → exports / legacy → 包实例身份。
fn resolve_bare(
    req: &ResolveRequest,
    from_dir: &Path,
    spec: &str,
) -> Result<Resolved, PackDiagnostic> {
    let (pkg_name, subpath) = split_package_specifier(spec, &req.importer)?;
    let dir = walk::find_package_dir(&pkg_name, from_dir)
        .or_else(|| walk::find_package_dir(&pkg_name, &req.root))
        .ok_or_else(|| {
            diag(
                CODE_NOT_FOUND,
                format!("包 `{pkg_name}` 未在任何上溯层的 node_modules 中找到"),
                &req.importer,
            )
        })?;
    let root = std::fs::canonicalize(&dir).map_err(|err| {
        diag(
            CODE_NOT_FOUND,
            format!("包目录 `{}` 无法 canonicalize：{err}", dir.display()),
            &req.importer,
        )
    })?;
    let manifest = Manifest::load(&root)?;
    let identity = PackageIdentity {
        name: manifest.name().unwrap_or(&pkg_name).to_string(),
        root: root.clone(),
        version: manifest.version().map(str::to_string),
    };

    let path = match manifest.field("exports") {
        // 包有 exports：只认 exports，绝不回退 legacy 字段或猜路径。
        Some(exports) => {
            let target =
                fields::match_exports(exports, &subpath, req.target).map_err(|failure| {
                    map_failure(failure, req.target, spec, &root, CODE_BAD_EXPORTS)
                })?;
            let TargetRef::Relative(rel) = target else {
                return Err(diag(
                    CODE_BAD_EXPORTS,
                    format!("`{spec}` 的 exports 目标不是包内 `./` 相对路径"),
                    &root,
                ));
            };
            files::resolve_file(&root.join(&rel)).ok_or_else(|| {
                diag(
                    CODE_NOT_FOUND,
                    format!("`{spec}` 的 exports 目标 `{rel}` 未命中任何候选文件"),
                    &root,
                )
            })?
        }
        // 无 exports 的遗留包：常规文件查找（无 exports 即无封装）。
        None => legacy_resolve(&root, &manifest, &subpath, req.target)?,
    };

    Ok(Resolved { path, package: Some(identity) })
}

/// 遗留包（无 `exports`）解析。
///
/// `.` 走入口字段优先级 + `index.*` 兜底；子路径走常规文件查找。
fn legacy_resolve(
    root: &Path,
    manifest: &Manifest,
    subpath: &str,
    target: Target,
) -> Result<PathBuf, PackDiagnostic> {
    if subpath == "." {
        // 只取字符串形式；object 形式 `browser` 属链接层别名，本层不处理。
        let entry_fields: &[&str] = match target {
            Target::Browser => &["browser", "module", "main"],
            Target::Node => &["main", "module"],
        };
        for field in entry_fields {
            if let Some(value) = manifest.field(field).and_then(json_str) {
                if let Some(path) = files::resolve_file(&root.join(value)) {
                    return Ok(path);
                }
            }
        }
        if let Some(path) = files::resolve_file(&root.join("index")) {
            return Ok(path);
        }
        return Err(diag(
            CODE_NOT_FOUND,
            "遗留包没有可用入口（`browser`/`module`/`main`/`index.*` 均未命中）",
            root,
        ));
    }
    files::resolve_file(&root.join(subpath)).ok_or_else(|| {
        diag(CODE_NOT_FOUND, format!("`{subpath}` 在遗留包中未命中任何候选文件"), root)
    })
}

/// `#` specifier：所属包 `imports` 解析（含条件、`*` pattern 与封装）。
fn resolve_hash(req: &ResolveRequest, spec: &str, depth: u32) -> Result<Resolved, PackDiagnostic> {
    if depth > MAX_IMPORTS_DEPTH {
        return Err(diag(
            CODE_BAD_MANIFEST,
            format!("`{spec}` 的 imports 解析超过 {MAX_IMPORTS_DEPTH} 层（疑似循环定义）"),
            &req.importer,
        ));
    }
    let importer_dir = req.importer.parent().unwrap_or_else(|| Path::new("."));
    let pkg_dir = walk::find_owning_package_root(importer_dir).ok_or_else(|| {
        diag(
            CODE_NOT_FOUND,
            format!("`{spec}` 需要 importer 所在链上的 package.json，但未找到"),
            &req.importer,
        )
    })?;
    let root = std::fs::canonicalize(&pkg_dir).map_err(|err| {
        diag(
            CODE_NOT_FOUND,
            format!("包目录 `{}` 无法 canonicalize：{err}", pkg_dir.display()),
            &req.importer,
        )
    })?;
    let manifest = Manifest::load(&root)?;
    let Some(imports) = manifest.field("imports") else {
        return Err(diag(
            CODE_NOT_FOUND,
            format!("`{spec}` 无法解析：所属包未定义 `imports` 字段"),
            &root,
        ));
    };
    let target = fields::match_imports(imports, spec, req.target)
        .map_err(|failure| map_failure(failure, req.target, spec, &root, CODE_BAD_MANIFEST))?;

    match target {
        TargetRef::Relative(rel) => {
            let path = files::resolve_file(&root.join(&rel)).ok_or_else(|| {
                diag(
                    CODE_NOT_FOUND,
                    format!("`{spec}` 的 imports 目标 `{rel}` 未命中任何候选文件"),
                    &root,
                )
            })?;
            let fallback = root
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_default();
            let identity = PackageIdentity {
                name: manifest.name().unwrap_or(&fallback).to_string(),
                root: root.clone(),
                version: manifest.version().map(str::to_string),
            };
            Ok(Resolved { path, package: Some(identity) })
        }
        // 同包嵌套 `#` 目标：importer 不变，继续解析。
        TargetRef::Hash(nested) => resolve_hash(req, &nested, depth + 1),
        // 裸包目标：从定义 imports 的包目录上溯 node_modules。
        TargetRef::Bare(bare) => resolve_bare(req, &root, &bare),
    }
}

/// 把字段匹配失败映射为共享诊断（code + importer/包根路径）。
fn map_failure(
    failure: FieldFailure,
    target: Target,
    spec: &str,
    path: &Path,
    invalid_code: &'static str,
) -> PackDiagnostic {
    match failure {
        FieldFailure::Encapsulated => diag(
            CODE_ENCAPSULATED,
            format!("`{spec}` 未被包 `exports` 导出，封装拒绝且不回退未导出路径"),
            path,
        ),
        FieldFailure::Undefined => {
            diag(CODE_NOT_FOUND, format!("`{spec}` 未在包 `imports` 中定义"), path)
        }
        FieldFailure::Forbidden => {
            diag(CODE_FORBIDDEN, format!("`{spec}` 的解析目标被 `null` 显式禁止"), path)
        }
        FieldFailure::NoApplicableCondition(keys) => diag(
            CODE_UNSUPPORTED_CONDITION,
            format!(
                "`{spec}` 对 target {target:?} 没有适用条件，激活条件 {:?}，目标可见键 {keys:?}",
                target.conditions()
            ),
            path,
        ),
        FieldFailure::Invalid(message) => diag(invalid_code, message, path),
    }
}

/// 拆分裸 specifier 为 (包目录段, 子路径)。子路径恒为 `"."` 或 `"./..."`。
fn split_package_specifier(
    spec: &str,
    importer: &Path,
) -> Result<(String, String), PackDiagnostic> {
    let mut segments = spec.split('/');
    let first = segments.next().unwrap_or_default();
    let pkg_name = if first.starts_with('@') {
        let scope = segments.next().filter(|part| !part.is_empty()).ok_or_else(|| {
            diag(CODE_INVALID_SPECIFIER, format!("scoped specifier 缺少包名段：`{spec}`"), importer)
        })?;
        format!("{first}/{scope}")
    } else {
        if first.is_empty() {
            return Err(diag(
                CODE_INVALID_SPECIFIER,
                format!("specifier 包名段为空：`{spec}`"),
                importer,
            ));
        }
        first.to_string()
    };
    let rest: Vec<&str> = segments.collect();
    let subpath = if rest.is_empty() { ".".to_string() } else { format!("./{}", rest.join("/")) };
    Ok((pkg_name, subpath))
}

/// 剥离 `?` 查询与 `#` 片段：模块身份是物理文件本身，两者不属于路径。
fn strip_query_and_fragment(spec: &str) -> &str {
    spec.find(|c| c == '?' || c == '#').map_or(spec, |index| &spec[..index])
}

/// 相对 specifier：`.`、`..`、`./`、`../` 前缀（作者面恒用 `/`）。
fn is_relative_spec(spec: &str) -> bool {
    spec == "." || spec == ".." || spec.starts_with("./") || spec.starts_with("../")
}

fn json_str(value: &json::Json) -> Option<&str> {
    value.as_str()
}

fn diag(code: &str, message: impl Into<String>, path: &Path) -> PackDiagnostic {
    PackDiagnostic::new(code, message).with_path(path.display().to_string())
}
