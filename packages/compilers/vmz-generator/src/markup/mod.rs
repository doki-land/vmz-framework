//! Markup CodeGenerator (HTML / XML / Mini template dialect).

mod ast;
mod html;
mod wxml;

pub use ast::{MarkupDocument, MarkupNode, emit_markup};
pub use html::{
    HreflangAlternate, PageShellInput, PageShellMeta, SitemapUrl, emit_html_document,
    emit_page_shell, emit_sitemap_xml,
};
pub use wxml::emit_mini_template;
