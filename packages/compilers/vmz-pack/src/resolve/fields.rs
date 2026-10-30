//! `exports` / `imports` 字段的子路径与条件匹配。
//!
//! # 条件取舍（与 `super` 模块文档一致，此处为实现级依据）
//!
//! - 条件**激活集合**由 [`super::Target`] 决定，**匹配顺序**是 package.json 中
//!   作者的书写顺序（Node 的 PACKAGE_TARGET_RESOLVE 按对象键顺序遍历，顺序
//!   是作者责任，解析器不重排）。
//! - `require` 不在任何激活集合内：本层为 ESM 模块图建立身份，CJS `require`
//!   分支被**跳过**并继续按作者顺序向后匹配（通常落到 `default`）；只有所有
//!   条件键都无一适用时才报 [`FieldFailure::NoApplicableCondition`]。
//! - `null` 目标 = 明确禁止：立即返回 [`FieldFailure::Forbidden`]，不继续向后、
//!   不回退。数组目标取第一个可解析项；数组中的 `null` 同样立即禁止；条件
//!   不适用的项跳过继续；空数组视为禁止。
//! - 条件一旦命中即选定（Node 口径）：目标文件随后不存在由调用方报
//!   `not_found`，不回溯其它条件。
//!
//! # 子路径匹配
//!
//! - 精确键优先；含 `*` 的 pattern 键按**最长前缀、再最长后缀**取胜
//!   （Node PATTERN_KEY_COMPARE 口径）；pattern 键只允许一个 `*`。
//! - `exports` 目标必须以 `./` 开头（包内相对），否则视为包配置非法；
//!   `imports` 目标可以是 `./` 包内路径、嵌套 `#` specifier 或裸包名。

use super::Target;
use super::json::Json;
use std::borrow::Borrow;

/// 字段匹配后的目标引用。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TargetRef {
    /// 包根相对路径（`./` 开头，pattern 的 `*` 已替换）。
    Relative(String),
    /// 裸包 specifier（仅 `imports` 目标允许）。
    Bare(String),
    /// 嵌套 `#` specifier（仅 `imports` 目标允许）。
    Hash(String),
}

/// 字段匹配失败；由调用方按上下文映射为 [`crate::diag::PackDiagnostic`]。
#[derive(Debug)]
pub(crate) enum FieldFailure {
    /// `exports` 存在但子路径未导出（封装拒绝）。
    Encapsulated,
    /// `#` specifier 未在 `imports` 中定义。
    Undefined,
    /// `null` 目标明确禁止。
    Forbidden,
    /// 条件对象存在但没有适用于当前 target 的条件键（附可见键名）。
    NoApplicableCondition(Vec<String>),
    /// 字段结构非法（code 由调用方按 exports/imports 上下文决定）。
    Invalid(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Exports,
    Imports,
}

/// 匹配 `exports` 的一个子路径（`"."` 或 `"./sub"`），返回包内目标引用。
pub(crate) fn match_exports(
    exports: &Json,
    subpath: &str,
    target: Target,
) -> Result<TargetRef, FieldFailure> {
    let entries = normalize_exports(exports)?;
    let Some((_, value, captured)) = best_key_match(&entries, subpath) else {
        return Err(FieldFailure::Encapsulated);
    };
    resolve_target(value, captured.as_deref(), target.conditions(), Mode::Exports)
}

/// 匹配 `imports` 的一个 `#` specifier，返回目标引用。
pub(crate) fn match_imports(
    imports: &Json,
    specifier: &str,
    target: Target,
) -> Result<TargetRef, FieldFailure> {
    let entries = imports
        .as_object()
        .ok_or_else(|| FieldFailure::Invalid("imports 字段必须是以 `#` 键开头的对象".into()))?;
    for (key, _) in entries {
        if !key.starts_with('#') {
            return Err(FieldFailure::Invalid(format!("imports 键必须以 `#` 开头：`{key}`")));
        }
        validate_pattern_key(key, "imports")?;
    }
    let Some((_, value, captured)) = best_key_match(entries, specifier) else {
        return Err(FieldFailure::Undefined);
    };
    resolve_target(value, captured.as_deref(), target.conditions(), Mode::Imports)
}

/// 把 `exports` 归一为 (子路径键, 目标) 列表。
///
/// - 字符串 / 数组 / 顶层 `null` → `{ ".": <exports> }` 语法糖。
/// - 对象且所有键以 `.` 开头 → 子路径表（键必须是 `.` 或 `./` 前缀）。
/// - 对象且所有键都不以 `.` 开头 → 条件语法糖（同上糖）。
/// - 混合键 → 非法。
fn normalize_exports(exports: &Json) -> Result<Vec<(String, &Json)>, FieldFailure> {
    match exports {
        Json::String(_) | Json::Array(_) | Json::Null => Ok(vec![(".".to_string(), exports)]),
        Json::Object(entries) => {
            if entries.is_empty() {
                return Ok(Vec::new());
            }
            let dot_keys = entries.iter().filter(|(key, _)| key.starts_with('.')).count();
            if dot_keys == entries.len() {
                for (key, _) in entries {
                    if key != "." && !key.starts_with("./") {
                        return Err(FieldFailure::Invalid(format!(
                            "exports 子路径键非法：`{key}`（必须是 `.` 或 `./` 前缀）"
                        )));
                    }
                    validate_pattern_key(key, "exports")?;
                }
                Ok(entries.iter().map(|(key, value)| (key.clone(), value)).collect())
            } else if dot_keys == 0 {
                Ok(vec![(".".to_string(), exports)])
            } else {
                Err(FieldFailure::Invalid(
                    "exports 不能在同一层混合子路径键（`.` / `./`）与条件键".into(),
                ))
            }
        }
        other => Err(FieldFailure::Invalid(format!("exports 字段类型非法：{}", type_name(other)))),
    }
}

fn validate_pattern_key(key: &str, field: &str) -> Result<(), FieldFailure> {
    if let Some(first) = key.find('*') {
        if key[first + 1..].contains('*') {
            return Err(FieldFailure::Invalid(format!("`{field}` 的键 `{key}` 只能包含一个 `*`")));
        }
    }
    Ok(())
}

/// 精确键优先；否则在含 `*` 的键中按最长前缀、再最长后缀选一个。
/// 返回 (键, 目标, pattern 捕获段)。
fn best_key_match<'a, T: Borrow<Json>>(
    entries: &'a [(String, T)],
    spec: &str,
) -> Option<(&'a str, &'a Json, Option<String>)> {
    for (key, value) in entries {
        if !key.contains('*') && key == spec {
            return Some((key.as_str(), value.borrow(), None));
        }
    }
    let mut best: Option<(usize, usize, &str, &Json, String)> = None;
    for (key, value) in entries {
        let Some((prefix, suffix)) = split_single_star(key) else {
            continue;
        };
        if spec.len() < prefix.len() + suffix.len()
            || !spec.starts_with(prefix)
            || !spec.ends_with(suffix)
        {
            continue;
        }
        let score = (prefix.len(), suffix.len());
        if best
            .as_ref()
            .is_none_or(|(best_prefix, best_suffix, ..)| score > (*best_prefix, *best_suffix))
        {
            let captured = spec[prefix.len()..spec.len() - suffix.len()].to_string();
            best = Some((score.0, score.1, key.as_str(), value.borrow(), captured));
        }
    }
    best.map(|(_, _, key, value, captured)| (key, value, Some(captured)))
}

