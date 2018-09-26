import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(example, '../../..');
const vmzBin = path.join(repoRoot, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

function resolveArtifactDist(): string {
    const root = path.join(example, 'dist');
    for (const nested of ['web-ssr', 'static', 'cdn', 'web-client', 'web-hybrid']) {
        const candidate = path.join(root, nested);
        if (fs.existsSync(path.join(candidate, 'vmz-dom.js'))) return candidate;
    }
    if (fs.existsSync(path.join(root, 'vmz-dom.js'))) return root;
    return root;
}

export default function setup() {
    execFileSync(process.execPath, [vmzBin, 'build', example], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    const dist = resolveArtifactDist();
    const dom = path.join(dist, 'vmz-dom.js');
    if (!fs.existsSync(dom)) {
        throw new Error(`global-setup: missing ${dom}`);
    }
}
