import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROUTE_CATALOG_REL, ROUTE_CATALOG_SCHEMA } from './constants.js';
import { isRouteBoundaryStem, parsePathPattern } from './route-catalog.js';
import { serveState } from './state.js';

export function bustUrl(href: string) {
    const u = new URL(href);
    u.searchParams.set('t', String(serveState.reloadToken));
    return u.href;
}

export async function loadPageCtor(chunkId: string) {
    const pageRel = `${chunkId}.client.js`;
    const href = bustUrl(pathToFileURL(path.join(serveState.distDir, pageRel)).href);
    const mod = await import(href);
    serveState.pageCtors.set(chunkId, mod.default);
    return mod.default;
}

export async function listPageClientFiles(dir: string) {
    const fromCatalog = await listPagesFromRouteCatalog(dir);
    if (!fromCatalog.length) {
        if (serveState.isDev) {
            console.warn(`vmz dev: missing compiled ${ROUTE_CATALOG_SCHEMA} at ${path.join(dir, ...ROUTE_CATALOG_REL.split('/'))}`);
            return [];
        }
        throw new Error(`vmz serve: missing compiled ${ROUTE_CATALOG_SCHEMA} at ${path.join(dir, ...ROUTE_CATALOG_REL.split('/'))}`);
    }
    return fromCatalog;
}

async function listPagesFromRouteCatalog(dir: string) {
    const out: Array<{
        chunkId: string;
        pageRel: string;
        routeId: string;
        pathPattern?: string;
        segs: string[];
    }> = [];
    try {
        const raw = await readFile(path.join(dir, ...ROUTE_CATALOG_REL.split('/')), 'utf8');
        const catalog = JSON.parse(raw);
        if (catalog?.schema !== ROUTE_CATALOG_SCHEMA || !Array.isArray(catalog.pages)) return [];
        for (const page of catalog.pages) {
            const chunkId = String(page?.chunkId || '').replace(/\\/g, '/');
            if (!chunkId.startsWith('pages/')) continue;
            const stem = chunkId.split('/').pop() || '';
            if (isRouteBoundaryStem(stem)) continue;
            const segs = Array.isArray(page?.segs) && page.segs.length ? page.segs : parsePathPattern(String(page?.pathPattern || ''));
            const pageRel = String(page?.pageRel || `${chunkId}.client.js`).replace(/\\/g, '/');
            out.push({
                chunkId,
                pageRel,
                routeId: typeof page?.routeId === 'string' ? page.routeId : chunkId,
                pathPattern: typeof page?.pathPattern === 'string' ? page.pathPattern : undefined,
                segs,
            });
        }
    } catch {
        return [];
    }
    return out;
}

export async function runRouteGate(pathname: string, chunkId: string | undefined) {
    try {
        const href = bustUrl(pathToFileURL(path.join(serveState.distDir, 'vmz-route-gate.mjs')).href);
        const mod = await import(href);
        if (typeof mod.check !== 'function') return null;
        return await mod.check(pathname, chunkId ?? null);
    } catch {
        return null;
    }
}

export function pageNeedsReload(chunkId: string, affected: string[]) {
    if (chunkId === 'pages/Layout' || chunkId.endsWith('/Layout')) return true;
    return affected.some((a) => {
        const id = String(a);
        return id === chunkId || chunkId.startsWith(`${id}/`) || id.startsWith(`${chunkId}/`);
    });
}

export async function loadPageResumeEntries(dir: string, chunkId: string) {
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        const units = Array.isArray(dep.units) ? dep.units : [];
        const page =
            units.find((u: { chunkId?: string }) => u.chunkId === chunkId) ||
            units.find((u: { chunkId?: string }) => u.chunkId === 'pages/index') ||
            units.find((u: { kind?: string }) => u.kind === 'page');
        const entries = Array.isArray(page?.resumeEntries) ? page.resumeEntries : [];
        return entries.map((e: { component?: string; strategy?: string }) => ({
            component: String(e.component || ''),
            strategy: String(e.strategy || ''),
        }));
    } catch {
        return [];
    }
}

export function isEventStrategy(strategy: string) {
    return strategy === 'event' || strategy === 'click' || strategy.startsWith('event:');
}

export function isEventOnlyShell(strategies: string[]) {
    if (!strategies.length) return false;
    return strategies.every((s) => isEventStrategy(s));
}
