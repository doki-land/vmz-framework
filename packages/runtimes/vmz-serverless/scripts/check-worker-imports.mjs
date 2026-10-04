/**
 * Static check: Worker sources must not import Node-only modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../worker');
const WORKER_FILES = ['index.ts', 'module-registry.generated.ts'];

const FORBIDDEN = [/from\s+['"]node:/, /from\s+['"]fs['"]/, /from\s+['"]path['"]/, /from\s+['"]child_process['"]/, /require\s*\(/];

let violations = 0;

for (const file of WORKER_FILES) {
    const full = path.join(WORKER_DIR, file);
    if (!fs.existsSync(full)) {
        console.error(`check-worker-imports: missing ${file}`);
        process.exit(1);
    }
    const text = fs.readFileSync(full, 'utf8');
    for (const pattern of FORBIDDEN) {
        if (pattern.test(text)) {
            console.error(`  forbidden ${pattern} in ${file}`);
            violations += 1;
        }
    }
}

if (violations > 0) {
    console.error(`check-worker-imports: ${violations} violation(s)`);
    process.exit(1);
}

console.log(`check-worker-imports: ok (${WORKER_FILES.length} files)`);
