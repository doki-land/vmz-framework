//! Structured dependency keys for precise updates.
//!
//! Current emit still uses field-root strings; these types define the target IR
//! so compilers can migrate without inventing parallel shapes.

use std::fmt;

/// One segment under a reactive field root.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum PathSegment {
    /// `.name` property access.
    Ident(String),
    /// `[0]` static numeric index.
    StaticIndex(usize),
    /// `[selected]` dynamic index; the index symbol is a separate DepKey.
    DynamicIndex(String),
}

/// Path under a component field, e.g. `user.address.city`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DepPath {
    /// Field root name (`user` in `user.address.city`).
    pub root: String,
    /// Segments after the root (idents and indexes).
    pub segments: Vec<PathSegment>,
}

impl DepPath {
    /// Path that is only the field root (no segments).
    pub fn field(root: impl Into<String>) -> Self {
        Self { root: root.into(), segments: Vec::new() }
    }

    /// Path `root.name` with a single ident segment.
    pub fn prop(root: impl Into<String>, name: impl Into<String>) -> Self {
        Self { root: root.into(), segments: vec![PathSegment::Ident(name.into())] }
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
    IndexPath {
        /// List field root.
        root: String,
        /// Static or dynamic index segment.
        index: PathSegment,
        /// Segments after the index.
        segments: Vec<PathSegment>,
    },
}

impl DepKey {
    /// Whole-field dependency on `name`.
    pub fn field(name: impl Into<String>) -> Self {
        Self::Field(name.into())
    }

    /// Collapse an empty [`DepPath`] to [`DepKey::Field`]; otherwise [`DepKey::Path`].
    pub fn path(path: DepPath) -> Self {
        if path.segments.is_empty() { Self::Field(path.root) } else { Self::Path(path) }
    }

    /// Stable string form for emit / runtime maps (`user.name`, `user.*`, `count`).
    pub fn to_stable_string(&self) -> String {
        match self {
            Self::Field(name) => name.clone(),
            Self::FieldStar(name) => format!("{name}.*"),
            Self::Path(p) => format_path(&p.root, &p.segments),
            Self::IndexPath { root, index, segments: segs } => {
                let mut s = root.clone();
                s.push_str(&format_index(index));
                for seg in segs {
                    match seg {
                        PathSegment::Ident(n) => {
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

fn format_path(root: &str, segs: &[PathSegment]) -> String {
    let mut s = root.to_string();
    for seg in segs {
        match seg {
            PathSegment::Ident(n) => {
                s.push('.');
                s.push_str(n);
            }
            other => s.push_str(&format_index(other)),
        }
    }
    s
}

fn format_index(seg: &PathSegment) -> String {
    match seg {
        PathSegment::StaticIndex(n) => format!("[{n}]"),
        PathSegment::DynamicIndex(sym) => format!("[{sym}]"),
        PathSegment::Ident(n) => format!(".{n}"),
    }
}

/// Write notice used to wake binders subscribed to a [`DepKey`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteNotice {
    /// Whole field replaced: `this.user = ...`
    Replace {
        /// Field root that was replaced.
        root: String,
    },
    /// Nested property write: `this.user.name = ...`
    Path {
        /// Field root of the write.
        root: String,
        /// Written path segments under `root`.
        segments: Vec<PathSegment>,
    },
}

impl WriteNotice {
    /// Whether a binder subscribed to `dep` should wake for this write.
    ///
    /// Replace wakes every dep under that root. Path writes wake FieldStar and
    /// Path/IndexPath deps when the write path equals or extends the dep path;
    /// a bare [`DepKey::Field`] only wakes on Replace (list-item precision).
    pub fn matches(&self, dep: &DepKey) -> bool {
        match self {
            Self::Replace { root } => dep.root_field() == root,
            Self::Path { root: w_root, segments: w_segs } => match dep {
                DepKey::Field(_) => false,
                DepKey::FieldStar(name) => name == w_root,
                DepKey::Path(p) => {
                    p.root == *w_root && path_is_prefix_or_equal(&p.segments, w_segs)
                }
                DepKey::IndexPath { root, .. } => root == w_root,
            },
        }
    }
}

/// True when `dep_segs` is a prefix of (or equal to) `write_segs`.
fn path_is_prefix_or_equal(dep_segs: &[PathSegment], write_segs: &[PathSegment]) -> bool {
    if dep_segs.len() > write_segs.len() {
        return false;
    }
    dep_segs.iter().zip(write_segs.iter()).all(|(a, b)| a == b)
}
