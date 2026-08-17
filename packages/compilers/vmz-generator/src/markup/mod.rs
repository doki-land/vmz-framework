//! Markup CodeGenerator (HTML / XML / Mini template dialect).

mod ast;
mod html;
mod mini;

pub use ast::{MarkupDocument, MarkupNode};
pub use html::emit_html_document;
pub use mini::emit_mini_template;
pub use ast::emit_markup;
