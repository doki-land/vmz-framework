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
    let mut lines: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    let mut block_comment = false;
    let mut line_comment = false;
    let mut layout = LineState::default();
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
                emit_statement(
                    &mut output,
                    &mut lines,
                    &mut current,
                    depth,
                    &unit,
                    nl,
                    false,
                    &mut layout,
                );
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
                if lines.iter().all(|line| line.trim().is_empty()) && current.trim().is_empty() {
                    return Err("style block contains an empty rule header".to_string());
                }
                current.push('{');
                emit_statement(
                    &mut output,
                    &mut lines,
                    &mut current,
                    depth,
                    &unit,
                    nl,
                    false,
                    &mut layout,
                );
                depth += 1;
                layout.just_flushed = true;
            }
            '}' => {
                emit_statement(
                    &mut output,
                    &mut lines,
                    &mut current,
                    depth,
                    &unit,
                    nl,
                    false,
                    &mut layout,
                );
                if depth == 0 {
                    return Err("style block contains an unmatched closing brace".to_string());
                }
                depth -= 1;
                layout.blank_line = false;
                write_line(&mut output, depth, &unit, "}", nl, &mut layout);
                layout.just_flushed = true;
            }
            ';' => {
                current.push(';');
                emit_statement(
                    &mut output,
                    &mut lines,
                    &mut current,
                    depth,
                    &unit,
                    nl,
                    true,
                    &mut layout,
                );
                layout.just_flushed = true;
            }
            '\n' => {
                if current.trim().is_empty() {
                    current.clear();
                    if !lines.is_empty() {
                        // The newline that ended the last line was already consumed,
                        // so this one is a blank line separator.
                        emit_statement(
                            &mut output,
                            &mut lines,
                            &mut current,
                            depth,
                            &unit,
                            nl,
                            false,
                            &mut layout,
                        );
                        if !output.is_empty() {
                            layout.blank_line = true;
                        }
                    } else if layout.just_flushed {
                        layout.just_flushed = false;
                    } else if !output.is_empty() {
                        layout.blank_line = true;
                    }
                } else {
                    lines.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
        index += 1;
    }

    if block_comment || quote.is_some() {
        return Err("style block contains an unterminated comment or string".to_string());
    }
    emit_statement(&mut output, &mut lines, &mut current, depth, &unit, nl, false, &mut layout);
    if depth != 0 {
        return Err("style block contains an unclosed brace".to_string());
    }
    Ok(output)
}

/// Tracks whether the emitter still owes a blank separator and whether the
/// source newline after the last written line has not been consumed yet.
#[derive(Default)]
struct LineState {
    blank_line: bool,
    just_flushed: bool,
}

/// Emit the statement collected so far, keeping its original line structure.
fn emit_statement(
    output: &mut String,
    lines: &mut Vec<String>,
    current: &mut String,
    depth: usize,
    unit: &str,
    nl: &str,
    declaration: bool,
    layout: &mut LineState,
) {
    if !current.trim().is_empty() {
        lines.push(std::mem::take(current));
    } else {
        current.clear();
    }
    if lines.is_empty() {
        return;
    }
    let rendered = render_statement(lines, depth, unit, declaration);
    lines.clear();
    write_line(output, 0, "", &rendered, nl, layout);
}

/// Re-indent one statement while preserving relative indentation between its
/// lines, so multi-line values and selector lists keep their shape.
fn render_statement(lines: &[String], depth: usize, unit: &str, declaration: bool) -> String {
    let body: Vec<&str> = lines
        .iter()
        .flat_map(|line| line.split('\n'))
        .filter(|line| !line.trim().is_empty())
        .collect();
    let min_indent = body.iter().map(|line| indent_width(line)).min().unwrap_or(0);
    let declaration_line =
        declaration.then(|| body.iter().position(|line| !is_comment_line(line))).flatten();
    let mut rendered = String::new();
    for (position, line) in body.iter().enumerate() {
        if position > 0 {
            rendered.push('\n');
        }
        rendered.push_str(&unit.repeat(depth));
        for _ in 0..indent_width(line).saturating_sub(min_indent) {
            rendered.push(' ');
        }
        let mut value = normalize_line(line.trim(), declaration_line == Some(position));
        // A rule header keeps one space before its opening brace.
        if value.ends_with('{') && !value.ends_with(" {") {
            value.insert(value.len() - 1, ' ');
        }
        rendered.push_str(&value);
    }
    rendered
}

fn indent_width(line: &str) -> usize {
    line.len() - line.trim_start().len()
}

fn is_comment_line(line: &str) -> bool {
    let trimmed = line.trim_start();
    trimmed.starts_with("/*") || trimmed.starts_with("//")
}

fn normalize_line(fragment: &str, declaration: bool) -> String {
    let mut value = fragment.split_whitespace().collect::<Vec<_>>().join(" ");
    // Wrapped function arguments carry a leading space after the join, so
    // `var( --x )` would otherwise stay padded.
    value = value.replace("( ", "(").replace(" )", ")");
    if declaration {
        if let Some(colon) = value.find(':') {
            let (left, right) = value.split_at(colon);
            value = format!("{}: {}", left.trim(), right[1..].trim());
        }
    }
    value.trim().to_string()
}

fn write_line(
    output: &mut String,
    depth: usize,
    unit: &str,
    value: &str,
    nl: &str,
    layout: &mut LineState,
) {
    if layout.blank_line && !output.is_empty() {
        output.push_str(nl);
    }
    layout.blank_line = false;
    layout.just_flushed = false;
    for _ in 0..depth {
        output.push_str(unit);
    }
    output.push_str(value);
    output.push_str(nl);
}
