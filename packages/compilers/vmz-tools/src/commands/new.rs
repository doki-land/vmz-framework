//! `vmz new` / `vmz init` — minimal application scaffold.

use std::fs;
use std::path::{Path, PathBuf};

use clap::Args as ClapArgs;
use vmz_compiler::{Result, ResultExt, bail};

#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Directory name for the new app (single path segment)
    pub dir: PathBuf,
}

fn is_safe_dir_name(name: &str) -> bool {
    if name.is_empty() || name == "." || name == ".." {
        return false;
    }
    if name.contains('/') || name.contains('\\') {
        return false;
    }
    if name == "node_modules" || name == "dist" {
        return false;
    }
    name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn pkg_name_from_dir(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    if s.is_empty() { "vmz-app".into() } else { s }
}

fn write_file(path: &Path, contents: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create directory {}", parent.display()))?;
    }
    fs::write(path, contents).with_context(|| format!("write {}", path.display()))
}

pub fn run(args: Args) -> Result<()> {
    let name = args.dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
    // Require a single segment relative name (not `foo/bar` or absolute).
    if args.dir.components().count() != 1 || !is_safe_dir_name(name) {
        bail!("usage: vmz new <dir>\n`<dir>` must be a single path segment (e.g. my-app).");
    }

    let cwd = std::env::current_dir().context("current directory")?;
    let target = cwd.join(name);

    if target.exists() {
        let has_project = target.join("package.json").exists() || target.join("src").exists();
        if has_project {
            bail!("refusing to overwrite existing project at {}", target.display());
        }
    }

    fs::create_dir_all(target.join("src/pages"))
        .with_context(|| format!("create {}", target.join("src/pages").display()))?;
    fs::create_dir_all(target.join("designs"))
        .with_context(|| format!("create {}", target.join("designs").display()))?;

    let pkg_name = pkg_name_from_dir(name);
    let vmz_version = format!("^{}", env!("CARGO_PKG_VERSION"));

    let package_json = format!(
        r#"{{
    "name": "{pkg_name}",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "scripts": {{
        "check": "vmz check .",
        "build": "vmz build .",
        "dev": "vmz dev ."
    }},
    "devDependencies": {{
        "vmz": "{vmz_version}"
    }}
}}
"#
    );

    write_file(target.join("package.json").as_path(), &package_json)?;
    write_file(
        target.join("src/Application.vmz").as_path(),
        r#"<template>
  <slot />
</template>

<script client>
// Root shell. Pages under `pages/` are routed automatically.
export default class Application {}
</script>
"#,
    )?;
    write_file(
        target.join("src/pages/index.vmz").as_path(),
        r#"<template>
  <main>
    <h1>Hello, VMZ</h1>
  </main>
</template>

<script client>
// `pages/index.vmz` → `/`
export default class IndexPage {}
</script>
"#,
    )?;
    write_file(
        target.join("designs/README.md").as_path(),
        r#"# designs

Design tokens and theme sources for this app. See VMZ style docs.
"#,
    )?;
    write_file(target.join(".gitignore").as_path(), "node_modules/\ndist/\n")?;

    println!("Created {pkg_name} at {}", target.display());
    println!();
    println!("Next:");
    println!("  cd {name}");
    println!("  pnpm install");
    println!("  pnpm exec vmz check");
    Ok(())
}
