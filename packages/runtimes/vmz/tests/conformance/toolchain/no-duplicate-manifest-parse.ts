/**
 * no-duplicate-manifest-parse — locale/document policy only via N-API Plan loaders.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

function fail(msg: string): never {
    console.error(`NO-DUPLICATE-MANIFEST-PARSE GATE FAIL: ${msg}`);
    process.exit(1);
}

const root = repoRoot(import.meta.url);

const authorInput = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/workspace/author-input.ts'), 'utf8');
if (!authorInput.includes('native.loadLocalePlan') || !authorInput.includes('native.loadDocumentRoutePlan')) {
    fail('author-input.ts must delegate locale/document policy to N-API Plan loaders');
}

const localeCheck = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/locale/locale-check.ts'), 'utf8');
if (!localeCheck.includes('loadLocalePlan(')) {
    fail('locale-check.ts must call loadLocalePlan');
}
if (/parseAuthorInput\(\s*readFileSync\([^)]*locales\.json5/.test(localeCheck)) {
    fail('locale-check must not parseAuthorInput locales.json5 for policy');
}

const documentCheck = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/document/document-check.ts'), 'utf8');
if (!documentCheck.includes('loadDocumentRoutePlan(')) {
    fail('document-check.ts must call loadDocumentRoutePlan');
}

console.log('NO-DUPLICATE-MANIFEST-PARSE GATE OK');
