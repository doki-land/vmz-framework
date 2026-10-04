//! Format `<style>` bodies with the VMZ CSS formatter.

use vmz_compiler::StyleBlock;

use crate::editorconfig::EditorSettings;

/// Format one CSS, SCSS, or Sass style block.
pub fn format_style_block(block: &StyleBlock, settings: &EditorSettings) -> Result<String, String> {
    let source = trim_outer_newlines(&block.content);
    if source.trim().is_empty() {
        return Ok(String::new());
    }
    format_css(source, settings)
}

fn trim_outer_newlines(content: &str) -> &str {
    content.trim_matches(|c: char| c == '\n' || c == '\r')
}

fn format_css(source: &str, settings: &EditorSettings) -> Result<String, String> {
    let nl = settings.newline();
    let unit = settings.indent_unit();
    let mut output = String::new();
    let mut current = String::new();
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut block_comment = false;
    let mut line_comment = false;
    let chars: Vec<char> = source.replace("\r\n", "\n").replace('\r', "\n").chars().collect();
    let mut index = 0usize;

    while index < chars.len() {
        let ch = chars[index];
        let next = chars.get(index + 1).copied();
        if block_comment {
            current.push(ch);
            if ch == '*' && next == Some('/') {
                current.push('/');
                index += 2;
                block_comment = false;
                continue;
            }
            index += 1;
            continue;
        }
        if line_comment {
            if ch == '\n' {
                line_comment = false;
                flush_line(&mut output, &mut current, depth, &unit, nl, false);
            } else {
                current.push(ch);
            }
            index += 1;
            continue;
        }
        if let Some(active_quote) = quote {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active_quote {
                quote = None;
            }
            index += 1;
            continue;
        }
        if ch == '/' && next == Some('*') {
            current.push(ch);
            current.push('*');
            block_comment = true;
            index += 2;
            continue;
        }
        if ch == '/' && next == Some('/') {
            current.push(ch);
            current.push('/');
            line_comment = true;
            index += 2;
            continue;
        }
        if ch == '\'' || ch == '"' {
            quote = Some(ch);
            current.push(ch);
            index += 1;
            continue;
        }
        match ch {
            '{' => {
                let header = normalize_fragment(&current, false);
                if header.is_empty() {
                    return Err("style block contains an empty rule header".to_string());
                }
                write_line(&mut output, depth, &unit, &format!("{header} {{"), nl);
                current.clear();
                depth += 1;
            }
            '}' => {
                flush_line(&mut output, &mut current, depth, &unit, nl, false);
                if depth == 0 {
                    return Err("style block contains an unmatched closing brace".to_string());
                }
                depth -= 1;
                write_line(&mut output, depth, &unit, "}", nl);
            }
            ';' => {
                current.push(';');
                flush_line(&mut output, &mut current, depth, &unit, nl, true);
            }
            '\n' => {
                if !current.trim().is_empty() && depth == 0 {
                    flush_line(&mut output, &mut current, depth, &unit, nl, false);
                } else {
                    current.push(' ');
                }
            }
            _ => current.push(ch),
        }
        index += 1;
    }

    if block_comment || quote.is_some() {
        return Err("style block contains an unterminated comment or string".to_string());
    }
    flush_line(&mut output, &mut current, depth, &unit, nl, false);
    if depth != 0 {
        return Err("style block contains an unclosed brace".to_string());
    }
    Ok(output)
}

fn flush_line(
    output: &mut String,
    current: &mut String,
    depth: usize,
    unit: &str,
    nl: &str,
    declaration: bool,
) {
    let value = normalize_fragment(current, declaration);
    current.clear();
    if !value.is_empty() {
        write_line(output, depth, unit, &value, nl);
    }
}

fn normalize_fragment(fragment: &str, declaration: bool) -> String {
    let mut value = fragment.split_whitespace().collect::<Vec<_>>().join(" ");
    if declaration {
        if let Some(colon) = value.find(':') {
            let (left, right) = value.split_at(colon);
            value = format!("{}: {}", left.trim(), right[1..].trim());
        }
    }
    value.trim().to_string()
}

fn write_line(output: &mut String, depth: usize, unit: &str, value: &str, nl: &str) {
    for _ in 0..depth {
        output.push_str(unit);
    }
    output.push_str(value);
    output.push_str(nl);
}
