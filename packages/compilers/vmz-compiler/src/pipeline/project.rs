//! Discover and classify `.vmz` modules under a project root.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

/// Closed `.vmz` module kind — owned by `vmz-protocol` (wire / DX shared).
pub use vmz_protocol::VmzModuleKind;

/// Walk `root` (and convention component deps) for `.vmz` files with module kinds.
pub fn discover_vmz_files(root: impl AsRef<Path>) -> Vec<(PathBuf, VmzModuleKind)> {
    let root = root.as_ref();
    let mut out = Vec::new();
    let mut seen = BTreeSet::new();

    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| !should_skip_dir(e.path(), root))
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
            out.push((pb, classify(root, path)));
        }
    }

    // Direct deps that follow the same convention: `src/components/**/*.vmz`.
    // No package.json "componentsRoot" — convention over configuration.
    for (path, kind) in discover_dependency_components(root) {
        if seen.insert(path.clone()) {
            out.push((path, kind));
        }
    }

    out.sort_by(|a, b| a.0.cmp(&b.0));
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
        VmzModuleKind::App
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
fn discover_dependency_components(root: &Path) -> Vec<(PathBuf, VmzModuleKind)> {
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
        for entry in WalkDir::new(&components).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            if path.extension().and_then(|e| e.to_str()) != Some("vmz") {
                continue;
            }
            out.push((path.to_path_buf(), VmzModuleKind::Component));
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
