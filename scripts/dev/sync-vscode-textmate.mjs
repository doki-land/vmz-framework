import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Copy shared TextMate assets into the VS Code extension folder so:
 * - F5 / vsce package do not depend on pnpm junction layout
 * - contributes.path stays inside the extension root
 *
 * Source of truth remains packages/editors/vmz-textmate (do not edit copies by hand).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcPkg = path.join(root, 'packages', 'editors', 'vmz-textmate');
const dstExt = path.join(root, 'packages', 'editors', 'vmz-vscode');

const copies = [
    {
        from: path.join(srcPkg, 'grammars', 'vmz.tmLanguage.json'),
        to: path.join(dstExt, 'syntaxes', 'vmz.tmLanguage.json'),
    },
    {
        from: path.join(srcPkg, 'grammars', 'vmz-markdown-injection.json'),
        to: path.join(dstExt, 'syntaxes', 'vmz-markdown-injection.json'),
    },
    {
        from: path.join(srcPkg, 'language-configuration.json'),
        to: path.join(dstExt, 'language-configuration.json'),
    },
];

for (const { from, to } of copies) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    console.log(`synced ${path.relative(root, from)} → ${path.relative(root, to)}`);
}
