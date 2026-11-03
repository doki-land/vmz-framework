//! Per-file `rustfmt` runner: explicit targets only, never `cargo fmt --all`.

use std::path::Path;
use std::process::Command;

/// Outcome of one `rustfmt` invocation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RustfmtOutcome {
    /// File already matched rustfmt output.
    Unchanged,
    /// File rewritten on disk (or would change in check mode).
    Changed,
}

/// Format exactly one `.rs` file with `rustfmt`.
///
/// `skip_children=true` keeps out-of-line `mod` children untouched so the run
/// can never escape the explicit target. The parse edition is read from the
/// nearest `Cargo.toml` (falling back to 2021), matching `cargo fmt` parsing
/// without inheriting its workspace-wide scope.
pub fn run_rustfmt_file(path: &Path, check: bool) -> Result<RustfmtOutcome, String> {
    let edition = detect_edition(path);
    let mut command = Command::new("rustfmt");
    command.arg("--edition").arg(&edition).arg("--config").arg("skip_children=true").arg(path);
    if check {
        command.arg("--check");
    }

    let before = if check { None } else { std::fs::read(path).ok() };
    let output = command.output().map_err(|err| format!("failed to run rustfmt: {err}"))?;

    if output.status.success() {
        if check {
            return Ok(RustfmtOutcome::Unchanged);
        }
        let after = std::fs::read(path).map_err(|err| format!("{}: {err}", path.display()))?;
        return Ok(if before.as_deref() == Some(after.as_slice()) {
            RustfmtOutcome::Unchanged
        } else {
            RustfmtOutcome::Changed
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if check && !stdout.trim().is_empty() {
        // `--check` prints the diff on stdout: non-zero exit plus a diff means
        // "would reformat", not an operational failure.
        return Ok(RustfmtOutcome::Changed);
    }
    Err(format!("rustfmt failed for {}:\n{stdout}{stderr}", path.display()))
}

/// Parse edition for `rustfmt` from the nearest `Cargo.toml`.
///
/// Handles `[package] edition`, `[workspace.package] edition`, and the
/// `edition.workspace = true` indirection (the dotted key never matches the
/// bare `edition` key, so the walk simply continues to the workspace root).
fn detect_edition(path: &Path) -> String {
    let mut dir = path.parent();
    while let Some(current) = dir {
        let manifest = current.join("Cargo.toml");
        if manifest.is_file() {
            if let Some(edition) = read_manifest_edition(&manifest) {
                return edition;
            }
        }
        dir = current.parent();
    }
    "2021".to_string()
}

fn read_manifest_edition(manifest: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(manifest).ok()?;
    let mut section = String::new();
    for line in raw.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            section = line.trim_matches(['[', ']']).trim().to_string();
            continue;
        }
        let Some((key, value)) = line.split_once('=') else { continue };
        if key.trim() != "edition" || (section != "package" && section != "workspace.package") {
            continue;
        }
        let edition = value.split('#').next().unwrap_or("").trim().trim_matches('"');
        if !edition.is_empty() {
            return Some(edition.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_package_edition() {
        let dir = std::env::temp_dir().join(format!("vmz-rustfmt-edition-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::write(dir.join("Cargo.toml"), "[package]\nedition = \"2024\"\n")
            .expect("manifest");
        let file = dir.join("lib.rs");
        std::fs::write(&file, "fn main() {}\n").expect("source");
        assert_eq!(detect_edition(&file), "2024");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn follows_workspace_inherited_edition() {
        let dir =
            std::env::temp_dir().join(format!("vmz-rustfmt-ws-edition-{}", std::process::id()));
        let member = dir.join("crates").join("a");
        std::fs::create_dir_all(&member).expect("member dir");
        std::fs::write(
            dir.join("Cargo.toml"),
            "[workspace]\nmembers = [\"crates/a\"]\n\n[workspace.package]\nedition = \"2024\"\n",
        )
        .expect("workspace manifest");
        std::fs::write(member.join("Cargo.toml"), "[package]\nedition.workspace = true\n")
            .expect("member manifest");
        let file = member.join("src").join("lib.rs");
        std::fs::create_dir_all(file.parent().unwrap()).expect("src dir");
        std::fs::write(&file, "fn main() {}\n").expect("source");
        assert_eq!(detect_edition(&file), "2024");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn defaults_to_2021_outside_cargo_projects() {
        let dir = std::env::temp_dir().join(format!("vmz-rustfmt-no-cargo-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("loose.rs");
        std::fs::write(&file, "fn main() {}\n").expect("source");
        assert_eq!(detect_edition(&file), "2021");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
