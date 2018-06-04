//! Adapter: Reactive view → transitional blueprint `deps` + BindingId.
//!
//! Emitter consumes Program/Reactive IR.
//! Control-flow deps (`if` / ternary) come **only** from `ControlRegion`
//! (CF sole source). String `deps` remain a transitional runtime index.

use std::collections::HashSet;

use vmz_types::{BindingKind, ControlRegion, ReactiveComponent};

/// One Reactive binding consumed for emit (id + transitional dep strings).
#[derive(Debug, Clone)]
pub struct TakenBinding {
    /// BindingId numeric value for runtime / blueprint indexing.
    pub id: u32,
    /// Transitional dep path strings derived from the binding's reads.
    pub deps: Vec<String>,
}

/// Control-flow slice taken from IR (no oxc re-scan).
#[derive(Debug, Clone)]
pub struct TakenControlFlow {
    /// Owning IfCond (or similar) binding when the slice was taken via a binding.
    pub binding_id: Option<u32>,
    /// Deps stable across all branches of the region.
    pub stable: Vec<String>,
    /// Per-branch condition / body dep slices.
    pub branches: Vec<TakenCfBranch>,
}

/// One branch of a control-flow region (`if` / `else-if` / `else`).
#[derive(Debug, Clone)]
pub struct TakenCfBranch {
    /// Condition expression text when present.
    pub cond: Option<String>,
    /// Deps of the condition expression.
    pub cond_deps: Vec<String>,
    /// Deps of the branch body.
    pub body_deps: Vec<String>,
}

/// Consumes Reactive bindings/regions in emit order for transitional `deps`.
pub struct IrDepCursor<'a> {
    comp: &'a ReactiveComponent,
    used_bindings: HashSet<u32>,
    used_regions: HashSet<u32>,
}

impl<'a> IrDepCursor<'a> {
    /// Create a cursor over `comp` with no bindings/regions marked used.
    pub fn new(comp: &'a ReactiveComponent) -> Self {
        Self { comp, used_bindings: HashSet::new(), used_regions: HashSet::new() }
    }

    /// Look up a binding's linked control region (Native View / direct emit).
    pub fn binding_region(&self, id: u32) -> Option<vmz_types::RegionId> {
        self.comp.bindings.iter().find(|b| b.id().0 == id).and_then(|b| b.region())
    }

    /// Dep strings for a known BindingId (no consume).
    pub fn deps_for_binding(&self, id: u32) -> Option<Vec<String>> {
        let b = self.comp.bindings.iter().find(|b| b.id().0 == id)?;
        Some(self.comp.transitional_deps(b.reads()))
    }

    /// Control-flow slice for a binding's linked region (no consume). Used by Native View emit.
    pub fn control_flow_for_binding(&self, id: u32) -> Option<TakenControlFlow> {
        let region = self
            .binding_region(id)
            .and_then(|rid| self.comp.control_regions.iter().find(|r| r.id == rid))?;
        Some(self.region_to_cf(Some(id), region))
    }

    /// Condition expression text for the first branch of a binding's region.
    pub fn region_test_expr(&self, binding_id: u32) -> Option<&str> {
        let rid = self.binding_region(binding_id)?;
        let region = self.comp.control_regions.iter().find(|r| r.id == rid)?;
        let cid = region.branches.first()?.cond?;
        self.comp.expr_text(cid)
    }

    /// Take the next unused binding matching `kinds` whose expr text equals `expr`.
    pub fn take_binding(&mut self, kinds: &[BindingKind], expr: &str) -> Option<TakenBinding> {
        for b in &self.comp.bindings {
            if self.used_bindings.contains(&b.id().0) {
                continue;
            }
            if !kinds.contains(&b.kind()) {
                continue;
            }
            let Some(eid) = b.expr() else {
                continue;
            };
            if self.comp.expr_text(eid)? != expr {
                continue;
            }
            self.used_bindings.insert(b.id().0);
            return Some(TakenBinding {
                id: b.id().0,
                deps: self.comp.transitional_deps(b.reads()),
            });
        }
        None
    }

    /// Take `if` / `else-if` / `else` chain — deps **only** from ControlRegion + IfCond.
    pub fn take_if(&mut self, first_cond: &str) -> Option<TakenControlFlow> {
        // Prefer IfCond binding (BindingId hot path), then its region.
        if let Some(taken) = self.take_binding(&[BindingKind::IfCond], first_cond) {
            let region = self
                .comp
                .bindings
                .iter()
                .find(|b| b.id().0 == taken.id)
                .and_then(|b| b.region())
                .and_then(|rid| self.comp.control_regions.iter().find(|r| r.id == rid));
            if let Some(r) = region {
                self.used_regions.insert(r.id.0);
                return Some(self.region_to_cf(Some(taken.id), r));
            }
            return Some(TakenControlFlow {
                binding_id: Some(taken.id),
                stable: taken.deps,
                branches: Vec::new(),
            });
        }
        // Region-only (no BindingId).
        for r in &self.comp.control_regions {
            if self.used_regions.contains(&r.id.0) {
                continue;
            }
            let Some(first) = r.branches.first() else {
                continue;
            };
            let Some(cid) = first.cond else {
                continue;
            };
            if self.comp.expr_text(cid)? != first_cond {
                continue;
            }
            self.used_regions.insert(r.id.0);
            return Some(self.region_to_cf(None, r));
        }
        None
    }

    /// Take ternary bind CF from the Text/Attr binding's linked ControlRegion.
    pub fn take_ternary(&mut self, expr: &str, kinds: &[BindingKind]) -> Option<TakenControlFlow> {
        let taken = self.take_binding(kinds, expr)?;
        let region = self
            .comp
            .bindings
            .iter()
            .find(|b| b.id().0 == taken.id)
            .and_then(|b| b.region())
            .and_then(|rid| self.comp.control_regions.iter().find(|r| r.id == rid))?;
        if self.used_regions.contains(&region.id.0) {
            // Region already consumed — still return binding-level CF from reads.
            return Some(TakenControlFlow {
                binding_id: Some(taken.id),
                stable: taken.deps.clone(),
                branches: vec![
                    TakenCfBranch {
                        cond: None,
                        cond_deps: taken.deps.clone(),
                        body_deps: taken.deps.clone(),
                    },
                    TakenCfBranch { cond: None, cond_deps: Vec::new(), body_deps: taken.deps },
                ],
            });
        }
        self.used_regions.insert(region.id.0);
        Some(self.region_to_cf(Some(taken.id), region))
    }

    fn region_to_cf(&self, binding_id: Option<u32>, r: &ControlRegion) -> TakenControlFlow {
        let stable = self.comp.transitional_deps(&r.stable);
        let branches = r
            .branches
            .iter()
            .map(|br| {
                let body_deps = if !br.body_reads.is_empty() {
                    self.comp.transitional_deps(&br.body_reads)
                } else {
                    // Template if: union reads of body bindings.
                    let mut paths = Vec::new();
                    for id in &br.body_bindings {
                        if let Some(b) = self.comp.bindings.iter().find(|x| x.id() == *id) {
                            for p in b.reads() {
                                if !paths.iter().any(|x| x == p) {
                                    paths.push(p.clone());
                                }
                            }
                        }
                    }
                    self.comp.transitional_deps(&paths)
                };
                TakenCfBranch {
                    cond: br.cond.and_then(|cid| self.comp.expr_text(cid).map(|s| s.to_string())),
                    cond_deps: self.comp.transitional_deps(&br.cond_reads),
                    body_deps,
                }
            })
            .collect();
        TakenControlFlow { binding_id, stable, branches }
    }
}
