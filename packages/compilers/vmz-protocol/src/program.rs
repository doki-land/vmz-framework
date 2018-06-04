//! Program Graph / Execution Plan schema ids and closed edge kinds.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Schema id written into `*.program.json`.
pub const PROGRAM_SCHEMA: &str = "vmz.program.v0";

/// Schema id written into Execution Plan JSON.
pub const PLAN_SCHEMA: &str = "vmz.plan.v0";

/// Schema id written into `*.reactive.json` (Reactive view snapshot).
pub const REACTIVE_SCHEMA: &str = "vmz.reactive.v0";

/// Schema id for Program Graph motion transition declarations (`units[].motion`).
pub const MOTION_SCHEMA: &str = "vmz.motion.v0";

/// Schema id for one motion transition fact (owner / trigger / cancel / generation).
pub const MOTION_TRANSITION_SCHEMA: &str = "vmz.motion.transition.v0";

/// Kind of a Program Graph edge (IR + debugger / DX consumers).
///
/// **Closed** unit enum — edge payloads are always `from` / `to` strings, so this
/// stays a label (not a tagged union). Wire labels are **kebab-case**.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProgramEdgeKind {
    /// Binding / effect reads a path.
    Reads,
    /// Effect writes a path.
    Writes,
    /// Effect / client calls a capability or method.
    Calls,
    /// Region declares a stable dependency.
    RegionStable,
    /// Ownership edge (unit owns region / resource).
    Owns,
    /// Dispose edge.
    Disposes,
    /// Spawn async / motion work.
    Spawns,
    /// Cancel async / motion work.
    Cancels,
    /// Motion / effect affects a region.
    Affects,
}

impl ProgramEdgeKind {
    /// Wire / JSON label (`kebab-case`).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Reads => "reads",
            Self::Writes => "writes",
            Self::Calls => "calls",
            Self::RegionStable => "region-stable",
            Self::Owns => "owns",
            Self::Disposes => "disposes",
            Self::Spawns => "spawns",
            Self::Cancels => "cancels",
            Self::Affects => "affects",
        }
    }

    /// Parse kebab-case (and legacy snake_case) labels.
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "reads" => Some(Self::Reads),
            "writes" => Some(Self::Writes),
            "calls" => Some(Self::Calls),
            "region-stable" | "region_stable" => Some(Self::RegionStable),
            "owns" => Some(Self::Owns),
            "disposes" => Some(Self::Disposes),
            "spawns" => Some(Self::Spawns),
            "cancels" => Some(Self::Cancels),
            "affects" => Some(Self::Affects),
            _ => None,
        }
    }
}

/// Slim graph edge row shared by IR emit and debugger loaders.
///
/// Prefer this over hand-parsing `serde_json::Value` for `graph.edges`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct ProgramGraphEdge {
    /// Closed edge kind.
    pub kind: ProgramEdgeKind,
    /// Source node id / label.
    pub from: String,
    /// Target node id / label.
    pub to: String,
}
