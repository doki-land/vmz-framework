//! Affected deployment units from dirty sources (dirty sources).
//!
//! HMR / rebuild minimum unit comes from VPG/Deployment
//! reachability. Leaf `.vmz` dirt expands through **template component reverse edges**.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::dep_graph::ComponentGraph;
use crate::project::{VmzModuleKind, discover_vmz_files};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AffectedUnit {
    pub source: PathBuf,
    pub kind: VmzModuleKind,
    pub chunk_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AffectedPlan {
    /// True when this is a full project rebuild.
    pub full: bool,
    pub rebuild_runtime: bool,
    pub rebuild_server_tree: bool,
    pub units: Vec<AffectedUnit>,
    /// Seed chunks before reverse-edge expansion (for HMR diagnostics).
    pub seed_chunks: Vec<String>,
}

impl AffectedPlan {
    pub fn sources(&self) -> impl Iterator<Item = &Path> {
        self.units.iter().map(|u| u.source.as_path())
    }

    /// True when every affected unit is a `components/*` chunk (island-friendly HMR).
    pub fn island_only(&self) -> bool {
        !self.full
            && !self.units.is_empty()
            && self.units.iter().all(|u| {
                matches!(u.kind, VmzModuleKind::Component) || u.chunk_id.starts_with("components/")
            })
    }

    // DX document (`vmz.dx.affected.v0`).
    pub fn to_dx_document(&self) -> vmz_protocol::AffectedDocument {
        use crate::project::VmzModuleKind;
        vmz_protocol::AffectedDocument {
            schema: vmz_protocol::AFFECTED_SCHEMA.into(),
            full: self.full,
            rebuild_runtime: self.rebuild_runtime,
            rebuild_server_tree: self.rebuild_server_tree,
            units: self
                .units
                .iter()
                .map(|u| vmz_protocol::AffectedUnitDoc {
                    source: u.source.to_string_lossy().replace('\\', "/"),
                    kind: match u.kind {
                        VmzModuleKind::Page => "page",
                        VmzModuleKind::Component => "component",
                        VmzModuleKind::App => "app",
                        VmzModuleKind::Other => "other",
                    }
                    .into(),
                    chunk_id: u.chunk_id.clone(),
                })
                .collect(),
            seed_chunks: self.seed_chunks.clone(),
            island_only: self.island_only(),
        }
    }
}

/// Map dirty paths to the minimal set of deployable units that must be re-emitted.
pub fn plan_affected(root: &Path, dirty: &[PathBuf]) -> AffectedPlan {
    let src_root = if root.join("src").is_dir() { root.join("src") } else { root.to_path_buf() };

    let all = discover_vmz_files(root);
    let catalog: Vec<(PathBuf, VmzModuleKind, String)> =
        all.iter().map(|(p, k)| (p.clone(), *k, chunk_id_for(&src_root, p))).collect();
    let graph = ComponentGraph::build(&src_root, &catalog);

    if dirty.is_empty() {
        return full_plan_from_catalog(&catalog, true);
    }

    let mut seeds = Vec::new();
    let mut seen = HashSet::new();
    let mut rebuild_server_tree = false;
    let mut unknown = false;

    for d in dirty {
        let abs = if d.is_absolute() { d.clone() } else { root.join(d) };
        let norm = abs.to_string_lossy().replace('\\', "/");

        if is_under(&abs, &src_root.join("server"))
            || norm.contains("/src/server/")
            || norm.ends_with("/src/server")
        {
            rebuild_server_tree = true;
            continue;
        }

        // `/designs` is style-core input — any dirt forces a full rebuild.
        if is_under(&abs, &root.join("designs"))
            || norm.contains("/designs/")
            || norm.ends_with("/designs")
        {
            return full_plan_from_catalog(&catalog, false);
        }

        if abs.extension().and_then(|e| e.to_str()) == Some("vmz") {
            if let Some((path, kind, chunk)) = catalog.iter().find(|(p, _, _)| paths_eq(p, &abs)) {
                if seen.insert(chunk.clone()) {
                    seeds.push(AffectedUnit {
                        chunk_id: chunk.clone(),
                        source: path.clone(),
                        kind: *kind,
                    });
                }
                continue;
            }
        }

        if is_under(&abs, &src_root) {
            if let Some((path, kind, chunk)) = catalog.iter().find(|(p, _, _)| {
                p.parent() == abs.parent()
                    && p.file_stem() == abs.file_stem()
                    && p.extension().and_then(|e| e.to_str()) == Some("vmz")
            }) {
                if seen.insert(chunk.clone()) {
                    seeds.push(AffectedUnit {
                        chunk_id: chunk.clone(),
                        source: path.clone(),
                        kind: *kind,
                    });
                }
                continue;
            }
            if abs.extension().and_then(|e| e.to_str()) == Some("txt")
                || abs.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with('.'))
            {
                continue;
            }
            unknown = true;
            break;
        }

        unknown = true;
        break;
    }

    if unknown {
        return full_plan_from_catalog(&catalog, false);
    }

    let seed_chunks: Vec<String> = seeds.iter().map(|u| u.chunk_id.clone()).collect();
    let expanded_ids = graph.expand_importers(seed_chunks.iter().cloned());

    let mut units = Vec::new();
    let mut unit_seen = HashSet::new();
    for (path, kind, chunk) in &catalog {
        if expanded_ids.contains(chunk) && unit_seen.insert(chunk.clone()) {
            units.push(AffectedUnit { source: path.clone(), kind: *kind, chunk_id: chunk.clone() });
        }
    }
    // Keep stable order by chunk_id.
    units.sort_by(|a, b| a.chunk_id.cmp(&b.chunk_id));

    AffectedPlan { full: false, rebuild_runtime: false, rebuild_server_tree, units, seed_chunks }
}

