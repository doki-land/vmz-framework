import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const example = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(example, '../../..');
const vmzBin = path.join(repoRoot, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');

export default function setup() {
    execFileSync(process.execPath, [vmzBin, 'build', example], {
        cwd: repoRoot,
        stdio: 'inherit',
    });
    const dom = path.join(example, 'dist', 'vmz-dom.js');
    if (!fs.existsSync(dom)) {
        throw new Error(`global-setup: missing ${dom}`);
    }
}
