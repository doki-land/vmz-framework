//! VMZ ↔ Oak integration inside the compiler (region map + concrete lowering).

mod nyar_projection;
mod script;
mod vmz_regions;

pub use nyar_projection::{project_nyar_analysis_input, project_nyar_from_vmz};
pub use script::{check_oak_script_ts, script_shell_from_block};
pub use vmz_regions::{project_parsed_vmz, project_vmz_regions};
