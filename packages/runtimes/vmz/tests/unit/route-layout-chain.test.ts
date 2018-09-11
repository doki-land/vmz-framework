/**
 * route-layout-chain — Application shell + nested page layouts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import {
    APPLICATION_SHELL_CHUNK,
    hasApplicationShell,
    resolveNestedLayoutChain,
    resolveRouteLayoutChain,
} from '../../../vmz-runtime/src/route-layout-chain.ts';

describe('route-layout-chain (VMZ-1)', () => {
    it('prepends Application when Application.client.js exists', () => {
        const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-layout-'));
        fs.mkdirSync(path.join(dist, 'pages', 'shop'), { recursive: true });
        fs.writeFileSync(path.join(dist, `${APPLICATION_SHELL_CHUNK}.client.js`), 'export default class Application {}');
        fs.writeFileSync(path.join(dist, 'pages', 'shop', 'Layout.client.js'), 'export default class Layout {}');
        fs.writeFileSync(path.join(dist, 'pages', 'shop', 'index.client.js'), 'export default class Index {}');

        expect(resolveNestedLayoutChain(dist, 'pages/shop/index')).toEqual(['pages/shop/Layout']);
        expect(resolveRouteLayoutChain(dist, 'pages/shop/index')).toEqual(['Application', 'pages/shop/Layout']);
        expect(hasApplicationShell(dist)).toBe(true);

        fs.rmSync(dist, { recursive: true, force: true });
    });

    it('omits Application when shell emit is absent', () => {
        const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-layout2-'));
        fs.mkdirSync(path.join(dist, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(dist, 'pages', 'index.client.js'), 'export default class Index {}');

        expect(resolveRouteLayoutChain(dist, 'pages/index')).toEqual([]);
        expect(hasApplicationShell(dist)).toBe(false);

        fs.rmSync(dist, { recursive: true, force: true });
    });
});
