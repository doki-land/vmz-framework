/**
 * 0.1.27 record-only: inventory modules that land next to a browser delivery dist.
 * Does NOT close thin runtime (0.1.32) or full inventory audit (0.1.28).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './repo-root.ts';

export const BROWSER_ARTIFACT_BOUNDARY_SCHEMA = 'vmz.browser-artifact-boundary.v0' as const;

/** Shared runtime / DOM copies typically vendored into delivery dist. */
const RUNTIME_SHARED_NAMES = new Set([
    'vmz-runtime.js',
    'vmz-dom.js',
    'vmz-http.js',
    'vmz-client-nav.js',
    'dom-core.js',
    'dom-ssr.js',
    'dom.client.js',
    'dom.browser.js',
    'direct-host-box.js',
    'unknown-component.js',
]);

/**
 * Modules that often sit in the same outDir but are host/SSR/tooling-facing.
 * Recorded for 0.1.28 boundary audit — presence alone does not fail 0.1.27.
 */
const HOST_OR_NODE_SUSPECT_NAMES = new Set([
    'native-addon.js',
    'render-host.js',
    'list-client-components.js',
    'deployment-registry.js',
    'route-layout-chain.js',
]);

/** Host registry / plan-dispatch signals (must not appear in browser entry). */
const INTERPRETER_SIGNAL_PATTERNS: Array<{ id: string; re: RegExp }> = [
    { id: 'registerComponents', re: /\bregisterComponents\b/ },
    { id: 'ensureComponents', re: /\bensureComponents\b/ },
    { id: 'bootstrapComponentRegistry', re: /\bbootstrapComponentRegistry\b/ },
    { id: 'trackPatch', re: /\btrackPatch\b/ },
    { id: 'untrackPatch', re: /\buntrackPatch\b/ },
];

/** Specialized Direct emit signals in generated artifacts (0.1.29). */
export const SPECIALIZED_EMIT_PATTERNS: Array<{ id: string; re: RegExp }> = [
    { id: 'specFieldText', re: /\bspecFieldText\b/ },
    { id: 'specFieldAttr', re: /\bspecFieldAttr\b/ },
    { id: 'onMethod', re: /\bonMethod\b/ },
    { id: 'bindComponentProp', re: /\bbindComponentProp\b/ },
    { id: 'trackPatch', re: /\btrackPatch\b/ },
    { id: 'vmzCreate', re: /__vmzCreate\b/ },
    { id: 'vmzDirect', re: /__vmzDirect\b/ },
];

export type BrowserArtifactBoundary = {
    schema: typeof BROWSER_ARTIFACT_BOUNDARY_SCHEMA;
    sourceRevision: string | null;
    fixture: string;
    profileId: string;
    distRel: string;
    thinRuntimeClaim: boolean;
    productionReadyClaim: false;
    pack: {
        unitCount: number | null;
        preferredClientFace: string | null;
        packDigest: string | null;
        generatedEntries: string[];
    };
    modules: {
        generatedComponents: string[];
        runtimeShared: string[];
        hostOrNodeSuspect: string[];
        unclassifiedJs: string[];
    };
    interpreterSignals: Array<{ id: string; files: string[] }>;
    specializedEmitSignals: Array<{ id: string; files: string[] }>;
    totals: {
        generatedBytes: number;
        runtimeSharedBytes: number;
        hostOrNodeSuspectBytes: number;
        unclassifiedBytes: number;
        jsFileCount: number;
    };
    note: string;
    updatedAt: string;
};

export function boundaryPath(root = repoRoot()): string {
    return path.join(root, 'dist', 'vmz.browser-artifact-boundary.json');
}

function gitHead(root: string): string | null {
    const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (r.status !== 0) return null;
    return (r.stdout || '').trim() || null;
}

function listJsFiles(distDir: string): string[] {
    const out: string[] = [];
    const stack = [distDir];
    while (stack.length) {
        const dir = stack.pop()!;
        for (const name of fs.readdirSync(dir)) {
            if (name === 'node_modules' || name === '_vmz') continue;
            const full = path.join(dir, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
                stack.push(full);
                continue;
            }
            if (name.endsWith('.js') && !name.endsWith('.map.js')) out.push(full);
        }
    }
    return out.sort();
}

function readPack(distDir: string): {
    unitCount: number | null;
    preferredClientFace: string | null;
    packDigest: string | null;
    generatedEntries: string[];
} {
    const packPath = path.join(distDir, '_vmz', 'pack-manifest.json');
    if (!fs.existsSync(packPath)) {
        return { unitCount: null, preferredClientFace: null, packDigest: null, generatedEntries: [] };
    }
    try {
        const pack = JSON.parse(fs.readFileSync(packPath, 'utf8')) as {
            unitCount?: number;
            preferredClientFace?: string;
            packDigest?: string;
            units?: Array<{ entry?: string }>;
        };
        const generatedEntries = (pack.units || [])
            .map((u) => (typeof u.entry === 'string' ? u.entry.replace(/\\/g, '/') : ''))
            .filter(Boolean)
            .sort();
        return {
            unitCount: typeof pack.unitCount === 'number' ? pack.unitCount : generatedEntries.length,
            preferredClientFace: typeof pack.preferredClientFace === 'string' ? pack.preferredClientFace : null,
            packDigest: typeof pack.packDigest === 'string' ? pack.packDigest : null,
            generatedEntries,
        };
    } catch {
        return { unitCount: null, preferredClientFace: null, packDigest: null, generatedEntries: [] };
    }
}

