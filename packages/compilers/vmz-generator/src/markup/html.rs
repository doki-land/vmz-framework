//! HTML document helpers for static / serve hosts.

use super::ast::{MarkupDialect, MarkupDocument, MarkupNode, emit_markup};

/// One hreflang alternate link.
#[derive(Debug, Clone)]
pub struct HreflangAlternate {
    /// `hreflang` attribute.
    pub hreflang: String,
    /// Absolute `href`.
    pub href: String,
}

/// SEO / locale meta for [`emit_page_shell`].
#[derive(Debug, Clone)]
pub struct PageShellMeta {
    /// Document title.
    pub title: String,
    /// Meta description.
    pub description: String,
    /// Canonical URL.
    pub canonical: String,
    /// Robots content.
    pub robots: String,
    /// `html[lang]` / locale id.
    pub lang: String,
    /// `dir` (`ltr` / `rtl`).
    pub dir: String,
    /// Optional hreflang alternates.
    pub alternates: Vec<HreflangAlternate>,
}

/// Input for a static/SSR HTML shell around a pre-rendered body.
#[derive(Debug, Clone)]
pub struct PageShellInput {
    /// Trusted SSR / static body HTML (not re-escaped).
    pub body_html: String,
    /// `data-vmz-page` chunk id (empty => omit).
    pub chunk_id: String,
    /// Layout chain chunk ids.
    pub layout_chain: Vec<String>,
    /// JSON-serializable props object (will be stringified).
    pub props_json: String,
    /// Head meta.
    pub meta: PageShellMeta,
    /// Optional CSS entry href without leading slash (e.g. `vmz.css`).
    pub css_entry: Option<String>,
    /// When true, omit `entry-client.js` script (error documents).
    pub is_error_document: bool,
}

fn el(tag: &str, attrs: Vec<(String, String)>, children: Vec<MarkupNode>) -> MarkupNode {
    MarkupNode::Element { tag: tag.into(), attrs, children, void: false }
}

fn void_el(tag: &str, attrs: Vec<(String, String)>) -> MarkupNode {
    MarkupNode::Element { tag: tag.into(), attrs, children: vec![], void: true }
}

fn attr(name: &str, value: impl Into<String>) -> (String, String) {
    (name.into(), value.into())
}

/// Build a minimal HTML shell document.
pub fn emit_html_document(
    title: &str,
    body_children: Vec<MarkupNode>,
    head_extra: Vec<MarkupNode>,
) -> String {
    emit_html_shell(&HtmlShellInput {
        title: title.into(),
        lang: "en".into(),
        css_hrefs: vec![],
        body_html: String::new(),
        body_attrs: vec![],
        body_nodes: body_children,
        head_extra,
    })
}

/// Flexible HTML5 document shell (documents / redirects / custom pages).
#[derive(Debug, Clone, Default)]
pub struct HtmlShellInput {
    /// `<title>` text (escaped).
    pub title: String,
    /// `html[lang]`.
    pub lang: String,
    /// Stylesheet `href` values (escaped as attributes).
    pub css_hrefs: Vec<String>,
    /// Trusted body HTML fragment (not re-escaped). Prefer this or [`Self::body_nodes`].
    pub body_html: String,
    /// Extra attributes on `<body>`.
    pub body_attrs: Vec<(String, String)>,
    /// Structured body children (used when [`Self::body_html`] is empty).
    pub body_nodes: Vec<MarkupNode>,
    /// Extra head nodes after charset/viewport/title/css.
    pub head_extra: Vec<MarkupNode>,
}

/// Emit an HTML5 document from [`HtmlShellInput`].
pub fn emit_html_shell(input: &HtmlShellInput) -> String {
    let lang = if input.lang.is_empty() { "en" } else { input.lang.as_str() };
    let mut head_kids = vec![
        void_el("meta", vec![attr("charset", "utf-8")]),
        void_el(
            "meta",
            vec![attr("name", "viewport"), attr("content", "width=device-width, initial-scale=1")],
        ),
        el("title", vec![], vec![MarkupNode::Text(input.title.clone())]),
    ];
    for href in &input.css_hrefs {
        head_kids.push(void_el(
            "link",
            vec![attr("rel", "stylesheet"), attr("href", href.clone())],
        ));
    }
    head_kids.extend(input.head_extra.iter().cloned());

    let body_kids = if !input.body_html.is_empty() {
        vec![MarkupNode::Raw(input.body_html.clone())]
    } else {
        input.body_nodes.clone()
    };

    let doc = MarkupDocument {
        doctype: Some("html".into()),
        dialect: MarkupDialect::Html5,
        roots: vec![el(
            "html",
            vec![attr("lang", lang)],
            vec![
                el("head", vec![], head_kids),
                el("body", input.body_attrs.clone(), body_kids),
            ],
        )],
    };
    emit_markup(&doc)
}

