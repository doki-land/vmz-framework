//! Moved from `src/pipeline/write_barrier.rs` (cargo-cry: tests next to Cargo.toml).

use std::collections::HashSet;

use vmz_compiler::pipeline::write_barrier::*;

fn owned(names: &[&str]) -> HashSet<String> {
    names.iter().map(|s| (*s).to_string()).collect()
}

#[test]
fn rewrites_nested_static_assign() {
    let src = r#"
export default class Demo {
  user = { name: "a", bio: "b" };
  setName(n: string) {
    this.user.name = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzWritePath(this, \"user\", [\"name\"]"));
    assert!(!out.source.contains("this.user.name ="));
}

#[test]
fn leaves_field_root_assign() {
    let src = r#"
export default class Demo {
  user = null;
  load() {
    this.user = { name: "x" };
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 0);
    assert!(out.source.contains("this.user = { name: \"x\" }"));
}

#[test]
fn rewrites_alias_path_assign() {
    let src = r#"
export default class Demo {
  user = { name: "a", bio: "b" };
  setViaAlias(n: string) {
    const u = this.user;
    u.name = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzWritePath(this, \"user\", [\"name\"]"));
    assert!(!out.source.contains("u.name ="));
}

#[test]
fn rewrites_array_push() {
    let src = r#"
export default class Demo {
  tags = [];
  add(tag: { id: string; label: string }) {
    this.tags.push(tag);
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["tags"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzArrayMutate(this, \"tags\", [], \"push\""));
}

#[test]
fn rewrites_static_index_leaf() {
    let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  setLabel(n: string) {
    this.tags[0].label = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["tags"]));
    assert_eq!(out.rewritten, 1);
    assert!(
        out.source.contains("__vmzWritePathItem(this, \"tags\", 0, \"label\"")
            || out.source.contains("__vmzWritePath(this, \"tags\", [\"0\", \"label\"]"),
        "{}",
        out.source
    );
}

#[test]
fn rewrites_dynamic_index_leaf() {
    let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  selected = 0;
  setLabel(n: string) {
    this.tags[this.selected].label = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["tags", "selected"]));
    assert_eq!(out.rewritten, 1);
    assert!(
        out.source.contains("__vmzWritePathItem(this, \"tags\", this.selected, \"label\"")
            || out.source.contains("__vmzWritePath(this, \"tags\""),
        "{}",
        out.source
    );
    assert!(!out.source.contains("this.tags[this.selected].label ="));
}

#[test]
fn rewrites_dynamic_index_ident() {
    let src = r#"
export default class Demo {
  tags = [{ id: "a", label: "A" }];
  setAt(i: number, n: string) {
    this.tags[i].label = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["tags"]));
    assert_eq!(out.rewritten, 1);
    assert!(
        out.source.contains("__vmzWritePathItem(this, \"tags\", i, \"label\""),
        "{}",
        out.source
    );
}

#[test]
fn rewrites_compound_assign() {
    let src = r#"
export default class Demo {
  user = { count: 0 };
  bump() {
    this.user.count += 1;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(
        out.source.contains("__vmzWritePathCompound(this, \"user\", [\"count\"], \"+\", 1)")
            || out.source.contains("__vmzWritePathCompoundItem")
    );
    assert!(!out.source.contains("this.user.count +="));
    assert!(!out.source.contains("__vmzReadPath"));
}

#[test]
fn rewrites_update_expression() {
    let src = r#"
export default class Demo {
  user = { count: 0 };
  bump() {
    this.user.count++;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzWritePathCompound(this, \"user\", [\"count\"], \"+\", 1)"));
    assert!(!out.source.contains("this.user.count++"));
    assert!(!out.source.contains("__vmzReadPath"));
}

#[test]
fn rewrites_logical_or_assign() {
    let src = r#"
export default class Demo {
  user = { flag: "" };
  ensure() {
    this.user.flag ||= "on";
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzWritePathLogical(this, \"user\", [\"flag\"], \"||\""));
    assert!(!out.source.contains("this.user.flag ||="));
}

#[test]
fn rewrites_nullish_assign() {
    let src = r#"
export default class Demo {
  user = { name: null as string | null };
  ensure() {
    this.user.name ??= "anon";
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert_eq!(out.rewritten, 1);
    assert!(out.source.contains("__vmzWritePathLogical(this, \"user\", [\"name\"], \"??\""));
}

#[test]
fn rewrites_jfb_swap_rows_to_list_transpose() {
    let src = r#"
export default class Demo {
  rows = [];
  swapRows() {
    const rows = this.rows.slice();
    if (rows.length > 998) {
      const tmp = rows[1];
      rows[1] = rows[998];
      rows[998] = tmp;
      this.rows = rows;
    }
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["rows"]));
    assert!(out.rewritten >= 1, "expected transpose rewrite, got {}", out.rewritten);
    assert!(
        out.source.contains("__vmzListTranspose(this, \"rows\", 1, 998)"),
        "emit:\n{}",
        out.source
    );
    assert!(!out.source.contains(".slice()"));
    assert!(!out.source.contains("this.rows = rows"));
}

#[test]
fn rewrites_alias_compound_array_item() {
    let src = r#"
export default class Demo {
  rows = [{ id: 1, label: "a" }];
  update() {
    const rows = this.rows;
    for (let i = 0; i < rows.length; i += 10) {
      rows[i].label += " !!!";
    }
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["rows"]));
    assert!(out.rewritten >= 1, "expected stride rewrite, got {}", out.rewritten);
    assert!(
        out.source.contains(
            "__vmzArrayItemCompoundStride(this, \"rows\", \"label\", \"+\", \" !!!\", 0, 10)"
        ),
        "emit:\n{}",
        out.source
    );
    assert!(!out.source.contains("__vmzReadPath"));
    assert!(!out.source.contains("rows[i].label +="));
    assert!(!out.source.contains("for ("));
    assert!(
        !out.source.contains("const rows = this.rows"),
        "dead alias should be absorbed:\n{}",
        out.source
    );
}

#[test]
fn rewrites_single_alias_compound_item() {
    let src = r#"
export default class Demo {
  rows = [{ id: 1, label: "a" }];
  bump(i: number) {
    const rows = this.rows;
    rows[i].label += " !!!";
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["rows"]));
    assert!(out.rewritten >= 1, "expected compound item rewrite, got {}", out.rewritten);
    assert!(
        out.source
            .contains("__vmzWritePathCompoundItem(this, \"rows\", i, \"label\", \"+\", \" !!!\")"),
        "emit:\n{}",
        out.source
    );
    assert!(!out.source.contains("__vmzReadPath"));
    assert!(!out.source.contains("rows[i].label +="));
}