function classifyRel(rel: string, generatedSet: Set<string>): 'generated' | 'runtime' | 'host' | 'unclassified' {
    const norm = rel.replace(/\\/g, '/');
    const base = path.posix.basename(norm);
    if (RUNTIME_SHARED_NAMES.has(base)) return 'runtime';
    if (generatedSet.has(norm)) return 'generated';
    if (/\.client\.js$/.test(norm)) return 'generated';
    if (RUNTIME_SHARED_NAMES.has(base)) return 'runtime';
    if (HOST_OR_NODE_SUSPECT_NAMES.has(base)) return 'host';
    return 'unclassified';
}

export function recordBrowserArtifactBoundary(opts: {
    root?: string;
    fixtureRel: string;
    profileId?: string;
    distDir: string;
}): BrowserArtifactBoundary {
    const root = opts.root ?? repoRoot();
    const profileId = opts.profileId || 'web-ssr';
    const distDir = opts.distDir;
    if (!fs.existsSync(distDir)) {
        throw new Error(`browser-artifact-boundary: dist missing: ${distDir}`);
    }

    const pack = readPack(distDir);
    const generatedSet = new Set(pack.generatedEntries);
    const jsFiles = listJsFiles(distDir);

    const generatedComponents: string[] = [];
    const runtimeShared: string[] = [];
    const hostOrNodeSuspect: string[] = [];
    const unclassifiedJs: string[] = [];
    let generatedBytes = 0;
    let runtimeSharedBytes = 0;
    let hostOrNodeSuspectBytes = 0;
    let unclassifiedBytes = 0;

    const signalHits = new Map<string, Set<string>>();
    for (const sig of INTERPRETER_SIGNAL_PATTERNS) signalHits.set(sig.id, new Set());
    const specializedHits = new Map<string, Set<string>>();
    for (const sig of SPECIALIZED_EMIT_PATTERNS) specializedHits.set(sig.id, new Set());

    for (const full of jsFiles) {
        const rel = path.relative(distDir, full).replace(/\\/g, '/');
        const bytes = fs.statSync(full).size;
        const kind = classifyRel(rel, generatedSet);
        if (kind === 'generated') {
            generatedComponents.push(rel);
            generatedBytes += bytes;
        } else if (kind === 'runtime') {
            runtimeShared.push(rel);
            runtimeSharedBytes += bytes;
        } else if (kind === 'host') {
            hostOrNodeSuspect.push(rel);
            hostOrNodeSuspectBytes += bytes;
        } else {
            unclassifiedJs.push(rel);
            unclassifiedBytes += bytes;
        }

        const text = fs.readFileSync(full, 'utf8');
        if (kind === 'generated') {
            for (const sig of SPECIALIZED_EMIT_PATTERNS) {
                if (sig.re.test(text)) specializedHits.get(sig.id)!.add(rel);
            }
        }

        // Scan runtime + host + unclassified for interpreter debt; skip tiny generated Direct create.
        if (kind === 'generated' && bytes < 8_000) continue;
        for (const sig of INTERPRETER_SIGNAL_PATTERNS) {
            if (sig.re.test(text)) signalHits.get(sig.id)!.add(rel);
        }
    }

    const interpreterSignals = INTERPRETER_SIGNAL_PATTERNS.map((sig) => ({
        id: sig.id,
        files: [...signalHits.get(sig.id)!].sort(),
    })).filter((row) => row.files.length > 0);

    const specializedEmitSignals = SPECIALIZED_EMIT_PATTERNS.map((sig) => ({
        id: sig.id,
        files: [...specializedHits.get(sig.id)!].sort(),
    })).filter((row) => row.files.length > 0);

    const distRel = path.relative(root, distDir).replace(/\\/g, '/');
    const body: BrowserArtifactBoundary = {
        schema: BROWSER_ARTIFACT_BOUNDARY_SCHEMA,
        sourceRevision: gitHead(root),
        fixture: opts.fixtureRel.replace(/\\/g, '/'),
        profileId,
        distRel,
        thinRuntimeClaim: true,
        productionReadyClaim: false,
        pack: {
            unitCount: pack.unitCount,
            preferredClientFace: pack.preferredClientFace,
            packDigest: pack.packDigest,
            generatedEntries: pack.generatedEntries,
        },
        modules: {
            generatedComponents: generatedComponents.sort(),
            runtimeShared: runtimeShared.sort(),
            hostOrNodeSuspect: hostOrNodeSuspect.sort(),
            unclassifiedJs: unclassifiedJs.sort(),
        },
        interpreterSignals,
        specializedEmitSignals,
        totals: {
            generatedBytes,
            runtimeSharedBytes,
            hostOrNodeSuspectBytes,
            unclassifiedBytes,
            jsFileCount: jsFiles.length,
        },
        note: '0.1.27 record-only baseline for 0.1.28 inventory; browser-production aggregate ≠ thin runtime / production-ready',
        updatedAt: new Date().toISOString(),
    };

    const out = boundaryPath(root);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(body, null, 2) + '\n', 'utf8');
    return body;
}
