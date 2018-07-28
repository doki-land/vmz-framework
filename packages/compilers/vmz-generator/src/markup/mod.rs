//! Markup CodeGenerator (HTML / XML / Mini template dialect).

mod ast;
mod html;
mod wxml;

pub use ast::{MarkupDocument, MarkupNode, emit_markup};
pub use html::{
    HreflangAlternate, HtmlShellInput, PageShellInput, PageShellMeta, RedirectHtmlInput,
    SitemapUrl, emit_html_document, emit_html_shell, emit_page_shell, emit_redirect_html,
    emit_robots_txt, emit_sitemap_xml,
};
pub use wxml::{
    MINI_TEMPLATE_DIALECT, MiniEmitError, MiniEmitErrorKind, MiniEventHandler, MiniTemplateEmit,
    MiniTemplateProfile, emit_mini_template, emit_mini_template_profile,
};
