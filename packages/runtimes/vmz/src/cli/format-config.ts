/**
 * `vmz.config` `format` resolution for `vmz format`.
 *
 * Scope always comes from the explicit CLI path — config only narrows
 * (`excludes`) and styles. There are no config-driven `includes`.
 */

import type { VmzFormatConfig } from '../workspace/user-config.js';

export type ResolvedFormatOptions = {
    excludes: string[];
    style: string;
};

const DEFAULT_EXCLUDES = ['**/fixtures/**', '**/dist/**', '**/node_modules/**', '**/target/**'] as const;

/** Merge `vmz.config` `format` excludes / style with the defaults. */
export function resolveFormatConfig(format?: VmzFormatConfig | null): ResolvedFormatOptions {
    return {
        excludes: [...DEFAULT_EXCLUDES, ...(format?.excludes ?? [])],
        style: format?.style ?? 'biome.json',
    };
}
