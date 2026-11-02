/**
 * plugin-shiki gate — configurable textmate peer + published runtime (VMZ-2 / VMZ-4).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const pluginRoot = path.join(root, 'packages', 'plugins', 'vmz-plugin-shiki');

function fail(msg: string): never {
    console.error(`PLUGIN-SHIKI GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('plugin-shiki: dist emit…');
const distPlugin = path.join(pluginRoot, 'dist', 'vmz.plugin.js');
const distRuntime = path.join(pluginRoot, 'dist', 'runtime.js');
if (!fs.existsSync(distPlugin)) fail('missing dist/vmz.plugin.js — run pnpm --filter @vmz/plugin-shiki build');
if (!fs.existsSync(distRuntime)) fail('missing dist/runtime.js');

console.log('plugin-shiki: factory + sidecar…');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-plugin-shiki-'));
const customTextmate = path.join(tmp, 'custom-textmate.mjs');
fs.writeFileSync(
    customTextmate,
    `export async function createVmzHighlighter() {
  return {
    codeToHtml(code, opts) {
      return '<pre class="shiki custom"><code data-lang="' + (opts?.lang || '') + '">' + code + '</code></pre>';
    },
  };
}
`,
    'utf8',
);

const { shiki } = await import(pathToFileURL(distPlugin).href);
const { configureShiki, getShikiRuntimeConfig, resetShikiRuntimeForTests, highlight } = await import(pathToFileURL(distRuntime).href);

resetShikiRuntimeForTests();
const plugin = shiki({ textmate: pathToFileURL(customTextmate).href });
if (plugin.manifest.name !== '@vmz/plugin-shiki') fail('bad manifest name');
if (getShikiRuntimeConfig().textmate !== pathToFileURL(customTextmate).href) {
    fail('configureShiki not applied by factory');
}

const outDir = path.join(tmp, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const batch = await plugin.contribute?.({
    project: tmp,
    outDir,
    stage: 'workspace_resolve',
    protocol: '0.1.0',
    packages: [],
    engines: { code: 'shiki' },
});
if (!batch || batch.stage !== 'workspace_resolve') fail('workspace_resolve batch missing');
const sidecar = path.join(outDir, '_vmz', 'plugin-shiki.config.json');
if (!fs.existsSync(sidecar)) fail('missing _vmz/plugin-shiki.config.json');
const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
if (side.textmate !== pathToFileURL(customTextmate).href) fail('sidecar textmate mismatch');

console.log('plugin-shiki: default sidecar omits textmate…');
// The textmate adapter is explicit opt-in: a bare `shiki()` must not leak a
// default adapter id into the runtime config (it is not an npm dependency of
// the plugin and would fail hard under pack resolution).
const outDirDefault = path.join(tmp, 'dist-default');
fs.mkdirSync(outDirDefault, { recursive: true });
resetShikiRuntimeForTests();
const plainPlugin = shiki({});
await plainPlugin.contribute?.({
    project: tmp,
    outDir: outDirDefault,
    stage: 'workspace_resolve',
    protocol: '0.1.0',
    packages: [],
    engines: { code: 'shiki' },
});
const sideDefault = JSON.parse(fs.readFileSync(path.join(outDirDefault, '_vmz', 'plugin-shiki.config.json'), 'utf8'));
if ('textmate' in sideDefault) fail(`default sidecar must not carry textmate: ${JSON.stringify(sideDefault)}`);

process.env.VMZ_DIST = outDir;
resetShikiRuntimeForTests();
configureShiki({});
const html = await highlight('hello', 'vos', 'vitesse-dark');
if (!html.includes('class="shiki custom"') || !html.includes('data-lang="vos"')) {
    fail(`custom highlighter not used: ${html.slice(0, 120)}`);
}
delete process.env.VMZ_DIST;

console.log('plugin-shiki: null prop normalization (SSR regression)…');
// Component props are nullable and a bound `null` overrides the prop default in
// compiled components; runtime entries must normalize null theme/lang to the
// defaults before touching the highlighter instead of crashing SSR.
const recordingTextmate = path.join(tmp, 'recording-textmate.mjs');
fs.writeFileSync(
    recordingTextmate,
    `export async function createVmzHighlighter() {
  return {
    codeToHtml(code, opts) {
      globalThis.__vmzShikiProbe = (globalThis.__vmzShikiProbe || []).concat([{ lang: opts?.lang, theme: opts?.theme }]);
      return '<pre class="shiki custom"><code>' + code + '</code></pre>';
    },
  };
}
`,
    'utf8',
);
resetShikiRuntimeForTests();
configureShiki({ textmate: pathToFileURL(recordingTextmate).href });
const { highlightSync } = await import(pathToFileURL(distRuntime).href);
const nullHtml = await highlight('const x = 1', null as unknown as string, null as unknown as string);
if (!nullHtml.includes('class="shiki')) fail(`null theme/lang rejected the render: ${nullHtml.slice(0, 120)}`);
const probeCalls = (globalThis as { __vmzShikiProbe?: Array<{ lang?: string; theme?: string }> }).__vmzShikiProbe || [];
if (probeCalls.length !== 1) fail(`expected exactly one highlighter call, got ${JSON.stringify(probeCalls)}`);
if (probeCalls[0]?.lang !== 'text' || probeCalls[0]?.theme !== 'vitesse-dark') {
    fail(`null theme/lang not normalized at the highlighter boundary: ${JSON.stringify(probeCalls)}`);
}
const syncNull = highlightSync('const y = 2', null as unknown as string, null as unknown as string);
if (!syncNull.includes('<pre')) fail(`highlightSync with null theme/lang did not render: ${syncNull.slice(0, 120)}`);

console.log('plugin-shiki: render failure degrades…');
// A highlighter whose codeToHtml throws must not take the page down: async and
// sync entries both degrade to an escaped <pre> shell.
const throwingTextmate = path.join(tmp, 'throwing-textmate.mjs');
fs.writeFileSync(
    throwingTextmate,
    `export async function createVmzHighlighter() {
  return {
    codeToHtml() {
      throw new Error("Cannot read properties of null (reading 'default')");
    },
  };
}
`,
    'utf8',
);
resetShikiRuntimeForTests();
configureShiki({ textmate: pathToFileURL(throwingTextmate).href });
let fellBack = false;
try {
    const degraded = await highlight('a < b', 'ts', 'vitesse-dark');
    fellBack = degraded.includes('shiki-fallback') && degraded.includes('a &lt; b');
} catch {
    fellBack = false;
}
if (!fellBack) fail('render failure did not degrade to escaped <pre>');
const syncDegraded = highlightSync('c < d', 'ts', 'vitesse-dark');
if (!syncDegraded.includes('shiki-fallback') || !syncDegraded.includes('c &lt; d')) {
    fail(`highlightSync did not degrade after render failure: ${syncDegraded.slice(0, 120)}`);
}


console.log('plugin-shiki: no computed dynamic import in shipped runtime (G4)…');
// Browser chunks can only vendor what the packer can see: a computed
// `import(specVar)` ships as a bare specifier and fails in the browser with
// "Failed to resolve module specifier 'shiki'". The only non-literal dynamic
// import allowed is the documented custom-textmate escape hatch.
const runtimeSrc = fs.readFileSync(distRuntime, 'utf8');
if (!/await import\('shiki'\)/.test(runtimeSrc)) {
    fail('generic shiki load must use a literal specifier so vmz-pack can vendor it');
}
const computedImports = runtimeSrc.match(/import\(([^'"`][^)]*)\)/g) || [];
const leaked = computedImports.filter((m) => !/webpackIgnore/.test(m));
if (leaked.length) fail(`computed dynamic imports leak to the client bundle: ${leaked.join(', ')}`);

console.log('plugin-shiki: factory prewarm keeps SSR on the sync path…');
// The plugin factory kicks prewarm at config-load time so SSR renders the same
// tokenized markup the client computes — no unhighlighted fallback flash.
const warmTextmate = path.join(tmp, 'warm-textmate.mjs');
fs.writeFileSync(
    warmTextmate,
    `export async function createVmzHighlighter() {
  return { codeToHtml(code) { return '<pre class="shiki warm"><code>' + code + '</code></pre>'; } };
}
`,
    'utf8',
);
resetShikiRuntimeForTests();
shiki({ textmate: pathToFileURL(warmTextmate).href });
let warm = '';
for (let i = 0; i < 200; i++) {
    const out = highlightSync('const z = 3', 'ts', 'vitesse-dark');
    if (out.includes('shiki warm')) {
        warm = out;
        break;
    }
    await new Promise((r) => setTimeout(r, 10));
}
if (!warm) fail('factory prewarm never warmed the sync path — SSR would flash the fallback');


console.log('plugin-shiki: package exports…');
const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'));
if (!String(pkg.exports['.'].default).includes('dist/')) fail('main export must target dist/');
if (!String(pkg.exports['./runtime'].default).includes('dist/')) fail('runtime export must target dist/');

fs.rmSync(tmp, { recursive: true, force: true });

console.log('plugin-shiki: serve-host bare import + JSON resolve…');
const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-serve-resolve-'));
const peerPkg = path.join(probeRoot, 'node_modules', '@test', 'vos-textmate');
fs.mkdirSync(peerPkg, { recursive: true });
fs.writeFileSync(
    path.join(peerPkg, 'package.json'),
    JSON.stringify({ name: '@test/vos-textmate', type: 'module', exports: { './shiki': './shiki.mjs' } }),
    'utf8',
);
fs.writeFileSync(path.join(peerPkg, 'shiki.mjs'), 'export const marker = "peer-ok";\n', 'utf8');
fs.writeFileSync(path.join(probeRoot, 'vos.tmLanguage.json'), JSON.stringify({ name: 'vos' }), 'utf8');
fs.writeFileSync(path.join(probeRoot, 'package.json'), JSON.stringify({ name: 'vmz-serve-resolve-probe', type: 'module' }), 'utf8');

const { createRequire, registerHooks } = await import('node:module');
const probePkg = path.join(probeRoot, 'package.json');
const probeRequire = createRequire(probePkg);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (
            !specifier ||
            specifier.startsWith('.') ||
            specifier.startsWith('node:') ||
            specifier.startsWith('file:') ||
            specifier.startsWith('#')
        ) {
            return nextResolve(specifier, context);
        }
        try {
            const resolved = probeRequire.resolve(specifier);
            return { url: pathToFileURL(resolved).href, shortCircuit: true };
        } catch {
            return nextResolve(specifier, context);
        }
    },
    load(url, context, nextLoad) {
        const pathOnly = url.split('?')[0].split('#')[0];
        if (!pathOnly.endsWith('.json')) return nextLoad(url, context);
        try {
            const filePath = fileURLToPath(pathOnly);
            const raw = fs.readFileSync(filePath, 'utf8');
            return { format: 'module', shortCircuit: true, source: `export default ${raw}` };
        } catch {
            return nextLoad(url, context);
        }
    },
});
const peer = await import('@test/vos-textmate/shiki');
if (peer.marker !== 'peer-ok') fail('bare peer import failed');
const grammarUrl = pathToFileURL(path.join(probeRoot, 'vos.tmLanguage.json')).href;
const grammar = await import(grammarUrl);
if (!grammar.default || grammar.default.name !== 'vos') fail('JSON import hook failed');
fs.rmSync(probeRoot, { recursive: true, force: true });

console.log('plugin-shiki PASS');
console.log('PLUGIN-SHIKI GATE OK');
