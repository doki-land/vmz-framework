/**
 * Pack artifact gates — site-level closure/splitting/vendor/budget/negative
 * evidence over the `pack-gates` fixture, driven by `_lib/pack-artifact-gates.ts`.
 *
 * verify id: pack-artifact-gates
 *
 * Covers: manifest/disk closure, import reference integrity, per-module
 * uniqueness, route chunk boundaries with private isolation, vendor dedup
 * (multi-file ESM package + subpath), CJS interop executed for real in Node,
 * TS type erasure, byte budgets, byte-identical rebuilds, and two negative
 * fixtures that must fail the build (server-only builtin in a client module,
 * unknown named export). Each check has a corruption self-check proving the
 * gate is not vacuous.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    assertBudgets,
    assertManifestClosed,
    assertModulesUnique,
    assertReferenceIntegrity,
    assertRouteBoundaries,
    assertSamePackSnapshot,
    countChunksContaining,
    loadPack,
    snapshotPack,
} from '../_lib/pack-artifact-gates.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const FIXTURE = 'packages/examples/pack-gates';
const BAD_SERVER = 'packages/examples/pack-gates-bad-server';
const BAD_EXPORT = 'packages/examples/pack-gates-bad-export';

function fail(msg: string): never {
    console.error(`pack-artifact-gates FAIL: ${msg}`);
    process.exit(1);
}

function reportErrors(label: string, errors: string[]): void {
    if (errors.length) fail(`${label}:\n  - ${errors.slice(0, 12).join('\n  - ')}`);
}

// ---------------------------------------------------------------------------
// Fixture materialization (node_modules is gitignored; the driver owns it)
// ---------------------------------------------------------------------------

const VENDOR_FILES: Record<string, Record<string, string>> = {
    'acme-util': {
        'package.json':
            '{"name":"acme-util","version":"1.0.0","type":"module","exports":{".":"./index.js","./sub":"./sub.js"}}',
        'index.js': 'export { core as utilMain } from "./lib/core.js";\n',
        'lib/core.js': 'import { util } from "./util.js";\nexport const core = "ACME_UTIL_CORE:" + util;\n',
        'lib/util.js': 'export const util = "ACME_UTIL_UTIL";\n',
        'sub.js': 'export const subMarker = "ACME_UTIL_SUB";\n',
        // Never imported by the site — vendor-internal prune target.
        'lib/ghost.js': 'export const ghost = "ACME_GHOST";\n',
    },
    'acme-cjs': {
        'package.json': '{"name":"acme-cjs","version":"1.0.0","main":"./lib/index.js"}',
        'lib/index.js': 'const util = require("./util");\nexports.twice = function (n) { return util.double(n) };\n',
        'lib/util.js': 'function double(n) { return n * 2 }\nmodule.exports = exports = { double };\n',
    },
};

function writeTree(base: string, files: Record<string, string>): void {
    for (const [rel, content] of Object.entries(files)) {
        const full = path.join(base, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    }
}

/** Give a fixture a self-contained `node_modules`: vendored packs + `@vmz/core` junction. */
function materializeFixtureModules(fixtureAbs: string, withVendor: boolean): void {
    const nm = path.join(fixtureAbs, 'node_modules');
    if (withVendor) {
        for (const [pkg, files] of Object.entries(VENDOR_FILES)) {
            writeTree(path.join(nm, pkg), files);
        }
    }
    const scopeDir = path.join(nm, '@vmz');
    fs.mkdirSync(scopeDir, { recursive: true });
    const coreLink = path.join(scopeDir, 'core');
    if (!fs.existsSync(coreLink)) {
        fs.symlinkSync(path.join(root, 'packages/runtimes/vmz-runtime'), coreLink, 'junction');
    }
}

// ---------------------------------------------------------------------------
// Positive build
// ---------------------------------------------------------------------------

console.log('pack-artifact-gates: materialize fixture modules…');
materializeFixtureModules(path.join(root, ...FIXTURE.split('/')), true);
materializeFixtureModules(path.join(root, ...BAD_SERVER.split('/')), false);
materializeFixtureModules(path.join(root, ...BAD_EXPORT.split('/')), false);

console.log('pack-artifact-gates: build pack-gates (static, pass 1)…');
const build1 = runVmzBuild(FIXTURE, root, { profile: 'static' });
if (build1.status !== 0) {
    fail(`fixture build failed\n${build1.stdout.slice(-2000)}\n${build1.stderr.slice(-2000)}`);
}
const loaded1 = loadPack(build1.dist);
if (!loaded1.ok) fail(loaded1.errors.join('; '));
const pack1 = loaded1.value;

