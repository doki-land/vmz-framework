//! Canonical CSS print must not rewrite colons outside declarations.

use vmz_generator::css::{format_css, print_css};

#[test]
fn keeps_pseudo_element_selectors_intact() {
    let css = format_css("*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n");
    assert!(css.contains("*"), "{css}");
    assert!(css.contains("*::before"), "{css}");
    assert!(css.contains("*::after"), "{css}");
    assert!(!css.contains(": :"), "{css}");
}

#[test]
fn keeps_urls_and_at_rule_strings_intact() {
    let css = format_css(
        "@import url(\"https://fonts.googleapis.com/css2?family=IBM+Plex+Sans&display=swap\");\n\
.a {\n  background: url(data:image/svg+xml,%3Csvg%3E);\n}\n",
    );
    assert!(css.contains("https://fonts.googleapis.com"), "{css}");
    assert!(!css.contains("https: //"), "{css}");
    assert!(css.contains("data:image/svg+xml"), "{css}");
    assert!(!css.contains("data: image"), "{css}");
}

#[test]
fn keeps_comments_like_windows_paths_intact() {
    let css = format_css("/* C:\\repo\\designs\\styles */\n.a {\n  color: red;\n}\n");
    assert!(css.contains("/* C:\\repo\\designs\\styles */"), "{css}");
}

#[test]
fn still_spaces_real_declarations() {
    let out = print_css(".a{color:red;margin:0}", false);
    assert!(out.contains("color: red;"), "{out}");
    assert!(out.contains("margin: 0"), "{out}");
}
