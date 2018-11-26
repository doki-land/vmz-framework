//! Product-path gate: official `.vmz` templates must not introduce JSX author forms.
//!
//! Isolation / migration snippets live under `tests/fixtures/jsx-migration/` only.

use std::fs;
use std::path::{Path, PathBuf};

use walkdir::WalkDir;

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..")
}

fn product_roots(root: &Path) -> Vec<PathBuf> {
    ["packages/examples", "packages/ui", "packages/homepage"]
        .iter()
        .map(|p| root.join(p))
        .filter(|p| p.is_dir())
        .collect()
}

fn looks_like_jsx_template(body: &str) -> bool {
    // JSX attribute form `attr={expr}` (Vue requires quotes: `:attr="…"` / `attr="…"`).
    if body.contains("={") {
        return true;
    }
    // Bare `{ident}` text interpolation (Vue is `{{ … }}`). Skip chars inside quotes.
    let bytes = body.as_bytes();
    let mut i = 0;
    let mut in_dq = false;
    let mut in_sq = false;
    while i < bytes.len() {
        let c = bytes[i];
        if !in_sq && c == b'"' {
            in_dq = !in_dq;
            i += 1;
            continue;
        }
        if !in_dq && c == b'\'' {
            in_sq = !in_sq;
            i += 1;
            continue;
        }
        if in_dq || in_sq {
            i += 1;
            continue;
        }
        if c == b'{' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'{' {
                i += 2;
                continue;
            }
            return true;
        }
        i += 1;
    }
    false
}

fn extract_template_bodies(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(open) = src[from..].find("<template") {
        let abs = from + open;
        let Some(gt) = src[abs..].find('>') else {
            break;
        };
        let body_start = abs + gt + 1;
        let Some(close) = src[body_start..].find("</template>") else {
            break;
        };
        out.push(src[body_start..body_start + close].to_string());
        from = body_start + close + "</template>".len();
    }
    out
}

#[test]
fn product_vmz_templates_have_no_jsx_author_forms() {
    let root = repo_root();
    let mut offenders = Vec::new();
    for dir in product_roots(&root) {
        for entry in WalkDir::new(&dir).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("vmz") {
                continue;
            }
            let Ok(src) = fs::read_to_string(path) else {
                continue;
            };
            for body in extract_template_bodies(&src) {
                if looks_like_jsx_template(&body) {
                    offenders.push(path.strip_prefix(&root).unwrap_or(path).display().to_string());
                    break;
                }
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "JSX author forms found in product `.vmz` (move to fixtures/jsx-migration):\n{}",
        offenders.join("\n")
    );
}

#[test]
fn isolation_corpus_snippets_are_rejected_by_parser() {
    use vmz_compiler::{parse_template, template_parse_to_diagnostic};

    let corpus = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/jsx-migration");
    for name in ["text-interp.snippet", "attr-bind.snippet"] {
        let src = fs::read_to_string(corpus.join(name)).unwrap();
        let err = parse_template(src.trim()).unwrap_err();
        let diag = template_parse_to_diagnostic("corpus.vmz", 0, &err);
        assert_eq!(
            diag.code_string().as_deref(),
            Some("vmz::template::jsx_rejected"),
            "{name}: {err}"
        );
    }
}
