/**
 * template-ast-single-source — cross-SFC script spans from analyze name_span, not string find.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`TEMPLATE-AST-SINGLE-SOURCE GATE FAIL: ${msg}`);
    process.exit(1);
}

const root = repoRoot(import.meta.url);
const crossSfc = fs.readFileSync(path.join(root, 'packages/compilers/vmz-compiler/src/tooling/cross_sfc.rs'), 'utf8');

for (const banned of ['fn span_of_ident', 'fn span_of_class_name', 'fn span_of_method_decl']) {
    if (crossSfc.includes(banned)) {
        fail(`cross_sfc.rs still defines ${banned}`);
    }
}

if (!crossSfc.includes('name_span')) {
    fail('cross_sfc.rs must consume analyze name_span');
}

console.log('TEMPLATE-AST-SINGLE-SOURCE GATE OK');
