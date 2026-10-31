/**
 * Integrated DocumentMount — compile host chrome via DocumentLayout + createRenderHost.
 * Replaces the removed regex template lowering in document-host-chrome.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderHost } from '@vmz/core/render-host';
import { packNodeEntryFile } from '../workspace/pack.js';

declare global {
    // Locale hint consumed by compiled DocumentLayout during SSR.
    // eslint-disable-next-line no-var
    var __vmzLocaleIdHint: string | undefined;
}

export function resolveDocumentLayoutChunkId(distDir: string): string | null {
    for (const chunkId of ['layouts/DocumentLayout', 'components/DocumentLayout']) {
        if (fs.existsSync(path.join(distDir, `${chunkId}.client.js`))) return chunkId;
    }
    return null;
}

export function assertIntegratedDistReady(distDir: string): string {
    const dom = path.join(distDir, 'vmz-dom.js');
    if (!fs.existsSync(dom)) {
        throw new Error('integrated document mount requires vmz build output (vmz-dom.js in app dist). Run `vmz build` before document emit.');
    }
    const chunkId = resolveDocumentLayoutChunkId(distDir);
    if (!chunkId) {
        throw new Error('integrated document mount requires compiled DocumentLayout (add src/layouts/DocumentLayout.vmz and rebuild)');
    }
    return chunkId;
}

export function assertCompiledShellHtml(html: string): void {
    const header = html.match(/<header[^>]*data-vmz-fixture="site-header"[\s\S]*?<\/header>/i)?.[0] ?? '';
    const footer = html.match(/<footer[^>]*data-vmz-fixture="site-footer"[\s\S]*?<\/footer>/i)?.[0] ?? '';
    const parts = [
        { label: 'header', tag: 'header', fixture: 'site-header', html: header },
        { label: 'footer', tag: 'footer', fixture: 'site-footer', html: footer },
    ];
    for (const part of parts) {
        if (!part.html) {
            throw new Error(
                `document layout SSR missing compiled <${part.tag} data-vmz-fixture="${part.fixture}"> in chrome`,
            );
        }
        const leak = part.html.match(/\{[A-Za-z][A-Za-z0-9]*\}/);
        if (leak) {
            throw new Error(`document layout SSR leaked binding placeholder ${leak[0]} in ${part.label}`);
        }
        const leakedTag = part.html.match(/<(Link|Button|Icon)\b/)?.[1];
        if (leakedTag) {
            throw new Error(
                `document layout SSR leaked uncompiled <${leakedTag}> in ${part.label} (compile it or use plain HTML)`,
            );
        }
    }
}

async function loadCtor(distDir: string, chunkId: string): Promise<unknown> {
    // Node chunk identity comes from `_vmz/pack-node-manifest.json`; the
    // unpacked root `${chunkId}.client.js` is not a fallback. No `?t=` cache
    // bust: packed chunks are shared instance URLs.
    const href = pathToFileURL(packNodeEntryFile(distDir, chunkId)).href;
    const mod = await import(href);
    return mod.default;
}

export async function renderCompiledDocumentLayout(distDir: string, localeId: string, slotHtml: string): Promise<string> {
    const chunkId = assertIntegratedDistReady(distDir);
    const prevHint = globalThis.__vmzLocaleIdHint;
    globalThis.__vmzLocaleIdHint = localeId;
    try {
        if (typeof globalThis.document !== 'undefined' && globalThis.document?.documentElement) {
            globalThis.document.documentElement.setAttribute('data-locale', localeId);
            globalThis.document.documentElement.setAttribute('lang', localeId);
        }
        const host = await createRenderHost(distDir, { strictDeployment: true, preload: 'none' });
        await host.ensureComponents([chunkId]);
        const Layout = await loadCtor(distDir, chunkId);
        const html = await host.renderToString(Layout, {}, { slotHtml });
        assertCompiledShellHtml(html);
        return html;
    } finally {
        if (prevHint === undefined) delete globalThis.__vmzLocaleIdHint;
        else globalThis.__vmzLocaleIdHint = prevHint;
    }
}
