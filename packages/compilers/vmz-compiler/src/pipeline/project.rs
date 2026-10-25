//! Discover and classify `.vmz` modules under a project root.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use boost_fs::walk::{Filter, Walker};

/// Closed `.vmz` module kind — owned by `vmz-protocol` (wire / DX shared).
pub use vmz_protocol::VmzModuleKind;

/// Where a discovered `.vmz` unit comes from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VmzUnitOrigin {
    /// Under the application root.
    Project,
    /// Convention component discovered from a dependency package.
    Dependency {
        /// Dependency package name as declared in the app `package.json`.
        package: String,
        /// Resolved package root.
        root: PathBuf,
    },
}

impl VmzUnitOrigin {
    /// `true` when the unit belongs to the application itself.
    pub fn is_project(&self) -> bool {
        matches!(self, Self::Project)
    }
}

/// One discovered `.vmz` unit with its application/dependency origin.
#[derive(Debug, Clone)]
pub struct VmzUnit {
    /// Absolute or root-relative `.vmz` path.
    pub path: PathBuf,
    /// Closed module kind.
    pub kind: VmzModuleKind,
    /// Application or dependency origin.
    pub origin: VmzUnitOrigin,
}

/// Walk `root` (and convention component deps) for `.vmz` files with module kinds.
pub fn discover_vmz_files(root: impl AsRef<Path>) -> Vec<(PathBuf, VmzModuleKind)> {
    discover_vmz_units(root).into_iter().map(|unit| (unit.path, unit.kind)).collect()
}

/// Walk `root` and convention component deps, keeping project/dependency origin.
pub fn discover_vmz_units(root: impl AsRef<Path>) -> Vec<VmzUnit> {
    let root = root.as_ref();
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();
    let walk_root = root.to_path_buf();

    for entry in Walker::new(root)
        .filter(move |entry| {
            if should_skip_dir(entry.path(), &walk_root) {
                Filter::IgnoreFolder
            } else {
                Filter::Continue
            }
        })
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("vmz") {
            continue;
        }
        let pb = path.to_path_buf();
        if seen.insert(pb.clone()) {
            out.push(VmzUnit {
                kind: classify(root, path),
                path: pb,
                origin: VmzUnitOrigin::Project,
            });
        }
    }

    // Direct deps that follow the same convention: `src/components/**/*.vmz`.
    // No package.json "componentsRoot" — convention over configuration.
    for unit in discover_dependency_units(root) {
        if seen.insert(unit.path.clone()) {
            out.push(unit);
        }
    }

    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn should_skip_dir(path: &Path, root: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(root) else {
        return false;
    };
    let s = rel.to_string_lossy().replace('\\', "/");
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    matches!(name, "node_modules" | "dist" | "target" | ".git" | ".turbo" | "coverage")
        || s.split('/').any(|p| matches!(p, "node_modules" | "dist" | "target" | ".git"))
}

fn classify(root: &Path, path: &Path) -> VmzModuleKind {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let s = rel.to_string_lossy().replace('\\', "/");
    if is_application_shell(&s) {
        VmzModuleKind::Application
    } else if s.contains("/pages/") {
        VmzModuleKind::Page
    } else if s.contains("/components/") {
        VmzModuleKind::Component
    } else {
        VmzModuleKind::Other
    }
}

/// Root shell: `Application.vmz` (canonical). Also accepts `App.vmz` / legacy `app.vmz`.
fn is_application_shell(rel: &str) -> bool {
    let lower = rel.to_ascii_lowercase();
    lower == "application.vmz"
        || lower.ends_with("/application.vmz")
        || lower.ends_with("/src/application.vmz")
        || lower == "app.vmz"
        || lower.ends_with("/app.vmz")
        || lower.ends_with("/src/app.vmz")
}

/// Discover components from direct dependencies that keep the hard convention
/// `src/components/**/*.vmz` (same as application packages).
fn discover_dependency_units(root: &Path) -> Vec<VmzUnit> {
    let pkg_path = root.join("package.json");
    let Ok(text) = fs::read_to_string(&pkg_path) else {
        return Vec::new();
    };
    let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&text) else {
        return Vec::new();
    };

    let mut names = BTreeSet::new();
    for key in ["dependencies", "devDependencies"] {
        if let Some(obj) = pkg.get(key).and_then(|v| v.as_object()) {
            for name in obj.keys() {
                names.insert(name.clone());
            }
        }
    }

    let mut out = Vec::new();
    for name in names {
        let Some(pkg_root) = resolve_dependency_root(root, &name) else {
            continue;
        };
        let components = pkg_root.join("src").join("components");
        if !components.is_dir() {
            continue;
        }
        for entry in Walker::new(&components).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("vmz") {
                continue;
            }
            out.push(VmzUnit {
                path: path.to_path_buf(),
                kind: VmzModuleKind::Component,
                origin: VmzUnitOrigin::Dependency { package: name.clone(), root: pkg_root.clone() },
            });
        }
    }
    out
}

fn resolve_dependency_root(app_root: &Path, name: &str) -> Option<PathBuf> {
    let mut candidate = app_root.join("node_modules");
    for part in name.split('/') {
        candidate = candidate.join(part);
    }
    if candidate.join("package.json").is_file() {
        return Some(candidate);
    }
    // pnpm may hoist to the workspace root.
    let mut cur = app_root.parent();
    while let Some(dir) = cur {
        let mut c = dir.join("node_modules");
        for part in name.split('/') {
            c = c.join(part);
        }
        if c.join("package.json").is_file() {
            return Some(c);
        }
        if dir.join("pnpm-workspace.yaml").is_file() || dir.join("pnpm-workspace.yml").is_file() {
            break;
        }
        cur = dir.parent();
    }
    None
}
