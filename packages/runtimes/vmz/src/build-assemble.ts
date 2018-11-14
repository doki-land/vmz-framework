/**
 * B5 Assemble dispatch + B6 build-proof (per-build semantic id slots).
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { semanticIdsForAssembly, sha256Hex, canonicalJson } from './delivery-profile.js';
import { emitServerArtifact } from './server-artifact.js';
import { emitEmbeddedPackaging } from './embedded-packaging.js';
import { emitSiteDelivery } from './site-delivery.js';
import { emitSiteFavicon } from './site-favicon.js';
import { emitPublicStaticAssets } from './public-static-assets.js';
import { emitWebStatic } from './static-emit.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const BUILD_PROOF_SCHEMA = 'vmz.build.proof.v0';
export const ASSEMBLE_MANIFEST_SCHEMA = 'vmz.assemble.manifest.v0';

interface AssembleStep {
    kind: string;
    digest?: string;
    status?: string;
    note?: string;
    reason?: string;
    htmlFiles?: number;
    skipped?: number;
    publicRoutes?: number;
    internalCapabilities?: number;
    httpContractDigest?: string;
    objectCount?: number;
}

interface AssembleManifest {
    schema: string;
    profileId: unknown;
    assembly: unknown;
    serverRuntime: unknown;
    steps: AssembleStep[];
    staticDelivery?: { digest: string; htmlFiles: unknown; skipped: unknown };
    serverArtifact?: { digest: string; httpContractDigest: string; schema: string; selectedRuntime: string };
    siteDelivery?: { digest: string; schema: string };
    embeddedPackaging?: { digest: string; objectCount: number; schema: string };
    packDigest?: string | null;
    assembleDigest?: string;
}

interface BuildProofSlot {
    status: string;
    detail?: string;
}

interface BuildProofBody {
    schema: string;
    profileId: unknown;
    assembly: unknown;
    selectionDigest: unknown;
    packDigest: string | null;
    assembleDigest: string | null;
    release: boolean;
    semanticIds: string[];
    slots: Record<string, BuildProofSlot>;
    productionReadyClaim: boolean;
    note: string;
    proofDigest?: string;
}

export async function assembleDelivery(outDir: string, ctx: Record<string, unknown>) {
    const selection = ctx.selection as Record<string, unknown>;
    const profile = ctx.profile as Record<string, unknown>;
    const assembly = selection.assembly;
    const result: AssembleManifest = {
        schema: ASSEMBLE_MANIFEST_SCHEMA,
        profileId: selection.profileId,
        assembly,
        serverRuntime: selection.serverRuntime || null,
        steps: [],
    };

    if (assembly === 'web-static' || assembly === 'cdn+server') {
        const staticResult = await emitWebStatic(outDir, {
            origin: ctx.origin as string,
            projectRoot: ctx.projectRoot as string,
        });
        result.steps.push({
            kind: 'web-static',
            digest: staticResult.digest,
            htmlFiles: staticResult.htmlFiles?.length ?? 0,
            skipped: staticResult.skipped?.length ?? 0,
        });
        result.staticDelivery = {
            digest: staticResult.digest,
            htmlFiles: staticResult.htmlFiles,
            skipped: staticResult.skipped,
        };
    } else if (assembly === 'server-host' || assembly === 'local-static') {
        // SSR / local packs: favicon + opaque public/ for serve-host.
        emitSiteFavicon(outDir, { projectRoot: ctx.projectRoot as string });
        emitPublicStaticAssets(outDir, { projectRoot: ctx.projectRoot as string });
    }

    if (assembly === 'local-static') {
        result.steps.push({
            kind: 'local-static',
            status: 'modules-ready',
            note: 'client modules packed; no ServerArtifact',
        });
    }

    if (assembly === 'server-host' || assembly === 'cdn+server') {
        const server = emitServerArtifact(outDir, {
            profileId: String(selection.profileId ?? ''),
            assembly: String(assembly),
            serverRuntime: String(selection.serverRuntime || 'node'),
            packDigest: ((ctx.pack as Record<string, unknown> | undefined)?.packDigest as string | null | undefined) ?? null,
        });
        const serverArtifact = server.artifact as unknown as Record<string, unknown>;
        result.steps.push({
            kind: 'server-host',
            status: 'emitted',
            digest: serverArtifact.artifactDigest as string,
            publicRoutes: (serverArtifact.publicRoutes as unknown[] | undefined)?.length ?? 0,
            internalCapabilities: (serverArtifact.internalCapabilities as unknown[] | undefined)?.length ?? 0,
            httpContractDigest: server.httpContractDigest,
        });
        result.serverArtifact = {
            digest: serverArtifact.artifactDigest as string,
            httpContractDigest: server.httpContractDigest,
            schema: serverArtifact.schema as string,
            selectedRuntime: serverArtifact.selectedRuntime as string,
        };
    }

    const siteAuthoring = profile.sources || null;
    if (siteAuthoring || assembly === 'rust-embedded') {
        if (!siteAuthoring) {
            throw new Error(
                'rust-embedded requires delivery sources (SiteDeliveryContract); cannot assemble without embedded|filesystem|remote baselines',
            );
        }
        const site = emitSiteDelivery(outDir, siteAuthoring, {
            siteId: ctx.siteId as string,
        });
        const siteContract = site.contract as unknown as Record<string, unknown>;
        result.steps.push({
            kind: 'site-delivery',
            digest: siteContract.contractDigest as string,
        });
        result.siteDelivery = {
            digest: siteContract.contractDigest as string,
            schema: siteContract.schema as string,
        };

        if (assembly === 'rust-embedded') {
            const pack = emitEmbeddedPackaging(outDir, {
                siteId: ctx.siteId as string,
                contractDigest: siteContract.contractDigest as string,
            });
            const packIndex = pack.index as unknown as Record<string, unknown>;
            result.steps.push({
                kind: 'embedded-packaging',
                digest: packIndex.indexDigest as string,
                objectCount: packIndex.objectCount as number,
            });
            result.embeddedPackaging = {
                digest: packIndex.indexDigest as string,
                objectCount: packIndex.objectCount as number,
                schema: packIndex.schema as string,
            };
        }
    }

    const packCtx = ctx.pack as Record<string, unknown> | undefined;
    result.packDigest = (packCtx?.packDigest as string | null | undefined) || null;
    result.assembleDigest = sha256Hex(canonicalJson({ ...result, assembleDigest: undefined }));

    const vmzDir = path.join(outDir, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'assemble-manifest.json');
    writePrettyJsonFile(file, result);
    return { manifest: result, path: file };
}

export function emitBuildProof(outDir: string, ctx: Record<string, unknown>) {
    const selection = ctx.selection as Record<string, unknown>;
    const assemble = ctx.assemble as AssembleManifest | undefined;
    const packCtx = ctx.pack as Record<string, unknown> | undefined;
    const semanticIds = semanticIdsForAssembly(selection.assembly as string);
    const slots: Record<string, BuildProofSlot> = {
        'server-host': { status: 'not-applicable' },
        'static-delivery': { status: 'not-applicable' },
        'site-fallback': { status: 'not-applicable' },
        'asset-graph': { status: 'not-applicable' },
    };
    for (const id of semanticIds) {
        if (id === 'static-delivery') {
            const step = (assemble?.steps || []).find((s) => s.kind === 'web-static');
            slots[id] = step
                ? { status: 'emitted', detail: `digest=${String(step.digest).slice(0, 12)}` }
                : { status: 'pending', detail: 'assembly requires static emit' };
        } else if (id === 'site-fallback') {
            const siteStep = (assemble?.steps || []).find((s) => s.kind === 'site-delivery');
            const packStep = (assemble?.steps || []).find((s) => s.kind === 'embedded-packaging');
            if (siteStep && packStep) {
                slots[id] = {
                    status: 'emitted',
                    detail: `contract=${String(siteStep.digest).slice(0, 12)}; pack=${String(packStep.digest).slice(0, 12)}; objects=${packStep.objectCount ?? '?'}`,
                };
            } else if (siteStep && siteStep.status !== 'skipped') {
                slots[id] = {
                    status: 'pending',
                    detail: 'site contract emitted; embedded packaging missing',
                };
            } else {
                slots[id] = { status: 'pending', detail: siteStep?.reason || 'no site sources' };
            }
        } else if (id === 'server-host') {
            const step = (assemble?.steps || []).find((s) => s.kind === 'server-host');
            slots[id] =
                step && step.status === 'emitted'
                    ? {
                          status: 'emitted',
                          detail: `digest=${String(step.digest).slice(0, 12)}; routes=${step.publicRoutes ?? 0}; internal=${step.internalCapabilities ?? 0}`,
                      }
                    : {
                          status: 'pending',
                          detail: step?.note || 'ServerArtifact not emitted',
                      };
        } else if (id === 'asset-graph') {
            slots[id] = {
                status: packCtx?.packDigest ? 'pack-digest' : 'pending',
                detail: packCtx?.packDigest
                    ? `pack=${String(packCtx.packDigest).slice(0, 12)} units=${packCtx.unitCount ?? '?'}`
                    : 'pack missing',
            };
        }
    }

    const body: BuildProofBody = {
        schema: BUILD_PROOF_SCHEMA,
        profileId: selection.profileId,
        assembly: selection.assembly,
        selectionDigest: selection.digest || null,
        packDigest: (packCtx?.packDigest as string | null) || null,
        assembleDigest: assemble?.assembleDigest || null,
        release: Boolean(ctx.release),
        semanticIds,
        slots,
        productionReadyClaim: false,
        note: 'Aggregate production-ready requires browser-production + cleared production-proof gaps (08)',
    };
    body.proofDigest = sha256Hex(canonicalJson({ ...body, proofDigest: undefined }));

    const vmzDir = path.join(outDir, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'build-proof.json');
    writePrettyJsonFile(file, body);
    return { proof: body, path: file };
}
