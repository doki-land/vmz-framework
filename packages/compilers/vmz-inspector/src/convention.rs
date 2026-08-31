//! Soft convention lints (advice-level).
//! Does not change semantics; default Warning for vmz lint / --deny-warnings.

use std::path::Path;

use vmz_compiler::{CheckReport, ReportedDiagnostic, VmzModuleKind, discover_vmz_files};

/// Route-group boundary role filenames (hard set; lowercase variants are not roles).
pub const BOUNDARY_ROLE_FILES: &[&str] =
    &["Layout.vmz", "Loading.vmz", "Error.vmz", "NotFound.vmz"];

pub fn lint_project(root: &Path, report: &mut CheckReport) {
    for (path, kind) in discover_vmz_files(root) {
        lint_discovered(&path, kind, report);
    }
}

pub fn lint_file(path: &Path, report: &mut CheckReport) {
    let kind = classify_loose(path);
    lint_discovered(path, kind, report);
}

fn classify_loose(path: &Path) -> VmzModuleKind {
    let s = path.to_string_lossy().replace('\\', "/");
    if s.ends_with("/Application.vmz") {
        VmzModuleKind::Application
    } else if s.contains("/pages/") {
        VmzModuleKind::Page
    } else if s.contains("/components/") {
        VmzModuleKind::Component
    } else {
        VmzModuleKind::Other
    }
}

fn lint_discovered(path: &Path, kind: VmzModuleKind, report: &mut CheckReport) {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return;
    };
    let rel = path.to_string_lossy().replace('\\', "/");

    lint_legacy_root_shell(path, name, &rel, report);
    lint_page_index_case(path, kind, name, report);
    lint_named_layout_suffix(path, name, &rel, report);
    lint_non_pascal_component(path, kind, name, report);
}

fn lint_legacy_root_shell(path: &Path, name: &str, rel: &str, report: &mut CheckReport) {
    let is_rootish = rel.ends_with("/src/app.vmz")
        || rel.ends_with("/src/App.vmz")
        || name.eq_ignore_ascii_case("app.vmz");
    if is_rootish && !name.eq_ignore_ascii_case("application.vmz") {
        report
            .diagnostics
            .push(ReportedDiagnostic::warning(path, "vmz::convention::prefer_application_shell"));
    }
}

fn lint_page_index_case(path: &Path, kind: VmzModuleKind, name: &str, report: &mut CheckReport) {
    if kind != VmzModuleKind::Page {
        return;
    }
    if name == "index.vmz" {
        report
            .diagnostics
            .push(ReportedDiagnostic::warning(path, "vmz::convention::prefer_pascal_index"));
    }
}

fn lint_named_layout_suffix(path: &Path, name: &str, rel: &str, report: &mut CheckReport) {
    if !rel.contains("/layouts/") {
        return;
    }
    // Group boundary role name `Layout.vmz` is exact; named layouts should use *Layout.
    if BOUNDARY_ROLE_FILES.contains(&name) {
        return;
    }
    if !name.ends_with(".vmz") {
        return;
    }
    let stem = &name[..name.len() - 4];
    if layout_suffix_stem(stem) {
        return;
    }
    report.diagnostics.push(
        ReportedDiagnostic::warning(path, "vmz::convention::layout_suffix")
            .with_arg("stem", stem.to_string()),
    );
}

/// `AccountLayout` / `DocsLayout` / bare `Layout` → true.
pub fn layout_suffix_stem(stem: &str) -> bool {
    stem == "Layout" || stem.ends_with("Layout")
}

fn lint_non_pascal_component(
    path: &Path,
    kind: VmzModuleKind,
    name: &str,
    report: &mut CheckReport,
) {
    if !matches!(kind, VmzModuleKind::Component | VmzModuleKind::Page) {
        return;
    }
    if !name.ends_with(".vmz") {
        return;
    }
    let stem = &name[..name.len() - 4];
    // Dynamic segments keep bracket syntax.
    if stem.starts_with('[') {
        return;
    }
    if is_pascal_case_stem(stem) {
        return;
    }
    // Soft under lint: hard PascalCase enforcement for check is separate / future.
    report.diagnostics.push(
        ReportedDiagnostic::warning(path, "vmz::convention::pascal_case_file")
            .with_arg("name", name.to_string())
            .with_arg("hint", to_pascal_hint(stem)),
    );
}

fn is_pascal_case_stem(stem: &str) -> bool {
    let mut chars = stem.chars();
    match chars.next() {
        Some(c) if c.is_ascii_uppercase() => stem.chars().all(|c| c.is_ascii_alphanumeric()),
        _ => false,
    }
}

fn to_pascal_hint(stem: &str) -> String {
    let mut out = String::new();
    let mut cap = true;
    for c in stem.chars() {
        if c == '-' || c == '_' {
            cap = true;
            continue;
        }
        if cap {
            out.extend(c.to_uppercase());
            cap = false;
        } else {
            out.push(c);
        }
    }
    if out.is_empty() { "Name".into() } else { format!("{out}.vmz") }
}
