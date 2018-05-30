//! Structured dependency keys for precise updates.
//!
//! Current emit still uses field-root strings; these types define the target IR
//! so compilers can migrate without inventing parallel shapes.

use std::fmt;

/// One segment under a reactive field root.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSeg {
    /// `.name`
    Ident(String),
    /// `[0]` — static index
    StaticIndex(usize),
    /// `[selected]` — dynamic index; the index symbol is a separate DepKey
    DynIndex(String),
}

/// Path under a component field, e.g. `user.address.city`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DepPath {
    pub root: String,
    pub segs: Vec<PathSeg>,
}

impl DepPath {
    pub fn field(root: impl Into<String>) -> Self {
        Self { root: root.into(), segs: Vec::new() }
    }

    pub fn prop(root: impl Into<String>, name: impl Into<String>) -> Self {
        Self { root: root.into(), segs: vec![PathSeg::Ident(name.into())] }
    }
}

/// Compile-time / runtime dependency key (target precision model).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum DepKey {
    /// Whole field (`count`) or conservative fallback.
    Field(String),
    /// Precise path (`user.name`).
    Path(DepPath),
    /// All paths under a field when only the subtree is known (`user.*`).
    FieldStar(String),
    /// `items[i].label` style (index may be static or named).
    IndexPath { root: String, index: PathSeg, segs: Vec<PathSeg> },
}

impl DepKey {
    pub fn field(name: impl Into<String>) -> Self {
        Self::Field(name.into())
    }

    pub fn path(path: DepPath) -> Self {
        if path.segs.is_empty() { Self::Field(path.root) } else { Self::Path(path) }
    }

    /// Stable string form for emit / runtime maps (`user.name`, `user.*`, `count`).
    pub fn to_stable_string(&self) -> String {
        match self {
            Self::Field(name) => name.clone(),
            Self::FieldStar(name) => format!("{name}.*"),
            Self::Path(p) => format_path(&p.root, &p.segs),
            Self::IndexPath { root, index, segs } => {
                let mut s = root.clone();
                s.push_str(&format_index(index));
                for seg in segs {
                    match seg {
                        PathSeg::Ident(n) => {
                            s.push('.');
                            s.push_str(n);
                        }
                        other => s.push_str(&format_index(other)),
                    }
                }
                s
            }
        }
    }

    /// Field root name for transitional runtimes that only schedule by field.
    pub fn root_field(&self) -> &str {
        match self {
            Self::Field(n) | Self::FieldStar(n) => n.as_str(),
            Self::Path(p) => p.root.as_str(),
            Self::IndexPath { root, .. } => root.as_str(),
        }
    }
}

impl fmt::Display for DepKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_stable_string())
    }
}

fn format_path(root: &str, segs: &[PathSeg]) -> String {
    let mut s = root.to_string();
    for seg in segs {
        match seg {
            PathSeg::Ident(n) => {
                s.push('.');
                s.push_str(n);
            }
            other => s.push_str(&format_index(other)),
        }
    }
    s
}

fn format_index(seg: &PathSeg) -> String {
    match seg {
        PathSeg::StaticIndex(n) => format!("[{n}]"),
        PathSeg::DynIndex(sym) => format!("[{sym}]"),
        PathSeg::Ident(n) => format!(".{n}"),
    }
}

/// Whether a write notice should wake a binder subscribed to `dep`.
/// Draft matching rules for write notices vs binder subscriptions.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteNotice {
    /// Whole field replaced: `this.user = …`
    Replace { root: String },
    /// Nested property write: `this.user.name = …`
    Path { root: String, segs: Vec<PathSeg> },
}

impl WriteNotice {
    pub fn matches(&self, dep: &DepKey) -> bool {
        match self {
            Self::Replace { root } => dep.root_field() == root,
            Self::Path { root: w_root, segs: w_segs } => match dep {
                // Bare field: replace-only (see 11 / list item precision).
                DepKey::Field(_) => false,
                DepKey::FieldStar(name) => name == w_root,
                DepKey::Path(p) => p.root == *w_root && path_is_prefix_or_equal(&p.segs, w_segs),
                DepKey::IndexPath { root, .. } => root == w_root,
            },
        }
    }
}

/// Binder path `user.name` wakes on write `user.name` or write under it?
/// Precision target: write `user.name` wakes Path(user.name);
/// write `user.address.city` does **not** wake Path(user.name).
/// Replace(user) wakes all.
/// For Path deps, wake iff write path equals dep path OR write is under dep path
/// (container used as value) — MVP: equal or write extends dep (dep is prefix of write).
fn path_is_prefix_or_equal(dep_segs: &[PathSeg], write_segs: &[PathSeg]) -> bool {
    if dep_segs.len() > write_segs.len() {
        return false;
    }
    dep_segs.iter().zip(write_segs.iter()).all(|(a, b)| a == b)
}
