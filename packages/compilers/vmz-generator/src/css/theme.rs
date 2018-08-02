//! Style Theme -> CSS custom-property CodeGenerator.

use super::print::format_css;
use crate::core::escape_css_string;

/// One CSS custom-property declaration (`--vmz-...: value`).
#[derive(Debug, Clone)]
pub struct ThemeDecl {
    /// Full custom-property name including `--` (e.g. `--vmz-color-bg`).
    pub property: String,
    /// Already-resolved CSS value (not further escaped as a string literal).
    pub value: String,
}

/// One rule block or `@media` wrapper contributing theme variables.
#[derive(Debug, Clone)]
pub enum ThemeRule {
    /// `selector { decls }`
    Block {
        /// CSS selector (e.g. `:root`, `[data-vmz-theme="dark"]`).
        selector: String,
        /// Declarations inside the block.
        decls: Vec<ThemeDecl>,
    },
    /// `@media (prefers-color-scheme: ...) { nested blocks }`
    PrefersColorScheme {
        /// `light` / `dark` / ...
        scheme: String,
        /// Nested rule blocks (typically `  :root { ... }`).
        nested: Vec<ThemeRule>,
    },
}

/// Map a theme leaf path to its `--vmz-...` CSS custom-property name.
pub fn css_var_name(path: &[String]) -> String {
    let mut s = String::from("--vmz");
    for p in path {
        s.push('-');
        s.push_str(&p.replace('_', "-"));
    }
    s
}

/// Print theme CSS from structured rules (sole theme CSS printer).
///
/// Attribute selectors escape the theme id as a CSS string when needed via
/// [`theme_attr_selector`]. Values are inserted as raw CSS tokens (authors /
/// loader already produced CSS values).
pub fn emit_theme_css(rules: &[ThemeRule]) -> String {
    let mut out = String::new();
    for (i, rule) in rules.iter().enumerate() {
        if i > 0 && !out.is_empty() {
            out.push('\n');
        }
        push_rule(&mut out, rule, 0);
    }
    format_css(&out)
}

/// `[attr="id"]` with CSS-string escaping for `id`.
pub fn theme_attr_selector(attr: &str, theme_id: &str) -> String {
    format!("[{attr}={}]", escape_css_string(theme_id))
}

fn push_rule(out: &mut String, rule: &ThemeRule, indent: usize) {
    let pad = " ".repeat(indent);
    match rule {
        ThemeRule::Block { selector, decls } => {
            if decls.is_empty() {
                return;
            }
            out.push_str(&pad);
            out.push_str(selector);
            out.push_str(" {\n");
            for d in decls {
                out.push_str(&pad);
                out.push_str("  ");
                out.push_str(&d.property);
                out.push_str(": ");
                out.push_str(&d.value);
                out.push_str(";\n");
            }
            out.push_str(&pad);
            out.push_str("}\n");
        }
        ThemeRule::PrefersColorScheme { scheme, nested } => {
            if nested.is_empty() {
                return;
            }
            out.push_str(&pad);
            out.push_str("@media (prefers-color-scheme: ");
            out.push_str(scheme);
            out.push_str(") {\n");
            for n in nested {
                push_rule(out, n, indent + 2);
            }
            out.push_str(&pad);
            out.push_str("}\n");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::css::validate_css;

    #[test]
    fn theme_css_validates_and_escapes_attr() {
        let rules = vec![
            ThemeRule::Block {
                selector: ":root".into(),
                decls: vec![ThemeDecl { property: "--vmz-color-bg".into(), value: "#fff".into() }],
            },
            ThemeRule::Block {
                selector: theme_attr_selector("data-theme", "a\"b"),
                decls: vec![ThemeDecl { property: "--vmz-color-bg".into(), value: "#000".into() }],
            },
        ];
        let css = emit_theme_css(&rules);
        assert!(css.contains(":root"));
        // oxc_formatter_css may rewrite `"a\"b"` to `'a"b'`; either form is escaped.
        assert!(
            css.contains("[data-theme=") && (css.contains("\\\"") || css.contains("'a\"b'") || css.contains(r#""a\"b""#)),
            "theme id must remain escaped in attr selector: {css}"
        );
        validate_css(&css).expect("theme css must parse");
    }
}