fn split_single_star(key: &str) -> Option<(&str, &str)> {
    let star = key.find('*')?;
    let (prefix, rest) = key.split_at(star);
    let suffix = &rest[1..];
    if suffix.contains('*') {
        return None;
    }
    Some((prefix, suffix))
}

/// 按 Node PACKAGE_TARGET_RESOLVE 口径解析一个目标值。
fn resolve_target(
    value: &Json,
    captured: Option<&str>,
    active: &[&str],
    mode: Mode,
) -> Result<TargetRef, FieldFailure> {
    match value {
        Json::Null => Err(FieldFailure::Forbidden),
        Json::String(raw) => {
            let text = match captured {
                Some(cap) if raw.contains('*') => raw.replace('*', cap),
                _ => raw.clone(),
            };
            if text.starts_with("./") {
                return Ok(TargetRef::Relative(text));
            }
            match mode {
                Mode::Exports => {
                    Err(FieldFailure::Invalid(format!("exports 目标必须以 `./` 开头：`{text}`")))
                }
                Mode::Imports => {
                    if text.starts_with('#') {
                        Ok(TargetRef::Hash(text))
                    } else if text.starts_with("../") || text.starts_with('/') {
                        Err(FieldFailure::Invalid(format!("imports 目标不能越出包根：`{text}`")))
                    } else {
                        Ok(TargetRef::Bare(text))
                    }
                }
            }
        }
        Json::Array(items) => {
            if items.is_empty() {
                return Err(FieldFailure::Forbidden);
            }
            let mut pending: Vec<String> = Vec::new();
            for item in items {
                match resolve_target(item, captured, active, mode) {
                    Ok(hit) => return Ok(hit),
                    // 数组中的 `null` 立即禁止（Node：null 不是 undefined，不跳过）。
                    Err(FieldFailure::Forbidden) => return Err(FieldFailure::Forbidden),
                    // 条件不适用 → 跳过，尝试下一个数组项。
                    Err(FieldFailure::NoApplicableCondition(keys)) => pending.extend(keys),
                    Err(other) => return Err(other),
                }
            }
            Err(FieldFailure::NoApplicableCondition(pending))
        }
        Json::Object(conditions) => {
            let mut keys_seen = Vec::with_capacity(conditions.len());
            for (key, sub) in conditions {
                keys_seen.push(key.clone());
                // 激活集合按 Target 判定；顺序完全取作者书写顺序。
                if !active.contains(&key.as_str()) {
                    continue;
                }
                match resolve_target(sub, captured, active, mode) {
                    Ok(hit) => return Ok(hit),
                    Err(FieldFailure::Forbidden) => return Err(FieldFailure::Forbidden),
                    // 命中条件但内部无适用条件 → Node 同样继续向后（undefined → continue）。
                    Err(FieldFailure::NoApplicableCondition(_)) => continue,
                    Err(other) => return Err(other),
                }
            }
            Err(FieldFailure::NoApplicableCondition(keys_seen))
        }
        Json::Bool(_) | Json::Number(_) => Err(FieldFailure::Invalid(format!(
            "解析目标必须是字符串、数组、对象或 null，实际是 {}",
            type_name(value)
        ))),
    }
}

fn type_name(value: &Json) -> &'static str {
    match value {
        Json::Null => "null",
        Json::Bool(_) => "布尔",
        Json::Number(_) => "数字",
        Json::String(_) => "字符串",
        Json::Array(_) => "数组",
        Json::Object(_) => "对象",
    }
}
