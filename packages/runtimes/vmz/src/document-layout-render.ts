// @ts-nocheck
/**
 * Integrated DocumentMount — compile host chrome via DocumentLayout + createRenderHost.
 * Replaces the removed regex template lowering in document-host-chrome.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRenderHost } from '@vmz/core/render-host';

/** @param {string} distDir */
export function resolveDocumentLayoutChunkId(distDir) {
    for (const chunkId of ['layouts/DocumentLayout', 'components/DocumentLayout']) {
        if (fs.existsSync(path.join(distDir, `${chunkId}.client.js`))) return chunkId;
    }
    return null;
}

/**
 * @param {string} distDir
 */
export function assertIntegratedDistReady(distDir) {
    const dom = path.join(distDir, 'vmz-dom.js');
    if (!fs.existsSync(dom)) {
        throw new Error(
            'integrated document mount requires vmz build output (vmz-dom.js in app dist). Run `vmz build` before document emit.',
        );
    }
    const chunkId = resolveDocumentLayoutChunkId(distDir);
    if (!chunkId) {
        throw new Error(
            'integrated document mount requires compiled DocumentLayout (add src/layouts/DocumentLayout.vmz and rebuild)',
        );
    }
    return chunkId;
}

/**
 * @param {string} html
 */
export function assertCompiledShellHtml(html) {
    const header = html.match(/<header[^>]*data-vmz-fixture="site-header"[\s\S]*?<\/header>/i)?.[0] ?? '';
    const footer = html.match(/<footer[^>]*data-vmz-fixture="site-footer"[\s\S]*?<\/footer>/i)?.[0] ?? '';
    for (const part of [header, footer]) {
        const leak = part.match(/\{[A-Za-z][A-Za-z0-9]*\}/);
        if (leak) {
            throw new Error(`document layout SSR leaked binding placeholder ${leak[0]}`);
        }
        if (/<(?:Link|Button|Icon)\b/.test(part)) {
            throw new Error('document layout SSR leaked uncompiled VMZ component tag in chrome');
        }
    }
    if (!header || !footer) {
        throw new Error('document layout SSR missing compiled SiteHeader/SiteFooter fixtures');
    }
}

/**
 * @param {string} distDir
 * @param {string} chunkId
 */
async function loadCtor(distDir, chunkId) {
    const href = pathToFileURL(path.join(distDir, `${chunkId}.client.js`)).href;
    const mod = await import(`${href}?t=${Date.now()}`);
    return mod.default;
}

/**
 * @param {string} distDir
 * @param {string} localeId
 * @param {string} slotHtml
 */
export async function renderCompiledDocumentLayout(distDir, localeId, slotHtml) {
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
