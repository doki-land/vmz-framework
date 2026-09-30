//! VMZ ↔ Oak integration inside the compiler (region map + concrete lowering).

mod nyar_projection;
mod vmz_regions;

pub use nyar_projection::{project_nyar_analysis_input, project_nyar_from_vmz};
pub use vmz_regions::{project_parsed_vmz, project_vmz_regions};
