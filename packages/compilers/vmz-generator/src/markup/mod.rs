//! Markup CodeGenerator (HTML / XML / Mini template dialect).

mod ast;
mod html;
mod wechat;
mod wxml;

pub use ast::{MarkupDocument, MarkupNode, emit_markup, emit_markup_opts};
pub use html::{
    HreflangAlternate, HtmlShellInput, PageShellInput, PageShellMeta, RedirectHtmlInput,
    SitemapUrl, emit_html_document, emit_html_shell, emit_page_shell, emit_redirect_html,
    emit_robots_txt, emit_sitemap_xml,
};
pub use wechat::{WECHAT_WXML_DIALECT, emit_wechat_wxml};
pub use wxml::{
    MINI_TEMPLATE_DIALECT, MiniEmitError, MiniEmitErrorKind, MiniEventHandler, MiniTemplateEmit,
    MiniTemplateProfile, emit_mini_template, emit_mini_template_profile,
};
