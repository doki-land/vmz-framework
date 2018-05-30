//! Application collection / mount composition .

pub mod artifact;
pub mod composition;
pub mod contract;
pub mod dev;
pub mod isolation;
pub mod reloc;

// Former flat `application.rs` surface lives in `contract`.
pub use contract::*;
