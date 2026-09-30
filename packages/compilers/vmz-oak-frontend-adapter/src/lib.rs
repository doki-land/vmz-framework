//! VMZ ↔ Oaks frontend adapter.
//!
//! - **CST path** (`oak_cst`): Oak `VueParser` on template regions (format / highlight / LSP).
//! - **Region map** (`vmz_regions`): `.vmz` block spans for Oak/Nyar projection.
//!
//! See `规划设计/vmz/handoffs/2026-09-30-vmz-oak-nyar-frontend-integration.md`.

mod contract;
mod oak_cst;
mod vmz_regions;

pub use contract::{
    BlockKind, ByteSpan, OakFrontendDiagnostic, SfcBlockRegion, SfcDocumentView, TemplateCstParse,
};
pub use oak_cst::parse_template_cst;
pub use vmz_regions::{project_parsed_vmz, project_vmz_regions};
