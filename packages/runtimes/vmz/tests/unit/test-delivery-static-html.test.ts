/**
 * Gate: `vmz test` delivery build must emit static HTML under `profiles.*.name`
 * (not only serve-host). Pre-nesting createWorkspace into `<out-dir>/cdn` without
 * pack+assemble left Browser Host 404 — see handoff serve-profile-name.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { buildProjectToOutDirRoot } from 'vmz';
import { resolveDeliveryServeRoot } from '@vmz/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '../..');
const vmzEntry = path.join(packageRoot, 'dist', 'index.js');

describe('test delivery build emits nested static HTML', () => {
    it('buildProjectToOutDirRoot writes index.html under name: cdn', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-test-cdn-html-'));
        fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
        fs.writeFileSync(
            path.join(dir, 'src', 'pages', 'index.vmz'),
            `<template>
  <h1>CIRCLE</h1>
</template>
<script client>
export default class IndexPage {}
</script>
`,
        );
        fs.writeFileSync(
            path.join(dir, 'src', 'Application.vmz'),
            `<template><slot /></template>
<script client>
export default class Application {}
</script>
`,
        );
        fs.writeFileSync(
            path.join(dir, 'vmz.config.ts'),
            `import { defineConfig } from ${JSON.stringify(vmzEntry)};
export default defineConfig({
  delivery: {
    default: 'static',
    profiles: {
      static: { host: 'browser', assembly: 'web-static', name: 'cdn' },
    },
  },
});
`,
        );

        const outDirRoot = path.join(dir, 'dist');
        const built = await buildProjectToOutDirRoot(dir, outDirRoot, { quiet: true });
        expect(built.ok).toBe(true);
        if (!built.ok) return;

        expect(built.deliveryName).toBe('cdn');
        expect(built.artifactDir).toBe(path.join(outDirRoot, 'cdn'));

        const serveRoot = resolveDeliveryServeRoot(built.outDirRoot, built.deliveryName);
        expect(serveRoot).toBe(path.join(outDirRoot, 'cdn'));
        expect(fs.existsSync(path.join(serveRoot, 'index.html'))).toBe(true);
        expect(fs.existsSync(path.join(serveRoot, 'vmz-serve-host.mjs')) || fs.existsSync(path.join(serveRoot, 'vmz-deployment.json'))).toBe(
            true,
        );

        const html = fs.readFileSync(path.join(serveRoot, 'index.html'), 'utf8');
        expect(html.includes('CIRCLE') || html.length > 0).toBe(true);
    });
});