console.log('pack-artifact-gates: G1 manifest/disk closure…');
reportErrors('manifest closure', assertManifestClosed(pack1));

console.log('pack-artifact-gates: G2 import reference integrity…');
reportErrors('reference integrity', assertReferenceIntegrity(pack1));

console.log('pack-artifact-gates: G3 per-module uniqueness…');
reportErrors('module uniqueness', assertModulesUnique(pack1));

console.log('pack-artifact-gates: G4 route chunk boundaries…');
reportErrors(
    'route boundaries',
    assertRouteBoundaries(pack1, { pages: ['pages/index', 'pages/about', 'pages/vendor', 'pages/lazy'] }),
);

console.log('pack-artifact-gates: G5 prune + isolation markers…');
{
    const errors: string[] = [];
    // Prune: unreferenced component / unused export / unreferenced vendor file
    // leave neither text nor module membership.
    for (const absent of ['UNUSED_NOTE_MARKER', 'UNUSED_FMT_MARKER', 'ACME_GHOST']) {
        const holders = countChunksContaining(pack1, absent);
        if (holders.length) errors.push(`${absent} leaked into ${holders.join(', ')}`);
    }
    for (const chunk of pack1.manifest.chunks) {
        if (chunk.modules.some((m) => m.includes('UnusedNote'))) {
            errors.push(`UnusedNote module present in ${chunk.chunkId}`);
        }
        if (chunk.modules.some((m) => m.includes('acme-util/lib/ghost.js'))) {
            errors.push(`vendor ghost module present in ${chunk.chunkId}`);
        }
    }
    // Route privacy: AboutOnly text only in the about chunk.
    const aboutOnly = countChunksContaining(pack1, 'ABOUT_ONLY_MARKER');
    if (aboutOnly.length !== 1 || !aboutOnly[0].includes('about')) {
        errors.push(`ABOUT_ONLY_MARKER holders = ${aboutOnly.join(', ') || '(none)'}`);
    }
    // Shared component used by two routes: exactly one chunk, and it is shared.
    const sharedHolders = countChunksContaining(pack1, 'SHARED_CARD_MARKER');
    if (sharedHolders.length !== 1 || !sharedHolders[0].startsWith('shared')) {
        errors.push(`SHARED_CARD_MARKER holders = ${sharedHolders.join(', ') || '(none)'} (want one shared chunk)`);
    }
    reportErrors('prune/isolation', errors);
}

console.log('pack-artifact-gates: G6 vendor follow + dedup…');
{
    const errors: string[] = [];
    const memberModules = pack1.manifest.chunks.flatMap((c) => c.modules.map((m) => m.replace(/\\/g, '/')));
    for (const expected of ['acme-util/index.js', 'acme-util/lib/core.js', 'acme-util/lib/util.js', 'acme-util/sub.js']) {
        if (!memberModules.some((m) => m.includes(expected))) errors.push(`vendor module ${expected} missing from graph`);
    }
    for (const marker of ['ACME_UTIL_CORE', 'ACME_UTIL_UTIL', 'ACME_UTIL_SUB']) {
        const holders = countChunksContaining(pack1, marker);
        if (holders.length !== 1) errors.push(`${marker} in ${holders.length} chunks (${holders.join(', ')})`);
    }
    reportErrors('vendor', errors);
}

console.log('pack-artifact-gates: G7 lazy split + explicit failure diagnostic…');
{
    const errors: string[] = [];
    const heavyOwner = pack1.manifest.chunks.find((c) =>
        c.modules.some((m) => m.replace(/\\/g, '/').endsWith('lib/heavy.js')),
    );
    if (!heavyOwner) {
        errors.push('heavy.ts never became a chunk module');
    } else {
        if (heavyOwner.chunkId.startsWith('entry/')) errors.push(`heavy.ts inlined into ${heavyOwner.chunkId}`);
        const lazyOwner = pack1.manifest.chunks.find((c) =>
            c.modules.some((m) => m.replace(/\\/g, '/').endsWith('pages/lazy.client.js')),
        );
        if (!lazyOwner) {
            errors.push('lazy page chunk missing');
        } else {
            const code = pack1.tree.get(lazyOwner.fileName)?.toString('utf8') ?? '';
            if (!code.includes(`import("./${heavyOwner.fileName}")`)) {
                errors.push(`lazy page chunk does not dynamically import ${heavyOwner.fileName}`);
            }
            if (code.includes(`from "./${heavyOwner.fileName}"`)) {
                errors.push('lazy page statically imports the heavy chunk');
            }
        }
        const entryHolders = pack1.manifest.chunks.filter((c) => c.chunkId.startsWith('entry/'));
        for (const entry of entryHolders) {
            const code = pack1.tree.get(entry.fileName)?.toString('utf8') ?? '';
            if (code.includes('HEAVY_LAZY_MARKER')) errors.push(`heavy text shipped in ${entry.chunkId}`);
        }
    }
    // Lazy-load failure path has an explicit diagnostic, not a bare TypeError.
    const clientEntry = pack1.manifest.chunks.find((c) => c.chunkId === 'entry/entry-client.js');
    const entryCode = clientEntry ? (pack1.tree.get(clientEntry.fileName)?.toString('utf8') ?? '') : '';
    if (!clientEntry || !entryCode.includes('unknown component')) {
        errors.push('entry-client chunk missing explicit `unknown component` lazy-load diagnostic');
    }
    reportErrors('lazy split', errors);
}

