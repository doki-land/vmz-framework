/**
 * A1 Browser Core — production-catalog fixture:
 * compile + logic + SSR + resume + real Chromium + async cancel + no-render scan
 * + incremental affected rebuild (ProductRow → CatalogList / pages/index).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkspace } from 'vmz';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, runVmzTest, scanForbiddenHotPath, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const EXAMPLE = 'packages/examples/production-catalog';

const REQUIRED = [
    'production.catalog.compile.list',
    'production.catalog.compile.page',
    'production.catalog.logic.list',
    'production.catalog.ssr.list',
    'production.catalog.browser.select',
    'production.catalog.resume.chip',
];

function fail(msg: string): never {
    console.error(`browser-core FAIL: ${msg}`);
    process.exit(1);
}

console.log('browser-core: build production-catalog…');
const build = runVmzBuild(EXAMPLE, root);
if (build.status !== 0) {
    const proof = readProof(root);
    upsertCheck(proof, {
        id: 'browser-core.build',
        status: 'failed',
        detail: (build.stderr || build.stdout).slice(0, 2000),
    });
    addLimitation(proof, 'A1: production-catalog failed to build');
    writeProof(proof, root);
    fail(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
}

const forbidden = scanForbiddenHotPath(build.dist);

console.log('browser-core: async softLoad cancel / stale generation…');
let asyncOk = true;
let asyncDetail = '';
try {
    asyncDetail = await proveCatalogAsync(build.dist);
} catch (e) {
    asyncOk = false;
    asyncDetail = e instanceof Error ? e.message : String(e);
}

console.log('browser-core: incremental affected rebuild (ProductRow)…');
let incrementalOk = true;
let incrementalDetail = '';
try {
    incrementalDetail = proveCatalogIncremental(path.join(root, EXAMPLE));
} catch (e) {
    incrementalOk = false;
    incrementalDetail = e instanceof Error ? e.message : String(e);
}

console.log('browser-core: vmz test compile,logic,ssr,resume,browser…');
const test = runVmzTest(EXAMPLE, ['--mode', 'compile,logic,ssr,resume,browser', '--filter', '^production\\.catalog\\.'], root);

const proof = readProof(root);
proof.hostProfile = 'browser-web-surface';
proof.deliveryProfile = proof.deliveryProfile ?? 'browser-ssr-direct-resume';

const report = test.report as {
    status?: string;
    tests?: Array<{ testId: string; status: string }>;
} | null;
const missing: string[] = [];
if (!report || report.status !== 'passed') {
    missing.push(`vmz test status=${report?.status ?? 'missing'}`);
}
for (const id of REQUIRED) {
    const hit = report?.tests?.find((t) => t.testId === id);
    if (!hit || hit.status !== 'passed') missing.push(id);
}

upsertCheck(proof, {
    id: 'browser-core.build',
    status: 'passed',
    detail: build.dist,
});
upsertCheck(proof, {
    id: 'browser-core.vmz-test',
    status: missing.length ? 'failed' : 'passed',
    detail: missing.length ? missing.join(', ') : test.reportPath,
});
upsertCheck(proof, {
    id: 'browser-core.no-render-hot-path',
    status: forbidden.length ? 'failed' : 'passed',
    detail: forbidden.length ? forbidden.join('; ') : 'no render()/blueprint dispatcher in application *.client.js',
});
upsertCheck(proof, {
    id: 'browser-core.async-cancel',
    status: asyncOk ? 'passed' : 'failed',
    detail: asyncDetail,
});
upsertCheck(proof, {
    id: 'browser-core.incremental',
    status: incrementalOk ? 'passed' : 'failed',
    detail: incrementalDetail,
});

proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('Resume adopt') &&
        !l.includes('async stale') &&
        !l.includes('browser Host (Chromium)') &&
        !l.includes('A1: incremental affected rebuild proof not yet covered'),
);
if (!incrementalOk) {
    addLimitation(proof, 'A1: incremental affected rebuild proof failed');
} else {
    // Region/route/locale/style incremental slices remain open beyond catalog reverse-edge.
    addLimitation(proof, 'A1: region/route/locale/style incremental slices not yet covered');
}

const out = writeProof(proof, root);
console.log(`browser-core: wrote ${path.relative(root, out)}`);

if (test.status !== 0 || missing.length || forbidden.length || !asyncOk || !incrementalOk) {
    fail(
        [
            test.status !== 0 ? `vmz test exit ${test.status}` : '',
            missing.length ? `failed tests: ${missing.join(', ')}` : '',
            forbidden.length ? `forbidden hot path: ${forbidden.join('; ')}` : '',
            !asyncOk ? `async: ${asyncDetail}` : '',
            !incrementalOk ? `incremental: ${incrementalDetail}` : '',
            test.stdout,
            test.stderr,
        ]
            .filter(Boolean)
            .join('\n'),
    );
}

console.log('browser-core PASS: catalog compile+logic+ssr+resume+browser+async + no-render + incremental');
console.log('browser-core NOTE: region/route/locale/style incremental slices still open');

async function proveCatalogAsync(dist: string): Promise<string> {
    const clientJs = fs.readFileSync(path.join(dist, 'components', 'CatalogList.client.js'), 'utf8');
    if (!clientJs.includes('__vmzRunTask(this, "softLoad"') && !clientJs.includes("__vmzRunTask(this, 'softLoad'")) {
        throw new Error('CatalogList.client.js missing __vmzRunTask wrap for softLoad');
    }
    const { parseHTML } = await import('linkedom');
    const { window } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
    (globalThis as any).window = window;
    (globalThis as any).document = window.document;
    (globalThis as any).HTMLElement = window.HTMLElement;
    (globalThis as any).Node = window.Node;
    (globalThis as any).AbortController = AbortController;

    const dom = await import(pathToFileURL(path.join(dist, 'vmz-dom.js')).href);
    const Comp = (await import(pathToFileURL(path.join(dist, 'components', 'CatalogList.client.js')).href)).default;
    const ProductRow = (await import(pathToFileURL(path.join(dist, 'components', 'ProductRow.client.js')).href)).default;
    if (typeof dom.registerComponents === 'function') {
        dom.registerComponents({ ProductRow });
    }
    const app = document.getElementById('app');
    const inst = await dom.mount(Comp, app, {});
    const p = inst.softLoad();
    dom.destroy(inst);
    await p;
    if (dom.__vmzTaskStatus(inst, 'softLoad') !== 'cancelled') {
        throw new Error(`destroy softLoad want cancelled, got ${dom.__vmzTaskStatus(inst, 'softLoad')}`);
    }
    if (inst.asyncLabel === 'done' || inst.selected === 'Alpha') {
        throw new Error('destroyed softLoad must not apply asyncLabel/selected');
    }

    const inst2 = await dom.mount(Comp, app, {});
    const slow = inst2.softLoad();
    await new Promise((r) => setTimeout(r, 5));
    const newer = inst2.softLoad();
    await newer;
    await slow;
    if (dom.__vmzTaskStatus(inst2, 'softLoad') !== 'success') {
        throw new Error(`supersede softLoad want success, got ${dom.__vmzTaskStatus(inst2, 'softLoad')}`);
    }
    if (inst2.asyncLabel !== 'done') throw new Error(`asyncLabel want done, got ${inst2.asyncLabel}`);
    return 'destroy-cancel + generation-supersede ok';
}

/**
 * Dirty ProductRow in a temp copy of production-catalog; prove reverse-edge
 * incremental rebuild (CatalogList + pages/index) without re-emitting CatalogChip.
 */
