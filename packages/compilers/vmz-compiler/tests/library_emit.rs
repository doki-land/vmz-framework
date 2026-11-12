use std::fs;
use std::path::PathBuf;

use vmz_compiler::pipeline::compile::CompileOptions;
use vmz_compiler::pipeline::library::{LibraryEntry, compile_library};

fn temp_root(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("vmz-lib-emit-{name}"));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir");
    dir
}

#[test]
fn library_emit_writes_named_module_and_keeps_bare_specifiers() {
    let dir = temp_root("keeps-bare");
    let entry = dir.join("LibCard.vmz");
    fs::write(
        &entry,
        r#"<template>
    <div class="lib-card">{{ label }}</div>
</template>
<style>
.lib-card { color: rebeccapurple; }
</style>
<script client>
import { renderSvg } from "@doki-land/davinci/scene";
export default class LibCard {
    label = "ok";
    draw() {
        return renderSvg;
    }
}
</script>
"#,
    )
    .expect("write fixture");

    let out = dir.join("dist");
    let options =
        CompileOptions { out_dir: out.clone(), release: true, ..CompileOptions::default() };
    let report =
        compile_library(&[LibraryEntry { name: "LibCard".into(), path: entry.clone() }], &options)
            .expect("compile_library");

    assert!(
        report.diagnostics.iter().all(|d| !d.is_error()),
        "diagnostics: {:?}",
        report.diagnostics
    );
    let js = out.join("LibCard.js");
    assert!(js.is_file(), "missing {}", js.display());
    assert!(!out.join("LibCard.client.js").exists());
    let code = fs::read_to_string(&js).expect("read js");
    assert!(code.contains("@doki-land/davinci/scene"), "code={code}");
    assert!(!code.contains("./vmz-runtime.js"), "code={code}");
    assert!(!code.contains("./dom-core.js"), "code={code}");
    assert!(report.emitted.contains(&js));
}

#[test]
fn library_emit_rejects_path_like_entry_names() {
    let dir = temp_root("bad-name");
    let entry = dir.join("LibCard.vmz");
    fs::write(
        &entry,
        r#"<template><div>x</div></template>
<script client>
export default class LibCard {}
</script>
"#,
    )
    .expect("write fixture");

    let options =
        CompileOptions { out_dir: dir.join("dist"), release: true, ..CompileOptions::default() };
    let report =
        compile_library(&[LibraryEntry { name: "../escape".into(), path: entry }], &options)
            .expect("compile_library");

    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.is_error() && d.code() == "vmz::lib::entry_name_invalid"),
        "diagnostics: {:?}",
        report.diagnostics
    );
    assert!(!dir.join("dist").join("escape.js").exists());
}
