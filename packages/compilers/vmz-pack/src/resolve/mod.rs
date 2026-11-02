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
/// Node.js 内建模块说明符（`node:` 前缀）：运行时提供的外部模块，无物理文件身份。
pub const CODE_NODE_BUILTIN: &str = "vmz::pack::resolve::node_builtin_external";

/// `node:` 前缀说明符是 Node.js 内建模块：打包层不解析为文件、不改写，
/// 发射时说明符文本原样保留，由运行时解析（`import('node:fs/promises')` 等
/// 仅在 Node 宿主求值的位置使用是本链支持的书写形态）。
pub fn is_node_builtin_specifier(specifier: &str) -> bool {
    specifier.strip_prefix("node:").is_some_and(|name| !name.is_empty())
}

/// Node 内建模块的裸名（`fs`、`util`、`stream` 等，含常见子路径根）。
/// CJS 包里大量裸名内建 require（无 `node:` 前缀）；仅在 Node target 上
/// 它们是运行时外部模块，Browser target 上不存在的名字必须走正常解析
/// （找不到即 `not_found`，或被包 `browser` 字段别名/`false` 拦截）。
pub fn is_node_builtin_name(specifier: &str) -> bool {
    let head = specifier.split('/').next().unwrap_or(specifier);
    matches!(
        head,
        "assert"
            | "async_hooks"
            | "buffer"
            | "child_process"
            | "cluster"
            | "console"
            | "constants"
            | "crypto"
            | "dgram"
            | "diagnostics_channel"
            | "dns"
            | "domain"
            | "events"
            | "fs"
            | "http"
            | "http2"
            | "https"
            | "inspector"
            | "module"
            | "net"
            | "os"
            | "path"
            | "perf_hooks"
            | "process"
            | "punycode"
            | "querystring"
            | "readline"
            | "repl"
            | "stream"
            | "string_decoder"
            | "sys"
            | "timers"
            | "tls"
            | "tty"
            | "url"
            | "util"
            | "v8"
            | "vm"
            | "wasi"
            | "worker_threads"
            | "zlib"
    )
}

/// 为 `node:` 内建说明符构造统一诊断：身份为「运行时外部模块」，不参与文件解析。
pub fn node_builtin_diagnostic(specifier: &str, importer: &Path) -> PackDiagnostic {
    diag(
        CODE_NODE_BUILTIN,
        format!("`{specifier}` 是 Node.js 内建模块，由运行时提供，打包层保留原文"),
        importer,
    )
}

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
    /// 导入方文件路径（用于相对解析与诊断归属）。
    pub importer: PathBuf,
    /// 目标平台（条件分流）。
    pub target: Target,
    /// 项目根（importer 上溯找不到时的兜底上溯点）。
    pub root: PathBuf,
    /// 投影来源：importer 是编译产物（如 `dist/components/Icon.client.js`）时，
    /// 其源文件（如 `node_modules/@vmz/ui/src/components/Icon.vmz`）的 canonical 路径。
    /// 裸说明符与 `#imports` 的包发现从**来源位置**起上溯——产物必须表现得像
    /// 模块仍住在源包里（与 Node 对符号链接包取 realpath 的语义一致）；
    /// 相对/绝对说明符仍按 importer（产物树）解析。
    pub origin: Option<PathBuf>,
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
    /// canonicalize 后的真实文件路径；stub 时是合成路径（不落盘）。
    pub path: PathBuf,
    /// 解析命中的包实例身份。
    pub package: Option<PackageIdentity>,
    /// `browser` 字段 `false` 目标的合成空模块（`module.exports = {}` 等价物）。
    pub stub: bool,
}

/// 模块格式：CJS 与 ESM 的图语义不同（CJS 经互操作壳发射）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ModuleFormat {
    /// ESM（含 VMZ 产物树：编译器发射恒为 ESM）。
    Esm,
    /// CommonJS：`require`/`module.exports` 语义，打包层装填互操作壳。
    Cjs,
}

