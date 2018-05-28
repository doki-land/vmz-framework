//! Minimal template IR: elements, text, `{expr}` interpolations.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplateNode {
    Element { tag: String, attrs: Vec<TemplateAttr>, children: Vec<TemplateNode> },
    Text(String),
    Interp(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateAttr {
    pub name: String,
    pub value: AttrValue,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AttrValue {
    Static(String),
    Interp(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateIr {
    pub roots: Vec<TemplateNode>,
}

pub fn parse_template(input: &str) -> TemplateIr {
    let mut parser = Parser { input, pos: 0 };
    let mut roots = Vec::new();
    while parser.pos < parser.input.len() {
        if let Some(node) = parser.parse_node() {
            roots.push(node);
        } else {
            break;
        }
    }
    TemplateIr { roots }
}

struct Parser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> Parser<'a> {
    fn rest(&self) -> &'a str {
        &self.input[self.pos..]
    }

    fn peek(&self) -> Option<char> {
        self.rest().chars().next()
    }

    fn starts_with(&self, s: &str) -> bool {
        self.rest().starts_with(s)
    }

    fn bump(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.pos += ch.len_utf8();
        Some(ch)
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(c) if c.is_whitespace()) {
            self.bump();
        }
    }

    fn parse_node(&mut self) -> Option<TemplateNode> {
        self.skip_ws();
        if self.pos >= self.input.len() {
            return None;
        }
        if self.starts_with("<!--") {
            self.skip_comment();
            return self.parse_node();
        }
        if self.starts_with("{") {
            return self.parse_interp().map(TemplateNode::Interp);
        }
        if self.starts_with("</") {
            return None;
        }
        if self.starts_with("<") {
            return self.parse_element();
        }
        self.parse_text()
    }

    fn skip_comment(&mut self) {
        self.pos += 4; // <!--
        if let Some(end) = self.rest().find("-->") {
            self.pos += end + 3;
        } else {
            self.pos = self.input.len();
        }
    }

    fn parse_interp(&mut self) -> Option<String> {
        self.bump()?; // {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == '}' {
                let expr = self.input[start..self.pos].trim().to_string();
                self.bump();
                return Some(expr);
            }
            self.bump();
        }
        None
    }

    fn parse_text(&mut self) -> Option<TemplateNode> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == '<' || c == '{' {
                break;
            }
            self.bump();
        }
        let text = self.input[start..self.pos].to_string();
        if text.trim().is_empty() {
            return self.parse_node();
        }
        Some(TemplateNode::Text(text))
    }

    fn parse_element(&mut self) -> Option<TemplateNode> {
        self.bump()?; // <
        let tag = self.parse_ident()?;
        let mut attrs = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with("/>") {
                self.pos += 2;
                return Some(TemplateNode::Element { tag, attrs, children: Vec::new() });
            }
            if self.starts_with(">") {
                self.bump();
                break;
            }
            let name = self.parse_ident()?;
            self.skip_ws();
            let value = if self.starts_with("=") {
                self.bump();
                self.skip_ws();
                if self.starts_with("{") {
                    AttrValue::Interp(self.parse_interp()?)
                } else if self.starts_with("\"") || self.starts_with("'") {
                    AttrValue::Static(self.parse_quoted()?)
                } else {
                    AttrValue::Static(String::new())
                }
            } else {
                AttrValue::Static(String::new())
            };
            attrs.push(TemplateAttr { name, value });
        }

        let mut children = Vec::new();
        loop {
            self.skip_ws();
            if self.starts_with(&format!("</{tag}>")) {
                self.pos += tag.len() + 3;
                break;
            }
            if self.pos >= self.input.len() {
                break;
            }
            if let Some(child) = self.parse_node() {
                children.push(child);
            } else if self.starts_with("</") {
                // mismatched close ?stop
                break;
            } else {
                break;
            }
        }

        Some(TemplateNode::Element { tag, attrs, children })
    }

    fn parse_ident(&mut self) -> Option<String> {
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == ':' {
                self.bump();
            } else {
                break;
            }
        }
        if start == self.pos {
            return None;
        }
        Some(self.input[start..self.pos].to_string())
    }

    fn parse_quoted(&mut self) -> Option<String> {
        let quote = self.bump()?;
        let start = self.pos;
        while let Some(c) = self.peek() {
            if c == quote {
                let val = self.input[start..self.pos].to_string();
                self.bump();
                return Some(val);
            }
            self.bump();
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_interp() {
        let ir = parse_template("<h2>{user.name}</h2>");
        assert_eq!(ir.roots.len(), 1);
        match &ir.roots[0] {
            TemplateNode::Element { tag, children, .. } => {
                assert_eq!(tag, "h2");
                assert!(matches!(&children[0], TemplateNode::Interp(s) if s == "user.name"));
            }
            _ => panic!("expected element"),
        }
    }

    #[test]
    fn skips_html_comments() {
        let ir = parse_template("<!-- auto -->\n<CounterButton initial={0} />");
        assert_eq!(ir.roots.len(), 1);
        match &ir.roots[0] {
            TemplateNode::Element { tag, attrs, .. } => {
                assert_eq!(tag, "CounterButton");
                assert_eq!(attrs.len(), 1);
                assert_eq!(attrs[0].name, "initial");
                assert!(matches!(&attrs[0].value, AttrValue::Interp(s) if s == "0"));
            }
            _ => panic!("expected component"),
        }
    }

    #[test]
    fn parses_if_attr() {
        let ir = parse_template(r#"<p if={!user}>Loading</p>"#);
        match &ir.roots[0] {
            TemplateNode::Element { tag, attrs, .. } => {
                assert_eq!(tag, "p");
                assert_eq!(attrs[0].name, "if");
                assert!(matches!(&attrs[0].value, AttrValue::Interp(s) if s == "!user"));
            }
            _ => panic!("expected element"),
        }
    }
}
