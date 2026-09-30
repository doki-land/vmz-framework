//! VMZ ↔ Oak integration inside the compiler (region map + concrete lowering).

mod vmz_regions;

pub use vmz_regions::{project_parsed_vmz, project_vmz_regions};
