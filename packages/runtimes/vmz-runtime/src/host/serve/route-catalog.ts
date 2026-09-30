import { existsSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listClientComponents } from '../list-client-components.js';
import type { ClosedAccessResult, HostRequestOpts, LocaleHostCtx, SseClient } from '../../shared/host.types.js';
import { LOCALE_LINK_PLAN_SCHEMA, linkRouteAliasesFromUnits, localeHrefTableFromPlan, localizeBodyLinks } from '../localize-body-links.js';
import { loadNativeAddon } from '../native-addon.js';
import { createRenderHost } from '../render-host.js';
import { resolveRouteLayoutChain } from '../route-layout-chain.js';
import { handleNodeRequest, setRoutes, setServerModuleResolver } from '../../faces/vmz-runtime.js';

export function parsePathPattern(pattern) {
    const raw = String(pattern || '').trim();
    if (!raw || raw === '/') return [];
    const parts = raw.replace(/^\/+/, '').split('/').filter(Boolean);

    const segs = [];
    for (const p of parts) {
        if (isRouteGroupDir(p)) continue;
        segs.push(parsePathSegment(p));
    }
    return segs;
}

function parsePathSegment(p) {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
    const param = /^\[([^\]]+)\]$/.exec(p);
    const colon = /^:([A-Za-z_][\w]*)$/.exec(p);
    if (catchAll) return { kind: 'catch', name: catchAll[1] };
    if (param) return { kind: 'param', name: param[1] };
    if (colon) return { kind: 'param', name: colon[1] };
    return { kind: 'static', value: p.toLowerCase() };
}

function isRouteGroupDir(seg) {
    return typeof seg === 'string' && seg.startsWith('(') && seg.endsWith(')') && seg.length > 2;
}

export function isRouteBoundaryStem(stem) {
    return stem === 'Layout' || stem === 'Loading' || stem === 'Error' || stem === 'NotFound';
}

export function matchFileRoute(pathname, catalog) {
    const pathParts = decodeURIComponent(pathname.split('?')[0] || '/')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean)
        .map((p) => p.toLowerCase());

    let best = null;
    let bestScore = -1;
    for (const page of catalog) {
        const score = scoreRoute(page.segs, pathParts);
        if (score == null) continue;
        if (score > bestScore) {
            bestScore = score;
            best = page;
        }
    }
    return best;
}

export function extractRouteParams(segs, pathname) {
    const pathParts = decodeURIComponent(pathname.split('?')[0] || '/')
        .replace(/\/+$/, '')
        .split('/')
        .filter(Boolean);

    const params = {};
    let j = 0;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.kind === 'catch') {
            if (s.name) params[s.name] = pathParts.slice(j).join('/');
            return params;
        }
        if (j >= pathParts.length) break;
        if (s.kind === 'param' && s.name) {
            params[s.name] = pathParts[j];
        }
        j++;
    }
    return params;
}

function scoreRoute(segs, pathParts) {
    let i = 0;
    let j = 0;
    let score = 0;
    while (i < segs.length) {
        const s = segs[i];
        if (s.kind === 'catch') {
            // Required catch-all `[...slug]` needs �? remaining segment (not `/`).
            if (j >= pathParts.length) return null;
            score += 1;
            return score;
        }
        if (j >= pathParts.length) return null;
        if (s.kind === 'static') {
            if (s.value !== pathParts[j]) return null;
            score += 1000;
        } else if (s.kind === 'param') {
            score += 100;
        }
        i++;
        j++;
    }
    if (j !== pathParts.length) return null;
    return score + segs.length;
}

export function isRootCatchAll(page) {
    return page?.segs?.length === 1 && page.segs[0].kind === 'catch';
}

export function findRootCatchAll(catalog) {
    return catalog.find((p) => isRootCatchAll(p)) || null;
}
