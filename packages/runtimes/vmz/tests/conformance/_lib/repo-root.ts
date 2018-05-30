import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Walk up from `from` (import.meta.url or file path) to the vmz-framework repo root
 * (directory that contains both Cargo.toml and package.json named vmz-framework).
 */
export function repoRoot(from = import.meta.url) {
    let dir = from.startsWith('file:') ? path.dirname(fileURLToPath(from)) : path.dirname(path.resolve(from));
    for (let i = 0; i < 12; i++) {
        const pkg = path.join(dir, 'package.json');
        const cargo = path.join(dir, 'Cargo.toml');
        if (fs.existsSync(pkg) && fs.existsSync(cargo)) {
            try {
                const name = JSON.parse(fs.readFileSync(pkg, 'utf8')).name;
                if (name === 'vmz-framework') return dir;
            } catch {
                /* keep walking */
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error('vmz-framework repo root not found from ' + from);
}

export function vmzBin(root = repoRoot()) {
    return path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');
}
