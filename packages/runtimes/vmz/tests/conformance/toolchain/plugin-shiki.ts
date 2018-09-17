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

process.env.VMZ_DIST = outDir;
resetShikiRuntimeForTests();
configureShiki({});
const html = await highlight('hello', 'vos', 'vitesse-dark');
if (!html.includes('class="shiki custom"') || !html.includes('data-lang="vos"')) {
    fail(`custom highlighter not used: ${html.slice(0, 120)}`);
}
delete process.env.VMZ_DIST;

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
