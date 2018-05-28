//! Component dependency graph from PascalCase template tags (N4.1).
//!
//! Convention: `<UserCard />` depends on a `.vmz` whose file stem is `UserCard`
//! (prefer `src/components/`). No ES `import '*.vmz'` — tags are the authoring edge.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use crate::project::VmzModuleKind;
use crate::sfc::parse_vmz;
use crate::template::{TemplateIr, TemplateNode};

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
            let ir = crate::template::parse_template(&parsed.template.content);
            let mut child_chunks = Vec::new();
            let mut seen = HashSet::new();
            for tag in component_tags(&ir) {
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

fn component_tags(ir: &TemplateIr) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for root in &ir.roots {
        walk(root, &mut out, &mut seen);
    }
    out
}

fn walk(node: &TemplateNode, out: &mut Vec<String>, seen: &mut HashSet<String>) {
    match node {
        TemplateNode::Element { tag, children, .. } => {
            if is_component_tag(tag) && seen.insert(tag.clone()) {
                out.push(tag.clone());
            }
            for c in children {
                walk(c, out, seen);
            }
        }
        TemplateNode::Text(_) | TemplateNode::Interp(_) => {}
    }
}

fn is_component_tag(tag: &str) -> bool {
    tag.chars().next().is_some_and(|c| c.is_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::affected::chunk_id_for;
    use crate::project::VmzModuleKind;
    use std::fs;

    #[test]
    fn reverse_edge_page_depends_on_component() {
        let dir = std::env::temp_dir().join(format!("vmz-dep-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src/components")).unwrap();
        fs::create_dir_all(dir.join("src/pages")).unwrap();
        let card = dir.join("src/components/UserCard.vmz");
        let page = dir.join("src/pages/index.vmz");
        fs::write(
            &card,
            "<template><p>c</p></template>\n<script client>\nexport default class UserCard {}\n</script>\n",
        )
        .unwrap();
        fs::write(
            &page,
            "<template><UserCard /></template>\n<script client>\nexport default class Index {}\n</script>\n",
        )
        .unwrap();
        let src = dir.join("src");
        let units = vec![
            (card.clone(), VmzModuleKind::Component, chunk_id_for(&src, &card)),
            (page.clone(), VmzModuleKind::Page, chunk_id_for(&src, &page)),
        ];
        let g = ComponentGraph::build(&src, &units);
        assert_eq!(
            g.deps.get("pages/index").map(|v| v.as_slice()),
            Some(vec!["components/UserCard".to_string()].as_slice())
        );
        let expanded = g.expand_importers(["components/UserCard".into()]);
        assert!(expanded.contains("pages/index"));
        assert!(expanded.contains("components/UserCard"));
        let _ = fs::remove_dir_all(&dir);
    }
}
