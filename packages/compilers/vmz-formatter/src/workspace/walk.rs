use std::path::{Path, PathBuf};

use boost_fs::walk::{Filter, Walker};

const SKIP_DIRS: &[&str] = &["node_modules", "target", ".git", "dist", ".cache", "fixtures"];

fn skip_dir(entry: &boost_fs::walk::Entry) -> Filter {
    let name = entry.file_name().to_string_lossy();
    if SKIP_DIRS.iter().any(|skip| skip == &name) {
        return Filter::IgnoreFolder;
    }
    Filter::Continue
}

/// JS/TS files under one explicit directory target.
///
/// The walk never escapes `root`: scope comes from the CLI path, not from
/// config `includes`.
pub fn discover_js_targets_under(root: &Path, excludes: &[String]) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    collect_tree(root, &mut paths);
    paths.retain(|path| !is_excluded(root, path, excludes));
    paths.sort();
    paths.dedup();
    Ok(paths)
}

/// `.rs` files under one explicit directory target (only with `rust` opt-in).
pub fn discover_rust_targets_under(
    root: &Path,
    excludes: &[String],
) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in Walker::new(root).filter(skip_dir).into_iter().filter_map(Result::ok) {
        if !entry.is_file() {
            continue;
        }
        let path = entry.path().to_path_buf();
        if path.extension().and_then(|ext| ext.to_str()) == Some("rs") {
            paths.push(path);
        }
    }
    paths.retain(|path| !is_excluded(root, path, excludes));
    paths.sort();
    paths.dedup();
    Ok(paths)
}

fn collect_tree(root: &Path, out: &mut Vec<PathBuf>) {
    for entry in Walker::new(root).filter(skip_dir).into_iter().filter_map(Result::ok) {
        if !entry.is_file() {
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
