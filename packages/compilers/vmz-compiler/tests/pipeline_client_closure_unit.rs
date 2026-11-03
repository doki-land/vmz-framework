//! Client helper closure: pages emit only the `src/` modules reachable from
//! unit client scripts through relative specifiers. Unreferenced modules are
//! never compiled, never emitted and cannot fail the pages build.

use std::fs;
use std::path::Path;

use vmz_compiler::pipeline::compile::{CompileOptions, compile_project, compile_project_with_dirty};

fn scaffold(dir: &Path) {
    let _ = fs::remove_dir_all(dir);
    fs::create_dir_all(dir.join("src/pages")).unwrap();
    fs::create_dir_all(dir.join("src/lib/nested")).unwrap();
    fs::create_dir_all(dir.join("src/lib/pkg")).unwrap();
    fs::create_dir_all(dir.join("designs/tokens")).unwrap();
    fs::write(
        dir.join("designs/theme.json"),
        r#"{"default":"default","activationAttr":"data-theme"}"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/Application.vmz"),
        r#"<template><slot /></template>
<script client>
export default class Application {}
</script>
"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/pages/index.vmz"),
        r#"<template><p>{{ label }}</p></template>
<script client>
import { used } from '../lib/used';
import { nah } from '../lib/missing';
export default class Index {
    label = used();
}
</script>
"#,
    )
    .unwrap();
    fs::write(
        dir.join("src/lib/used.ts"),
        "import { tool } from './nested/tool';\n\
         import { direct } from './direct.js';\n\
         import { version } from './pkg';\n\
         export function used() { return tool() + direct + version; }\n",
    )
    .unwrap();
    fs::write(dir.join("src/lib/nested/tool.ts"), "export function tool() { return 'ok'; }\n")
        .unwrap();
    fs::write(dir.join("src/lib/direct.ts"), "export const direct = 'd';\n").unwrap();
    fs::write(dir.join("src/lib/pkg/index.ts"), "export const version = 1;\n").unwrap();
    // Not reachable from any unit client script: must not be compiled or
    // emitted, even though the source is not valid TypeScript.
    fs::write(dir.join("src/lib/unused.ts"), "export const broken = = = ;\n").unwrap();
    // Declaration files are never part of the client module mirror.
    fs::write(dir.join("src/lib/types.d.ts"), "export declare const x: number;\n").unwrap();
}

#[test]
fn client_closure_emits_only_reachable_helpers() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-client-closure-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    scaffold(&dir);

    let mut options = CompileOptions::default();
    options.out_dir = dir.join("dist");
    let report = compile_project(&dir, &options).expect("compile_project");

    assert!(
        report.diagnostics.iter().all(|d| !d.is_error()),
        "diagnostics: {:?}",
        report.diagnostics
    );
    // Reachable helpers: direct, transitive, `.js`-named `.ts` and dir index.
    assert!(dir.join("dist/lib/used.js").is_file(), "missing used.js");
    assert!(dir.join("dist/lib/nested/tool.js").is_file(), "missing nested/tool.js");
    assert!(dir.join("dist/lib/direct.js").is_file(), "missing direct.js");
    assert!(dir.join("dist/lib/pkg/index.js").is_file(), "missing pkg/index.js");
    // Unreachable and declaration sources stay out of the client graph.
    assert!(!dir.join("dist/lib/unused.js").exists(), "unused.ts must not emit");
    assert!(!dir.join("dist/lib/types.js").exists(), "types.d.ts must not emit");
    assert!(
        !report.emitted.iter().any(|p| p.to_string_lossy().contains("unused")),
        "emitted: {:?}",
        report.emitted
    );
    // The unresolved relative import warns instead of failing the build.
    let unresolved: Vec<_> = report
        .diagnostics
        .iter()
        .filter(|d| format!("{d:?}").contains("vmz::emit::client_module_unresolved"))
        .collect();
    assert_eq!(unresolved.len(), 1, "diagnostics: {:?}", report.diagnostics);
    assert!(
        format!("{unresolved:?}").contains("../lib/missing"),
        "warning must name the specifier: {unresolved:?}"
    );

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn client_closure_reemits_missing_output_for_nondirty_helper() {
    let dir = std::env::temp_dir().join(format!(
        "vmz-client-closure-dirty-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    scaffold(&dir);

    let mut options = CompileOptions::default();
    options.out_dir = dir.join("dist");
    compile_project(&dir, &options).expect("compile_project");

    // A page may start importing a pre-existing helper: the helper is not
    // dirty, yet its missing output must be re-emitted.
    fs::remove_file(dir.join("dist/lib/used.js")).unwrap();
    let page = dir.join("src/pages/index.vmz");
    let report =
        compile_project_with_dirty(&dir, &options, std::slice::from_ref(&page)).expect("dirty");
    assert!(
        report.diagnostics.iter().all(|d| !d.is_error()),
        "diagnostics: {:?}",
        report.diagnostics
    );
    assert!(dir.join("dist/lib/used.js").is_file(), "missing output was not re-emitted");

    let _ = fs::remove_dir_all(&dir);
}
