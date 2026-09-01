/**
 * Shared asserts for 0.1.31 Thin Runtime Host Boundary.
 *
 * - Serve/`web-ssr` (non-release): host companions under `_vmz/host/`
 * - Static profile: ships `entry-client.js` with thin `dom.browser` face
 */

import fs from 'node:fs';
import path from 'node:path';
import { BROWSER_FORBIDDEN_BASENAMES, buildBrowserImportClosure } from './runtime-inventory.ts';
import { runVmzBuild } from './production-proof.ts';
import { repoRoot } from './repo-root.ts';
import { recordBrowserArtifactBoundary } from './browser-artifact-boundary.ts';

export const THIN_HOST_SERVE_FIXTURE = 'packages/examples/production-catalog';
export const THIN_HOST_STATIC_FIXTURE = 'packages/examples/production-router';

export type ThinHostScan = {
    serveDist: string;
    staticDist: string;
    entryClient: string;
    rootForbidden: string[];
    hostDirFiles: string[];
    closureModules: string[];
};

export function buildThinHostFixture(root = repoRoot(import.meta.url)): ThinHostScan {
    const serveBuild = runVmzBuild(THIN_HOST_SERVE_FIXTURE, root, { profile: 'web-ssr' });
    if (serveBuild.status !== 0) {
        throw new Error(`vmz build (web-ssr) exited ${serveBuild.status}\n${serveBuild.stdout}\n${serveBuild.stderr}`);
    }
    const staticBuild = runVmzBuild(THIN_HOST_STATIC_FIXTURE, root, {
        profile: 'static',
        extraArgs: ['--origin', 'https://thin-host.example.test'],
    });
    if (staticBuild.status !== 0) {
        throw new Error(`vmz build (static) exited ${staticBuild.status}\n${staticBuild.stdout}\n${staticBuild.stderr}`);
    }

    const serveDist = serveBuild.dist;
    const staticDist = staticBuild.dist;
    const entryPath = path.join(staticDist, 'entry-client.js');
    const entryClient = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf8') : '';

    const rootForbidden: string[] = [];
    for (const name of BROWSER_FORBIDDEN_BASENAMES) {
        if (fs.existsSync(path.join(serveDist, name))) rootForbidden.push(name);
    }

    const hostDir = path.join(serveDist, '_vmz', 'host');
    const hostDirFiles: string[] = [];
    if (fs.existsSync(hostDir)) {
        for (const name of fs.readdirSync(hostDir)) {
            if (name.endsWith('.js') || name.endsWith('.mjs')) hostDirFiles.push(name);
        }
    }

    const boundary = recordBrowserArtifactBoundary({
        root,
        fixtureRel: THIN_HOST_STATIC_FIXTURE,
        profileId: 'static',
        distDir: staticDist,
    });
    const seeds = ['entry-client.js', 'dom.browser.js', 'dom.client.js', 'dom-core.js'].filter((rel) =>
        fs.existsSync(path.join(staticDist, rel)),
    );
    for (const entry of boundary.pack.generatedEntries) {
        if (fs.existsSync(path.join(staticDist, ...entry.split('/')))) seeds.push(entry);
    }
    const closure = buildBrowserImportClosure(staticDist, seeds);

    return {
        serveDist,
        staticDist,
        entryClient,
        rootForbidden,
        hostDirFiles,
        closureModules: closure.modules,
    };
}

