/**
 * Resolve the delivery artifact root for Browser Host / serve-host.
 *
 * `vmz build --out-dir <D>` with `profiles.*.name: 'cdn'` writes under `<D>/cdn`
 * (see delivery `name` contract). `@vmz/test` must serve that nested root — not
 * assume HTML / `vmz-serve-host.mjs` live at `<D>/`.
 */

import fs from 'node:fs';
import path from 'node:path';

const SERVE_HOST = 'vmz-serve-host.mjs';
const DEPLOYMENT = 'vmz-deployment.json';

/** True when `dir` looks like a built delivery tree (serve-host or static index). */
export function isDeliveryServeRoot(dir: string): boolean {
    if (!dir || !fs.existsSync(dir)) return false;
    return (
        fs.existsSync(path.join(dir, SERVE_HOST)) ||
        fs.existsSync(path.join(dir, 'index.html')) ||
        fs.existsSync(path.join(dir, DEPLOYMENT)) ||
        fs.existsSync(path.join(dir, '_vmz'))
    );
}

/**
 * Map CLI `--out-dir` root → profile delivery root (`outDir/<name>`).
 *
 * Prefer `preferredName` when provided (from the selected delivery profile).
 * Otherwise pick the sole nested delivery child, preferring a tree that has
 * `vmz-serve-host.mjs`. If the root itself is already a delivery tree, return it.
 */
export function resolveDeliveryServeRoot(outDirRoot: string, preferredName?: string | null): string {
    const root = path.resolve(outDirRoot);
    if (isDeliveryServeRoot(root)) return root;

    const preferred = typeof preferredName === 'string' ? preferredName.trim() : '';
    if (preferred) {
        const nested = path.join(root, preferred);
        if (isDeliveryServeRoot(nested)) return nested;
    }

    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return root;

    const children = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== 'node_modules' && !d.name.startsWith('.'))
        .map((d) => path.join(root, d.name))
        .filter(isDeliveryServeRoot);

    if (children.length === 0) return root;
    if (children.length === 1) return children[0];

    const withHost = children.filter((d) => fs.existsSync(path.join(d, SERVE_HOST)));
    const pool = withHost.length > 0 ? withHost : children;
    const cdn = pool.find((d) => path.basename(d) === 'cdn');
    if (cdn) return cdn;
    const staticName = pool.find((d) => path.basename(d) === 'static');
    if (staticName) return staticName;
    return pool[0];
}
