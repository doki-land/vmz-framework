import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';
import { addLimitation, readProof, upsertCheck, writeProof } from '../_lib/production-proof.ts';

export function failNotImplemented(id: string, gaps: string[]): never {
    const root = repoRoot(import.meta.url);
    const proof = readProof(root);
    upsertCheck(proof, {
        id,
        status: 'not-implemented',
        detail: gaps[0] || 'not implemented',
    });
    for (const g of gaps) addLimitation(proof, g);
    const out = writeProof(proof, root);
    console.error(`${id}: not implemented yet — recorded in ${path.relative(root, out)}`);
    for (const g of gaps) console.error(`  - ${g}`);
    process.exit(1);
}
