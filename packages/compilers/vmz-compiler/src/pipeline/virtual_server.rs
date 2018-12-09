//! Virtual `#server/...` module IDs.
//!
//! Physical origin does not matter to callers:
//! - `src/server/db/users.ts` ?`#server/db/users`
//! - `src/components/UserCard.vmz` `<script server>` ?`#server/components/UserCard`

use std::path::{Path, PathBuf};

/// Virtual module id prefix for server modules (`#server/...`).
pub const PREFIX: &str = "#server";

/// Map a filesystem path under a project `src/` (or project root) to a `#server/...` id.
pub fn id_from_src_path(project_src: &Path, file: &Path) -> String {
    let rel = file.strip_prefix(project_src).unwrap_or(file).with_extension("");
    let mut parts = Vec::new();
    for c in rel.components() {
        let s = c.as_os_str().to_string_lossy();
        if s == "server" {
            // `src/server/db/users` ?`#server/db/users` (drop the extra "server" segment)
            continue;
        }
        parts.push(s.replace('\\', "/"));
    }
    format!("{PREFIX}/{}", parts.join("/"))
}

/// `#server/db/users` ?relative path candidates under src.
pub fn candidates_from_id(id: &str) -> Vec<PathBuf> {
    let rest = id.strip_prefix(PREFIX).unwrap_or(id).trim_start_matches('/');
    vec![
        PathBuf::from("server").join(rest).with_extension("ts"),
        PathBuf::from("server").join(rest).with_extension("js"),
        PathBuf::from(rest).with_extension("vmz"),
        PathBuf::from(rest).join("index.vmz"),
    ]
}

/// `#server/a/b` importing `#server/x/y` ?relative specifier ending in `.vmz-runtime`.
pub fn relative_import(from_id: &str, to_id: &str) -> String {
    let from = from_id.strip_prefix(PREFIX).unwrap_or(from_id).trim_start_matches('/');
    let to = to_id.strip_prefix(PREFIX).unwrap_or(to_id).trim_start_matches('/');
    let from_dir = Path::new(from).parent().unwrap_or(Path::new(""));
    let target = Path::new(to).with_extension("js");
    let rel = pathdiff_fallback(from_dir, &target);
    if rel.starts_with('.') { rel } else { format!("./{rel}") }
}

fn pathdiff_fallback(from_dir: &Path, target: &Path) -> String {
    let from_parts: Vec<_> = from_dir
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .filter(|s| !s.is_empty())
        .collect();
    let to_parts: Vec<_> = target.components().filter_map(|c| c.as_os_str().to_str()).collect();
    let mut i = 0;
    while i < from_parts.len() && i < to_parts.len() && from_parts[i] == to_parts[i] {
        i += 1;
    }
    let mut out = Vec::new();
    out.extend(std::iter::repeat_n("..", from_parts.len() - i));
    for p in &to_parts[i..] {
        out.push(*p);
    }
    if out.is_empty() { ".".into() } else { out.join("/") }
}

/// Rewrite `from '#server/...'` / `"#server/..."` to relative paths for Node ESM (oxc AST).
pub fn rewrite_imports_to_relative(js: &str, from_module_id: &str) -> String {
    let from = from_module_id.to_string();
    vmz_generator::js::rewrite_module_specifiers_required(
        js,
        |spec| {
            if spec.starts_with(PREFIX) { Some(relative_import(&from, spec)) } else { None }
        },
        "virtual_server::rewrite_imports_to_relative",
    )
}