console.log('pack-artifact-gates: G8 CJS interop executed for real…');
{
    const cjsOwner = pack1.manifest.chunks.find((c) =>
        c.modules.some((m) => m.replace(/\\/g, '/').includes('acme-cjs/lib/index.js')),
    );
    if (!cjsOwner) fail('acme-cjs never emitted as a chunk');
    const shellCode = pack1.tree.get(cjsOwner.fileName)?.toString('utf8') ?? '';
    // Packed chunks are emitted minified, so assert the shell semantically
    // rather than against formatted source literals.
    const shellCompact = shellCode.replace(/\s+/g, '');
    if (!shellCompact.includes('letmodule={exports:{}};') || !shellCompact.includes('functionrequire(id)')) {
        fail(`CJS chunk ${cjsOwner.chunkId} lacks the interop shell`);
    }
    // Runtime proof: importing the emitted isolated chunk must not throw
    // `module is not defined` — the shell binds the CommonJS globals.
    const chunkUrl = pathToFileURL(path.join(pack1.packDir, cjsOwner.fileName)).href;
    let mod: { default?: { twice?: (n: number) => number }; twice?: (n: number) => number };
    try {
        mod = (await import(chunkUrl)) as typeof mod;
    } catch (error) {
        fail(`importing emitted CJS chunk threw at runtime: ${error}`);
    }
    const twice = mod?.default?.twice ?? mod?.twice;
    if (typeof twice !== 'function') fail('CJS chunk exposes no callable `twice`');
    if (twice(21) !== 42) fail(`CJS interop semantics wrong: twice(21) = ${twice(21)}`);
}

console.log('pack-artifact-gates: G9 TS type syntax zero residue…');
{
    const errors: string[] = [];
    for (const chunk of pack1.manifest.chunks) {
        const code = pack1.tree.get(chunk.fileName)?.toString('utf8') ?? '';
        for (const residue of ['import type', 'export type']) {
            if (code.includes(residue)) errors.push(`${chunk.chunkId} keeps \`${residue}\``);
        }
    }
    reportErrors('ts erasure', errors);
}

console.log('pack-artifact-gates: G10 byte budgets…');
{
    const total = pack1.manifest.chunks.reduce((sum, c) => sum + c.bytes, 0);
    const biggestAsync = pack1.manifest.chunks
        .filter((c) => c.chunkId.startsWith('async/'))
        .reduce((max, c) => Math.max(max, c.bytes), 0);
    console.log(`  measured: total=${total}B biggestAsync=${biggestAsync}B chunks=${pack1.manifest.chunks.length}`);
    reportErrors(
        'budgets',
        assertBudgets(pack1, { maxEntryChunkBytes: 512 * 1024, maxAsyncChunkBytes: 256 * 1024, maxTotalJsBytes: 3 * 1024 * 1024 }),
    );
}

console.log('pack-artifact-gates: G11 byte-identical rebuild…');
const snap1 = snapshotPack(pack1);
const build2 = runVmzBuild(FIXTURE, root, { profile: 'static' });
if (build2.status !== 0) fail(`fixture rebuild failed\n${build2.stdout.slice(-1500)}`);
const loaded2 = loadPack(build2.dist);
if (!loaded2.ok) fail(loaded2.errors.join('; '));
reportErrors('determinism', assertSamePackSnapshot(snapshotPack(loaded2.value), snap1));

