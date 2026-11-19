//! Product `format` contract for `data_text_vue::formatter` (downstream ownership).

use data_text_vue::formatter::{FormatOptions, format_source};

#[test]
fn preserves_valid_template_and_is_idempotent() {
    let input = "<template><div class=\"x\">{{ msg }}</div></template>";
    let out = format_source(input, &FormatOptions::default()).expect("format");
    assert_eq!(out, input);
    let again = format_source(&out, &FormatOptions::default()).expect("twice");
    assert_eq!(out, again);
}
