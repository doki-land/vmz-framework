/**
 * Unit — content-addressed CSS @import rewrite.
 */
import assert from 'node:assert/strict';
import { rewriteCssImports } from '../../dist/content-addressed-assets.js';

const rewrites = {
    'vmz-designs.css': 'assets/abc123.css',
    '/vmz-designs.css': '/assets/abc123.css',
    'vmz-style.css': 'assets/def456.css',
    '/vmz-style.css': '/assets/def456.css',
};

const input = '@import"./vmz-designs.css";@import "./vmz-style.css";';
const out = rewriteCssImports(input, rewrites);
assert.match(out, /@import"\.\/abc123\.css"/);
assert.match(out, /@import"\.\/def456\.css"/);
assert.doesNotMatch(out, /vmz-designs\.css/);
assert.doesNotMatch(out, /vmz-style\.css/);

console.log('content-addressed-css-import unit: PASS');
