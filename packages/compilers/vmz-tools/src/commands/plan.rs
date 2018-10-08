//! `vmz plan` — dump frozen Rust plans as canonical JSON (CLI ≡ N-API).

use std::path::PathBuf;

use clap::{Args as ClapArgs, Subcommand};
use vmz_compiler::Result;

/// Arguments for `vmz plan`.
#[derive(Debug, ClapArgs)]
pub struct Args {
    /// Plan kind to dump.
    #[command(subcommand)]
    pub kind: PlanKind,
}

/// Which frozen plan to emit as canonical JSON on stdout.
#[derive(Debug, Subcommand)]
pub enum PlanKind {
    /// `locales/locales.json5` → LocalePlan.
    Locale {
        /// Project root containing `locales/`.
        #[arg(default_value = ".")]
        root: PathBuf,
    },
    /// `documents/documents.config.*` → DocumentRoutePlan.
    #[command(name = "document-route")]
    DocumentRoute {
        /// Project root containing `documents/`.
        #[arg(default_value = ".")]
        root: PathBuf,
    },
}

/// Print the requested plan as pretty canonical JSON (same bytes as N-API `to_json`).
pub fn run(args: Args) -> Result<()> {
    match args.kind {
        PlanKind::Locale { root } => {
            let plan = vmz_compiler::locale::load_locale_plan(root);
            print!("{}", plan.to_json());
        }
        PlanKind::DocumentRoute { root } => {
            let plan = vmz_compiler::document::load_document_route_plan(root);
            print!("{}", plan.to_json());
        }
    }
    Ok(())
}

/// Canonical JSON for a project locale plan (shared by CLI and N-API).
pub fn locale_plan_json(root: impl AsRef<std::path::Path>) -> String {
    vmz_compiler::locale::load_locale_plan(root).to_json()
}

/// Canonical JSON for a project document-route plan (shared by CLI and N-API).
pub fn document_route_plan_json(root: impl AsRef<std::path::Path>) -> String {
    vmz_compiler::document::load_document_route_plan(root).to_json()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locale_plan_json_matches_compiler_to_json() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../homepage")
            .canonicalize()
            .expect("homepage root");
        let via_helper = locale_plan_json(&root);
        let via_compiler = vmz_compiler::locale::load_locale_plan(&root).to_json();
        assert_eq!(via_helper, via_compiler);
        assert!(via_helper.contains("schema"), "{via_helper}");
    }
}
