//! Style emitter — re-export from `vmz-generator` CssCodeGenerator.

pub use vmz_generator::css::{
    StyleContribution, StyleEmitReport, StyleLayer, emit_style_bundle, emit_style_bundle_opts,
    format_css, minify_css, validate_css,
};
