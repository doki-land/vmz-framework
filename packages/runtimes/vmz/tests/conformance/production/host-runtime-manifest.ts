/**
 * Sole host-runtime-files.json must exist; TS + Rust consumers must not hardcode the list.
 * verify id: host-runtime-manifest
 */

import fs from 'node:fs';
import path from 'node:path';
import { readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const MANIFEST_REL = 'packages/runtimes/vmz/host-runtime-files.json';
const LOADER_REL = 'packages/runtimes/vmz/src/host-materialize/host-runtime-files.ts';
const MATERIALIZE_REL = 'packages/runtimes/vmz/src/host-materialize/serve-host-runtime.ts';

function fail(msg: string): never {
    console.error(`host-runtime-manifest FAIL: ${msg}`);
    process.exit(1);
}

console.log('host-runtime-manifest: assert single source…');

const manifestPath = path.join(root, MANIFEST_REL);
if (!fs.existsSync(manifestPath)) fail(`missing ${MANIFEST_REL}`);

let manifest: { schema?: string; files?: Array<{ src: string; out: string }> };
try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {
    fail(`parse ${MANIFEST_REL}: ${e instanceof Error ? e.message : String(e)}`);
}
if (manifest.schema !== 'vmz.host-runtime-files.v0') fail(`schema want vmz.host-runtime-files.v0 got ${manifest.schema}`);
if (!Array.isArray(manifest.files) || manifest.files.length < 5) fail('files too sparse');

if (!fs.existsSync(path.join(root, LOADER_REL))) fail(`missing ${LOADER_REL}`);

const materialize = fs.readFileSync(path.join(root, MATERIALIZE_REL), 'utf8');
if (!/loadHostRuntimeFilesManifest|serveHostRuntimeFilePairs/.test(materialize)) {
    fail('serve-host-runtime.ts must load host-runtime-files manifest');
}
if (/\[\s*['"]serve-host\.mjs['"]\s*,\s*['"]_vmz\/host\//.test(materialize)) {
    fail('serve-host-runtime.ts must not hardcode SERVE_HOST_RUNTIME_FILES array');
}

const compileRs = fs.readFileSync(path.join(root, 'packages/compilers/vmz-compiler/src/pipeline/compile.rs'), 'utf8');
if (!/include_str!\s*\(\s*"\.\.\/\.\.\/\.\.\/\.\.\/runtimes\/vmz\/host-runtime-files\.json"\s*\)/.test(compileRs)) {
    fail('compile.rs must include_str! host-runtime-files.json');
}
if (/copies\.push\(\s*\(\s*"serve-host\.mjs"/.test(compileRs) || /"serve-host\.mjs",\s*"_vmz\/host\/vmz-serve-host\.mjs"/.test(compileRs)) {
    fail('compile.rs must not hardcode host companion basename list');
}

const packTs = path.join(root, 'packages/runtimes/vmz/src/workspace/pack.ts');
if (fs.existsSync(packTs)) {
    const pack = fs.readFileSync(packTs, 'utf8');
    if (/serve-host\.mjs['"]\s*,\s*['"]_vmz\/host/.test(pack)) {
        fail('pack.ts must not hardcode competing host companion list');
    }
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'host-runtime-manifest',
    status: 'passed',
    detail: `files=${manifest.files.length}; consumers=compile.rs+materializeServeHostRuntime`,
});
writeProof(proof, root);

console.log(`host-runtime-manifest PASS: files=${manifest.files.length}`);
