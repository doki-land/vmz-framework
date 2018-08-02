//! CSS CodeGenerator: StyleEmitter + oxc-css-parser validation + oxc_formatter_css print.

mod print;
mod theme;

pub use print::{
    StyleContribution, StyleEmitReport, StyleLayer, emit_style_bundle, format_css, validate_css,
};
pub use theme::{ThemeDecl, ThemeRule, css_var_name, emit_theme_css, theme_attr_selector};
