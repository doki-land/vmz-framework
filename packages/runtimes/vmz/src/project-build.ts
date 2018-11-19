/**
 * Shared project delivery build (N-API + pack + assemble).
 * Used by `vmz build` and `vmz test` so Browser Host sees the same
 * `<out-dir>/<profiles.*.name>/` tree (including static HTML).
 */

import path from 'node:path';
import { loadVmzConfig } from './plugin-host.js';
import { normalizeDeliveryAuthoring, resolveProfileArtifactDir, selectBuildProfile } from './delivery-profile.js';
import { packFromDeploymentIr } from './pack.js';
import { assembleDelivery, emitBuildProof } from './build-assemble.js';
import { emitLocaleRuntimeModules, localeHasErrors } from './locale-check.js';
import { emitLocaleRouteRealization } from './locale-route-emit.js';
import { buildIntegratedDocuments, projectHasDocuments } from './document-integrate.js';

export type BuildProjectOptions = {
    /** `--profile` id; empty → delivery default. */
    profile?: string;
    release?: boolean;
    origin?: string;
    /** Skip locale / documents / proof when only need pack+static for tests. */
    quiet?: boolean;
};

export type BuildProjectOk = {
    ok: true;
    outDirRoot: string;
    artifactDir: string;
    deliveryName: string;
    profileId: string;
    assembly: string;
    diagnostics: unknown[];
};

export type BuildProjectErr = {
    ok: false;
    outDirRoot: string;
    artifactDir: string | null;
    deliveryName: string | null;
    diagnostics: unknown[];
    error: string;
};

export type BuildProjectResult = BuildProjectOk | BuildProjectErr;

type Diagnostic = { code?: string; path?: string; message?: string; severity?: string };

