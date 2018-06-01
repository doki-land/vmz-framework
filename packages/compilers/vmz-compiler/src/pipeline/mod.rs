//! Compile pipeline: discover → check/build → program graph → emit.

pub mod check;
pub mod compile;
pub mod dep_graph;
pub mod emit;
pub mod emit_direct;
pub mod emit_ir;
pub mod field_rw;
pub mod link;
pub mod method_compose;
pub mod plan_build;
pub mod project;
pub mod reactive_build;
pub mod row_kernel;
pub mod secrets;
pub mod server_calls;
pub mod server_slice;
pub mod structural_build;
pub mod virtual_server;
pub mod write_barrier;
