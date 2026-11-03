//! Scope contract for `run_target_format`: only the explicit target may change.

use std::path::{Path, PathBuf};

use vmz_formatter::{TargetFormatOptions, run_target_format};

struct Scratch(PathBuf);

impl Scratch {
    fn new(name: &str) -> Self {
        let root =
            std::env::temp_dir().join(format!("vmz-format-scope-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("temp root");
        Self(root)
    }

    fn path(&self) -> &Path {
        &self.0
    }

    fn write(&self, rel: &str, content: &str) -> PathBuf {
        let path = self.0.join(rel);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("parent dir");
        std::fs::write(&path, content).expect("write");
        path
    }

    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(self.0.join(rel)).expect("read")
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn options(targets: Vec<PathBuf>) -> TargetFormatOptions {
    TargetFormatOptions { targets, ..TargetFormatOptions::default() }
}

#[test]
fn single_ts_file_only_changes_that_file() {
    let scratch = Scratch::new("ts-single");
    let target = scratch.write("target.ts", "const  x=1");
    scratch.write("sibling.ts", "const  y=2");

    let report = run_target_format(&options(vec![target])).expect("format run");

    assert_eq!(scratch.read("target.ts"), "const x = 1");
    assert_eq!(scratch.read("sibling.ts"), "const  y=2", "sibling must stay untouched");
    assert_eq!(report.formatted, 1);
    assert_eq!(report.unchanged, 0);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn directory_target_stays_inside_the_directory() {
    let scratch = Scratch::new("dir-scope");
    scratch.write("inside/a.ts", "const  x=1");
    scratch.write("inside/nested/b.ts", "const  y=2");
    scratch.write("outside/c.ts", "const  z=3");

    let report =
        run_target_format(&options(vec![scratch.path().join("inside")])).expect("format run");

    assert_eq!(scratch.read("inside/a.ts"), "const x = 1");
    assert_eq!(scratch.read("inside/nested/b.ts"), "const y = 2");
    assert_eq!(scratch.read("outside/c.ts"), "const  z=3", "outside must stay untouched");
    assert_eq!(report.formatted, 2);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn directory_target_skips_rust_without_opt_in() {
    let scratch = Scratch::new("dir-rust-default-off");
    scratch.write("pkg/a.ts", "const  x=1");
    scratch.write("pkg/b.rs", "fn  main() {}\n");

    let report = run_target_format(&options(vec![scratch.path().join("pkg")])).expect("format run");

    assert_eq!(scratch.read("pkg/a.ts"), "const x = 1");
    assert_eq!(scratch.read("pkg/b.rs"), "fn  main() {}\n", "no rust without --rust");
    assert_eq!(report.formatted, 1);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn directory_target_with_rust_opt_in_formats_rs_within_scope() {
    let scratch = Scratch::new("dir-rust-opt-in");
    scratch.write("pkg/Cargo.toml", "[package]\nedition = \"2021\"\n");
    scratch.write("pkg/src/a.rs", "fn  a( ) {}\n");
    scratch.write("pkg/src/nested/b.rs", "fn  b( ) {}\n");
    scratch.write("other/c.rs", "fn  c( ) {}\n");

    let mut opts = options(vec![scratch.path().join("pkg")]);
    opts.rust = Some(true);
    let report = run_target_format(&opts).expect("format run");

    assert_eq!(scratch.read("pkg/src/a.rs"), "fn a() {}\n");
    assert_eq!(scratch.read("pkg/src/nested/b.rs"), "fn b() {}\n");
    assert_eq!(scratch.read("other/c.rs"), "fn  c( ) {}\n", "outside must stay untouched");
    assert_eq!(report.formatted, 2, "report={report:?}");
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn single_rs_file_does_not_follow_mod_children() {
    let scratch = Scratch::new("rs-skip-children");
    scratch.write("pkg/Cargo.toml", "[package]\nedition = \"2021\"\n");
    let lib = scratch.write("pkg/src/lib.rs", "mod child;\nfn  parent( ) {}\n");
    scratch.write("pkg/src/child.rs", "fn  child( ) {}\n");

    let report = run_target_format(&options(vec![lib])).expect("format run");

    assert_eq!(scratch.read("pkg/src/lib.rs"), "mod child;\nfn parent() {}\n");
    assert_eq!(
        scratch.read("pkg/src/child.rs"),
        "fn  child( ) {}\n",
        "rustfmt must not descend into `mod child;`"
    );
    assert_eq!(report.formatted, 1, "report={report:?}");
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn single_rs_file_is_an_explicit_opt_in_without_flag() {
    let scratch = Scratch::new("rs-explicit");
    let target = scratch.write("main.rs", "fn  main( ) {}\n");

    // No Cargo.toml anywhere: edition falls back to 2021 and rust must still
    // run because the explicit `.rs` path is itself the opt-in.
    let report = run_target_format(&options(vec![target])).expect("format run");

    assert_eq!(scratch.read("main.rs"), "fn main() {}\n");
    assert_eq!(report.formatted, 1);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn rust_veto_rejects_rs_file_target() {
    let scratch = Scratch::new("rs-veto");
    let target = scratch.write("main.rs", "fn  main( ) {}\n");

    let mut opts = options(vec![target]);
    opts.rust = Some(false);
    let report = run_target_format(&opts).expect("format run");

    assert_eq!(scratch.read("main.rs"), "fn  main( ) {}\n", "vetoed target untouched");
    assert_eq!(report.errors.len(), 1, "errors={:?}", report.errors);
    assert!(report.errors[0].contains("rejected"), "errors={:?}", report.errors);
}

#[test]
fn missing_target_is_an_error() {
    let scratch = Scratch::new("missing");
    let report = run_target_format(&options(vec![scratch.path().join("nope.ts")]));
    let err = report.expect_err("missing target must fail");
    assert!(err.contains("does not exist"), "err={err}");
}

#[test]
fn empty_target_list_is_an_error() {
    let report = run_target_format(&options(vec![]));
    let err = report.expect_err("empty targets must fail");
    assert!(err.contains("no explicit target"), "err={err}");
}

#[test]
fn unsupported_extension_is_an_error() {
    let scratch = Scratch::new("unsupported");
    let target = scratch.write("notes.txt", "hello\n");

    let report = run_target_format(&options(vec![target])).expect("format run");

    assert_eq!(report.errors.len(), 1, "errors={:?}", report.errors);
    assert!(report.errors[0].contains("unsupported format target"), "errors={:?}", report.errors);
}

#[test]
fn directory_without_targets_is_an_error() {
    let scratch = Scratch::new("dir-empty");
    scratch.write("empty/.gitkeep", "");

    let report =
        run_target_format(&options(vec![scratch.path().join("empty")])).expect("format run");

    assert_eq!(report.errors.len(), 1, "errors={:?}", report.errors);
    assert!(report.errors[0].contains("no formattable targets"), "errors={:?}", report.errors);
}

#[test]
fn single_vmz_file_only_changes_that_file() {
    let scratch = Scratch::new("vmz-single");
    let sfc = |decl: &str| {
        format!(
            "<template><p>hi</p></template>\n<script client>\n{decl}\nexport default class App {{}}\n</script>\n"
        )
    };
    let target = scratch.write("Target.vmz", &sfc("const  x=1"));
    scratch.write("Sibling.vmz", &sfc("const  y=2"));

    let report = run_target_format(&options(vec![target])).expect("format run");

    let after = scratch.read("Target.vmz");
    assert!(after.contains("const x = 1"), "after={after}");
    assert!(scratch.read("Sibling.vmz").contains("const  y=2"), "sibling must stay untouched");
    assert_eq!(report.formatted, 1, "report={report:?}");
    assert_eq!(report.need_write, 0, "report={report:?}");
    assert!(
        !report.diagnostics.iter().any(|d| d.is_error()),
        "diagnostics={:?}",
        report.diagnostics
    );
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn single_vmz_file_check_mode_counts_would_change() {
    let scratch = Scratch::new("vmz-check");
    let target = scratch.write(
        "Target.vmz",
        "<template><p>hi</p></template>\n<script client>\nconst  x=1\nexport default class App {}\n</script>\n",
    );
    let before = scratch.read("Target.vmz");

    let mut opts = options(vec![target]);
    opts.check = true;
    let report = run_target_format(&opts).expect("format run");

    assert_eq!(scratch.read("Target.vmz"), before, "check mode must not write");
    assert_eq!(report.formatted, 0);
    assert_eq!(report.need_write, 1, "report={report:?}");
}

#[test]
fn check_mode_writes_nothing_and_counts_would_change() {
    let scratch = Scratch::new("check-mode");
    let target = scratch.write("target.ts", "const  x=1");

    let mut opts = options(vec![target]);
    opts.check = true;
    let report = run_target_format(&opts).expect("format run");

    assert_eq!(scratch.read("target.ts"), "const  x=1", "check mode must not write");
    assert_eq!(report.formatted, 0);
    assert_eq!(report.need_write, 1);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}

#[test]
fn excludes_narrow_directory_targets() {
    let scratch = Scratch::new("dir-excludes");
    scratch.write("pkg/keep.ts", "const  x=1");
    scratch.write("pkg/gen/skip.ts", "const  y=2");

    let mut opts = options(vec![scratch.path().join("pkg")]);
    opts.excludes = Some(vec!["**/gen/**".to_string()]);
    let report = run_target_format(&opts).expect("format run");

    assert_eq!(scratch.read("pkg/keep.ts"), "const x = 1");
    assert_eq!(scratch.read("pkg/gen/skip.ts"), "const  y=2", "excluded file untouched");
    assert_eq!(report.formatted, 1);
    assert!(report.errors.is_empty(), "errors={:?}", report.errors);
}
