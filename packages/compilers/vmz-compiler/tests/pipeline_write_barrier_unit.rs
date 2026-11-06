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
fn wraps_array_mutator_args_in_one_array() {
    let src = r#"
export default class Demo {
  tags = [];
  cells = [];
  groups: string[][] = [];
  add(tag: { id: string }) {
    this.tags.push(tag);
  }
  insert(i: number, cell: { id: string }) {
    this.cells.splice(i + 1, 0, cell);
  }
  drop() {
    this.tags.pop();
  }
  nested(i: number, x: string) {
    this.groups[i].push(x);
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["tags", "cells", "groups"]));
    assert!(
        out.source.contains("__vmzArrayMutate(this, \"tags\", [], \"push\", [tag])"),
        "push arg must be an array literal:\n{}",
        out.source
    );
    assert!(
        out.source.contains("__vmzArrayMutate(this, \"cells\", [], \"splice\", [i + 1, 0, cell])"),
        "splice args must stay one array literal:\n{}",
        out.source
    );
    assert!(
        out.source.contains("__vmzArrayMutate(this, \"tags\", [], \"pop\", [])"),
        "zero-arg mutator passes an explicit empty array:\n{}",
        out.source
    );
    assert!(
        out.source.contains("__vmzArrayMutate(this, \"groups\", [i], \"push\", [x])"),
        "nested array mutator keeps a live index and array args:\n{}",
        out.source
    );
}

#[test]
fn renders_computed_root_index_as_live_expression() {
    let src = r#"
export default class Demo {
  cells = [{ id: "a", text: "x" }];
  patch(i: number, v: { id: string; text: string }) {
    this.cells[i] = v;
  }
  bump(i: number) {
    this.cells[i]++;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["cells"]));
    assert!(
        out.source.contains("__vmzWritePath(this, \"cells\", [i], v)"),
        "computed index must stay a live expression:\n{}",
        out.source
    );
    assert!(
        out.source.contains("__vmzWritePathCompound(this, \"cells\", [i], \"+\", 1)"),
        "computed index update must stay a live expression:\n{}",
        out.source
    );
    assert!(
        !out.source.contains("[\"i\"]"),
        "computed index must not freeze into a string literal:\n{}",
        out.source
    );
}