export function assertThinRuntimeImports(scan: ThinHostScan): string[] {
    const errors: string[] = [];
    if (!scan.entryClient) {
        errors.push('missing entry-client.js (static profile)');
        return errors;
    }
    if (!/from\s+["']\.\/dom\.browser\.js/.test(scan.entryClient)) {
        errors.push('entry-client must import hydrate face from ./dom.browser.js');
    }
    if (/from\s+["']\.\/vmz-dom\.js/.test(scan.entryClient)) {
        errors.push('entry-client must not import full ./vmz-dom.js barrel');
    }
    // Prefer component samples from serve fixture (specialized Direct emit).
    const componentsDir = path.join(scan.serveDist, 'components');
    if (fs.existsSync(componentsDir)) {
        for (const name of fs.readdirSync(componentsDir)) {
            if (!name.endsWith('.client.js')) continue;
            const text = fs.readFileSync(path.join(componentsDir, name), 'utf8');
            if (!text.includes('__vmzRunTask')) continue;
            if (/from\s+["'][^"']*vmz-dom\.js["']/.test(text)) {
                errors.push(`${name} still imports vmz-dom.js for __vmzRunTask`);
                break;
            }
            if (!/from\s+["'][^"']*dom-core\.js["']/.test(text) && !/from\s+["'][^"']*dom\.browser\.js["']/.test(text)) {
                errors.push(`${name} __vmzRunTask must resolve to dom-core.js or dom.browser.js`);
                break;
            }
        }
    }
    if (fs.existsSync(path.join(scan.staticDist, 'dom.browser.js'))) {
        if (/dom\.browser\.js/.test(scan.entryClient) && !scan.closureModules.some((m) => m.includes('dom.browser'))) {
            errors.push('browser closure missing dom.browser.js');
        }
    } else {
        errors.push('static dist missing dom.browser.js companion');
    }
    return errors;
}

export function assertHostRuntimeBoundary(scan: ThinHostScan): string[] {
    const errors: string[] = [];
    if (scan.rootForbidden.length) {
        errors.push(`forbidden host basenames at delivery root: ${scan.rootForbidden.join(', ')}`);
    }
    const expectedHost = [...BROWSER_FORBIDDEN_BASENAMES];
    const missing = expectedHost.filter((n) => !scan.hostDirFiles.includes(n));
    if (missing.length === expectedHost.length) {
        errors.push('missing _vmz/host companions (expected nested host pack)');
    } else if (missing.length) {
        errors.push(`_vmz/host missing: ${missing.join(', ')}`);
    }
    if (!fs.existsSync(path.join(scan.serveDist, '_vmz', 'host', 'vmz-serve-host.mjs'))) {
        errors.push('missing _vmz/host/vmz-serve-host.mjs');
    }
    if (!fs.existsSync(path.join(scan.serveDist, 'vmz-serve-host.mjs'))) {
        errors.push('missing root vmz-serve-host.mjs launcher stub');
    }
    // Nested serve-host must reach delivery-root vmz-runtime.js.
    const nestedHost = path.join(scan.serveDist, '_vmz', 'host', 'vmz-serve-host.mjs');
    if (fs.existsSync(nestedHost)) {
        const text = fs.readFileSync(nestedHost, 'utf8');
        if (!/from\s+['"]\.\.\/\.\.\/vmz-runtime\.js['"]/.test(text)) {
            errors.push('_vmz/host/vmz-serve-host.mjs must import ../../vmz-runtime.js');
        }
        if (/from\s+['"]\.\/vmz-runtime\.js['"]/.test(text)) {
            errors.push('_vmz/host/vmz-serve-host.mjs must not import ./vmz-runtime.js');
        }
    }
    return errors;
}

export function assertSingleRevisionOwner(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const serveHost = fs.readFileSync(path.join(root, 'packages/runtimes/vmz-runtime/src/serve-host.ts'), 'utf8');
    if (/function shouldReloadAllPages/.test(serveHost)) {
        errors.push('serve-host must not define shouldReloadAllPages (payload-only reload)');
    }
    if (/emitted.*\/lib\//.test(serveHost) || /includes\('\/lib\/'\)/.test(serveHost)) {
        errors.push('serve-host must not guess full reload from emitted /lib/ paths');
    }
    if (!/Boolean\(full\)/.test(serveHost) && !/opts\.payload\?\.full/.test(serveHost)) {
        errors.push('serve-host softReload must honor payload.full');
    }
    const incremental = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/dev-incremental.ts'), 'utf8');
    if (!/shouldSoftReload/.test(incremental) || !/outputRevision/.test(incremental)) {
        errors.push('dev-incremental must own shouldSoftReload(outputRevision)');
    }
    return errors;
}

export function assertNoBrowserPlanDispatch(root = repoRoot(import.meta.url), scan?: ThinHostScan): string[] {
    const errors: string[] = [...assertSingleRevisionOwner(root)];
    const clientNav = fs.readFileSync(path.join(root, 'packages/runtimes/vmz-runtime/src/client-nav.ts'), 'utf8');
    if (/shouldReloadAllPages|affectedChunks\s*=/.test(clientNav)) {
        errors.push('client-nav must not invent reload scope');
    }
    if (/\/vmz-dom\.js/.test(clientNav) && !/dom\.browser\.js/.test(clientNav)) {
        errors.push('client-nav must load thin /dom.browser.js face');
    }
    if (scan) {
        if (/renderToString|renderToStream/.test(scan.entryClient)) {
            errors.push('entry-client must not reference renderToString/renderToStream');
        }
    }
    return errors;
}
