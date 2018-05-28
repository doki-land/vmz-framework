/**
 * D3 document interactive gate:
 * - document.search.json (SearchRecord index)
 * - document.islands.json hydrate=island-only (no full-page hydrate)
 * - HTML Island shells for DocumentSearch + DocumentPlayground
 * - static pages remain no-<script> readable
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'packages', 'examples', 'documents-fixture');
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function fail(msg) {
    console.error(`D3 GATE FAIL: ${msg}`);
    process.exit(1);
}

function runVmz(args, cwd = root) {
    return spawnSync(process.execPath, [vmzBin, ...args], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
}

console.log('D3: document build emits search + islands…');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d3-'));
const build = runVmz(['document', 'build', fixture, '--out', outDir, '--strict']);
if (build.status !== 0) {
    fail(`build failed\n${build.stdout}\n${build.stderr}`);
}

const searchPath = path.join(outDir, 'document.search.json');
const islandsPath = path.join(outDir, 'document.islands.json');
if (!fs.existsSync(searchPath)) fail('missing document.search.json');
if (!fs.existsSync(islandsPath)) fail('missing document.islands.json');

const search = JSON.parse(fs.readFileSync(searchPath, 'utf8'));
if (search.schema !== 'vmz.document.search.v0') fail(`search schema ${search.schema}`);
if (search.status !== 'ready') fail(`search status ${search.status}`);
if (!(search.records || []).some((r) => r.kind === 'page' && r.route)) {
    fail(`expected page SearchRecord: ${JSON.stringify(search.records).slice(0, 600)}`);
}
if (!(search.records || []).some((r) => r.kind === 'heading')) {
    fail('expected heading SearchRecord');
}
if (!(search.records || []).some((r) => r.kind === 'api' && String(r.apiSymbolId || '').includes('DemoCard'))) {
    fail(`expected api SearchRecord for DemoCard: ${JSON.stringify(search.records.filter((r) => r.kind === 'api')).slice(0, 800)}`);
}

const islands = JSON.parse(fs.readFileSync(islandsPath, 'utf8'));
if (islands.schema !== 'vmz.document.islands.v0') fail(`islands schema ${islands.schema}`);
if (islands.hydrate !== 'island-only' || islands.fullPageHydrate !== false) {
    fail(`hydrate must be island-only: ${JSON.stringify({ hydrate: islands.hydrate, fullPageHydrate: islands.fullPageHydrate })}`);
}
if (!(islands.islands || []).some((i) => i.name === 'DocumentSearch' && i.kind === 'search')) {
    fail('missing DocumentSearch island');
}
if (!(islands.islands || []).some((i) => i.kind === 'playground' && i.fence?.playground)) {
    fail(`expected playground island: ${JSON.stringify(islands.islands).slice(0, 1000)}`);
}

const evidenceHtml = path.join(outDir, 'docs', 'zh-hans', 'guide', 'evidence.html');
if (!fs.existsSync(evidenceHtml)) fail(`missing ${evidenceHtml}`);
const html = fs.readFileSync(evidenceHtml, 'utf8');
if (/<script[\s>]/i.test(html)) fail('no-JS gate: evidence.html must not include <script>');
if (!/data-vmz-hydrate="island-only"/i.test(html)) fail('missing body data-vmz-hydrate=island-only');
if (!/data-vmz-island="DocumentSearch"/i.test(html)) fail('missing DocumentSearch island shell');
if (!/data-vmz-island="DocumentPlayground:/i.test(html)) fail('missing DocumentPlayground island shell');
if (!/data-vmz-search-index="[^"]*document\.search\.json"/i.test(html)) {
    fail('DocumentSearch must point at document.search.json');
}
if (/data-vmz-hydrate=["']full[-_]?page["']/i.test(html) || /hydrate-all/i.test(html)) {
    fail('full-page hydrate markers are forbidden');
}

const viewPath = path.join(outDir, 'views', 'zh-hans', 'guide', 'evidence.view.json');
if (!fs.existsSync(viewPath)) fail(`missing ${viewPath}`);
const view = JSON.parse(fs.readFileSync(viewPath, 'utf8'));
if (view.hydrate !== 'island-only') fail(`view.hydrate ${view.hydrate}`);
if (!view.noJsReadable) fail('view.noJsReadable must remain true');
if (!Array.isArray(view.islands) || !view.islands.includes('DocumentSearch')) {
    fail(`view.islands incomplete: ${JSON.stringify(view.islands)}`);
}

const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'document.manifest.json'), 'utf8'));
if (manifest.build?.search !== 'document.search.json' || manifest.build?.islands !== 'document.islands.json') {
    fail(`manifest.build missing search/islands refs: ${JSON.stringify(manifest.build)}`);
}

console.log('D3 GATE PASS');
console.log('  search index · island-only resume · DocumentSearch/Playground shells · no full-page hydrate');