/// Meta-refresh redirect document (document mount roots, etc.).
#[derive(Debug, Clone)]
pub struct RedirectHtmlInput {
    /// `html[lang]`.
    pub lang: String,
    /// Absolute or root-relative redirect target.
    pub target: String,
    /// Document title.
    pub title: String,
    /// Visible link label (defaults to a Continue… string when empty).
    pub link_label: String,
}

/// Emit a tiny HTML redirect page with refresh + canonical + fallback link.
pub fn emit_redirect_html(input: &RedirectHtmlInput) -> String {
    let label = if input.link_label.is_empty() {
        format!("Continue to {}", input.lang)
    } else {
        input.link_label.clone()
    };
    let head_extra = vec![
        void_el(
            "meta",
            vec![
                attr("http-equiv", "refresh"),
                attr("content", format!("0;url={}", input.target)),
            ],
        ),
        void_el("link", vec![attr("rel", "canonical"), attr("href", input.target.clone())]),
    ];
    let body = vec![el(
        "p",
        vec![],
        vec![el(
            "a",
            vec![attr("href", input.target.clone())],
            vec![MarkupNode::Text(label)],
        )],
    )];
    emit_html_shell(&HtmlShellInput {
        title: input.title.clone(),
        lang: input.lang.clone(),
        css_hrefs: vec![],
        body_html: String::new(),
        body_attrs: vec![],
        body_nodes: body,
        head_extra,
    })
}

/// Emit the production page HTML shell (static delivery / SSR wrap).
pub fn emit_page_shell(input: &PageShellInput) -> String {
    let locale_id = if input.meta.lang.is_empty() { "en" } else { input.meta.lang.as_str() };
    let dir = if input.meta.dir.is_empty() { "ltr" } else { input.meta.dir.as_str() };

    let mut head_kids = vec![
        void_el("meta", vec![attr("charset", "utf-8")]),
        void_el(
            "meta",
            vec![attr("name", "viewport"), attr("content", "width=device-width, initial-scale=1")],
        ),
        el("title", vec![], vec![MarkupNode::Text(input.meta.title.clone())]),
        void_el(
            "meta",
            vec![attr("name", "description"), attr("content", input.meta.description.clone())],
        ),
        void_el("meta", vec![attr("name", "robots"), attr("content", input.meta.robots.clone())]),
        void_el("link", vec![attr("rel", "canonical"), attr("href", input.meta.canonical.clone())]),
    ];

    for a in &input.meta.alternates {
        head_kids.push(void_el(
            "link",
            vec![
                attr("rel", "alternate"),
                attr("hreflang", a.hreflang.clone()),
                attr("href", a.href.clone()),
            ],
        ));
    }

    head_kids.push(void_el(
        "meta",
        vec![attr("property", "og:title"), attr("content", input.meta.title.clone())],
    ));
    head_kids.push(void_el(
        "meta",
        vec![attr("property", "og:description"), attr("content", input.meta.description.clone())],
    ));
    head_kids.push(void_el(
        "meta",
        vec![attr("property", "og:url"), attr("content", input.meta.canonical.clone())],
    ));

    if let Some(css) = &input.css_entry {
        let href = format!("/{}", css.trim_start_matches('/'));
        head_kids.push(void_el("link", vec![attr("rel", "stylesheet"), attr("href", href)]));
    }

    let mut app_attrs = vec![attr("id", "app")];
    if !input.chunk_id.is_empty() {
        app_attrs.push(attr("data-vmz-page", input.chunk_id.clone()));
    }
    if !input.layout_chain.is_empty() {
        app_attrs.push(attr("data-vmz-layout", input.layout_chain.join(",")));
    }
    app_attrs.push(attr("data-vmz-locale", locale_id));
    app_attrs.push(attr("data-vmz-dir", dir));
    app_attrs.push(attr("data-vmz-props", input.props_json.clone()));

    let mut body_kids = vec![MarkupNode::Element {
        tag: "div".into(),
        attrs: app_attrs,
        children: vec![MarkupNode::Raw(input.body_html.clone())],
        void: false,
    }];

    if !input.is_error_document {
        body_kids.push(el(
            "script",
            vec![attr("type", "module"), attr("src", "/entry-client.js")],
            vec![],
        ));
    }

    let doc = MarkupDocument {
        doctype: Some("html".into()),
        dialect: MarkupDialect::Html5,
        roots: vec![el(
            "html",
            vec![attr("lang", locale_id), attr("data-locale", locale_id), attr("dir", dir)],
            vec![el("head", vec![], head_kids), el("body", vec![], body_kids)],
        )],
    };
    emit_markup(&doc)
}

