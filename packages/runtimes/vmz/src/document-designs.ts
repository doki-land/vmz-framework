// @ts-nocheck
/**
 * Document D1 — wire project `/designs` into static document assets.
 * Prefer compiled `vmz-designs.css` / `vmz.css`; else emit a minimal token CSS.
 */
import fs from 'node:fs';
import path from 'node:path';
/**
 * @param {string} projectRoot
 * @returns {{ css: string, source: string | null, href: string | null }}
 */
export function resolveDocumentDesignsCss(projectRoot) {
    const designsDir = path.join(projectRoot, 'designs');
    if (!fs.existsSync(designsDir) || !fs.statSync(designsDir).isDirectory()) {
        return { css: '', source: null, href: null };
    }

    /** @type {string[]} */
    const parts = [];
    /** @type {string[]} */
    const sources = [];

    // Layout first so @import (fonts) stays at stylesheet top; theme tokens follow.
    const layoutCandidates = [path.join(designsDir, 'document', 'chrome.css'), path.join(designsDir, 'styles', 'document.css')];
    for (const p of layoutCandidates) {
        if (!fs.existsSync(p)) continue;
        parts.push(fs.readFileSync(p, 'utf8'));
        sources.push(path.relative(projectRoot, p).replace(/\\/g, '/'));
        break;
    }

    const distCandidates = [path.join(projectRoot, 'dist', 'vmz-designs.css'), path.join(projectRoot, 'dist', 'vmz.css')];
    for (const p of distCandidates) {
        if (fs.existsSync(p)) {
            parts.push(fs.readFileSync(p, 'utf8'));
            sources.push(path.relative(projectRoot, p).replace(/\\/g, '/'));
            break;
        }
    }

    if (parts.length) {
        return {
            css: parts.join('\n\n'),
            source: sources.join('+'),
            href: 'assets/vmz-designs.css',
        };
    }

    const styleCandidates = [path.join(designsDir, 'styles', 'index.css')];
    for (const p of styleCandidates) {
        if (fs.existsSync(p)) {
            return {
                css: fs.readFileSync(p, 'utf8'),
                source: path.relative(projectRoot, p).replace(/\\/g, '/'),
                href: 'assets/vmz-designs.css',
            };
        }
    }
    const emitted = emitMinimalDesignsCss(designsDir);
    if (emitted) {
        return { css: emitted, source: 'designs/', href: 'assets/vmz-designs.css' };
    }
    return { css: '', source: 'designs/', href: null };
}
/** @param {string} designsDir */
function emitMinimalDesignsCss(designsDir) {
    /** @type {Record<string, string>} */
    const vars = {};
    const tokenDir = path.join(designsDir, 'tokens');
    if (fs.existsSync(tokenDir)) {
        walkJson(tokenDir, (obj, prefix) => flattenTokens(obj, prefix, vars));
    }
    const themeJson = path.join(designsDir, 'theme.json');
    if (fs.existsSync(themeJson)) {
        try {
            flattenTokens(JSON.parse(fs.readFileSync(themeJson, 'utf8')), '', vars);
        } catch {
            /* ignore */
        }
    }
    const keys = Object.keys(vars).sort();
    if (!keys.length) {
        // Presence of /designs still warrants a readable baseline sheet.
        return `/* vmz.document designs baseline */\n:root { color-scheme: light; }\nbody { font-family: system-ui, sans-serif; line-height: 1.5; margin: 0; }\nmain { max-width: 48rem; margin: 0 auto; padding: 1.5rem; }\nnav { padding: 1rem 1.5rem; border-bottom: 1px solid #ddd; }\n`;
    }
    const lines = keys.map((k) => `  ${cssVar(k)}: ${vars[k]};`);
    return `/* vmz.document designs from /designs */\n:root {\n${lines.join('\n')}\n}\nbody { font-family: var(--font-sans, system-ui, sans-serif); line-height: 1.5; margin: 0; color: var(--color-fg, #111); background: var(--color-bg, #fff); }\nmain { max-width: 48rem; margin: 0 auto; padding: 1.5rem; }\nnav { padding: 1rem 1.5rem; border-bottom: 1px solid var(--color-border, #ddd); }\n`;
}
function cssVar(key) {
    const name = String(key)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '');
    return `--${name}`;
}
function flattenTokens(obj, prefix, out) {
    if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}-${k}` : k;
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
            if ('value' in v && (typeof v.value === 'string' || typeof v.value === 'number')) {
                out[key] = String(v.value);
            } else {
                flattenTokens(v, key, out);
            }
        } else if (typeof v === 'string' || typeof v === 'number') {
            out[key] = String(v);
        }
    }
}
function walkJson(dir, fn) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkJson(full, fn);
        else if (ent.isFile() && ent.name.endsWith('.json')) {
            try {
                fn(JSON.parse(fs.readFileSync(full, 'utf8')), '');
            } catch {
                /* ignore */
            }
        }
    }
}
