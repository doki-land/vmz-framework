/**
 * Unit — opaque public/** → dist root (no DXO / node_modules scanning).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emitPublicStaticAssets } from '../../dist/public-static-assets.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-public-'));
const project = path.join(root, 'app');
const dist = path.join(root, 'dist');
const pub = path.join(project, 'public');
fs.mkdirSync(path.join(pub, 'nested'), { recursive: true });
fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(pub, 'dxo_lite_bg.wasm'), Buffer.from('wasm-fixture'));
fs.writeFileSync(path.join(pub, '_redirects'), '/old /new 301\n');
fs.writeFileSync(path.join(pub, 'nested', 'note.txt'), 'ok');
// Must not clobber reserved
fs.writeFileSync(path.join(pub, 'entry-client.js'), 'steal');
fs.writeFileSync(path.join(dist, 'entry-client.js'), 'generated');

const out = emitPublicStaticAssets(dist, { projectRoot: project });
assert.equal(out.status, 'ready');
assert.equal(out.fileCount, 3);
assert.ok(fs.existsSync(path.join(dist, 'dxo_lite_bg.wasm')));
assert.equal(fs.readFileSync(path.join(dist, 'dxo_lite_bg.wasm'), 'utf8'), 'wasm-fixture');
assert.ok(fs.existsSync(path.join(dist, '_redirects')));
assert.ok(fs.existsSync(path.join(dist, 'nested', 'note.txt')));
assert.equal(fs.readFileSync(path.join(dist, 'entry-client.js'), 'utf8'), 'generated');
assert.ok((out.skippedConflicts || []).some((c) => c.path === 'entry-client.js'));

const manifest = JSON.parse(fs.readFileSync(path.join(dist, '_vmz', 'public-static-assets.json'), 'utf8'));
assert.equal(manifest.schema, 'vmz.public_static_assets.v0');
assert.ok(manifest.files.some((f) => f.path === 'dxo_lite_bg.wasm'));

fs.rmSync(root, { recursive: true, force: true });
console.log('public-static-assets unit: PASS');