/// One sitemap URL entry.
#[derive(Debug, Clone)]
pub struct SitemapUrl {
    /// Absolute loc URL.
    pub loc: String,
}

/// Emit `sitemap.xml` body.
pub fn emit_sitemap_xml(urls: &[SitemapUrl]) -> String {
    let mut kids = Vec::new();
    for u in urls {
        kids.push(el(
            "url",
            vec![],
            vec![el("loc", vec![], vec![MarkupNode::Text(u.loc.clone())])],
        ));
    }
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    let doc = MarkupDocument {
        doctype: None,
        dialect: MarkupDialect::Xml,
        roots: vec![MarkupNode::Element {
            tag: "urlset".into(),
            attrs: vec![attr("xmlns", "http://www.sitemaps.org/schemas/sitemap/0.9")],
            children: kids,
            void: false,
        }],
    };
    out.push_str(&emit_markup(&doc));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_shell_escapes_title_and_attrs() {
        let html = emit_page_shell(&PageShellInput {
            body_html: "<p>ok</p>".into(),
            chunk_id: "pages/Home".into(),
            layout_chain: vec![],
            props_json: r#"{"x":"a\"b"}"#.into(),
            meta: PageShellMeta {
                title: "A < B & C".into(),
                description: "desc \"q\"".into(),
                canonical: "https://ex.test/".into(),
                robots: "index,follow".into(),
                lang: "zh-CN".into(),
                dir: "ltr".into(),
                alternates: vec![],
            },
            css_entry: Some("vmz.css".into()),
            is_error_document: false,
        });
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("A &lt; B &amp; C"));
        assert!(html.contains("content=\"desc &quot;q&quot;\""));
        assert!(html.contains("href=\"/vmz.css\""));
        assert!(html.contains("src=\"/entry-client.js\""));
        assert!(html.contains("<p>ok</p>"));
    }

    #[test]
    fn sitemap_escapes_loc() {
        let xml = emit_sitemap_xml(&[SitemapUrl { loc: "https://ex.test/a&b".into() }]);
        assert!(xml.contains("https://ex.test/a&amp;b"));
        assert!(xml.contains("urlset"));
    }

    #[test]
    fn html_shell_and_redirect_escape() {
        let html = emit_html_shell(&HtmlShellInput {
            title: "A < B".into(),
            lang: "zh-hans".into(),
            css_hrefs: vec!["/vmz.css".into()],
            body_html: "<main>ok</main>".into(),
            body_attrs: vec![("data-vmz-hydrate".into(), "island-only".into())],
            body_nodes: vec![],
            head_extra: vec![],
        });
        assert!(html.contains("A &lt; B"));
        assert!(html.contains("lang=\"zh-hans\""));
        assert!(html.contains("href=\"/vmz.css\""));
        assert!(html.contains("data-vmz-hydrate=\"island-only\""));
        assert!(html.contains("<main>ok</main>"));

        let redir = emit_redirect_html(&RedirectHtmlInput {
            lang: "en-us".into(),
            target: "/d/en-us/\"".into(),
            title: "Documents".into(),
            link_label: String::new(),
        });
        assert!(redir.contains("url=/d/en-us/&quot;"));
        assert!(redir.contains("href=\"/d/en-us/&quot;\""));
    }
}
