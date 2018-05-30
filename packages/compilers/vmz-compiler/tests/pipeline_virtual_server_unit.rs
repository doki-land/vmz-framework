//! Moved from `src/pipeline/virtual_server.rs` (cargo-cry: tests next to Cargo.toml).

use std::path::Path;

use vmz_compiler::pipeline::virtual_server::*;

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
