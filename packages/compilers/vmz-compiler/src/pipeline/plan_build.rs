//! Build thin [`ExecutionPlan`] from Native View + dispose schedule.
//!
//! Plan nodes share BindingId / RegionId with ViewView -- not a competing IR.

use vmz_types::{
    ComponentEventPlan, DisposeRegionSource, ExecutionPlan, PLAN_SCHEMA, PlanNode, PlanStatus,
    ViewNode, ViewStatus, ViewView,
};

/// Derive a shared Execution Plan from Native View roots.
pub fn build_execution_plan(view: &ViewView) -> ExecutionPlan {
    if view.status != ViewStatus::Native || view.roots.is_empty() {
        return ExecutionPlan::default();
    }
    let mut nodes = Vec::new();
    let mut next_id = 0u32;
    let mut root_ids = Vec::new();
    for root in &view.roots {
        let id = push_node(root, &mut nodes, &mut next_id);
        root_ids.push(id);
    }
    append_dispose_nodes(view, &mut nodes, &mut next_id);
    ExecutionPlan { schema: PLAN_SCHEMA.into(), status: PlanStatus::Partial, root_ids, nodes }
}

/// One `dispose-region` plan node per if/each LifetimeRegion (same RegionId).
fn append_dispose_nodes(view: &ViewView, out: &mut Vec<PlanNode>, next_id: &mut u32) {
    let mut seen: std::collections::BTreeMap<u32, DisposeRegionSource> =
        std::collections::BTreeMap::new();
    fn collect(node: &ViewNode, seen: &mut std::collections::BTreeMap<u32, DisposeRegionSource>) {
        match node {
            ViewNode::If { region, branches, .. } => {
                if let Some(r) = region {
                    seen.entry(r.0).or_insert(DisposeRegionSource::If);
                }
                for b in branches {
                    collect(&b.body, seen);
                }
            }
            ViewNode::Element { children, each, .. } => {
                if let Some(e) = each {
                    if let Some(r) = e.region {
                        // Prefer `each` when the list shares a parent CF region id.
                        seen.insert(r.0, DisposeRegionSource::Each);
                    }
                }
                for c in children {
                    collect(c, seen);
                }
            }
            ViewNode::Component { children, .. } | ViewNode::Slot { children, .. } => {
                for c in children {
                    collect(c, seen);
                }
            }
            ViewNode::Text { .. } | ViewNode::Interp { .. } => {}
        }
    }
    for root in &view.roots {
        collect(root, &mut seen);
    }
    for (region, source) in seen {
        let id = *next_id;
        *next_id += 1;
        out.push(PlanNode::DisposeRegion { id, region: Some(region), source: Some(source) });
    }
}

fn push_node(node: &ViewNode, out: &mut Vec<PlanNode>, next_id: &mut u32) -> u32 {
    let id = *next_id;
    *next_id += 1;
    // Placeholder so children can reference parent id order; we overwrite below.
    out.push(PlanNode::Pending { id });

    let built = match node {
        ViewNode::Text { .. } => PlanNode::Text { id },
        ViewNode::Interp { binding, .. } => PlanNode::Interp { id, binding: binding.map(|b| b.0) },
        ViewNode::Element { tag, children, each, attrs, .. } => {
            let kid_ids: Vec<u32> = children.iter().map(|c| push_node(c, out, next_id)).collect();
            let binding = attrs.iter().find_map(|a| a.binding.map(|b| b.0));
            let list_binding = each.as_ref().and_then(|e| e.list_binding.map(|b| b.0));
            let key_binding = each.as_ref().and_then(|e| e.key_binding.map(|b| b.0));
            let region = each.as_ref().and_then(|e| e.region.map(|r| r.0));
            let binding = list_binding.or(binding);
            if each.is_some() {
                PlanNode::Each {
                    id,
                    tag: Some(tag.clone()),
                    binding,
                    key_binding,
                    region,
                    resume_marker: None,
                    children: kid_ids,
                }
            } else {
                PlanNode::Element { id, tag: Some(tag.clone()), binding, region, children: kid_ids }
            }
        }
        ViewNode::If { region, binding, branches } => {
            let branch_ids: Vec<u32> =
                branches.iter().map(|b| push_node(&b.body, out, next_id)).collect();
            PlanNode::If {
                id,
                binding: binding.map(|b| b.0),
                region: region.map(|r| r.0),
                branches: branch_ids,
            }
        }
        ViewNode::Component { tag, children, attrs, .. } => {
            let kid_ids: Vec<u32> = children.iter().map(|c| push_node(c, out, next_id)).collect();
            let resume_marker = attrs.iter().find_map(|a| {
                a.name
                    .strip_prefix("client:")
                    .map(|s| if s.is_empty() { "load".into() } else { s.to_string() })
            });
            // Component `@event` → ComponentEventPlan (never onXxx prop).
            let events: Vec<ComponentEventPlan> = attrs
                .iter()
                .filter(|a| a.name.starts_with('@') && a.name.len() > 1)
                .map(|a| {
                    let raw = a.name.strip_prefix('@').unwrap_or(&a.name);
                    let name = raw.split('.').next().unwrap_or(raw).to_string();
                    ComponentEventPlan { name, host_id: Some(id) }
                })
                .collect();
            PlanNode::Component {
                id,
                tag: Some(tag.clone()),
                resume_marker,
                events,
                children: kid_ids,
            }
        }
        ViewNode::Slot { name, children, .. } => {
            let kid_ids: Vec<u32> = children.iter().map(|c| push_node(c, out, next_id)).collect();
            PlanNode::Slot {
                id,
                tag: name.clone().or_else(|| Some("slot".into())),
                projection_id: Some(id),
                children: kid_ids,
            }
        }
    };
    out[id as usize] = built;
    id
}
