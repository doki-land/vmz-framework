/**
 * 0.1.28 — browser artifact inventory, import-closure audit, budget baseline.
 * Does NOT close thin runtime (0.1.32) or specialized component emit (0.1.29).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
    BROWSER_ARTIFACT_BOUNDARY_SCHEMA,
    type BrowserArtifactBoundary,
    boundaryPath,
    recordBrowserArtifactBoundary,
} from './browser-artifact-boundary.ts';
import { repoRoot } from './repo-root.ts';

export const RUNTIME_INVENTORY_SCHEMA = 'vmz.runtime-inventory.v0' as const;

export type InventoryOwnerKind = 'browser-runtime' | 'generated-artifact' | 'node-host' | 'dev-host' | 'unassigned';

export type InventoryOwnerRow = {
    id: string;
    owner: InventoryOwnerKind;
    evidencePaths: string[];
    debtTarget: string | null;
    note: string;
};

/** Basename (no path) forbidden inside the browser import closure. */
export const BROWSER_FORBIDDEN_BASENAMES = new Set([
    'native-addon.js',
    'render-host.js',
    'deployment-registry.js',
    'list-client-components.js',
    'route-layout-chain.js',
]);

const NODE_BUILTIN_SPECS = new Set([
    'fs',
    'node:fs',
    'fs/promises',
    'node:fs/promises',
    'child_process',
    'node:child_process',
    'path',
    'node:path',
    'os',
    'node:os',
    'module',
    'node:module',
    'url',
    'node:url',
    'worker_threads',
    'node:worker_threads',
]);