function proveCatalogIncremental(exampleRoot: string): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-a1-inc-'));
    const srcRoot = path.join(tmp, 'app');
    const outDir = path.join(tmp, 'dist');
    fs.cpSync(exampleRoot, srcRoot, {
        recursive: true,
        filter: (p) => !p.replaceAll('\\', '/').includes('/dist') && !p.replaceAll('\\', '/').includes('/node_modules'),
    });

    const rowPath = path.join(srcRoot, 'src', 'components', 'ProductRow.vmz');
    if (!fs.existsSync(rowPath)) {
        throw new Error(`missing ProductRow.vmz at ${rowPath}`);
    }

    const ws = createWorkspace({ root: srcRoot, outDir });
    try {
        const full = ws.build();
        if ((full.diagnostics || []).some((d) => d.severity === 'error')) {
            throw new Error(`full build diagnostics: ${JSON.stringify(full.diagnostics)}`);
        }
        if (!full.full) throw new Error('first build must be full');

        const dirty =
            `<template>\n  <span class="row">inc-{{ title }}</span>\n</template>\n\n` +
            `<script client>\nexport default class ProductRow {\n  public title: string = '';\n}\n</script>\n`;
        fs.writeFileSync(rowPath, dirty);
        ws.updateFiles([{ path: rowPath, kind: 'update' }]);

        const plan = ws.queryAffected();
        if (plan.full) throw new Error('affected plan must not be full');
        const planChunks = (plan.units || []).map((u) => u.chunkId).sort();
        if (!planChunks.includes('components/ProductRow')) {
            throw new Error(`seed ProductRow missing from plan: ${JSON.stringify(planChunks)}`);
        }
        if (!planChunks.includes('components/CatalogList') && !planChunks.includes('pages/index')) {
            throw new Error(`expected CatalogList or pages/index via reverse edge, got ${JSON.stringify(planChunks)}`);
        }
        if (planChunks.includes('components/CatalogChip')) {
            throw new Error(`unrelated CatalogChip must not be affected: ${JSON.stringify(planChunks)}`);
        }

        const inc = ws.build();
        if (inc.full) throw new Error('incremental build must not be full');
        const affected = inc.affectedChunks || [];
        if (!affected.includes('components/ProductRow')) {
            throw new Error(`affectedChunks missing ProductRow: ${JSON.stringify(affected)}`);
        }
        if (!affected.includes('components/CatalogList') && !affected.includes('pages/index')) {
            throw new Error(`affectedChunks missing reverse edge: ${JSON.stringify(affected)}`);
        }
        if (affected.includes('components/CatalogChip')) {
            throw new Error(`CatalogChip must not rebuild: ${JSON.stringify(affected)}`);
        }
        const emitted = (inc.emitted || []).map((p) => p.replaceAll('\\', '/'));
        if (emitted.some((p) => p.includes('CatalogChip.client.js') || p.endsWith('CatalogChip.program.json'))) {
            throw new Error(`CatalogChip re-emitted: ${emitted.join(', ')}`);
        }
        if (!emitted.some((p) => p.includes('ProductRow.client.js') || p.endsWith('ProductRow.program.json'))) {
            throw new Error(`ProductRow not re-emitted: ${emitted.join(', ')}`);
        }
        return `ProductRow → ${affected.join(',')} (not CatalogChip)`;
    } finally {
        try {
            ws.dispose();
        } catch {
            /* ignore */
        }
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}
