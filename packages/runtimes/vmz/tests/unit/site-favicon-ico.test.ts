/**
 * Unit — PNG-in-ICO pack for site favicon.
 */
import assert from 'node:assert/strict';
import { packPngsIntoIco } from '../../dist/site-favicon.js';

// Minimal valid 1x1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const ico = packPngsIntoIco([
    { png, size: 16 },
    { png, size: 32 },
]);
assert.equal(ico.readUInt16LE(0), 0);
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 2);
assert.equal(ico.readUInt8(6), 16);
assert.equal(ico.readUInt8(22), 32);
assert.ok(ico.length > 6 + 32);

console.log('site-favicon-ico unit: PASS');