fn full_plan_from_catalog(
    catalog: &[(PathBuf, VmzModuleKind, String)],
    rebuild_runtime: bool,
) -> AffectedPlan {
    let units = catalog
        .iter()
        .map(|(source, kind, chunk_id)| AffectedUnit {
            source: source.clone(),
            kind: *kind,
            chunk_id: chunk_id.clone(),
        })
        .collect();
    AffectedPlan {
        full: true,
        rebuild_runtime,
        rebuild_server_tree: true,
        units,
        seed_chunks: Vec::new(),
    }
}

pub fn chunk_id_for(src_root: &Path, source: &Path) -> String {
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("component");
    if let Ok(parent) = source.parent().unwrap_or(source).strip_prefix(src_root) {
        let dir = parent.to_string_lossy().replace('\\', "/");
        return if dir.is_empty() { stem.to_string() } else { format!("{dir}/{stem}") };
    }
    // Dependency packages live outside app `src/` (e.g. node_modules/@vmz/ui/…).
    // Map `…/src/components/Button.vmz` → `components/Button` so serve-host can register them.
    let norm = source.to_string_lossy().replace('\\', "/");
    if let Some(idx) = norm.find("/src/components/") {
        let rest = &norm[idx + "/src/".len()..];
        let without_ext = rest.strip_suffix(".vmz").unwrap_or(rest);
        if !without_ext.is_empty() {
            return without_ext.to_string();
        }
    }
    stem.to_string()
}

/// Build graph for Deployment IR emission.
pub fn component_graph_for(
    root: &Path,
) -> (PathBuf, ComponentGraph, Vec<(PathBuf, VmzModuleKind, String)>) {
    let src_root = if root.join("src").is_dir() { root.join("src") } else { root.to_path_buf() };
    let catalog: Vec<(PathBuf, VmzModuleKind, String)> = discover_vmz_files(root)
        .into_iter()
        .map(|(p, k)| {
            let chunk = chunk_id_for(&src_root, &p);
            (p, k, chunk)
        })
        .collect();
    let graph = ComponentGraph::build(&src_root, &catalog);
    (src_root, graph, catalog)
}

fn is_under(path: &Path, root: &Path) -> bool {
    path.strip_prefix(root).is_ok()
}

pub fn paths_eq(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    a.to_string_lossy()
        .replace('\\', "/")
        .eq_ignore_ascii_case(&b.to_string_lossy().replace('\\', "/"))
}
