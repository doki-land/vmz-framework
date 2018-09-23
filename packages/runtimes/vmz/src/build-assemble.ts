/**
 * B5 Assemble dispatch + B6 build-proof (per-build semantic id slots).
 */
// @ts-nocheck

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

/**
 * @param {string} outDir
 * @param {any} ctx
 */
export async function assembleDelivery(outDir, ctx) {
    const { selection, profile } = ctx;
    const assembly = selection.assembly;
    const result = {
        schema: ASSEMBLE_MANIFEST_SCHEMA,
        profileId: selection.profileId,
        assembly,
        serverRuntime: selection.serverRuntime || null,
        steps: [],
    };

    if (assembly === 'static-cdn' || assembly === 'cdn+server') {
        const staticResult = await emitWebStatic(outDir, {
            origin: ctx.origin,
            projectRoot: ctx.projectRoot,
        });
        result.steps.push({
            kind: 'static-cdn',
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
        emitSiteFavicon(outDir, { projectRoot: ctx.projectRoot });
        emitPublicStaticAssets(outDir, { projectRoot: ctx.projectRoot });
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
            profileId: selection.profileId,
            assembly,
            serverRuntime: selection.serverRuntime || 'node',
            packDigest: ctx.pack?.packDigest || null,
        });
        result.steps.push({
            kind: 'server-host',
            status: 'emitted',
            digest: server.artifact.artifactDigest,
            publicRoutes: server.artifact.publicRoutes?.length ?? 0,
            internalCapabilities: server.artifact.internalCapabilities?.length ?? 0,
            httpContractDigest: server.httpContractDigest,
        });
        result.serverArtifact = {
            digest: server.artifact.artifactDigest,
            httpContractDigest: server.httpContractDigest,
            schema: server.artifact.schema,
            selectedRuntime: server.artifact.selectedRuntime,
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
            siteId: ctx.siteId,
        });
        result.steps.push({
            kind: 'site-delivery',
            digest: site.contract.contractDigest,
        });
        result.siteDelivery = {
            digest: site.contract.contractDigest,
            schema: site.contract.schema,
        };

        if (assembly === 'rust-embedded') {
            const pack = emitEmbeddedPackaging(outDir, {
                siteId: ctx.siteId,
                contractDigest: site.contract.contractDigest,
            });
            result.steps.push({
                kind: 'embedded-packaging',
                digest: pack.index.indexDigest,
                objectCount: pack.index.objectCount,
            });
            result.embeddedPackaging = {
                digest: pack.index.indexDigest,
                objectCount: pack.index.objectCount,
                schema: pack.index.schema,
            };
        }
    }

    result.packDigest = ctx.pack?.packDigest || null;
    result.assembleDigest = sha256Hex(canonicalJson({ ...result, assembleDigest: undefined }));

    const vmzDir = path.join(outDir, '_vmz');
    mkdirSync(vmzDir, { recursive: true });
    const file = path.join(vmzDir, 'assemble-manifest.json');
    writePrettyJsonFile(file, result);
    return { manifest: result, path: file };
}

/**
 * @param {string} outDir
 * @param {any} ctx
 */
export function emitBuildProof(outDir, ctx) {
    const semanticIds = semanticIdsForAssembly(ctx.selection.assembly);
    const slots = {
        'server-host': { status: 'not-applicable' },
        'static-delivery': { status: 'not-applicable' },
        'site-fallback': { status: 'not-applicable' },
        'asset-graph': { status: 'not-applicable' },
    };
    for (const id of semanticIds) {
        if (id === 'static-delivery') {
            const step = (ctx.assemble?.steps || []).find((s) => s.kind === 'static-cdn');
            slots[id] = step
                ? { status: 'emitted', detail: `digest=${String(step.digest).slice(0, 12)}` }
                : { status: 'pending', detail: 'assembly requires static emit' };
        } else if (id === 'site-fallback') {
            const siteStep = (ctx.assemble?.steps || []).find((s) => s.kind === 'site-delivery');
            const packStep = (ctx.assemble?.steps || []).find((s) => s.kind === 'embedded-packaging');
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
            const step = (ctx.assemble?.steps || []).find((s) => s.kind === 'server-host');
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
                status: ctx.pack?.packDigest ? 'pack-digest' : 'pending',
                detail: ctx.pack?.packDigest
                    ? `pack=${String(ctx.pack.packDigest).slice(0, 12)} units=${ctx.pack.unitCount ?? '?'}`
                    : 'pack missing',
            };
        }
    }

    const body = {
        schema: BUILD_PROOF_SCHEMA,
        profileId: ctx.selection.profileId,
        assembly: ctx.selection.assembly,
        selectionDigest: ctx.selection.digest || null,
        packDigest: ctx.pack?.packDigest || null,
        assembleDigest: ctx.assemble?.assembleDigest || null,
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
