/**
 * route-layout-chain — Application shell + nested page layouts from Deployment Plan.
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

function writeDeployment(dist: string, units: Array<{ chunkId: string; kind?: string; layoutChain?: string[] }>) {
    fs.writeFileSync(
        path.join(dist, 'vmz-deployment.json'),
        JSON.stringify({
            schema: 'vmz.deployment.v0',
            units: units.map((u) => ({
                chunkId: u.chunkId,
                kind: u.kind || 'page',
                source: `${u.chunkId}.vmz`,
                clientEntry: `${u.chunkId}.client.js`,
                programIr: `${u.chunkId}.program.json`,
                layoutChain: u.layoutChain || [],
            })),
        }),
    );
}

describe('route-layout-chain (plan-only)', () => {
    it('reads Application + nested Layout from page unit layoutChain', () => {
        const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-layout-'));
        writeDeployment(dist, [
            { chunkId: APPLICATION_SHELL_CHUNK, kind: 'application', layoutChain: [] },
            {
                chunkId: 'pages/shop/index',
                layoutChain: [APPLICATION_SHELL_CHUNK, 'pages/shop/Layout'],
            },
            { chunkId: 'pages/shop/Layout', kind: 'page', layoutChain: [] },
        ]);

        expect(resolveNestedLayoutChain(dist, 'pages/shop/index')).toEqual(['pages/shop/Layout']);
        expect(resolveRouteLayoutChain(dist, 'pages/shop/index')).toEqual([APPLICATION_SHELL_CHUNK, 'pages/shop/Layout']);
        expect(hasApplicationShell(dist)).toBe(true);

        fs.rmSync(dist, { recursive: true, force: true });
    });

    it('returns empty chain when Plan emits no layouts', () => {
        const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-layout2-'));
        writeDeployment(dist, [{ chunkId: 'pages/index', layoutChain: [] }]);

        expect(resolveRouteLayoutChain(dist, 'pages/index')).toEqual([]);
        expect(hasApplicationShell(dist)).toBe(false);

        fs.rmSync(dist, { recursive: true, force: true });
    });
});
