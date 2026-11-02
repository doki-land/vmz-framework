/**
 * Icon duplication gate for the homepage app.
 *
 * The homepage consumes icons exclusively from `@vmz/ui-icons` (registry +
 * package `Icon`). Any local re-implementation — inline SVG glyphs, path-data
 * string tables keyed by icon name, or copies of the package-owned
 * `.vmz-ui-icon*` CSS — forks the icon surface and must fail the check.
 *
 * Scope: `packages/homepage/src/**` (.vmz / .ts / .css). Exits 1 and prints
 * `file:line` evidence when a forbidden pattern is found.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..', 'src');
const EXTENSIONS = new Set(['.vmz', '.ts', '.css']);

/** Each rule names the duplication class it catches. */
const RULES = [
    {
        id: 'inline-svg-element',
        pattern: /<(?:svg|path|circle|rect|ellipse|polygon|polyline)\b/i,
        reason: 'inline SVG glyph element; icons must come from the `@vmz/ui-icons` registry via the package `Icon` component',
    },
    {
        id: 'svg-viewbox',
        pattern: /\bviewBox\s*=/i,
        reason: 'hand-authored SVG viewBox; glyph geometry belongs to `@vmz/ui-icons`',
    },
    {
        id: 'svg-stroke-rendering',
        pattern: /stroke-line(?:cap|join)/i,
        reason: 'hand-authored icon stroke rendering; stroke weight and caps are owned by the registry definition',
    },
    {
        id: 'svg-path-data-literal',
        pattern: /["']M-?\d/,
        reason: 'SVG path-data literal; path data must live in `@vmz/ui-icons`, not in homepage sources',
    },
    {
        id: 'icon-key-mapping-table',
        pattern: /["'](?:action|brand|commerce|data|develop|device|editor|feature|file|git|media|nav|social|status|tool)\.[a-z0-9-]+["']\s*:/i,
        reason: 'icon-name keyed mapping table; the registry is the only key surface, query it instead of restating keys',
    },
    {
        id: 'package-icon-css-copy',
        pattern: /(?:^|[}\r\n])\s*\.vmz-ui-icon(?:__|\[|:|\s*\{|\s*,)/m,
        reason: 'redefinition of the package-owned `.vmz-ui-icon*` CSS; icon component styles ship with the package',
    },
];

function* walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            yield* walk(full);
        } else if (EXTENSIONS.has(path.extname(entry.name))) {
            yield full;
        }
    }
}

let failures = 0;
for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const rule of RULES) {
        lines.forEach((line, index) => {
            if (rule.pattern.test(line)) {
                failures += 1;
                console.error(
                    `icon-duplication gate [${rule.id}] ${path.relative(process.cwd(), file)}:${index + 1}\n    ${line.trim()}\n    ${rule.reason}`,
                );
            }
        });
    }
}

if (failures > 0) {
    console.error(`icon-duplication gate: ${failures} violation(s) under packages/homepage/src`);
    process.exit(1);
}
console.log('icon-duplication gate: clean — homepage renders icons only from `@vmz/ui-icons`');
