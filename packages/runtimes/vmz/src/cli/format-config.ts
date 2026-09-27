/**
 * `vmz.config` `format` resolution for `vmz format`.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { VmzFormatConfig } from '@vmz/plugin';

export type ResolvedFormatOptions = {
    includes?: string[];
    excludes: string[];
    rust: boolean;
    javascript: boolean;
    vmz: boolean;
    style: string;
};

/** VMZ hybrid monorepo — JS/TS surfaces only, never whole-repo walk. */
export const VMZ_FRAMEWORK_INCLUDES = [
    'scripts/**',
    'packages/runtimes/**',
    'packages/examples/**',
    'packages/editors/**',
    'packages/ui/**',
    'packages/plugins/**',
    'packages/content/**',
    'packages/homepage/**',
    'package.json',
    'biome.json',
    'vmz.config.ts',
    'nifty.config.ts',
] as const;

const DEFAULT_EXCLUDES = ['**/fixtures/**'] as const;

function isFrameworkMonorepoRoot(projectRoot: string): boolean {
    return existsSync(path.join(projectRoot, 'packages', 'runtimes'));
}

/** Merge `vmz.config` `format` with framework monorepo defaults. */
export function resolveFormatConfig(projectRoot: string, format?: VmzFormatConfig): ResolvedFormatOptions {
    const frameworkRoot = isFrameworkMonorepoRoot(projectRoot);
    const hasCargo = existsSync(path.join(projectRoot, 'Cargo.toml'));
    const hasFormatSection = format !== undefined;

    return {
        includes: format?.includes ?? (frameworkRoot ? [...VMZ_FRAMEWORK_INCLUDES] : undefined),
        excludes: [...DEFAULT_EXCLUDES, ...(format?.excludes ?? [])],
        rust: format?.rust ?? (hasCargo && (frameworkRoot || hasFormatSection)),
        javascript: format?.javascript ?? (frameworkRoot || hasFormatSection),
        vmz: format?.vmz ?? true,
        style: format?.style ?? 'biome.json',
    };
}