/// 按 Node 规则判定依赖文件的模块格式：`.cjs` 恒 CJS，`.mjs` 恒 ESM，
/// 依赖树（路径含 `node_modules` 段）内 `.js` 随 owning `package.json`
/// 的 `type`（缺省即 CJS）；产物树与应用源（无 `node_modules` 段）恒 ESM。
pub fn module_format(file: &Path) -> ModuleFormat {
    match file.extension().and_then(|e| e.to_str()) {
        Some(ext) if ext.eq_ignore_ascii_case("cjs") => return ModuleFormat::Cjs,
        Some(ext) if ext.eq_ignore_ascii_case("mjs") => return ModuleFormat::Esm,
        _ => {}
    }
    let in_dependency_tree = file.components().any(|c| c.as_os_str() == "node_modules");
    if !in_dependency_tree {
        return ModuleFormat::Esm;
    }
    let Some(dir) = file.parent() else { return ModuleFormat::Esm };
    let Some(root) = walk::find_owning_package_root(dir) else { return ModuleFormat::Esm };
    let Ok(manifest) = Manifest::load(&root) else { return ModuleFormat::Esm };
    match manifest.field("type").and_then(json_str) {
        Some("module") => ModuleFormat::Esm,
        _ => ModuleFormat::Cjs,
    }
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
        return resolve_hash(req, spec, 0)
            .and_then(|resolved| apply_browser_path_alias(req, resolved));
    }
    // 身份规则：`?` 查询与 `#` 片段按首个出现处剥离，剥离后才是文件路径；
    // 裸包名段不含这两个字符，剥离发生在拆分包段之前（相对与子路径同样适用）。
    let spec = strip_query_and_fragment(spec);
    let importer_dir = req.importer.parent().unwrap_or_else(|| Path::new("."));
    // 包发现起点：投影产物按其来源位置上溯（源包自己的 node_modules 可见性），
    // 无来源信息时按 importer 自身位置上溯。
    let walk_dir = match req.origin.as_ref() {
        Some(origin) => origin.parent().unwrap_or(importer_dir),
        None => importer_dir,
    };
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
        let resolved = Resolved { path, package: None, stub: false };
        return apply_browser_path_alias(req, resolved);
    }
    resolve_bare(req, walk_dir, spec).and_then(|resolved| apply_browser_path_alias(req, resolved))
}

