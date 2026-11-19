use data_text_core::TextError;
use data_text_vue::formatter::{FormatError, FormatOptions, format_source};

#[test]
fn validation_preserves_comment_text_and_line_endings() {
    let source = "<template>\r\n  <!-- keep  spaces -->\r\n  <div title='a  b'> hello  world </div>  \r\n</template>\r\n";
    let formatted = format_source(source, &FormatOptions::default()).expect("valid Vue template");
    assert_eq!(formatted, source);
    assert_eq!(format_source(&formatted, &FormatOptions::default()).unwrap(), source);
}

#[test]
fn formatter_errors_retain_shared_text_source_offsets() {
    let error: FormatError = TextError::syntax_error("invalid Vue source", 12, None);
    let shared: TextError = error;
    assert_eq!(shared.source_offset(), Some(12));
}
