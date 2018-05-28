/**
 * N4: affected rebuild + Deployment IR adapter.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import {
    createRolldownPluginVmzAdapter,
    createVitePluginVmzAdapter,
    createWorkspace,
    loadDeploymentIr,
    planAffectedBundleInputs,
    planBundleInputs,
} from 'vmz';

describe('vmz affected rebuild (N4)', () => {
    it('rebuilds only the dirty component chunk', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n4-unit-'));
        fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
        const body = (n) => `<template><p>${n}</p></template>\n<script client>\nexport default class ${n} {}\n</script>\n`;
        const a = path.join(dir, 'src', 'components', 'A.vmz');
        const b = path.join(dir, 'src', 'components', 'B.vmz');
        fs.writeFileSync(a, body('A'));
        fs.writeFileSync(b, body('B'));
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><slot /></template>\n<script client>\nexport default class Application {}\n</script>\n`,
        );
        const outDir = path.join(dir, 'dist');
        const ws = createWorkspace({ root: dir, outDir });
        const full = ws.build();
        expect(full.full).toBe(true);
        expect(fs.existsSync(path.join(outDir, 'vmz-deployment.json'))).toBe(true);
        ws.dispose();

        const ws2 = createWorkspace({ root: dir, outDir });
        fs.writeFileSync(a, body('A2'));
        ws2.updateFiles([{ path: a, kind: 'update' }]);
        const plan = ws2.queryAffected();
        expect(plan.islandOnly).toBe(true);
        const inc = ws2.build();
        expect(inc.full).toBe(false);
        expect(inc.affectedChunks).toContain('components/A');
        expect(inc.islandHmr).toBe(true);
        const emitted = (inc.emitted || []).map((p) => p.replaceAll('\\', '/'));
        expect(emitted.some((p) => p.endsWith('B.client.js'))).toBe(false);

        const ir = loadDeploymentIr(outDir);
        expect(ir.schema).toBe('vmz.deployment.v0');
        expect(ir.islandHmr).toBe(true);
        expect(planBundleInputs(outDir, ir).length).toBeGreaterThanOrEqual(2);
        expect(planAffectedBundleInputs(outDir, ir).some((e) => e.chunkId.includes('A'))).toBe(true);
        expect(createVitePluginVmzAdapter({ outDir, root: dir }).name).toBe('vmz-deployment-adapter');
        expect(createRolldownPluginVmzAdapter({ outDir, root: dir }).name).toBe('vmz-deployment-adapter-rolldown');

        ws2.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('expands reverse edges from component to importing page', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-n4-rev-'));
        fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
        const body = (n) => `<template><p>${n}</p></template>\n<script client>\nexport default class ${n} {}\n</script>\n`;
        const card = path.join(dir, 'src', 'components', 'Card.vmz');
        const page = path.join(dir, 'src', 'pages', 'index.vmz');
        fs.writeFileSync(card, body('Card'));
        fs.writeFileSync(page, `<template><Card /></template>\n<script client>\nexport default class Index {}\n</script>\n`);
        const outDir = path.join(dir, 'dist');
        const ws = createWorkspace({ root: dir, outDir });
        ws.build();
        const ir = loadDeploymentIr(outDir);
        const pageU = ir.units.find((u) => u.chunkId === 'pages/index');
        expect(pageU.dependsOn).toContain('components/Card');
        ws.dispose();

        const ws2 = createWorkspace({ root: dir, outDir });
        fs.writeFileSync(card, body('Card2'));
        ws2.updateFiles([{ path: card, kind: 'update' }]);
        const plan = ws2.queryAffected();
        expect(plan.units.map((u) => u.chunkId).sort()).toEqual(['components/Card', 'pages/index']);
        expect(plan.islandOnly).toBe(false);
        const inc = ws2.build();
        expect(inc.islandHmr).toBe(false);
        expect(inc.affectedChunks).toContain('pages/index');
        ws2.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