/// 裸 specifier：node_modules 上溯 → exports / legacy → 包实例身份。
/// Browser target 下先经 importer 所属包的 `browser` 对象字段分流说明符
/// （`fs: false` 这类内建 stub 在此生效）。
fn resolve_bare(
    req: &ResolveRequest,
    from_dir: &Path,
    spec: &str,
) -> Result<Resolved, PackDiagnostic> {
    if req.target == Target::Browser {
        if let Some(aliased) = browser_specifier_alias(req, from_dir, spec)? {
            return Ok(aliased);
        }
    }
    let (pkg_name, subpath) = split_package_specifier(spec, &req.importer)?;
    let dir = walk::find_package_dir(&pkg_name, from_dir)
        .or_else(|| walk::find_package_dir(&pkg_name, &req.root))
        .ok_or_else(|| {
            let origin_note = match req.origin.as_ref() {
                Some(origin) => format!("（投影来源 `{}` 的树上溯同样不可见）", origin.display()),
                None => String::new(),
            };
            diag(
                CODE_NOT_FOUND,
                format!(
                    "包 `{pkg_name}` 未在任何上溯层的 node_modules 中找到（自 `{}` 起）{origin_note}",
                    from_dir.display()
                ),
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

    Ok(Resolved { path, package: Some(identity), stub: false })
}

/// `browser` 对象字段的说明符级别名：在 importer 所属包（origin 投影时按来源
/// 位置的 owning 包）的 manifest 上精确命中说明符键时生效。值 `false` 合成
/// 空 stub，字符串为包内替换文件。仅 Browser target 调用。
fn browser_specifier_alias(
    req: &ResolveRequest,
    from_dir: &Path,
    spec: &str,
) -> Result<Option<Resolved>, PackDiagnostic> {
    let Some(pkg_dir) = walk::find_owning_package_root(from_dir) else { return Ok(None) };
    let Ok(manifest) = Manifest::load(&pkg_dir) else { return Ok(None) };
    let Some(map) = manifest.field("browser").and_then(|field| field.as_object()) else {
        return Ok(None);
    };
    let Some(value) = map.iter().find(|(key, _)| key == spec).map(|(_, value)| value) else {
        return Ok(None);
    };
    let root = std::fs::canonicalize(&pkg_dir).unwrap_or(pkg_dir.clone());
    let name = manifest.name().unwrap_or(spec);
    let identity = PackageIdentity {
        name: name.to_string(),
        root: root.clone(),
        version: manifest.version().map(str::to_string),
    };
    match value {
        json::Json::Bool(false) => Ok(Some(Resolved {
            path: browser_stub_path(&root, spec),
            package: Some(identity),
            stub: true,
        })),
        json::Json::Bool(true) => Err(diag(
            CODE_BAD_MANIFEST,
            format!("`browser` 字段 `{spec}` 的值不能为 true（只能为替换路径或 false）"),
            &root,
        )),
        json::Json::String(target) => {
            let path = files::resolve_file(&root.join(target)).ok_or_else(|| {
                diag(
                    CODE_NOT_FOUND,
                    format!("`browser` 字段 `{spec}` 的替换目标 `{target}` 未命中任何候选文件"),
                    &root,
                )
            })?;
            Ok(Some(Resolved { path, package: Some(identity), stub: false }))
        }
        _ => Ok(None),
    }
}

/// `browser` 对象字段的路径级别名：解析落点文件在其所属包的映射键
/// （`./lib/index.js` 形态）命中时替换为值文件或合成 stub。仅 Browser target。
fn apply_browser_path_alias(
    req: &ResolveRequest,
    resolved: Resolved,
) -> Result<Resolved, PackDiagnostic> {
    if req.target != Target::Browser || resolved.stub {
        return Ok(resolved);
    }
    let Some(parent) = resolved.path.parent() else { return Ok(resolved) };
    let Some(pkg_dir) = walk::find_owning_package_root(parent) else { return Ok(resolved) };
    let Ok(manifest) = Manifest::load(&pkg_dir) else { return Ok(resolved) };
    let Some(map) = manifest.field("browser").and_then(|field| field.as_object()) else {
        return Ok(resolved);
    };
    let root = std::fs::canonicalize(&pkg_dir).unwrap_or_else(|_| pkg_dir.clone());
    let Ok(rel) = resolved.path.strip_prefix(&root) else { return Ok(resolved) };
    // 键口径：`./` 前缀 + `/` 分隔（package.json 作者书写形态）。
    let key = format!("./{}", rel.to_string_lossy().replace('\\', "/"));
    let Some(value) = map.iter().find(|(name, _)| *name == key).map(|(_, value)| value) else {
        return Ok(resolved);
    };
    let identity = resolved.package.clone().or_else(|| {
        Some(PackageIdentity {
            name: manifest.name().unwrap_or_default().to_string(),
            root: root.clone(),
            version: manifest.version().map(str::to_string),
        })
    });
    match value {
        json::Json::Bool(false) => {
            Ok(Resolved { path: browser_stub_path(&root, &key), package: identity, stub: true })
        }
        json::Json::Bool(true) => Err(diag(
            CODE_BAD_MANIFEST,
            format!("`browser` 字段 `{key}` 的值不能为 true（只能为替换路径或 false）"),
            &root,
        )),
        json::Json::String(target) => {
            let path = files::resolve_file(&root.join(target)).ok_or_else(|| {
                diag(
                    CODE_NOT_FOUND,
                    format!("`browser` 字段 `{key}` 的替换目标 `{target}` 未命中任何候选文件"),
                    &root,
                )
            })?;
            Ok(Resolved { path, package: identity, stub: false })
        }
        _ => Ok(resolved),
    }
}

/// `browser` 字段 `false` 目标的合成 stub 路径（确定身份，不落盘）。
fn browser_stub_path(pkg_root: &Path, key: &str) -> PathBuf {
    let mut sanitized = String::new();
    for ch in key.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
            sanitized.push(ch);
        } else {
            sanitized.push('_');
        }
    }
    pkg_root.join(".vmz-browser-stub").join(format!("{sanitized}.cjs"))
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
/// 所属包按投影来源（无则 importer）的 owning package 判定。
fn resolve_hash(req: &ResolveRequest, spec: &str, depth: u32) -> Result<Resolved, PackDiagnostic> {
    if depth > MAX_IMPORTS_DEPTH {
        return Err(diag(
            CODE_BAD_MANIFEST,
            format!("`{spec}` 的 imports 解析超过 {MAX_IMPORTS_DEPTH} 层（疑似循环定义）"),
            &req.importer,
        ));
    }
    let importer_dir = req.importer.parent().unwrap_or_else(|| Path::new("."));
    let walk_dir = match req.origin.as_ref() {
        Some(origin) => origin.parent().unwrap_or(importer_dir),
        None => importer_dir,
    };
    let pkg_dir = walk::find_owning_package_root(walk_dir).ok_or_else(|| {
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
            Ok(Resolved { path, package: Some(identity), stub: false })
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
