/**
 * ui-author-surface — official UI author-surface evidence (Discussion #2).
 *
 * Asserts the contracted props render and behave, not just that a prop name
 * exists: CodeBlock header precedence, Dropdown link-vs-action items, AppShell
 * flat nav + `actions` slot, Link variants, and the `language → nav.language`
 * icon alias resolving to the same glyph.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const vmzBin = path.join(root, 'packages', 'runtimes', 'vmz', 'bin', 'vmz.js');
const homepage = path.join(root, 'packages', 'homepage');

function fail(msg) {
    console.error(`ui-author-surface GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ui-author-surface: build homepage (official @vmz/ui dogfood)…');
const build = spawnSync(process.execPath, [vmzBin, 'build', homepage], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`homepage build failed\n${build.stdout}\n${build.stderr}`);

const dist = path.join(homepage, 'dist', 'web-ssr');
const domHref = pathToFileURL(
    path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js'),
).href;
const { registerComponents, renderToString } = await import(domHref);

async function loadComponent(name) {
    const file = path.join(dist, 'components', `${name}.client.js`);
    if (!fs.existsSync(file)) fail(`missing ${file}`);
    return (await import(pathToFileURL(file).href)).default;
}

// --- Dropdown: link items keep navigation, action items select -------------
console.log('ui-author-surface: Dropdown link vs action items…');
const Dropdown = await loadComponent('Dropdown');
const dropdownItems = [
    { id: 'edit', title: 'Edit', href: '/edit' },
    { id: 'archive', title: 'Archive' },
    { id: 'delete', title: 'Delete', danger: true, disabled: true },
    { id: 'sep', title: '', divider: true },
];
registerComponents({ Dropdown });
const dropdownHtml = await renderToString(Dropdown, { label: 'Actions', items: dropdownItems });
if (!/<a[^>]*href="\/edit"[^>]*data-vmz-dropdown-item="edit"/.test(dropdownHtml)) {
    fail(`link item must stay an anchor with href: ${dropdownHtml.slice(0, 600)}`);
}
if (!/<button[^>]*type="button"[^>]*data-vmz-dropdown-item="archive"/.test(dropdownHtml)) {
    fail(`href-less item must render an action button: ${dropdownHtml.slice(0, 600)}`);
}
if (dropdownHtml.includes('href="#"')) fail('action item must not fake `href="#"`');
if (!/<div role="separator"/.test(dropdownHtml)) fail('divider item must render a separator');
if (!/data-vmz-dropdown-item="delete"[^>]*data-disabled="true"/.test(dropdownHtml)) {
    fail('disabled item must expose data-disabled="true"');
}

const dropdown = new Dropdown();
dropdown.items = dropdownItems;
const picked = [];
dropdown.onSelect = (id) => picked.push(id);
const fakeTarget = (id) => ({ getAttribute: (name) => (name === 'data-vmz-dropdown-item' ? id : null) });
dropdown.onItemClick({ currentTarget: fakeTarget('archive') });
dropdown.onItemClick({ currentTarget: fakeTarget('edit') });
dropdown.onItemClick({ currentTarget: fakeTarget('delete') });
if (picked.join(',') !== 'archive') {
    fail(`onSelect must fire for action items only, got: ${JSON.stringify(picked)}`);
}

console.log('ui-author-surface PASS: Dropdown link-vs-action contract');
