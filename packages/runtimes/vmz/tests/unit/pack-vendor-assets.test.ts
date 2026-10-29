import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { packClientBareImports } from '../../dist/workspace/pack-client-packages.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-vendor-assets-'));
const dist = path.join(root, 'dist');
const pkg = path.join(root, 'node_modules', 'fixture-style');
const pkgDist = path.join(pkg, 'dist');
for (const directory of [dist, pkgDist, path.join(pkgDist, 'fonts')]) {
    fs.mkdirSync(directory, { recursive: true });
}
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'fixture-style', type: 'module', exports: { './*': './*' } }),
);
fs.writeFileSync(
    path.join(pkgDist, 'style.css'),
    '@font-face{font-family:"Fixture";src:url(./fonts/body.woff2)}.fixture{background:url(fonts/body.woff2)}',
);
fs.writeFileSync(path.join(pkgDist, 'fonts', 'body.woff2'), 'font-bytes');
fs.writeFileSync(
    path.join(pkgDist, 'theme.js'),
    'export const payload = new URL("./payload.bin", import.meta.url).href;export const theme="dark";',
);
fs.writeFileSync(path.join(pkgDist, 'payload.bin'), 'bin-bytes');
fs.writeFileSync(
    path.join(dist, 'main.js'),
    'import{theme}from"fixture-style/dist/theme.js";import"fixture-style/dist/style.css";export const name=theme;',
);

const report = packClientBareImports(dist, { projectRoot: root });
assert.deepEqual(report.remainingBareSpecs, []);

const styleDir = path.join(dist, 'vendor', 'fixture-style', 'dist');
assert.ok(fs.existsSync(path.join(styleDir, 'style.css')), 'stylesheet materialized');
assert.ok(fs.existsSync(path.join(styleDir, 'fonts', 'body.woff2')), 'css url() font copied');
assert.ok(fs.existsSync(path.join(styleDir, 'style.css.js')), 'stylesheet loader generated');
assert.ok(fs.existsSync(path.join(styleDir, 'payload.bin')), 'import.meta.url asset copied');

const loader = fs.readFileSync(path.join(styleDir, 'style.css.js'), 'utf8');
assert.match(loader, /new URL\("\.\/style\.css", import\.meta\.url\)/);
assert.match(loader, /export default ready/);

const main = fs.readFileSync(path.join(dist, 'main.js'), 'utf8');
assert.match(main, /from"\.\/vendor\/fixture-style\/dist\/theme\.js"/);
assert.match(main, /import"\.\/vendor\/fixture-style\/dist\/style\.css\.js"/);

const module = await import(pathToFileURL(path.join(dist, 'main.js')).href);
assert.equal(module.name, 'dark');
const theme = await import(pathToFileURL(path.join(styleDir, 'theme.js')).href);
assert.equal(theme.payload.endsWith('/payload.bin'), true);
console.log('pack-vendor-assets: PASS');
