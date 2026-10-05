use std::path::{Path, PathBuf};

use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", ".cache", "fixtures"];

#[derive(Debug, Clone, Default)]
pub struct DiscoverOptions {
    pub includes: Option<Vec<String>>,
    pub excludes: Option<Vec<String>>,
}

pub fn discover_format_targets(
    root: &Path,
    options: &DiscoverOptions,
) -> Result<Vec<PathBuf>, String> {
    let mut paths =
        if let Some(includes) = options.includes.as_ref().filter(|items| !items.is_empty()) {
            expand_includes(root, includes)?
        } else if let Some(includes) = read_biome_includes(root)? {
            expand_includes(root, &includes)?
        } else {
            discover_default_targets(root)?
        };

    if let Some(excludes) = options.excludes.as_ref().filter(|items| !items.is_empty()) {
        paths.retain(|path| !is_excluded(root, path, excludes));
    }

    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn read_biome_includes(root: &Path) -> Result<Option<Vec<String>>, String> {
    let biome_path = root.join("biome.json");
    if !biome_path.is_file() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&biome_path)
        .map_err(|err| format!("{}: {err}", biome_path.display()))?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("{}: {err}", biome_path.display()))?;
    let includes = value
        .pointer("/files/includes")
        .and_then(|v| v.as_array())
        .map(|items| {
            items.iter().filter_map(|item| item.as_str().map(str::to_string)).collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty());
    Ok(includes)
}

fn expand_includes(root: &Path, includes: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for pattern in includes {
        if pattern.ends_with("/**") {
            let dir = root.join(pattern.trim_end_matches("/**"));
            if dir.is_dir() {
                collect_tree(&dir, &mut paths);
            }
            continue;
        }
        if pattern.contains("**/metadata.json") {
            continue;
        }
        let candidate = root.join(pattern);
        if candidate.is_file() && is_format_target(&candidate) {
            paths.push(candidate);
        }
    }
    Ok(paths)
}

fn discover_default_targets(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();

    for segment in [
        "scripts",
        "packages/runtimes",
        "packages/examples",
        "packages/editors",
        "packages/ui",
        "packages/plugins",
        "packages/content",
        "packages/homepage",
    ] {
        let dir = root.join(segment);
        if dir.is_dir() {
            collect_tree(&dir, &mut paths);
        }
    }

    collect_root_sources(root, &mut paths);

    for name in ["package.json", "biome.json", "vmz.config.ts", "nifty.config.ts"] {
        let candidate = root.join(name);
        if candidate.is_file() && is_format_target(&candidate) {
            paths.push(candidate);
        }
    }

    if paths.is_empty() {
        collect_full_repo(root, &mut paths);
    }

    Ok(paths)
}

fn collect_root_sources(root: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.is_file() && is_format_target(&path) {
            out.push(path);
        }
    }
}

fn collect_full_repo(root: &Path, out: &mut Vec<PathBuf>) {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.iter().any(|skip| skip == &name)
        })
        .filter_map(Result::ok)
    {
        if entry.file_type().is_file() && is_format_target(entry.path()) {
            out.push(entry.path().to_path_buf());
        }
    }
}

fn collect_tree(root: &Path, out: &mut Vec<PathBuf>) {
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !SKIP_DIRS.iter().any(|skip| skip == &name)
        })
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path().to_path_buf();
        if is_format_target(&path) {
            out.push(path);
        }
    }
}

fn is_format_target(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("ts" | "mts" | "cts" | "js" | "mjs" | "cjs" | "jsx" | "tsx") => true,
        _ => false,
    }
}

pub fn layout_has_js_targets(root: &Path) -> bool {
    discover_format_targets(root, &DiscoverOptions::default())
        .map(|paths| !paths.is_empty())
        .unwrap_or(false)
}

fn is_excluded(root: &Path, path: &Path, excludes: &[String]) -> bool {
    let relative = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");
    excludes.iter().any(|pattern| glob_matches(&relative, pattern))
}

fn glob_matches(relative: &str, pattern: &str) -> bool {
    if let Some(suffix) = pattern.strip_prefix("**/") {
        if let Some(suffix) = suffix.strip_suffix("/**") {
            return relative == suffix
                || relative.starts_with(&format!("{suffix}/"))
                || relative.contains(&format!("/{suffix}/"));
        }
    }
    if pattern.ends_with("/**") {
        let prefix = pattern.trim_end_matches("/**");
        return relative == prefix || relative.starts_with(&format!("{prefix}/"));
    }
    relative == pattern
}

#[cfg(test)]
mod tests {
    use super::glob_matches;

    #[test]
    fn matches_nested_generated_directories() {
        assert!(glob_matches("packages/runtimes/vmz/dist/cli.js", "**/dist/**"));
        assert!(glob_matches("packages/ui/node_modules/pkg/index.js", "**/node_modules/**"));
        assert!(!glob_matches("packages/runtimes/vmz/src/cli.ts", "**/dist/**"));
    }
}
