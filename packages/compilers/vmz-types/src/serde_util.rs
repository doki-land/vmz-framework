//! Shared serde skip helpers for wire documents.
//!
//! Use these in `skip_serializing_if` so empty `null` / `""` / `[]` do not
//! clutter frontend payloads.
//!
//! Shape rules (see crate root):
//! - open label → `String`
//! - closed pure label → unit enum
//! - closed data → **tagged union** (`tag = "kind"`, or `tag` + `content` for newtypes)
//!
//! Naming (Rust is source of truth — avoid per-field `rename`):
//! - struct fields → `rename_all = "camelCase"`
//! - kind / tag enums → `rename_all = "kebab-case"`
//! - tagged-union fields → `rename_all_fields = "camelCase"` when needed
//!
//! If you find yourself writing `x.kind == …` then branching on fields, convert
//! `x` to a tagged union instead of `struct { kind: Enum, … }`.

/// True when the string is empty (skip `""` on the wire).
#[inline]
pub fn is_empty_str(s: &str) -> bool {
    s.is_empty()
}

/// True when the owned string is empty (skip `""` on the wire).
///
/// Takes `&String` (not `&str`) so it matches serde `skip_serializing_if` on `String` fields.
#[inline]
#[allow(clippy::ptr_arg)]
pub fn is_empty_string(s: &String) -> bool {
    s.is_empty()
}

/// True when the optional string is missing or empty.
#[inline]
pub fn is_none_or_empty_string(s: &Option<String>) -> bool {
    s.as_ref().is_none_or(|v| v.is_empty())
}
