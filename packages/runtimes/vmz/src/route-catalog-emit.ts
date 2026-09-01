/**
 * Compiled route catalog (`_vmz/route-catalog.json`) — 0.1.30 authority for page matching.
 * Hosts load this artifact; they must not re-parse deployment pathPattern into a live catalog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { writePrettyJsonFile } from './pretty-json.js';
import { type DeploymentPageUnit, listPublicPageUnits, type PathSeg, parsePathPattern, unitBrowserPathPattern } from './route-path.js';

export const ROUTE_CATALOG_SCHEMA = 'vmz.route.catalog.v0';
export const ROUTE_CATALOG_REL = '_vmz/route-catalog.json';

export type RouteCatalogPage = {
    chunkId: string;
    routeId: string;
    pathPattern: string;
    pageRel: string;
    segs: PathSeg[];
};

export type RouteCatalog = {
    schema: typeof ROUTE_CATALOG_SCHEMA;
    pages: RouteCatalogPage[];
};

export function buildRouteCatalogFromDeployment(deployment: { units?: DeploymentPageUnit[] } | null | undefined): RouteCatalog {
    const pages: RouteCatalogPage[] = [];
    for (const unit of listPublicPageUnits(deployment)) {
        const chunkId = String(unit.chunkId || '').replace(/\\/g, '/');
        const pathPattern = unitBrowserPathPattern(unit);
        const pageRel = String(unit.clientEntry || `${chunkId}.client.js`).replace(/\\/g, '/');
        const routeId = typeof unit.routeId === 'string' && unit.routeId.trim() ? unit.routeId.trim() : chunkId;
        pages.push({
            chunkId,
            routeId,
            pathPattern,
            pageRel,
            segs: parsePathPattern(pathPattern),
        });
    }
    pages.sort((a, b) => a.chunkId.localeCompare(b.chunkId));
    return { schema: ROUTE_CATALOG_SCHEMA, pages };
}

export function emitRouteCatalog(distDir: string): { ok: boolean; written: string[]; catalog: RouteCatalog | null; error?: string } {
    const deploymentPath = path.join(distDir, 'vmz-deployment.json');
    if (!fs.existsSync(deploymentPath)) {
        return { ok: false, written: [], catalog: null, error: `missing ${deploymentPath}` };
    }
    let deployment: { units?: unknown[] };
    try {
        deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    } catch (err) {
        return { ok: false, written: [], catalog: null, error: err instanceof Error ? err.message : String(err) };
    }
    const catalog = buildRouteCatalogFromDeployment(deployment);
    if (!catalog.pages.length) {
        return { ok: false, written: [], catalog: null, error: 'no page units with pathPattern' };
    }
    const vmzDir = path.join(distDir, '_vmz');
    fs.mkdirSync(vmzDir, { recursive: true });
    writePrettyJsonFile(path.join(distDir, ...ROUTE_CATALOG_REL.split('/')), catalog);
    return { ok: true, written: [ROUTE_CATALOG_REL], catalog };
}

export function loadRouteCatalog(distDir: string): RouteCatalog | null {
    const p = path.join(distDir, ...ROUTE_CATALOG_REL.split('/'));
    if (!fs.existsSync(p)) return null;
    try {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (raw?.schema !== ROUTE_CATALOG_SCHEMA || !Array.isArray(raw.pages)) return null;
        return raw as RouteCatalog;
    } catch {
        return null;
    }
}
