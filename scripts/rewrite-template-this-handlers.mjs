/**
 * Bulk-prefix bare handler idents with `this.` inside <template> … </template>.
 * Living 01: instance methods must be explicit `this.method` — never silent guess.
 *
 * Rewrites:
 *   @click="save"           → @click="this.save"
 *   :on-submit="confirm"    → :on-submit="this.confirm"
 *   @click='onDomClick'     → @click='this.onDomClick'
 * Leaves alone: this.*, arrows, calls with (, complex exprs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [path.join(root, 'packages', 'ui'), path.join(root, 'packages', 'homepage'), path.join(root, 'packages', 'examples')];

/** Attrs that bind handlers / function props (value may be bare method ref). */
const ATTR_RE = /(@[\w.:-]+|:on[\w-]*)\s*=\s*(["'])(?!this\.)([A-Za-z_$][\w$]*)\2/g;

function rewriteTemplateSection(templateInner) {
    return templateInner.replace(ATTR_RE, (_m, attr, q, ident) => {
        return `${attr}=${q}this.${ident}${q}`;
    });
}

function rewriteFile(filePath) {
    const src = fs.readFileSync(filePath, 'utf8');
    const re = /(<template\b[^>]*>)([\s\S]*?)(<\/template>)/gi;
    let changed = false;
    const out = src.replace(re, (full, open, inner, close) => {
        const next = rewriteTemplateSection(inner);
        if (next !== inner) changed = true;
        return open + next + close;
    });
    if (changed) {
        fs.writeFileSync(filePath, out, 'utf8');
        return true;
    }
    return false;
}

function walk(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === '.git') continue;
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p, acc);
        else if (ent.isFile() && ent.name.endsWith('.vmz')) acc.push(p);
    }
    return acc;
}

const files = TARGETS.flatMap((d) => walk(d));
let n = 0;
for (const f of files) {
    if (rewriteFile(f)) {
        n += 1;
        console.log('rewrote', path.relative(root, f));
    }
}
console.log(`done: ${n}/${files.length} files updated`);