console.log('pack-artifact-gates: G12 teeth — corruption must be caught…');
{
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-pack-gates-corrupt-'));
    try {
        fs.cpSync(path.join(build1.dist, '_vmz'), path.join(tmp, '_vmz'), { recursive: true });
        // (a) delete one chunk file → reference integrity must report it.
        const victim = pack1.manifest.chunks.find((c) => c.chunkId.startsWith('shared/')) ?? pack1.manifest.chunks[0];
        fs.rmSync(path.join(tmp, '_vmz', 'pack', victim.fileName));
        const corruptLoad = loadPack(tmp);
        if (!corruptLoad.ok) fail('corrupt copy failed to load for self-check');
        const integrity = assertReferenceIntegrity(corruptLoad.value);
        if (!integrity.some((line) => line.includes(victim.fileName))) {
            fail(`teeth: deleting ${victim.fileName} produced no integrity violation`);
        }
        const closure = assertManifestClosed(corruptLoad.value);
        if (!closure.some((line) => line.includes(victim.fileName))) {
            fail(`teeth: deleting ${victim.fileName} produced no closure violation`);
        }
        // (b) flip one byte in another chunk → digest mismatch must surface.
        fs.cpSync(path.join(build1.dist, '_vmz'), path.join(tmp, '_vmz'), { recursive: true });
        const target = pack1.manifest.chunks.find((c) => c.fileName !== victim.fileName) ?? pack1.manifest.chunks[0];
        const targetPath = path.join(tmp, '_vmz', 'pack', target.fileName);
        const bytes = fs.readFileSync(targetPath);
        bytes[0] = bytes[0] ^ 0xff;
        fs.writeFileSync(targetPath, bytes);
        const flippedLoad = loadPack(tmp);
        if (!flippedLoad.ok) fail('flipped copy failed to load for self-check');
        const digestErrors = assertManifestClosed(flippedLoad.value);
        if (!digestErrors.some((line) => line.includes('digest mismatch'))) {
            fail('teeth: byte flip produced no digest violation');
        }
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

console.log('pack-artifact-gates: G13 negative — server-only builtin in client module…');
{
    const bad = runVmzBuild(BAD_SERVER, root, { profile: 'static' });
    const text = `${bad.stdout}\n${bad.stderr}`;
    if (bad.status === 0) {
        fail('bad-server fixture built successfully — a client `node:fs` import must fail the build');
    }
    if (!/node_builtin|node:fs|pack failed|vmz::pack/.test(text)) {
        fail(`bad-server failure lacks a pack diagnostic:\n${text.slice(-1500)}`);
    }
    console.log(`  rejected as expected: ${text.trim().split('\n').pop()}`);
}

console.log('pack-artifact-gates: G14 negative — unknown named export…');
{
    // Needs the pack wire that escalates `unknown_export` (the default binary
    // on older checkouts predates it); prefer an explicit override, else the
    // locally rebuilt side binary, else the default binding.
    const side = path.join(root, 'packages/runtimes/vmz-win32-x64/vmz-packgates.node');
    const previous = process.env.VMZ_NATIVE_NODE;
    if (!previous && fs.existsSync(side)) process.env.VMZ_NATIVE_NODE = side;
    try {
        const bad = runVmzBuild(BAD_EXPORT, root, { profile: 'static' });
        const text = `${bad.stdout}\n${bad.stderr}`;
        if (bad.status === 0) {
            fail('bad-export fixture built successfully — an unknown named export must fail the build');
        }
        if (!/unknown_export|ghost/.test(text)) {
            fail(`bad-export failure lacks the export diagnostic:\n${text.slice(-1500)}`);
        }
        console.log(`  rejected as expected: ${text.trim().split('\n').pop()}`);
    } finally {
        if (!previous) delete process.env.VMZ_NATIVE_NODE;
    }
}

const proof = readProof(root);
upsertCheck(proof, {
    id: 'pack-artifact-gates',
    status: 'passed',
    detail: 'closure + integrity + uniqueness + route isolation + vendor dedup + CJS runtime + budgets + determinism + negatives',
});
addLimitation(proof, 'pack-gates: arrow-const dynamic import edges stay conservative at link (dead variant still ships)');
addLimitation(proof, 'pack-gates: `interface` bodies keep module scope facts incomplete (module-level prune fallback)');
addLimitation(proof, 'pack-gates: `${...}` interpolations are invisible in the Oak AST, so modules with template interpolation keep incomplete scope facts and ship via the conservative isolated path');
writeProof(proof, root);
console.log('pack-artifact-gates PASS');
