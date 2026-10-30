import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectBareSpecs, packClientBareImports } from '../../dist/workspace/pack-client-packages.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-minified-closure-'));
const dist = path.join(root, 'dist');
const library = path.join(root, 'node_modules', 'fixture-parser');
const dependency = path.join(root, 'node_modules', 'fixture-value');
for (const directory of [dist, library, dependency]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(path.join(library, 'package.json'), JSON.stringify({ name: 'fixture-parser', type: 'module', exports: './index.js' }));
fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-value', type: 'module', exports: './index.js' }));
fs.writeFileSync(path.join(dependency, 'index.js'), 'export const value=42;');
fs.writeFileSync(path.join(library, 'index.js'), 'import"./side.js";export{value}from"./utils.js";');
fs.writeFileSync(path.join(library, 'side.js'), 'globalThis.__vmzMinifiedClosure=true;');
fs.writeFileSync(path.join(library, 'utils.js'), 'export{value}from"fixture-value";');
fs.writeFileSync(path.join(dist, 'entry.js'), 'export{value}from"fixture-parser";');

assert.deepEqual(collectBareSpecs('export{value}from"fixture-value";import"fixture-parser";'), ['fixture-value', 'fixture-parser']);
const report = packClientBareImports(dist, { projectRoot: root });
assert.deepEqual(report.remainingBareSpecs, []);
// The vendored tree is intermediate behavior of the thin pack slice (no
// linking / tree-shaking / minification runs today), so exact `dist/vendor/**`
// paths and vendored file counts are not correctness targets here — lowering
// happening plus an executable module graph are.
assert.ok(report.vendoredModules.length > 0, 'expected intermediate vendoring to materialize the closure');
const module = await import(pathToFileURL(path.join(dist, 'entry.js')).href);
assert.equal(module.value, 42);
assert.equal((globalThis as Record<string, unknown>).__vmzMinifiedClosure, true);
delete (globalThis as Record<string, unknown>).__vmzMinifiedClosure;
console.log('pack-vendor-module-closure: PASS');
