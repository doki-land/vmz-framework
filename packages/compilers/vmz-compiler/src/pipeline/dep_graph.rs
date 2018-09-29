//! Component dependency graph from PascalCase template tags (incremental).
//!
//! Convention: `<UserCard />` depends on a `.vmz` whose file stem is `UserCard`
//! (prefer `src/components/`). No ES `import '*.vmz'` — tags are the authoring edge.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::project::VmzModuleKind;
use crate::sfc::parse_vmz;
use crate::template::{TemplateIr, TemplateNode};

/// Directed graph of component chunk dependencies inferred from template tags.
#[derive(Debug, Clone, Default)]
pub struct ComponentGraph {
    /// chunk_id → child component chunk_ids referenced in its template.
    pub deps: HashMap<String, Vec<String>>,
    /// chunk_id → parents that reference it.
    pub reverse: HashMap<String, Vec<String>>,
    /// component class/tag name → chunk_id
    pub by_tag: HashMap<String, String>,
}

impl ComponentGraph {
    /// Build the graph from discovered units under `src_root`.
    pub fn build(src_root: &Path, units: &[(PathBuf, VmzModuleKind, String)]) -> Self {
        let mut by_tag: HashMap<String, String> = HashMap::new();
        for (path, _kind, chunk_id) in units {
            let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if stem.is_empty() {
                continue;
            }
            // Prefer components/ when multiple stems collide.
            let under_components =
                path.to_string_lossy().replace('\\', "/").contains("/components/");
            match by_tag.get(&stem) {
                Some(_) if !under_components => {}
                _ => {
                    by_tag.insert(stem, chunk_id.clone());
                }
            }
        }

        let mut deps: HashMap<String, Vec<String>> = HashMap::new();
        let mut reverse: HashMap<String, Vec<String>> = HashMap::new();

        for (path, _kind, chunk_id) in units {
            let Ok(source) = fs::read_to_string(path) else {
                continue;
            };
            let Ok(parsed) = parse_vmz(path, source) else {
                continue;
            };
            let Ok(ir) = crate::template::parse_template(&parsed.template.content) else {
                continue;
            };
            let mut child_chunks = Vec::new();
            let mut seen = HashSet::new();
            for tag in component_tags(&ir, &by_tag) {
                let Some(child) = by_tag.get(&tag) else {
                    continue;
                };
                if child == chunk_id {
                    continue;
                }
                if seen.insert(child.clone()) {
                    child_chunks.push(child.clone());
                    reverse.entry(child.clone()).or_default().push(chunk_id.clone());
                }
            }
            if !child_chunks.is_empty() {
                deps.insert(chunk_id.clone(), child_chunks);
            }
        }

        for v in reverse.values_mut() {
            v.sort();
            v.dedup();
        }
        let _ = src_root;
        Self { deps, reverse, by_tag }
    }

    /// Expand a set of seed chunk ids through reverse edges (importers).
    pub fn expand_importers(&self, seeds: impl IntoIterator<Item = String>) -> HashSet<String> {
        let mut out: HashSet<String> = seeds.into_iter().collect();
        let mut stack: Vec<String> = out.iter().cloned().collect();
        while let Some(id) = stack.pop() {
            if let Some(parents) = self.reverse.get(&id) {
                for p in parents {
                    if out.insert(p.clone()) {
                        stack.push(p.clone());
                    }
                }
            }
        }
        out
    }
}

fn component_tags(ir: &TemplateIr, by_tag: &HashMap<String, String>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in &ir.roots {
        walk(root, by_tag, &mut out, &mut seen);
    }
    out
}

fn walk(
    node: &TemplateNode,
    by_tag: &HashMap<String, String>,
    out: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    match node {
        TemplateNode::Element { tag, children, .. } => {
            if is_component_tag(tag, by_tag) && seen.insert(tag.clone()) {
                out.push(tag.clone());
            }
            for c in children {
                walk(c, by_tag, out, seen);
            }
        }
        TemplateNode::Text(_) | TemplateNode::Interp(_) => {}
    }
}

fn is_component_tag(tag: &str, by_tag: &HashMap<String, String>) -> bool {
    // When a real component chunk exists (e.g. `@vmz/ui` Link), keep the deployment edge.
    if by_tag.contains_key(tag) {
        return true;
    }
    // Built-in `<Link>` lowers to `<a>` when no component chunk is registered.
    if tag == "Link" {
        return false;
    }
    tag.chars().next().is_some_and(|c| c.is_uppercase())
}
