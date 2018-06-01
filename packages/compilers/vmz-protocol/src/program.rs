//! Program Graph / Execution Plan schema ids.

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
