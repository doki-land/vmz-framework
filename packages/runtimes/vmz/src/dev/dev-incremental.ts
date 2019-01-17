/**
 * Dev incremental state helpers (0.1.24): HMR plan parsing, reload decisions, static revision.
 */

import path from 'node:path';

export interface HmrPlanWire {
    mode?: string;
    islandOnly?: boolean;
    island_only?: boolean;
    rerunLoaders?: string[];
    rerun_loaders?: string[];
    affectedChunks?: string[];
    affected_chunks?: string[];
    seedChunks?: string[];
    seed_chunks?: string[];
}

export interface BuildReportWire {
    full?: boolean;
    islandHmr?: boolean;
    island_hmr?: boolean;
    affectedChunks?: string[];
    affected_chunks?: string[];
    seedChunks?: string[];
    seed_chunks?: string[];
    emitted?: string[];
    outputRevision?: string;
    output_revision?: string;
    writtenOutputs?: string[];
    written_outputs?: string[];
    reloadRequired?: boolean;
    reload_required?: boolean;
}

export interface DevReloadPayload {
    affectedChunks?: string[];
    seedChunks?: string[];
    emitted?: string[];
    full?: boolean;
    islandHmr?: boolean;
    rerunLoaders?: string[];
    staticRevision?: string;
    skipEntryRewrite?: boolean;
    outputRevision?: string;
}

export function parseHmrPlan(raw: string | object | null | undefined): HmrPlanWire | null {
    if (!raw) return null;
    try {
        const doc = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return doc && typeof doc === 'object' ? (doc as HmrPlanWire) : null;
    } catch {
        return null;
    }
}

export function hmrRerunLoaders(plan: HmrPlanWire | null | undefined): string[] {
    if (!plan) return [];
    const list = plan.rerunLoaders ?? plan.rerun_loaders ?? [];
    return Array.isArray(list) ? list.map(String) : [];
}

export function buildReloadPayload(
    report: BuildReportWire,
    hmrPlan: HmrPlanWire | null,
    opts: { staticRevision?: string; skipEntryRewrite?: boolean } = {},
): DevReloadPayload {
    const rerunLoaders = hmrRerunLoaders(hmrPlan);
    const affectedChunks = report.affectedChunks ?? report.affected_chunks ?? [];
    const islandHmr = Boolean(report.islandHmr ?? report.island_hmr);
    const mode = String(hmrPlan?.mode ?? '').toLowerCase();

    let full = Boolean(report.full);
    if (mode === 'full') full = true;
    if (islandHmr && rerunLoaders.length === 0 && affectedChunks.length > 0) {
        full = true;
    }

    return {
        affectedChunks,
        seedChunks: report.seedChunks ?? report.seed_chunks ?? [],
        emitted: report.emitted ?? [],
        full,
        islandHmr: islandHmr && !full,
        rerunLoaders,
        staticRevision: opts.staticRevision,
        skipEntryRewrite: opts.skipEntryRewrite,
        outputRevision: report.outputRevision ?? report.output_revision,
    };
}

export function shouldSoftReload(report: BuildReportWire, lastOutputRevision: string | null, opts: { force?: boolean } = {}): boolean {
    if (opts.force) return true;
    const reloadRequired = report.reloadRequired ?? report.reload_required;
    if (reloadRequired === false) return false;
    const rev = report.outputRevision ?? report.output_revision ?? '';
    if (lastOutputRevision && rev && rev === lastOutputRevision) return false;
    return true;
}

export function staticRevisionFromArtifact(
    artifact: {
        files?: Array<{ path: string; bytes?: number }>;
        fileCount?: number;
    } | null,
): string {
    if (!artifact || artifact.fileCount === 0) return 'empty';
    const parts = (artifact.files ?? []).map((f) => `${f.path}:${f.bytes ?? 0}`);
    parts.sort();
    let h = 0xcbf29ce484222325n;
    for (const p of parts) {
        for (const b of Buffer.from(p)) {
            h = (h * 0x100000001b3n + BigInt(b)) & 0xffffffffffffffffn;
        }
    }
    return h.toString(16);
}

export function filterGenerationIgnore(changed: string[], ignore: Set<string>): string[] {
    if (!ignore.size) return changed;
    return changed.filter((p) => !ignore.has(devPathNormalize(p)));
}

export function devPathNormalize(p: string): string {
    return String(p).replace(/\\/g, '/');
}

export function registerWrittenOutputsIgnore(writtenOutputs: string[] | undefined, outDir: string, projectRoot: string, ignore: Set<string>) {
    for (const rel of writtenOutputs ?? []) {
        const abs = path.isAbsolute(rel) ? rel : path.join(outDir, rel);
        ignore.add(devPathNormalize(abs));
        const underProject = devPathNormalize(abs);
        if (underProject.startsWith(devPathNormalize(projectRoot))) {
            ignore.add(underProject);
        }
    }
}
