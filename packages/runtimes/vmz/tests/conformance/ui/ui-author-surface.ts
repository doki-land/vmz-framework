/**
 * ui-author-surface — official UI author-surface evidence (Discussion #2).
 *
 * Asserts the contracted props render and behave, not just that a prop name
 * exists: CodeBlock header precedence, Dropdown link-vs-action items, AppShell
 * flat nav + `actions` slot, Link variants, and canonical semantic icon names
 * (bare legacy names must be rejected by the registry).
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
// Build into a scratch dir: `packages/homepage/dist` is incremental, so a stale
// vendored `@vmz/ui-icons` copy there would silently test old registry code.
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-author-surface-'));
process.on('exit', () => {
    try {
        fs.rmSync(outDir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});
const build = spawnSync(process.execPath, [vmzBin, 'build', homepage, '--out-dir', outDir], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
});
if (build.status !== 0) fail(`homepage build failed\n${build.stdout}\n${build.stderr}`);

const dist = path.join(outDir, 'web-ssr');
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

// --- CodeBlock: title/caption precedence, language chip, copy gating ------
console.log('ui-author-surface: CodeBlock header surface…');
const CodeBlock = await loadComponent('CodeBlock');
registerComponents({ CodeBlock });
const titled = await renderToString(CodeBlock, {
    code: 'npm i @vmz/ui',
    title: 'Install',
    caption: 'Legacy caption',
    language: 'bash',
});
if (!titled.includes('Install')) fail('CodeBlock must render `title`');
if (titled.includes('Legacy caption')) fail('`title` must win over `caption`');
if (!titled.includes('vmz-ui-code-block__lang') || !titled.includes('bash')) {
    fail(`CodeBlock must render the \`language\` chip: ${titled.slice(0, 400)}`);
}
if (/<button/.test(titled)) fail('CodeBlock must not render a dead copy button without `onCopy`');

const captioned = await renderToString(CodeBlock, {
    code: 'echo hi',
    caption: 'Legacy caption',
});
if (!captioned.includes('Legacy caption')) fail('`caption` must remain the fallback heading');

const copyable = await renderToString(CodeBlock, {
    code: 'echo hi',
    title: 'Run',
    copyLabel: 'Copy command',
    onCopy: () => {},
});
if (!copyable.includes('Copy command')) fail('`copyLabel` must label the copy control');
if (!/<button/.test(copyable)) fail('`onCopy` must render the copy control');

console.log('ui-author-surface PASS: CodeBlock header contract');

// --- AppShell: flat nav unchanged, `actions` slot is the extension point ---
console.log('ui-author-surface: AppShell flat nav + actions slot…');
const AppShell = await loadComponent('AppShell');
registerComponents({ AppShell });
const shellHtml = await renderToString(
    AppShell,
    {
        brand: 'VMZ',
        homeHref: '/',
        navLabel: 'Primary',
        activeId: 'docs',
        nav: [
            { id: 'docs', title: 'Docs', href: '/docs' },
            { id: 'blog', title: 'Blog', href: '/blog' },
        ],
    },
    { slotHtml: '<h1>Page</h1>' },
);
for (const needle of [
    'data-vmz-ui="app-shell"',
    'aria-label="Primary"',
    'href="/docs"',
    'aria-current="page"',
    '<h1>Page</h1>',
]) {
    if (!shellHtml.includes(needle)) fail(`AppShell SSR missing ${needle}: ${shellHtml.slice(0, 600)}`);
}
const shellSrc = fs.readFileSync(path.join(dist, 'components', 'AppShell.client.js'), 'utf8');
if (!/api\.attr\([^,]+, ["']name["'], ["']actions["']\)/.test(shellSrc)) {
    fail('AppShell has no named `actions` slot in the compiled component');
}
if (!shellSrc.includes('"tag":"actions"')) {
    fail('AppShell compiled plan is missing the `actions` slot node');
}

// --- Link: `nav` / `muted` variants keep href/target/rel ------------------
console.log('ui-author-surface: Link variants…');
const Link = await loadComponent('Link');
registerComponents({ Link });
for (const variant of ['default', 'muted', 'nav']) {
    const html = await renderToString(
        Link,
        { href: `/v/${variant}`, target: '_blank', rel: 'noopener', variant },
        { slotHtml: variant },
    );
    if (!html.includes(`data-variant="${variant}"`)) fail(`Link missing data-variant="${variant}"`);
    if (!html.includes(`href="/v/${variant}"`)) fail(`Link ${variant} must keep href`);
    if (!html.includes('target="_blank"') || !html.includes('rel="noopener"')) {
        fail(`Link ${variant} must pass through target/rel`);
    }
}

// --- Icons: canonical semantic names only, bare legacy names fail loudly ---
console.log('ui-author-surface: canonical icon names…');
const Icon = await loadComponent('Icon');
registerComponents({ Icon });
const glyphPaths = (html) =>
    [...html.matchAll(/\sd="([^"]+)"/g)]
        .map((match) => match[1])
        .sort()
        .join('|');
const iconHtml = await renderToString(Icon, { name: 'nav.language', decorative: true });
if (!iconHtml.includes('data-name="nav.language"')) fail('Icon must keep the authored semantic name in data-name');
if (!glyphPaths(iconHtml)) fail('`nav.language` rendered no glyph paths');
// SSR records component-render failures as diagnostics, so the registry throw may
// surface as an empty/absent subtree. What must not happen is a silent alias hit.
let bareHtml = '';
try {
    bareHtml = await renderToString(Icon, { name: 'language', decorative: true });
} catch {
    bareHtml = '';
}
if (glyphPaths(bareHtml)) fail('bare legacy icon name `language` must not resolve to a glyph');

console.log('ui-author-surface PASS: AppShell, Link and canonical icon-name contracts');
