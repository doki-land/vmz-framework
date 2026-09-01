/**
 * Shared build + artifact scan for 0.1.29 Specialized Component Artifact gates.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    recordBrowserArtifactBoundary,
    type BrowserArtifactBoundary,
} from './browser-artifact-boundary.ts';
import { scanForbiddenHotPath, runVmzBuild } from './production-proof.ts';
import { repoRoot } from './repo-root.ts';

export const SPECIALIZED_FIXTURE = 'packages/examples/production-catalog';

export type GeneratedArtifactScan = {
    boundary: BrowserArtifactBoundary;
    dist: string;
    directModules: string[];
    missingDirect: string[];
    missingCreate: string[];
    blueprintViolations: string[];
    specializedHits: number;
    specializedKinds: string[];
};

export function buildAndScanSpecialized(root = repoRoot(import.meta.url)): GeneratedArtifactScan {
    const build = runVmzBuild(SPECIALIZED_FIXTURE, root);
    if (build.status !== 0) {
        throw new Error(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
    }
    const boundary = recordBrowserArtifactBoundary({
        root,
        fixtureRel: SPECIALIZED_FIXTURE,
        profileId: 'web-ssr',
        distDir: build.dist,
    });

    const directModules = boundary.modules.generatedComponents.filter((rel) => /\.client\.js$/.test(rel));
    const missingDirect: string[] = [];
    const missingCreate: string[] = [];
    for (const rel of directModules) {
        const text = fs.readFileSync(path.join(build.dist, ...rel.split('/')), 'utf8');
        if (!/__vmzDirect\s*=\s*true/.test(text)) missingDirect.push(rel);
        if (!/__vmzCreate\b/.test(text)) missingCreate.push(rel);
        if (/prototype\.render\b/.test(text)) missingDirect.push(`${rel}:prototype.render`);
    }

    const specializedKinds = boundary.specializedEmitSignals.map((s) => s.id);
    const specializedHits = boundary.specializedEmitSignals.reduce((n, s) => n + s.files.length, 0);

    return {
        boundary,
        dist: build.dist,
        directModules,
        missingDirect,
        missingCreate,
        blueprintViolations: scanForbiddenHotPath(build.dist),
        specializedHits,
        specializedKinds,
    };
}

export function assertGeneratedComponentCode(scan: GeneratedArtifactScan): string[] {
    const errors: string[] = [];
    if (!scan.directModules.length) errors.push('no generated *.client.js modules');
    if (scan.missingDirect.length) errors.push(`missing __vmzDirect: ${scan.missingDirect.join(', ')}`);
    if (scan.missingCreate.length) errors.push(`missing __vmzCreate: ${scan.missingCreate.join(', ')}`);
    const vmzDirect = scan.boundary.specializedEmitSignals.find((s) => s.id === 'vmzDirect');
    const vmzCreate = scan.boundary.specializedEmitSignals.find((s) => s.id === 'vmzCreate');
    if (!vmzDirect?.files.length) errors.push('no __vmzDirect signal in generated artifacts');
    if (!vmzCreate?.files.length) errors.push('no __vmzCreate signal in generated artifacts');
    return errors;
}

export function assertSpecializedBindings(scan: GeneratedArtifactScan): string[] {
    const errors: string[] = [];
    const kinds = new Set(scan.specializedKinds);
    const required = ['specFieldText', 'specFieldAttr', 'onMethod'] as const;
    for (const id of required) {
        if (!kinds.has(id)) errors.push(`missing specialized emit ${id} in generated artifacts`);
    }
    if (scan.specializedHits < 3) errors.push(`specialized emit too sparse (${scan.specializedHits})`);
    return errors;
}

export function assertNoGenericComponentInterpreter(scan: GeneratedArtifactScan): string[] {
    const errors: string[] = [...scan.blueprintViolations];
    const generatedWithBlueprint = scan.boundary.modules.generatedComponents.filter((rel) => {
        const text = fs.readFileSync(path.join(scan.dist, ...rel.split('/')), 'utf8');
        return /blueprint|prototype\.render|kind:\s*"(if|each)"/.test(text);
    });
    if (generatedWithBlueprint.length) {
        errors.push(`blueprint interpreter in generated modules: ${generatedWithBlueprint.join(', ')}`);
    }
    return errors;
}
