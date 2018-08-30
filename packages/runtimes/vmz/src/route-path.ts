/**
 * Browser HTTP path projection from Route Graph / `vmz-deployment.json`.
 * Mini pack ignores this and lowers RouteId → chunk id → page stem.
 */

export function isRouteBoundaryStem(stem: string): boolean {
    return stem === 'Layout' || stem === 'Loading' || stem === 'Error' || stem === 'NotFound';
}

export function isRouteGroupDir(seg: string): boolean {
    return typeof seg === 'string' && seg.startsWith('(') && seg.endsWith(')') && seg.length > 2;
}

/**
 * File-route fallback (`pages/home` → `/home`, `pages/index` → `/`).
 * Used only when a deployment unit has no `pathPattern`.
 */
export function filePathPatternFromChunk(chunkId: string): string {
    const rel = String(chunkId || '').replace(/^pages\//, '');
    const parts = rel.split('/').filter(Boolean);
    const segs: string[] = [];
    for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (isRouteGroupDir(p)) continue;
        if (p === 'index' && i === parts.length - 1) continue;
        if (isRouteBoundaryStem(p)) continue;
        segs.push(p);
    }
    return segs.length ? `/${segs.join('/')}` : '/';
}

export type DeploymentPageUnit = {
    kind?: string;
    chunkId?: string;
    clientEntry?: string;
    programIr?: string;
    pathPattern?: string;
    routeId?: string;
};

/** Canonical Browser HTTP pattern for a page unit. Mini must not read this. */
export function unitBrowserPathPattern(unit: DeploymentPageUnit | null | undefined): string {
    const explicit = String(unit?.pathPattern || '').trim();
    if (explicit) return explicit.startsWith('/') ? explicit : `/${explicit}`;
    return filePathPatternFromChunk(String(unit?.chunkId || ''));
}

export type PathSeg = { kind: 'static'; value: string } | { kind: 'param'; name: string } | { kind: 'catch'; name: string };

export function parsePathPattern(pattern: string): PathSeg[] {
    const raw = String(pattern || '').trim();
    if (!raw || raw === '/') return [];
    const parts = raw.replace(/^\/+/, '').replace(/\/+$/, '').split('/').filter(Boolean);
    const segs: PathSeg[] = [];
    for (const p of parts) {
        if (isRouteGroupDir(p)) continue;
        segs.push(parsePathSegment(p));
    }
    return segs;
}

function parsePathSegment(p: string): PathSeg {
    const catchAll = /^\[\.\.\.([^\]]+)\]$/.exec(p);
    const star = /^\*([A-Za-z_][\w]*)$/.exec(p);
    const param = /^\[([^\]]+)\]$/.exec(p);
    const colon = /^:([A-Za-z_][\w]*)$/.exec(p);
    if (catchAll) return { kind: 'catch', name: catchAll[1] };
    if (star) return { kind: 'catch', name: star[1] };
    if (param) return { kind: 'param', name: param[1] };
    if (colon) return { kind: 'param', name: colon[1] };
    return { kind: 'static', value: p.toLowerCase() };
}

export function listPublicPageUnits(deployment: { units?: DeploymentPageUnit[] } | null | undefined): DeploymentPageUnit[] {
    const units = Array.isArray(deployment?.units) ? deployment.units : [];
    return units.filter((u) => {
        if (u?.kind !== 'page') return false;
        const chunkId = String(u.chunkId || '').replace(/\\/g, '/');
        if (!chunkId.startsWith('pages/')) return false;
        const stem = chunkId.split('/').pop() || '';
        return !isRouteBoundaryStem(stem);
    });
}
