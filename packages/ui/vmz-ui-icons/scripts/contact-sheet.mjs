#!/usr/bin/env node
/**
 * Generate a static HTML contact sheet for `@vmz/ui-icons` registry review.
 *
 * Usage:
 *   node packages/ui/vmz-ui-icons/scripts/contact-sheet.mjs [out.html]
 *   node packages/ui/vmz-ui-icons/scripts/contact-sheet.mjs --mode=light|dark|both --grid
 *
 * The sheet groups marks by category, renders light and dark surfaces with a
 * 16 / 20 / 24 / 32 size ladder and an optional 24-unit alignment grid, so stroke
 * weight, optical size and centering can be checked against real glyph geometry
 * instead of source text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const iconsRoot = path.join(here, '..');
const registryUrl = pathToFileURL(path.join(iconsRoot, 'src', 'registry.ts')).href;
const { REGISTRY } = await import(registryUrl);

const args = process.argv.slice(2);
const modeArg = args.find((arg) => arg.startsWith('--mode='));
const mode = modeArg ? modeArg.slice('--mode='.length) : 'both';
const showGrid = args.includes('--grid');
const outArg = args.find((arg) => !arg.startsWith('--'));
const outPath = outArg ?? path.join(iconsRoot, showGrid ? 'contact-sheet-grid.html' : 'contact-sheet.html');

const ladderSizes = [16, 20, 24, 32];
const CATEGORY_GROUPS = [
    ['action', 'Action'],
    ['nav', 'Navigation'],
    ['status', 'Status'],
    ['feature', 'Feature'],
    ['tool', 'Tool'],
    ['file', 'File'],
    ['media', 'Media'],
    ['data', 'Data'],
    ['commerce', 'Commerce'],
    ['social', 'Social'],
    ['brand', 'Brand'],
];
const names = Object.keys(REGISTRY).sort();
const groups = CATEGORY_GROUPS.map(([prefix, title]) => ({
    prefix,
    title,
    names: names.filter((name) => name.startsWith(`${prefix}.`)),
})).filter((group) => group.names.length > 0);
const ungrouped = names.filter((name) => !CATEGORY_GROUPS.some(([prefix]) => name.startsWith(`${prefix}.`)));
if (ungrouped.length > 0) groups.push({ prefix: '', title: 'Ungrouped', names: ungrouped });
const strokeCount = names.filter((name) => REGISTRY[name].kind === 'stroke').length;
const fillCount = names.filter((name) => REGISTRY[name].kind === 'fill').length;
const badgeCount = names.filter((name) => REGISTRY[name].kind === 'text-badge').length;
const strokeWidthOverrides = names.filter(
    (name) => REGISTRY[name].kind === 'stroke' && REGISTRY[name].strokeWidth !== undefined,
);

function renderGlyph(def, size) {
    if (def.kind === 'text-badge') {
        return `<span class="badge" style="font-size:${size * 0.56}px">${def.label}</span>`;
    }
    if (def.kind === 'stroke') {
        const strokeWidth = def.strokeWidth ?? 1.75;
        const parts = [
            `<g fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">`,
        ];
        for (const pathData of def.paths ?? []) parts.push(`<path d="${pathData}"/>`);
        for (const circle of def.circles ?? []) {
            parts.push(`<circle cx="${circle.cx}" cy="${circle.cy}" r="${circle.r}"/>`);
        }
        for (const dot of def.dots ?? []) {
            parts.push(`<circle cx="${dot.cx}" cy="${dot.cy}" r="${dot.r}" fill="currentColor" stroke="none"/>`);
        }
        parts.push('</g>');
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${parts.join('')}</svg>`;
    }
    if (def.kind === 'fill') {
        const fillRule = def.fillRule ? ` fill-rule="${def.fillRule}"` : '';
        return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor"${fillRule} d="${def.d}"/></svg>`;
    }
    return '';
}

function renderGrid(size) {
    if (!showGrid) return '';
    const lines = [4, 8, 12, 16, 20].map((value) => `<path d="M${value} 0V24"/><path d="M0 ${value}H24"/>`);
    return `<svg class="grid-overlay" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${lines.join('')}</svg>`;
}

function renderTile(name) {
    const def = REGISTRY[name];
    const hero = renderGlyph(def, 64);
    const ladder = ladderSizes.map((size) => `<span class="step">${renderGlyph(def, size)}</span>`).join('');
    return `<article class="tile">
  <div class="hero">${renderGrid(64)}${hero}</div>
  <div class="ladder">${ladder}</div>
  <code class="name">${name}</code>
  <span class="kind">${def.kind}</span>
</article>`;
}

function renderGroup(group) {
    return `<section class="group">
  <h3 class="group-title">${group.title} <span>${group.names.length}</span></h3>
  <div class="grid">${group.names.map(renderTile).join('\n')}</div>
</section>`;
}

const panels = [];
if (mode !== 'dark') {
    panels.push(`<section class="panel light">
  <header class="panel-head"><h2>Light surface</h2><span>16 · 20 · 24 · 32 ladder</span></header>
  ${groups.map(renderGroup).join('\n')}
</section>`);
}
if (mode !== 'light') {
    panels.push(`<section class="panel dark">
  <header class="panel-head"><h2>Dark surface</h2><span>16 · 20 · 24 · 32 ladder</span></header>
  ${groups.map(renderGroup).join('\n')}
</section>`);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>@vmz/ui-icons contact sheet</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { max-width: 100%; }
  body {
    margin: 0;
    padding: 24px;
    background: #eceef1;
    color: #1f2329;
    font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }
  .masthead { max-width: 72rem; margin: 0 auto 16px; }
  .masthead h1 { margin: 4px 0 8px; font-size: 22px; font-weight: 600; }
  .eyebrow { margin: 0; font: 600 12px/1 ui-monospace, Consolas, monospace; letter-spacing: .06em; color: #51565d; }
  .stats { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0; color: #51565d; font-size: 13px; }
  .stats strong { color: #1f2329; font-weight: 600; }
  .rules { margin: 10px 0 0; padding: 10px 12px; border-left: 3px solid #1677ff; background: #fff; color: #51565d; font-size: 12px; line-height: 1.6; }
  .panel {
    max-width: 72rem;
    margin: 0 auto 16px;
    padding: 20px;
    border: 1px solid #e5e6eb;
    border-radius: 10px;
    background: #fff;
  }
  .panel.dark { background: #141414; border-color: #2a2a2a; color: #f0f0f0; }
  .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
  .panel-head h2 { margin: 0; font-size: 14px; font-weight: 600; }
  .panel-head span { color: #8a9099; font: 400 11px/1 ui-monospace, Consolas, monospace; }
  .group { margin-top: 14px; }
  .group-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin: 0 0 8px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: #51565d;
  }
  .dark .group-title { color: #a6a6a6; }
  .group-title span { font: 500 10px/1 ui-monospace, Consolas, monospace; color: #8a9099; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 8px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-width: 0;
    padding: 10px 6px 8px;
    border: 1px solid #f0f1f3;
    border-radius: 8px;
    background: #fafbfc;
  }
  .dark .tile { background: #1c1c1c; border-color: #262626; }
  .hero { position: relative; display: flex; align-items: center; justify-content: center; width: 64px; height: 64px; color: #1f2329; }
  .dark .hero { color: #f0f0f0; }
  .hero svg { width: 100%; height: 100%; }
  .step svg { display: block; }
  .grid-overlay { position: absolute; inset: 0; color: currentColor; opacity: .16; }
  .grid-overlay path { stroke: currentColor; stroke-width: 1; fill: none; }
  .ladder { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 32px; color: #1f2329; }
  .dark .ladder { color: #f0f0f0; }
  .step { display: inline-flex; align-items: center; justify-content: center; }
  .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #51565d; font: 400 10px/1.3 ui-monospace, Consolas, monospace; }
  .dark .name { color: #a6a6a6; }
  .kind { color: #8a9099; font: 500 9px/1 ui-monospace, Consolas, monospace; letter-spacing: .04em; text-transform: uppercase; }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.7em;
    padding: .1em .2em;
    border: 1.5px solid currentColor;
    border-radius: .2em;
    font-family: ui-monospace, Consolas, monospace;
    font-weight: 600;
    letter-spacing: -.02em;
    line-height: 1.1;
    text-align: center;
    text-transform: uppercase;
  }
  footer { max-width: 72rem; margin: 0 auto; color: #8a9099; font: 400 11px/1.6 ui-monospace, Consolas, monospace; }
  @media (max-width: 560px) {
    body { padding: 10px; }
    .panel { padding: 10px; border-radius: 8px; }
    .panel-head { flex-wrap: wrap; gap: 4px 10px; }
    .rules { overflow-wrap: anywhere; }
    .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .tile { padding: 8px 4px 6px; }
    .hero { width: 48px; height: 48px; }
    .ladder { gap: 4px; }
    .name { font-size: 9px; }
    .kind { font-size: 8px; }
  }
</style>
</head>
<body>
<header class="masthead">
  <p class="eyebrow">@vmz/ui-icons</p>
  <h1>Visual contact sheet</h1>
  <p class="stats">
    <span><strong>${names.length}</strong> entries</span>
    <span><strong>${strokeCount}</strong> stroke</span>
    <span><strong>${fillCount}</strong> fill</span>
    <span><strong>${badgeCount}</strong> text-badge</span>
    <span><strong>${groups.length}</strong> categories</span>
    <span><strong>24</strong> unit grid</span>
    <span><strong>1.75</strong> stroke</span>
    <span><strong>16 / 20 / 24 / 32</strong> ladder</span>
  </p>
  <p class="rules">
    Optical box 4–20 · crosses 6–18 · chevrons 6–18 × 9–15 · plus/minus 5–19 · dots r 1.5 ·
    round caps and joins · one silhouette per concept · brand silhouettes are fill by exception ·
    color inherited from <code>currentColor</code>.
  </p>
</header>
${panels.join('\n')}
<footer>
  Generated from <code>src/registry.ts</code>${showGrid ? ' with the 24-unit alignment grid' : ''}.
  Brand geometry from Simple Icons (CC0-1.0), trademarks belong to their owners.
  Stroke width overrides: ${strokeWidthOverrides.length === 0 ? 'none' : strokeWidthOverrides.join(', ')}.
</footer>
</body>
</html>`;

fs.writeFileSync(outPath, html, 'utf8');
console.log(`wrote ${outPath} (${names.length} icons, ${groups.length} categories, mode=${mode}${showGrid ? ', grid' : ''})`);
if (strokeWidthOverrides.length > 0) {
    console.warn(`stroke width overrides found: ${strokeWidthOverrides.join(', ')}`);
}
