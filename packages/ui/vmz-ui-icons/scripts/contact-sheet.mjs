#!/usr/bin/env node
/**
 * Generate a static HTML contact sheet for `@vmz/ui-icons` registry review.
 * Usage: node packages/ui/vmz-ui-icons/scripts/contact-sheet.mjs [out.html]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const iconsRoot = path.join(here, '..');
const registryUrl = pathToFileURL(path.join(iconsRoot, 'src', 'registry.ts')).href;
const { REGISTRY } = await import(registryUrl);

const sizes = [16, 20, 24];
const names = Object.keys(REGISTRY).sort();

function renderSvg(def) {
    if (def.kind === 'text-badge') {
        return `<span class="badge">${def.label}</span>`;
    }
    const parts = [];
    if (def.kind === 'stroke') {
        const sw = def.strokeWidth ?? 1.75;
        parts.push(`<g fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`);
        for (const d of def.paths ?? []) parts.push(`<path d="${d}"/>`);
        for (const c of def.circles ?? []) parts.push(`<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}"/>`);
        for (const dot of def.dots ?? []) {
            parts.push(`<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="currentColor" stroke="none"/>`);
        }
        parts.push('</g>');
        return `<svg viewBox="0 0 24 24">${parts.join('')}</svg>`;
    }
    if (def.kind === 'fill') {
        const rule = def.fillRule ? ` fill-rule="${def.fillRule}"` : '';
        return `<svg viewBox="0 0 24 24"><path fill="currentColor"${rule} d="${def.d}"/></svg>`;
    }
    return '';
}

const cells = names
    .map((name) => {
        const def = REGISTRY[name];
        const previews = sizes
            .map(
                (px) =>
                    `<div class="cell" style="--px:${px}px"><div class="glyph" style="width:${px}px;height:${px}px">${renderSvg(def)}</div></div>`,
            )
            .join('');
        return `<section class="row"><h2>${name}</h2><div class="sizes">${previews}</div></section>`;
    })
    .join('\n');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>@vmz/ui-icons contact sheet</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; background: #f5f6f8; color: #1f2329; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  .row { display: grid; grid-template-columns: 220px 1fr; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #e5e6eb; }
  .row h2 { margin: 0; font: 600 12px/1.3 ui-monospace, monospace; color: #51565d; }
  .sizes { display: flex; gap: 16px; align-items: center; }
  .cell { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .glyph { display: flex; align-items: center; justify-content: center; color: #1f2329; }
  .glyph svg { width: 100%; height: 100%; display: block; }
  .badge { display: inline-flex; align-items: center; justify-content: center; min-width: 1.65em; padding: 0.12em 0.22em; border: 1.5px solid currentColor; border-radius: 3px; font: 600 10px/1 ui-monospace, monospace; letter-spacing: -0.03em; text-transform: uppercase; }
  .panel { background: #fff; border: 1px solid #e5e6eb; border-radius: 8px; padding: 16px; }
  .panel.dark { background: #141414; color: #f0f0f0; }
  .panel.dark .row { border-color: #303030; }
  .panel.dark .row h2 { color: #a6a6a6; }
</style>
</head>
<body>
<h1>@vmz/ui-icons — ${names.length} registry entries</h1>
<div class="panel">${cells}</div>
<div class="panel dark" style="margin-top:24px">${cells}</div>
</body>
</html>`;

const outPath = process.argv[2] ?? path.join(iconsRoot, 'contact-sheet.html');
fs.writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${names.length} icons)`);
