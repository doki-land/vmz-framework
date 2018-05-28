//! Virtual `#server/...` module IDs.
//!
//! Physical origin does not matter to callers:
//! - `src/server/db/users.ts` ?`#server/db/users`
//! - `src/components/UserCard.vmz` `<script server>` ?`#server/components/UserCard`

use std::path::{Path, PathBuf};

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
    for _ in i..from_parts.len() {
        out.push("..");
    }
    for p in &to_parts[i..] {
        out.push(*p);
    }
    if out.is_empty() { ".".into() } else { out.join("/") }
}

/// Rewrite `from '#server/...'` / `"#server/..."` to relative paths for Node ESM.
pub fn rewrite_imports_to_relative(js: &str, from_module_id: &str) -> String {
    let mut out = js.to_string();
    // Collect unique #server ids referenced in quotes.
    let mut ids = Vec::new();
    for (quote, rest) in [('"', js), ('\'', js)] {
        let _ = rest;
        let pattern_prefix = format!("{quote}{PREFIX}/");
        let mut search = js;
        while let Some(start) = search.find(&pattern_prefix) {
            let abs_start = js.len() - search.len() + start;
            let after = &js[abs_start + 1..];
            if let Some(end) = after.find(quote) {
                let id = &after[..end];
                if id.starts_with(PREFIX) && !ids.iter().any(|x: &String| x == id) {
                    ids.push(id.to_string());
                }
                search = &after[end + 1..];
            } else {
                break;
            }
        }
    }
    for id in ids {
        let rel = relative_import(from_module_id, &id);
        out = out.replace(&format!("\"{id}\""), &format!("\"{rel}\""));
        out = out.replace(&format!("'{id}'"), &format!("'{rel}'"));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_db_file() {
        let src = Path::new("app/src");
        let file = Path::new("app/src/server/db/users.ts");
        assert_eq!(id_from_src_path(src, file), "#server/db/users");
    }

    #[test]
    fn maps_component_vmz() {
        let src = Path::new("app/src");
        let file = Path::new("app/src/components/UserCard.vmz");
        assert_eq!(id_from_src_path(src, file), "#server/components/UserCard");
    }

    #[test]
    fn relative_from_component_to_db() {
        assert_eq!(
            relative_import("#server/components/UserCard", "#server/db/users"),
            "../db/users.js"
        );
    }

    #[test]
    fn rewrites_quoted_imports() {
        let js = r##"import { UsersRepository } from "#server/db/users";"##;
        let out = rewrite_imports_to_relative(js, "#server/components/UserCard");
        assert!(out.contains("\"../db/users.js\""));
        assert!(!out.contains("#server/db/users"));
    }
}
