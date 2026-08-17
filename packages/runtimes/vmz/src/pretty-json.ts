// @ts-nocheck
/**
 * Production JSON artifact printer — always via N-API JsonCodeGenerator.
 * Do not use `JSON.stringify(x, null, 2)` for on-disk artifacts.
 */
import fs from 'node:fs';
import { requireNativeAddon } from './native-addon.js';

/**
 * Pretty-print a value through `vmz-generator` (N-API).
 * @param {unknown} value
 * @returns {string} Pretty JSON without trailing newline.
 */
export function generatePrettyJson(value) {
    const native = requireNativeAddon();
    if (typeof native.generatePrettyJson !== 'function') {
        throw new Error('vmz native addon missing generatePrettyJson — rebuild with `pnpm napi:build`');
    }
    return native.generatePrettyJson(JSON.stringify(value));
}

/**
 * Write a pretty JSON artifact with a trailing newline.
 * @param {string} filePath
 * @param {unknown} value
 */
export function writePrettyJsonFile(filePath, value) {
    fs.writeFileSync(filePath, `${generatePrettyJson(value)}\n`, 'utf8');
}
