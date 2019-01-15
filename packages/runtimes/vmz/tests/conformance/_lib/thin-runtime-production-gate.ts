/**
 * Shared build + asserts for 0.1.32 Thin Runtime Production Proof.
 *
 * Fixture: production-catalog (web-ssr) + production-router (static entry sample).
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    assertBoundaryAudit,
    assertInventoryContract,
    buildBrowserImportClosure,
    type RuntimeInventory,
    recordRuntimeInventory,
} from './runtime-inventory.ts';
import { runVmzBuild } from './production-proof.ts';
import { repoRoot } from './repo-root.ts';
import {
    THIN_HOST_SERVE_FIXTURE,
    THIN_HOST_STATIC_FIXTURE,
    buildThinHostFixture,
    type ThinHostScan,
} from './thin-runtime-host-gate.ts';

export const THIN_PROOF_SERVE_FIXTURE = THIN_HOST_SERVE_FIXTURE;
export const THIN_PROOF_STATIC_FIXTURE = THIN_HOST_STATIC_FIXTURE;

/** Hard budget caps (calibrated on production-catalog web-ssr + static entry closure). */
export const THIN_RUNTIME_BUDGET = {
    /** Browser import closure bytes from entry-client + dom.browser seeds. */
    maxBrowserClosureBytes: 220_000,
    /** runtimeShared / generated from inventory record. */
    maxRatioRuntimeToGenerated: 35,
} as const;

export type ThinProductionScan = ThinHostScan & {
    inventory: RuntimeInventory;
    serveIndexClient: string;
};

export function buildThinProductionFixture(root = repoRoot(import.meta.url)): ThinProductionScan {
    const thin = buildThinHostFixture(root);
    const serveBuild = runVmzBuild(THIN_PROOF_SERVE_FIXTURE, root, { profile: 'web-ssr' });
    if (serveBuild.status !== 0) {
        throw new Error(`vmz build (web-ssr) exited ${serveBuild.status}\n${serveBuild.stdout}\n${serveBuild.stderr}`);
    }
    const inventory = recordRuntimeInventory({
        root,
        fixtureRel: THIN_PROOF_SERVE_FIXTURE,
        profileId: 'web-ssr',
        distDir: serveBuild.dist,
    });

    const indexPath = path.join(serveBuild.dist, 'pages', 'index.client.js');
    const serveIndexClient = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : '';

    return { ...thin, inventory, serveIndexClient };
}

export function assertThinRuntimeProduction(scan: ThinProductionScan): string[] {
    const errors: string[] = [];
    const inv = scan.inventory;
    if (!inv.thinRuntimeClaim) errors.push('thinRuntimeClaim must be true');
    if (inv.productionReadyClaim !== false) errors.push('productionReadyClaim must stay false');

    errors.push(...assertInventoryContract(inv));

    const reg = inv.owners.find((o) => o.id === 'registerComponents');
    if (!reg || reg.owner !== 'node-host') {
        errors.push('registerComponents owner must be node-host');
    }
    if (reg?.debtTarget != null) errors.push('registerComponents debtTarget must be null (closed)');

    for (const id of ['bindAttr', 'bindText', 'eachBlock', 'ifBlock']) {
        const row = inv.owners.find((o) => o.id === id);
        if (!row || row.owner !== 'browser-runtime') errors.push(`${id} owner must be browser-runtime`);
        if (row?.debtTarget != null) errors.push(`${id} debtTarget must be null (Direct platform API)`);
    }

    if (!scan.entryClient) {
        errors.push('missing static entry-client.js');
    } else {
        if (/\bregisterComponents\b/.test(scan.entryClient)) {
            errors.push('entry-client must not call registerComponents');
        }
        if (/\bensureComponents\b/.test(scan.entryClient)) {
            errors.push('entry-client must not call ensureComponents');
        }
        if (/\bbootstrapComponentRegistry\b/.test(scan.entryClient)) {
            errors.push('entry-client must not call bootstrapComponentRegistry');
        }
        if (!/from\s+["']\.\/dom\.browser\.js/.test(scan.entryClient)) {
            errors.push('entry-client must import ./dom.browser.js');
        }
    }

    // Generated page with nested components must static-import Ctors (not string registry tags).
    if (scan.serveIndexClient) {
        if (/api\.component\(this,\s*["'][A-Z]/.test(scan.serveIndexClient)) {
            errors.push('pages/index.client.js must pass Ctor to api.component (not string tag)');
        }
        if (!/import\s+[A-Z]\w+\s+from\s+["'][./]/.test(scan.serveIndexClient)) {
            errors.push('pages/index.client.js must static-import child components');
        }
    }

    return errors;
}

export function assertBrowserArtifactSize(scan: ThinProductionScan): string[] {
    const errors: string[] = [];
    const b = scan.inventory.budget;
    if (!(b.browserClosureBytes > 0)) errors.push('browserClosureBytes must be > 0');
    if (b.browserClosureBytes > THIN_RUNTIME_BUDGET.maxBrowserClosureBytes) {
        errors.push(
            `browserClosureBytes ${b.browserClosureBytes} exceeds cap ${THIN_RUNTIME_BUDGET.maxBrowserClosureBytes}`,
        );
    }
    if (b.ratioRuntimeToGenerated == null) {
        errors.push('ratioRuntimeToGenerated missing');
    } else if (b.ratioRuntimeToGenerated > THIN_RUNTIME_BUDGET.maxRatioRuntimeToGenerated) {
        errors.push(
            `ratioRuntimeToGenerated ${b.ratioRuntimeToGenerated} exceeds cap ${THIN_RUNTIME_BUDGET.maxRatioRuntimeToGenerated}`,
        );
    }
    return errors;
}

export function assertRuntimeForbiddenImports(scan: ThinProductionScan): string[] {
    const errors: string[] = [];
    errors.push(...assertBoundaryAudit(scan.inventory));

    const staticDist = scan.staticDist;
    const entryPath = path.join(staticDist, 'entry-client.js');
    const entry = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';
    if (entry && /\bregisterComponents\b/.test(entry)) {
        errors.push('forbidden: registerComponents in entry-client.js');
    }

    const seeds = ['entry-client.js', 'dom.browser.js'].filter((rel) =>
        fs.existsSync(path.join(staticDist, rel)),
    );
    const closure = buildBrowserImportClosure(staticDist, seeds);
    for (const hit of closure.forbiddenImports) {
        errors.push(`forbidden import: ${hit.module} (${hit.reason})`);
    }

    for (const mod of closure.modules) {
        const full = path.join(staticDist, ...mod.split('/'));
        if (!fs.existsSync(full)) continue;
        const raw = fs.readFileSync(full, 'utf8');
        const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        if (/\bensureComponents\b/.test(text)) {
            errors.push(`forbidden symbol ensureComponents in closure module ${mod}`);
        }
        if (/\bbootstrapComponentRegistry\b/.test(text)) {
            errors.push(`forbidden symbol bootstrapComponentRegistry in closure module ${mod}`);
        }
    }

    return errors;
}