#[test]
fn keeps_two_segment_object_paths_off_the_array_item_fast_path() {
    let src = r#"
export default class Demo {
  user = { address: { city: "a" } };
  move(city: string) {
    this.user.address.city = city;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["user"]));
    assert!(
        out.source.contains("__vmzWritePath(this, \"user\", [\"address\", \"city\"], city)"),
        "two static segments are an object path:\n{}",
        out.source
    );
    assert!(
        !out.source.contains("__vmzWritePathItem"),
        "object paths must not lower to the array item helper:\n{}",
        out.source
    );
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
fn oak_transpose_rewrites_numeric_indices_without_fallback() {
    let source = r#"export default class Demo {
  swapRows() {
    const rows = this.rows.slice();
    if (rows.length > 998) {
      const tmp = rows[1];
      rows[1] = rows[998];
      rows[998] = tmp;
      this.rows = rows;
    }
  }
}"#;
    let result = vmz_compiler::pipeline::write_barrier_oak::rewrite_list_transpose(
        source,
        &owned(&["rows"]),
    )
    .expect("Oak parse");
    assert_eq!(result.rewritten, 1, "{}", result.source);
    assert!(result.source.contains("__vmzListTranspose(this, \"rows\", 1, 998)"));
    assert!(!result.source.contains(".slice()"));
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

#[test]
fn leaves_root_field_postfix_update() {
    let src = r#"
export default class Demo {
  count = 0;
  bump() {
    this.count++;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["count"]));
    assert_eq!(out.rewritten, 0, "root update must stay plain:\n{}", out.source);
    assert!(out.source.contains("this.count++"));
    assert!(
        !out.source.contains("__vmzWritePathCompound(this, \"count\", []"),
        "empty path write:\n{}",
        out.source
    );
}

#[test]
fn leaves_root_field_prefix_update() {
    let src = r#"
export default class Demo {
  count = 0;
  bump() {
    ++this.count;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["count"]));
    assert_eq!(out.rewritten, 0, "root update must stay plain:\n{}", out.source);
    assert!(out.source.contains("++this.count"));
    assert!(!out.source.contains("__vmzWritePathCompound(this, \"count\", []"));
}

#[test]
fn leaves_root_field_decrements() {
    let src = r#"
export default class Demo {
  count = 0;
  drop() {
    this.count--;
    --this.count;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["count"]));
    assert_eq!(out.rewritten, 0, "root decrement must stay plain:\n{}", out.source);
    assert!(out.source.contains("this.count--"));
    assert!(out.source.contains("--this.count"));
    assert!(!out.source.contains("__vmzWritePathCompound(this, \"count\", []"));
}

#[test]
fn ignores_local_update() {
    let src = r#"
export default class Demo {
  count = 0;
  bump() {
    let n = 0;
    n++;
    this.count = n;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["count"]));
    assert!(out.source.contains("n++"), "local update untouched:\n{}", out.source);
    assert!(!out.source.contains("__vmzWritePathCompound"));
}

#[test]
fn no_emit_contains_empty_path_writes() {
    let src = r#"
export default class Demo {
  count = 0;
  user = { count: 0 };
  flags = { on: false };
  bump() {
    this.count++;
    ++this.count;
    this.count--;
    --this.count;
    this.user.count++;
    this.user.count += 2;
    this.flags.on ||= true;
    this.user.count = 3;
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["count", "user", "flags"]));
    assert!(
        !out.source.contains(", [], ") && !out.source.contains(", [])"),
        "empty path write must never be emitted:\n{}",
        out.source
    );
    assert!(out.source.contains("__vmzWritePathCompound(this, \"user\", [\"count\"], \"+\", 1)"));
    assert!(out.source.contains("__vmzWritePathCompound(this, \"user\", [\"count\"], \"+\", 2)"));
    assert!(out.source.contains("__vmzWritePathLogical(this, \"flags\", [\"on\"], \"||\""));
    assert!(out.source.contains("__vmzWritePath(this, \"user\", [\"count\"], 3)"));
    assert!(out.source.contains("this.count++"));
    assert!(out.source.contains("++this.count"));
    assert!(out.source.contains("this.count--"));
    assert!(out.source.contains("--this.count"));
}

#[test]
fn rewrites_nested_writes_inside_arrow_callbacks() {
    let src = r#"
export default class Demo {
  board = { meta: { count: 0 } };
  later() {
    Promise.resolve().then(() => {
      this.board.meta.count = 1;
    });
    setTimeout(() => {
      this.board.meta.count = 2;
    }, 0);
    this.board.items.forEach((item) => {
      this.board.meta.count = item.n;
    });
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["board"]));
    assert_eq!(out.rewritten, 3, "emit:\n{}", out.source);
    assert!(!out.source.contains("this.board.meta.count ="), "bare write:\n{}", out.source);
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 1)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 2)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], item.n)"));
}

#[test]
fn rewrites_nested_writes_inside_statement_containers() {
    let src = r#"
export default class Demo {
  board = { meta: { count: 0 }, tags: [] };
  scan() {
    for (const tag of this.board.tags) {
      this.board.meta.count = tag.n;
    }
    switch (this.board.tags.length) {
      case 0:
        this.board.meta.count = 3;
        break;
      default:
        this.board.meta.count = 4;
    }
    try {
      this.board.meta.count = 5;
    } catch {
      this.board.meta.count = 6;
    }
    let guard = 0;
    while (guard < 1) {
      guard++;
      this.board.meta.count = 7;
    }
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["board"]));
    assert_eq!(out.rewritten, 6, "emit:\n{}", out.source);
    assert!(!out.source.contains("this.board.meta.count ="), "bare write:\n{}", out.source);
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], tag.n)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 3)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 4)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 5)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 6)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"count\"], 7)"));
}

#[test]
fn rewrites_nested_writes_in_conditional_alternate() {
    let src = r#"
export default class Demo {
  board = { meta: { a: 0, b: 0 } };
  pick(flag: boolean) {
    flag ? (this.board.meta.a = 1) : (this.board.meta.b = 2);
  }
}
"#;
    let out = rewrite_static_path_writes(src, &owned(&["board"]));
    assert_eq!(out.rewritten, 2, "emit:\n{}", out.source);
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"a\"], 1)"));
    assert!(out.source.contains("__vmzWritePath(this, \"board\", [\"meta\", \"b\"], 2)"));
}
