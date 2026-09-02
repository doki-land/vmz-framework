/**
 * Static scans for 0.2.0 maintenance discipline (production sources only).
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './repo-root.ts';

const TS_SUPPRESS_RE = /@ts-nocheck|@ts-ignore|@ts-expect-error(?!\s+\/\/\s*vmz-expires:)/;

/** JSDoc used as a type system (@param { … }, @returns { … }, @type { … }, @typedef { … }). */
const JSDOC_PSEUDO_TYPE_RE = /@(?:param|returns|type|typedef)\s+\{/;

const RUNTIME_SRC = 'packages/runtimes/vmz-runtime/src';

const AUTHORING_GLOBS = ['packages/ui/vmz-ui/src', 'packages/ui/vmz-ui-data-grid/src', 'packages/homepage/src', 'packages/examples'];

const TEMPLATE_THIS_HANDLER_RE = /@(?:click|submit|input|change|keydown|keyup|focus|blur|mousedown|mouseup)=["'][^"']*\bthis\.[A-Za-z_$]/;

function walkFiles(root: string, dir: string, out: string[]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
        const rel = path.join(dir, name);
        const full = path.join(root, rel);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist' || name === 'tests') continue;
            walkFiles(root, rel, out);
        } else if (/\.(ts|tsx|mts|cts)$/.test(name)) {
            out.push(rel);
        }
    }
}

function walkVmz(root: string, dir: string, out: string[]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return;
    for (const name of fs.readdirSync(abs)) {
        const rel = path.join(dir, name);
        const full = path.join(root, rel);
        const st = fs.statSync(full);
        if (st.isDirectory()) {
            if (name === 'node_modules' || name === 'dist') continue;
            walkVmz(root, rel, out);
        } else if (name.endsWith('.vmz')) {
            out.push(rel);
        }
    }
}

function lineHits(text: string, re: RegExp): number[] {
    const lines = text.split(/\r?\n/);
    const hits: number[] = [];
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) hits.push(i + 1);
    }
    return hits;
}

function templateSection(text: string): string {
    const open = text.indexOf('<template');
    if (open < 0) return '';
    const close = text.indexOf('</template>', open);
    if (close < 0) return text.slice(open);
    return text.slice(open, close + '</template>'.length);
}

export function scanTypeCheckSuppression(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const files: string[] = [];
    walkFiles(root, RUNTIME_SRC.replace(/\\/g, '/'), files);
    for (const rel of files) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const hits = lineHits(text, TS_SUPPRESS_RE);
        if (hits.length) errors.push(`${rel}:${hits.join(',')}: type-check suppression forbidden`);
    }
    return errors;
}

export function scanJSDocPseudoTypes(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const files: string[] = [];
    walkFiles(root, RUNTIME_SRC.replace(/\\/g, '/'), files);
    for (const rel of files) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const hits = lineHits(text, JSDOC_PSEUDO_TYPE_RE);
        if (hits.length) {
            errors.push(`${rel}:${hits.slice(0, 8).join(',')}: JSDoc pseudo-type forbidden (use TypeScript)`);
        }
    }
    return errors;
}

export function scanAuthoringSurface(root = repoRoot(import.meta.url)): string[] {
    const errors: string[] = [];
    const files: string[] = [];
    for (const base of AUTHORING_GLOBS) {
        walkVmz(root, base.replace(/\\/g, '/'), files);
    }
    for (const rel of files) {
        const text = fs.readFileSync(path.join(root, rel), 'utf8');
        const tpl = templateSection(text);
        if (!tpl) continue;
        const hits = lineHits(tpl, TEMPLATE_THIS_HANDLER_RE);
        if (hits.length) errors.push(`${rel}:${hits.join(',')}: template uses explicit this.method handler`);
    }
    return errors;
}

export const GENERIC_RUNTIME_API_RE = /\b(bindAttr|bindText|ifBlock|eachBlock|wireDirectBind)\s*\(/;

export function scanGeneratedForGenericRuntimeApi(distDir: string): string[] {
    const errors: string[] = [];
    const stack = [''];
    while (stack.length) {
        const rel = stack.pop() || '';
        const abs = path.join(distDir, rel);
        for (const name of fs.readdirSync(abs)) {
            const childRel = rel ? `${rel}/${name}` : name;
            const childAbs = path.join(distDir, childRel);
            const st = fs.statSync(childAbs);
            if (st.isDirectory()) stack.push(childRel);
            else if (/\.client\.js$/.test(name)) {
                const text = fs.readFileSync(childAbs, 'utf8');
                if (GENERIC_RUNTIME_API_RE.test(text)) {
                    errors.push(`${childRel}: generic runtime API call in generated artifact`);
                }
            }
        }
    }
    return errors;
}

export function scanBrowserClosureForGenericExports(root: string, closureModules: string[]): string[] {
    const errors: string[] = [];
    const runtimeSrc = path.join(root, 'packages/runtimes/vmz-runtime/src');
    const layers = ['browser', 'ssr', 'host', 'faces', 'shared'] as const;
    for (const mod of closureModules) {
        const base = mod.replace(/\.js$/, '.ts');
        const srcPath = layers.map((layer) => path.join(runtimeSrc, layer, base)).find((p) => fs.existsSync(p));
        if (!srcPath) continue;
        const text = fs.readFileSync(srcPath, 'utf8');
        if (/\b(bindAttr|bindText|ifBlock|eachBlock|wireDirectBind)\s*[:(]/.test(text)) {
            errors.push(`${path.relative(runtimeSrc, srcPath).replace(/\\/g, '/')}: generic interpreter export in browser closure source`);
        }
    }
    return errors;
}
