/**
 * Unit — content-addressed JS entry relative import rewrite.
 */
import assert from 'node:assert/strict';
import { rewriteJsEntryRelativeImports } from '../../dist/content-addressed-assets.js';

const input = `import { hydrate } from "./vmz-dom.js";
import { installClientNavigation } from "./vmz-client-nav.js";
import Button from "./components/Button.client.js";
const mod = await import("./" + entry);
const Page = (await import("./" + chunkId + ".client.js")).default;
`;

const out = rewriteJsEntryRelativeImports(input, {});
assert.match(out, /from "\.\.\/vmz-dom\.js"/);
assert.match(out, /from "\.\.\/vmz-client-nav\.js"/);
assert.match(out, /from "\.\.\/components\/Button\.client\.js"/);
assert.match(out, /import\("\.\.\/"\s*\+\s*entry\)/);
assert.match(out, /import\("\.\.\/"\s*\+\s*chunkId/);
assert.doesNotMatch(out, /from "\.\/vmz-dom\.js"/);
assert.doesNotMatch(out, /import\("\.\/"\s*\+/);

const hashed = rewriteJsEntryRelativeImports('import x from "./vmz-dom.js";', {
    'vmz-dom.js': 'assets/abc123.js',
    '/vmz-dom.js': '/assets/abc123.js',
});
assert.match(hashed, /from "\.\/abc123\.js"/);
assert.doesNotMatch(hashed, /vmz-dom\.js/);

console.log('content-addressed-js-entry-import unit: PASS');