const FROM_SPEC_RE = /\b(?:import|export)\s+[^'"\n]*?\s+from\s+(['"])([^'"]+)\1/g;
const IMPORT_CALL_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1/g;
const SIDE_EFFECT_IMPORT_RE = /\bimport\s+(['"])([^'"]+)\1/g;

/** Known second-class duties — must not remain `unassigned`. */
const OWNER_SEED: Array<{
    id: string;
    owner: InventoryOwnerKind;
    debtTarget: string;
    evidencePaths: string[];
    note: string;
    distSignalId?: string;
}> = [
    {
        id: 'registerComponents',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts'],
        note: 'Process-global component registry',
        distSignalId: 'registerComponents',
    },
    {
        id: 'ensureComponents',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/render-host.ts'],
        note: 'Dynamic component load / dependsOn closure',
        distSignalId: 'ensureComponents',
    },
    {
        id: 'bootstrapComponentRegistry',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/deployment-registry.ts'],
        note: 'Deployment-driven registry bootstrap',
        distSignalId: 'bootstrapComponentRegistry',
    },
    {
        id: 'bindAttr',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts'],
        note: 'Generic attr binding interpreter',
        distSignalId: 'bindAttr',
    },
    {
        id: 'bindText',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts'],
        note: 'Generic text binding interpreter',
        distSignalId: 'bindText',
    },
    {
        id: 'eachBlock',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts'],
        note: 'Generic each/control-flow interpreter',
        distSignalId: 'eachBlock',
    },
    {
        id: 'ifBlock',
        owner: 'browser-runtime',
        debtTarget: '0.1.29',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts'],
        note: 'Generic branch interpreter',
        distSignalId: 'ifBlock',
    },
    {
        id: 'hydrateResumeDispatch',
        owner: 'browser-runtime',
        debtTarget: '0.1.31',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/dom-core.ts', 'packages/runtimes/vmz-runtime/src/dom-ssr.ts'],
        note: 'Generic hydrate / resume dispatch still in shared runtime',
    },
    {
        id: 'pageCatalog',
        owner: 'browser-runtime',
        debtTarget: '0.1.30',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/serve-host.ts'],
        note: 'Runtime page catalog selection (also used by serve-host)',
    },
    {
        id: 'routeLocaleDocument',
        owner: 'node-host',
        debtTarget: '0.1.30',
        evidencePaths: [
            'packages/runtimes/vmz-runtime/src/localize-body-links.ts',
            'packages/runtimes/vmz/src/static-emit.ts',
            'packages/runtimes/vmz-runtime/src/serve-host.ts',
        ],
        note: 'SSR/static locale link rewrite + RouteId alias bridge; compiled refs hang 0.1.30',
    },
    {
        id: 'cacheBust',
        owner: 'dev-host',
        debtTarget: '0.1.31',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/serve-host.ts'],
        note: 'Soft-reload cache-bust token on module imports',
    },
    {
        id: 'reloadScope',
        owner: 'dev-host',
        debtTarget: '0.1.31',
        evidencePaths: ['packages/runtimes/vmz-runtime/src/serve-host.ts'],
        note: 'Dev softReload affected / full scope decisions',
    },
];

export type RuntimeInventory = {
    schema: typeof RUNTIME_INVENTORY_SCHEMA;
    sourceRevision: string | null;
    fixture: string;
    profileId: string;
    distRel: string;
    thinRuntimeClaim: false;
    productionReadyClaim: false;
    boundaryPath: string | null;
    boundarySchema: typeof BROWSER_ARTIFACT_BOUNDARY_SCHEMA | null;
    owners: InventoryOwnerRow[];
    browserClosure: {
        entry: string | null;
        entries: string[];
        modules: string[];
        bytes: number;
    };
    forbiddenImports: Array<{ module: string; reason: string }>;
    hostInOutDirNotInClosure: string[];
    budget: {
        generatedBytes: number;
        runtimeSharedBytes: number;
        browserClosureBytes: number;
        hostOrNodeSuspectBytes: number;
        unclassifiedBytes: number;
        ratioRuntimeToGenerated: number | null;
        jsFileCount: number;
    };
    note: string;
    updatedAt: string;
};

export function inventoryPath(root = repoRoot()): string {
    return path.join(root, 'dist', 'vmz.runtime-inventory.json');
}

function gitHead(root: string): string | null {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
}

function collectStaticSpecs(jsText: string): string[] {
    const out: string[] = [];
    for (const re of [FROM_SPEC_RE, IMPORT_CALL_RE, SIDE_EFFECT_IMPORT_RE]) {
        const local = new RegExp(re.source, re.flags);
        let m: RegExpExecArray | null;
        while ((m = local.exec(jsText)) !== null) {
            const spec = String(m[2] || '').trim();
            if (spec) out.push(spec.split('?')[0].split('#')[0]);
        }
    }
    return out;
}

function resolveRelative(fromRel: string, spec: string): string | null {
    if (!(spec.startsWith('./') || spec.startsWith('../'))) return null;
    const fromDir = path.posix.dirname(fromRel);
    let resolved = path.posix.normalize(path.posix.join(fromDir === '.' ? '' : fromDir, spec));
    if (resolved.startsWith('../')) return null;
    if (!resolved.endsWith('.js') && !resolved.endsWith('.mjs') && !resolved.endsWith('.cjs')) {
        resolved = `${resolved}.js`;
    }
    return resolved.replace(/^\.\//, '');
}

export function buildBrowserImportClosure(
    distDir: string,
    entryRels: string[],
): {
    modules: string[];
    bytes: number;
    forbiddenImports: Array<{ module: string; reason: string }>;
} {
    const queue = entryRels.map((e) => e.replace(/\\/g, '/').replace(/^\.\//, ''));
    const seen = new Set<string>();
    const forbiddenImports: Array<{ module: string; reason: string }> = [];
    let bytes = 0;

    while (queue.length) {
        const rel = queue.shift()!;
        if (seen.has(rel)) continue;
        seen.add(rel);
        const full = path.join(distDir, ...rel.split('/'));
        if (!fs.existsSync(full)) continue;
        const st = fs.statSync(full);
        if (!st.isFile()) continue;
        bytes += st.size;
        const base = path.posix.basename(rel);
        if (BROWSER_FORBIDDEN_BASENAMES.has(base)) {
            forbiddenImports.push({ module: rel, reason: `forbidden host basename ${base}` });
        }
        const text = fs.readFileSync(full, 'utf8');
        for (const spec of collectStaticSpecs(text)) {
            if (spec.startsWith('node:') || NODE_BUILTIN_SPECS.has(spec)) {
                forbiddenImports.push({ module: `${rel} -> ${spec}`, reason: `node builtin ${spec}` });
                continue;
            }
            if (spec.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(spec)) continue;
            const next = resolveRelative(rel, spec);
            if (!next) continue;
            const nextFull = path.join(distDir, ...next.split('/'));
            if (!fs.existsSync(nextFull)) continue;
            if (!seen.has(next)) queue.push(next);
        }
    }

    return { modules: [...seen].sort(), bytes, forbiddenImports };
}

function mapPreferredFaceToDist(face: string | null): string | null {
    if (!face) return null;
    const f = face.replace(/\\/g, '/');
    if (f.endsWith('.js') || f.startsWith('./') || f.startsWith('../')) return f.replace(/^\.\//, '');
    const FACE_MAP: Record<string, string> = {
        '@vmz/core/dom/client': 'dom.client.js',
        '@vmz/core/dom': 'vmz-dom.js',
        '@vmz/core/runtime': 'vmz-runtime.js',
        '@vmz/core/http': 'vmz-http.js',
        '@vmz/core/client-nav': 'vmz-client-nav.js',
    };
    return FACE_MAP[f] || null;
}

function pickClientEntries(boundary: BrowserArtifactBoundary, distDir: string): string[] {
    const seeds: string[] = [];
    const push = (rel: string | null | undefined) => {
        if (!rel) return;
        const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
        if (!seeds.includes(norm) && fs.existsSync(path.join(distDir, ...norm.split('/')))) seeds.push(norm);
    };

    push(mapPreferredFaceToDist(boundary.pack.preferredClientFace));
    push('entry-client.js');
    push('dom.client.js');
    push('vmz-dom.js');
    for (const entry of boundary.pack.generatedEntries) push(entry);
    for (const rel of boundary.modules.generatedComponents) push(rel);
    return seeds;
}

function buildOwners(boundary: BrowserArtifactBoundary, root: string): InventoryOwnerRow[] {
    const signalMap = new Map(boundary.interpreterSignals.map((s) => [s.id, s.files]));
    return OWNER_SEED.map((seed) => {
        const distFiles = seed.distSignalId ? signalMap.get(seed.distSignalId) || [] : [];
        const evidence = [
            ...seed.evidencePaths.filter((p) => fs.existsSync(path.join(root, ...p.split('/')))),
            ...distFiles.map((f) => `${boundary.distRel}/${f}`),
        ];
        const unique = [...new Set(evidence)].sort();
        return {
            id: seed.id,
            owner: seed.owner,
            evidencePaths: unique.length ? unique : seed.evidencePaths,
            debtTarget: seed.debtTarget,
            note: seed.note,
        };
    });
}

export function recordRuntimeInventory(opts: { root?: string; fixtureRel: string; profileId?: string; distDir: string }): RuntimeInventory {
    const root = opts.root ?? repoRoot();
    const profileId = opts.profileId || 'web-ssr';
    const distDir = opts.distDir;
    if (!fs.existsSync(distDir)) {
        throw new Error(`runtime-inventory: dist missing: ${distDir}`);
    }

    const boundary = recordBrowserArtifactBoundary({
        root,
        fixtureRel: opts.fixtureRel,
        profileId,
        distDir,
    });

    const entries = pickClientEntries(boundary, distDir);
    const closure = entries.length
        ? buildBrowserImportClosure(distDir, entries)
        : { modules: [] as string[], bytes: 0, forbiddenImports: [] as Array<{ module: string; reason: string }> };

    const closureSet = new Set(closure.modules);
    const hostInOutDirNotInClosure = boundary.modules.hostOrNodeSuspect.filter((h) => !closureSet.has(h));

    const generated = boundary.totals.generatedBytes;
    const runtimeShared = boundary.totals.runtimeSharedBytes;
    const ratio = generated > 0 ? Number((runtimeShared / generated).toFixed(3)) : null;

    const body: RuntimeInventory = {
        schema: RUNTIME_INVENTORY_SCHEMA,
        sourceRevision: gitHead(root),
        fixture: opts.fixtureRel.replace(/\\/g, '/'),
        profileId,
        distRel: path.relative(root, distDir).replace(/\\/g, '/'),
        thinRuntimeClaim: false,
        productionReadyClaim: false,
        boundaryPath: path.relative(root, boundaryPath(root)).replace(/\\/g, '/'),
        boundarySchema: BROWSER_ARTIFACT_BOUNDARY_SCHEMA,
        owners: buildOwners(boundary, root),
        browserClosure: {
            entry: entries[0] || null,
            entries,
            modules: closure.modules,
            bytes: closure.bytes,
        },
        forbiddenImports: closure.forbiddenImports,
        hostInOutDirNotInClosure,
        budget: {
            generatedBytes: generated,
            runtimeSharedBytes: runtimeShared,
            browserClosureBytes: closure.bytes,
            hostOrNodeSuspectBytes: boundary.totals.hostOrNodeSuspectBytes,
            unclassifiedBytes: boundary.totals.unclassifiedBytes,
            ratioRuntimeToGenerated: ratio,
            jsFileCount: boundary.totals.jsFileCount,
        },
        note: '0.1.28 inventory + boundary audit + budget baseline; ≠ thin runtime / specialized component artifact',
        updatedAt: new Date().toISOString(),
    };

    const out = inventoryPath(root);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(body, null, 2) + '\n', 'utf8');
    return body;
}

export function readRuntimeInventory(root = repoRoot()): RuntimeInventory | null {
    const p = inventoryPath(root);
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as RuntimeInventory;
    } catch {
        return null;
    }
}

export function assertInventoryContract(inv: RuntimeInventory): string[] {
    const errors: string[] = [];
    if (inv.schema !== RUNTIME_INVENTORY_SCHEMA) errors.push(`schema want ${RUNTIME_INVENTORY_SCHEMA}`);
    if (inv.thinRuntimeClaim !== false) errors.push('thinRuntimeClaim must be false');
    if (inv.productionReadyClaim !== false) errors.push('productionReadyClaim must be false');
    if (!inv.owners.length) errors.push('owners empty');
    for (const row of inv.owners) {
        if (row.owner === 'unassigned') errors.push(`owner unassigned for ${row.id}`);
        if (!row.evidencePaths.length) errors.push(`missing evidence for ${row.id}`);
        if (!row.debtTarget) errors.push(`missing debtTarget for ${row.id}`);
    }
    const required = new Set(OWNER_SEED.map((s) => s.id));
    for (const id of required) {
        if (!inv.owners.some((o) => o.id === id)) errors.push(`missing owner row ${id}`);
    }
    return errors;
}

export function assertBoundaryAudit(inv: RuntimeInventory): string[] {
    const errors: string[] = [];
    if (!inv.browserClosure.entry && !inv.browserClosure.entries?.length) {
        errors.push('browserClosure.entry/entries missing');
    }
    if (!inv.browserClosure.modules.length) errors.push('browserClosure.modules empty');
    for (const hit of inv.forbiddenImports) {
        errors.push(`forbidden import: ${hit.module} (${hit.reason})`);
    }
    return errors;
}

export function assertBudgetBaseline(inv: RuntimeInventory): string[] {
    const errors: string[] = [];
    if (inv.thinRuntimeClaim !== false) errors.push('thinRuntimeClaim must be false');
    if (inv.productionReadyClaim !== false) errors.push('productionReadyClaim must be false');
    if (!(inv.budget.generatedBytes > 0)) errors.push('generatedBytes must be > 0');
    if (!(inv.budget.runtimeSharedBytes > 0)) errors.push('runtimeSharedBytes must be > 0');
    if (!(inv.budget.browserClosureBytes > 0)) errors.push('browserClosureBytes must be > 0');
    if (inv.budget.ratioRuntimeToGenerated == null) errors.push('ratioRuntimeToGenerated missing');
    return errors;
}
