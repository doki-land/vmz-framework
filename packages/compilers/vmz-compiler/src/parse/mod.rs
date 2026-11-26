//! SFC surface: split `.vmz`, template IR, script analysis.

pub mod analyze;
pub mod analyze_text;
pub mod field_rw_text;
pub mod offset_index;
pub mod rust_dsl;
pub mod sfc;
pub mod template;
pub mod template_common;
pub mod template_concrete;
pub(crate) mod template_const;
pub mod template_ir;
pub mod template_lower;
pub mod template_semantic;
pub mod template_span;
pub mod template_text;
pub mod transpile;
