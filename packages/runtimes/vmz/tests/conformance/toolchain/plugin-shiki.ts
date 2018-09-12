/**
 * plugin-shiki gate — configurable textmate peer + published runtime (VMZ-2 / VMZ-4).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
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
const { configureShiki, getShikiRuntimeConfig, resetShikiRuntimeForTests, highlight } = await import(
    pathToFileURL(distRuntime).href
);

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
console.log('PLUGIN-SHIKI GATE OK');
