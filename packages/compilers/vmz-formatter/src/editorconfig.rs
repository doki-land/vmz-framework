//! Resolve EditorConfig for a `.vmz` path into formatter envelope settings.

use std::collections::HashMap;
use std::path::Path;

use oxc_formatter::JsFormatOptions;
use oxc_formatter_core::{IndentStyle, IndentWidth, LineEnding, LineWidth};
use oxc_formatter_css::{CssFormatOptions, CssVariant};

/// Resolved EditorConfig (+ defaults) for one file.
#[derive(Debug, Clone)]
pub struct EditorSettings {
    /// Indent with tabs when true; spaces otherwise.
    pub use_tabs: bool,
    /// Spaces per indent level (or visual width when tabs).
    pub indent_width: u8,
    /// Preferred print width when EditorConfig sets `max_line_length`.
    pub line_width: Option<u16>,
    /// Output line ending for the whole SFC.
    pub end_of_line: EndOfLine,
    /// Whether the file must end with a newline.
    pub insert_final_newline: bool,
    /// Strip trailing whitespace on envelope lines (template / data / non-TS).
    pub trim_trailing_whitespace: bool,
}

/// Line ending style from EditorConfig `end_of_line`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndOfLine {
    /// `\n`
    Lf,
    /// `\r\n`
    Crlf,
    /// `\r`
    Cr,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            use_tabs: false,
            indent_width: 2,
            line_width: None,
            end_of_line: EndOfLine::Lf,
            insert_final_newline: true,
            trim_trailing_whitespace: true,
        }
    }
}

impl EditorSettings {
    /// Indent string for one level of template / data-block envelope.
    pub fn indent_unit(&self) -> String {
        if self.use_tabs { "\t".to_string() } else { " ".repeat(usize::from(self.indent_width)) }
    }

    /// Line break sequence for SFC assembly.
    pub fn newline(&self) -> &'static str {
        match self.end_of_line {
            EndOfLine::Lf => "\n",
            EndOfLine::Crlf => "\r\n",
            EndOfLine::Cr => "\r",
        }
    }

    fn core_indent_style(&self) -> IndentStyle {
        if self.use_tabs { IndentStyle::Tab } else { IndentStyle::Space }
    }

    fn core_indent_width(&self) -> IndentWidth {
        IndentWidth::try_from(self.indent_width).unwrap_or_default()
    }

    fn core_line_ending(&self) -> LineEnding {
        match self.end_of_line {
            EndOfLine::Lf => LineEnding::Lf,
            EndOfLine::Crlf => LineEnding::Crlf,
            EndOfLine::Cr => LineEnding::Cr,
        }
    }

    fn core_line_width(&self) -> Option<LineWidth> {
        self.line_width.and_then(|w| LineWidth::try_from(w).ok())
    }

    /// Map into oxc JS/TS format options.
    pub fn js_options(&self) -> JsFormatOptions {
        let mut options = JsFormatOptions::default();
        options.indent_style = self.core_indent_style();
        options.indent_width = self.core_indent_width();
        options.line_ending = self.core_line_ending();
        if let Some(lw) = self.core_line_width() {
            options.line_width = lw;
        }
        options
    }

    /// Map into oxc CSS format options for the given dialect.
    pub fn css_options(&self, variant: CssVariant) -> CssFormatOptions {
        let mut options = CssFormatOptions::default();
        options.indent_style = self.core_indent_style();
        options.indent_width = self.core_indent_width();
        options.line_ending = self.core_line_ending();
        options.variant = variant;
        if let Some(lw) = self.core_line_width() {
            options.line_width = lw;
        }
        options
    }
}

/// Resolve EditorConfig for `path` (must be a file path). Falls back to defaults on error.
pub fn resolve_for_path(path: &Path) -> EditorSettings {
    let mut settings = EditorSettings::default();
    let Ok(canon) = path.canonicalize().or_else(|_| {
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        parent.canonicalize().map(|p| p.join(path.file_name().unwrap_or_default()))
    }) else {
        return settings;
    };
    let Ok(map) = editorconfig::get_config(&canon) else {
        return settings;
    };
    let flat: HashMap<String, String> =
        map.into_iter().map(|(k, v)| (k.to_ascii_lowercase(), v)).collect();
    apply_map(&mut settings, &flat);
    settings
}

fn apply_map(settings: &mut EditorSettings, map: &HashMap<String, String>) {
    if let Some(val) = map.get("indent_style") {
        settings.use_tabs = val.eq_ignore_ascii_case("tab");
    }
    if let Some(val) = map.get("indent_size") {
        if val.eq_ignore_ascii_case("tab") {
            settings.use_tabs = true;
        } else if let Ok(n) = val.parse::<u8>() {
            settings.indent_width = n.clamp(1, 16);
        }
    }
    if let Some(val) = map.get("tab_width")
        && let Ok(n) = val.parse::<u8>()
    {
        settings.indent_width = n.clamp(1, 16);
    }
    if let Some(val) = map.get("max_line_length")
        && !val.eq_ignore_ascii_case("off")
        && let Ok(n) = val.parse::<u16>()
    {
        settings.line_width = Some(n.clamp(20, 1000));
    }
    if let Some(val) = map.get("end_of_line") {
        settings.end_of_line = match val.to_ascii_lowercase().as_str() {
            "crlf" => EndOfLine::Crlf,
            "cr" => EndOfLine::Cr,
            _ => EndOfLine::Lf,
        };
    }
    if let Some(val) = map.get("insert_final_newline") {
        settings.insert_final_newline = val.eq_ignore_ascii_case("true");
    }
    if let Some(val) = map.get("trim_trailing_whitespace") {
        settings.trim_trailing_whitespace = val.eq_ignore_ascii_case("true");
    }
}