function dedupeDiagnostics(list: Diagnostic[]): Diagnostic[] {
    const seen = new Set<string>();
    const out: Diagnostic[] = [];
    for (const d of list || []) {
        const key = `${d.code || ''}\0${d.path || ''}\0${d.message || ''}\0${d.severity || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
    }
    return out;
}

async function runWithPlugins(
    ws: { /* opaque workspace */ },
    project: string,
    outDir: string,
    fn: () => Promise<number> | number,
): Promise<number> {
    const { applyPlugins } = await import('./plugin-host.js');
    const { plugins, engines } = await loadVmzConfig(project);
    if (plugins.length) {
        await applyPlugins(ws as never, plugins, { project, outDir, engines });
    }
    return await fn();
}

/**
 * Build into `--out-dir` **root** the same way as `vmz build . --out-dir <root>`:
 * nest once via `resolveProfileArtifactDir`, then N-API build + pack + assemble
 * (static HTML for `web-static`). Callers resolve the serve root **after** this.
 */
export async function buildProjectToOutDirRoot(
    project: string,
    outDirRoot: string,
    opts: BuildProjectOptions = {},
): Promise<BuildProjectResult> {
    const root = path.resolve(outDirRoot);
    const diagnostics: unknown[] = [];

    let cfg: Awaited<ReturnType<typeof loadVmzConfig>>;
    try {
        cfg = await loadVmzConfig(project);
    } catch (e) {
        return {
            ok: false,
            outDirRoot: root,
            artifactDir: null,
            deliveryName: null,
            diagnostics,
            error: `loadVmzConfig failed: ${e instanceof Error ? e.message : String(e)}`,
        };
    }

    const norm = normalizeDeliveryAuthoring(cfg.delivery ?? null);
    if (!norm.ok) {
        return {
            ok: false,
            outDirRoot: root,
            artifactDir: null,
            deliveryName: null,
            diagnostics: norm.diagnostics ?? [],
            error: 'delivery authoring invalid',
        };
    }

    const selected = selectBuildProfile(norm.table, opts.profile || '');
    if (!selected.ok) {
        return {
            ok: false,
            outDirRoot: root,
            artifactDir: null,
            deliveryName: null,
            diagnostics: selected.diagnostics ?? [],
            error: `unknown build --profile ${opts.profile || norm.table.default}`,
        };
    }

    const deliveryName = String(selected.profile.name || selected.selection.profileId || '');
    const artifactDir = resolveProfileArtifactDir(root, selected.profile);
    const assembly = String(selected.selection.assembly || '');
    const profileId = String(selected.selection.profileId || '');

    // Dynamic import avoids init cycle with `./index.js` re-exports.
    const { createWorkspace, resolveCoreRuntimeDist } = await import('./index.js');

    const ws = createWorkspace({ root: project, outDir: artifactDir });
    try {
        const code = await runWithPlugins(ws, project, artifactDir, () => {
            const report = ws.build(Boolean(opts.release));
            const diags = report.diagnostics ?? [];
            diagnostics.push(...diags);
            const errors = diags.filter(
                (d: { severity?: string; level?: string }) => d && (d.severity === 'error' || d.level === 'error'),
            );
            return errors.length ? 1 : 0;
        });
        if (code !== 0) {
            return {
                ok: false,
                outDirRoot: root,
                artifactDir,
                deliveryName,
                diagnostics,
                error: 'workspace build reported errors',
            };
        }

        const localeEmit = emitLocaleRuntimeModules(project, artifactDir);
        const localeRoutes = emitLocaleRouteRealization(project, artifactDir, {
            origin: opts.origin,
        });
        const localeDiags = dedupeDiagnostics([
            ...((localeEmit.diagnostics ?? []) as Diagnostic[]),
            ...((localeRoutes.diagnostics ?? []) as Diagnostic[]),
        ]);
        diagnostics.push(...localeDiags);
        if (!localeEmit.ok || localeHasErrors({ diagnostics: localeEmit.diagnostics })) {
            return {
                ok: false,
                outDirRoot: root,
                artifactDir,
                deliveryName,
                diagnostics,
                error: 'locale runtime emit failed',
            };
        }
        if (!localeRoutes.ok) {
            return {
                ok: false,
                outDirRoot: root,
                artifactDir,
                deliveryName,
                diagnostics,
                error: 'locale route realization emit failed',
            };
        }

        if (projectHasDocuments(project)) {
            const docs = await buildIntegratedDocuments({ projectRoot: project, outDir: artifactDir });
            if (!docs.ok) {
                return {
                    ok: false,
                    outDirRoot: root,
                    artifactDir,
                    deliveryName,
                    diagnostics,
                    error: 'integrated documents build failed',
                };
            }
        }

        let pack: ReturnType<typeof packFromDeploymentIr>;
        try {
            pack = packFromDeploymentIr(artifactDir, {
                release: Boolean(opts.release),
                profileId,
                assembly,
                coreDist: resolveCoreRuntimeDist(),
                projectRoot: project,
            });
        } catch (err) {
            return {
                ok: false,
                outDirRoot: root,
                artifactDir,
                deliveryName,
                diagnostics,
                error: `pack failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        try {
            const assemble = await assembleDelivery(artifactDir, {
                selection: selected.selection,
                profile: {
                    ...selected.profile,
                    sources:
                        (selected.profile as { sources?: unknown }).sources ||
                        (norm.table.sugar
                            ? (norm.table.profiles[norm.table.default] as { sources?: unknown } | undefined)?.sources
                            : null),
                },
                siteId: cfg.application?.id || undefined,
                origin: opts.origin,
                pack: pack.manifest,
                projectRoot: project,
            });
            if (!opts.quiet) {
                emitBuildProof(artifactDir, {
                    selection: selected.selection,
                    pack: pack.manifest,
                    assemble: assemble.manifest,
                    release: Boolean(opts.release),
                });
            }
        } catch (err) {
            return {
                ok: false,
                outDirRoot: root,
                artifactDir,
                deliveryName,
                diagnostics,
                error: `assemble failed: ${err instanceof Error ? err.message : String(err)}`,
            };
        }

        return {
            ok: true,
            outDirRoot: root,
            artifactDir,
            deliveryName,
            profileId,
            assembly,
            diagnostics,
        };
    } finally {
        ws.dispose();
    }
}
