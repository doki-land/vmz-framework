/**
 * Production JSON artifact printer — always via N-API JsonCodeGenerator.
 * Do not use `JSON.stringify(x, null, 2)` for on-disk artifacts.
 */
import fs from 'node:fs';
import { requireNativeAddon } from './native-addon.js';

export interface EmitPrettyJsonOpts {
    logWrote?: (path: string) => void;
}

/** Pretty-print a value through `vmz-generator` (N-API). Returns pretty JSON without trailing newline. */
export function generatePrettyJson(value: unknown): string {
    const native = requireNativeAddon();
    if (typeof native.generatePrettyJson !== 'function') {
        throw new Error('vmz native addon missing generatePrettyJson — rebuild with `pnpm napi:build`');
    }
    return native.generatePrettyJson(JSON.stringify(value));
}

/** Write a pretty JSON artifact with a trailing newline. */
export function writePrettyJsonFile(filePath: string, value: unknown): void {
    fs.writeFileSync(filePath, `${generatePrettyJson(value)}\n`, 'utf8');
}

/** CLI `--json` helper: write to a path when `target` is a string, else stdout. */
export function emitPrettyJson(target: string | boolean | undefined, value: unknown, opts: EmitPrettyJsonOpts = {}): void {
    const text = generatePrettyJson(value);
    if (typeof target === 'string') {
        fs.writeFileSync(target, `${text}\n`, 'utf8');
        if (typeof opts.logWrote === 'function') opts.logWrote(target);
        return;
    }
    console.log(text);
}
