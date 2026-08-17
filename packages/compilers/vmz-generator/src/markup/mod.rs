//! Markup CodeGenerator (HTML / XML / Mini template dialect).

mod ast;
mod html;
mod wxml;

pub use ast::{MarkupDocument, MarkupNode};
pub use html::emit_html_document;
pub use wxml::emit_mini_template;
pub use ast::emit_markup;
