/**
 * smoke: Node host loads native workspace session and runs check.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import {
    COMPILER_PROTOCOL,
    PROGRAM_IR_SCHEMA,
    createWorkspace,
    expectedProtocol,
    getProtocolVersions,
    handshake,
    resolveNativePath,
} from 'vmz';

describe('vmz napi workspace (N1)', () => {
    it('resolves native addon', () => {
        expect(fs.existsSync(resolveNativePath())).toBe(true);
    });

    it('handshake matches locked protocols', () => {
        const native = getProtocolVersions();
        expect(native.compilerProtocol).toBe(COMPILER_PROTOCOL);
        expect(native.programIrSchema).toBe(expectedProtocol().programIrSchema);
        expect(() => handshake()).not.toThrow();
    });

    it('createWorkspace -> updateFiles -> check', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-napi-'));
        const src = path.join(dir, 'src');
        fs.mkdirSync(src);
        const vmz = path.join(src, 'Application.vmz');
        fs.writeFileSync(
            vmz,
            `<template>
  <p>hi</p>
</template>

<script client>
export default class Application {}
</script>
`,
        );

        const ws = createWorkspace({ root: dir, outDir: path.join(dir, 'dist') });
        expect(path.normalize(ws.root())).toBe(path.normalize(dir));
        ws.updateFiles([{ path: vmz, kind: 'update' }]);
        expect(ws.dirtyPaths().some((p) => p.replaceAll('\\', '/').endsWith('Application.vmz'))).toBe(true);

        const report = ws.check();
        expect(report.filesChecked).toBeGreaterThanOrEqual(1);
        const errors = report.diagnostics.filter((d) => d.severity === 'error');
        expect(errors, JSON.stringify(report.diagnostics)).toEqual([]);

        ws.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('build -> queryProgramGraph returns emitted Program IR', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-napi-build-'));
        const src = path.join(dir, 'src');
        fs.mkdirSync(src);
        const vmz = path.join(src, 'Application.vmz');
        fs.writeFileSync(
            vmz,
            `<template>
  <p>hi</p>
</template>

<script client>
export default class Application {}
</script>
`,
        );

        const outDir = path.join(dir, 'dist');
        const ws = createWorkspace({ root: dir, outDir });
        const report = ws.build();
        expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
        const json = ws.queryProgramGraph(vmz);
        expect(json).toContain(PROGRAM_IR_SCHEMA);
        expect(json).toBe(fs.readFileSync(path.join(outDir, 'Application.program.json'), 'utf8'));
        expect(ws.explain('App').length).toBeGreaterThan(0);
        ws.dispose();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
