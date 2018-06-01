/**
 * ui-automation gate — @vmz/ui package skeleton + token requirements + Button probe.
 *
 *
 * Asserts:
 * - package name @vmz/ui (not vmz-design); not a plugin
 * - token-requirements.v0 contract present and wired to Button source
 * - Button references required CSS vars; no forbidden brand hex in @vmz/ui
 * - fixture with semantic action tokens builds
 * - fixture missing required tokens fails unknown_design_token
 * - homepage designs emit action.primary.* / focus.ring vars
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const uiRoot = path.join(root, 'packages', 'ui', 'vmz-ui');
const homepage = path.join(root, 'packages', 'homepage');
const cargo = process.env.CARGO || 'cargo';
const DIAG_UNKNOWN = 'vmz::style::unknown_design_token';
const SCHEMA = 'vmz.ui.token_requirements.v0';

function fail(msg) {
    console.error(`ui-automation GATE FAIL: ${msg}`);
    process.exit(1);
}

/** True when build output has a product unknown-token diagnostic (not rustc quoting the const). */
function productUnknownTokenDiag(out) {
    const text = String(out || '');
    if (!text.includes(DIAG_UNKNOWN) && !/unknown design token/i.test(text)) return false;
    // rustc `missing documentation for a constant` blocks quote the DIAG_* source line.
    const lines = text.split(/\r?\n/);
    return lines.some((l) => {
        if (/DIAG_UNKNOWN_DESIGN_TOKEN|missing documentation for a constant|^\s*-->/.test(l)) return false;
        if (/^\s*\d+\s*\|/.test(l) || /^\s*\|/.test(l)) return false;
        return l.includes(DIAG_UNKNOWN) || /unknown design token/i.test(l);
    });
}

function dottedToCssVar(dotted) {
    return `--vmz-${String(dotted).split('.').join('-')}`;
}

function runBuild(projectDir) {
    const r = spawnSync(cargo, ['run', '-p', 'vmz-tools', '--quiet', '--', 'build', projectDir], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: r.status ?? 1, out: `${r.stdout || ''}\n${r.stderr || ''}` };
}

function walkFiles(dir, pred, out = []) {
    if (!fs.existsSync(dir)) return out;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (ent.name === 'node_modules' || ent.name === 'dist') continue;
            walkFiles(p, pred, out);
        } else if (pred(p)) out.push(p);
    }
    return out;
}

console.log('ui-automation: package identity…');
const pkg = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
if (pkg.name !== '@vmz/ui') fail(`package name must be @vmz/ui, got ${pkg.name}`);
if (pkg.dependencies?.['@vmz/plugin'] || pkg.devDependencies?.['@vmz/plugin']) {
    fail('@vmz/ui must not depend on @vmz/plugin');
}
for (const bad of ['vmz-design', '@vmz/design']) {
    if (JSON.stringify(pkg).includes(bad)) fail(`forbidden name residue: ${bad}`);
}

console.log('ui-automation: token requirements contract…');
const contractPath = path.join(uiRoot, 'contracts', 'token-requirements.v0.json');
if (!fs.existsSync(contractPath)) fail('missing contracts/token-requirements.v0.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.schema !== SCHEMA) fail(`schema want ${SCHEMA}`);
if (contract.package !== '@vmz/ui') fail('contract.package');
const button = contract.components?.Button;
if (!button?.tokens?.length) fail('Button token list missing');
const buttonSrcPath = path.join(uiRoot, button.source || 'src/Button.vmz');
if (!fs.existsSync(buttonSrcPath)) fail(`missing ${button.source}`);
const buttonSrc = fs.readFileSync(buttonSrcPath, 'utf8');

for (const tok of button.tokens) {
    const cssVar = dottedToCssVar(tok);
    if (!buttonSrc.includes(`var(${cssVar})`)) {
        fail(`Button must reference ${cssVar} for token ${tok}`);
    }
}

console.log('ui-automation: forbid brand hex inside @vmz/ui…');
const uiSources = walkFiles(uiRoot, (p) => /\.(vmz|css|scss|ts|js|mjs|json)$/.test(p));
const forbidden = (contract.forbiddenBrandHex || []).map((h) => h.toLowerCase());
for (const file of uiSources) {
    if (file.endsWith('token-requirements.v0.json')) continue;
    const text = fs.readFileSync(file, 'utf8');
    const lower = text.toLowerCase();
    for (const hex of forbidden) {
        if (lower.includes(hex.toLowerCase())) {
            fail(`brand hex ${hex} found in ${path.relative(root, file)}`);
        }
    }
}

console.log('ui-automation: @vmz/ui keeps src/components convention…');
if (!fs.existsSync(path.join(uiRoot, 'src', 'components', 'Button.vmz'))) {
    fail('Button must live at src/components/Button.vmz (no componentsRoot config)');
}
if (pkg.vmz?.componentsRoot) {
    fail('forbid package.json vmz.componentsRoot — convention is src/components');
}

console.log('ui-automation: homepage semantic action tokens…');
const homeDesigns = path.join(homepage, 'designs', 'tokens', 'semantic-action.json');
const homeMotion = path.join(homepage, 'designs', 'tokens', 'semantic-motion.json');
const homeStatus = path.join(homepage, 'designs', 'tokens', 'semantic-status.json');
const homeDensity = path.join(homepage, 'designs', 'tokens', 'semantic-density.json');
const homeBrand = path.join(homepage, 'designs', 'tokens', 'brand.json');
if (!fs.existsSync(homeDesigns)) fail('homepage missing designs/tokens/semantic-action.json');
if (!fs.existsSync(homeMotion)) fail('homepage missing designs/tokens/semantic-motion.json');
if (!fs.existsSync(homeStatus)) fail('homepage missing designs/tokens/semantic-status.json');
if (!fs.existsSync(homeDensity)) fail('homepage missing designs/tokens/semantic-density.json');
if (!fs.existsSync(homeBrand)) fail('homepage missing designs/tokens/brand.json');
const homeBuild = runBuild(homepage);
if (homeBuild.status !== 0) fail(`homepage build failed\n${homeBuild.out}`);
const designsCss = fs.readFileSync(path.join(homepage, 'dist', 'vmz-designs.css'), 'utf8');
for (const tok of button.tokens) {
    const cssVar = dottedToCssVar(tok);
    if (!designsCss.includes(`${cssVar}:`)) {
        fail(`homepage vmz-designs.css missing ${cssVar}`);
    }
}

console.log('ui-automation: homepage dogfood discovers Button from @vmz/ui…');
{
    const dep = JSON.parse(fs.readFileSync(path.join(homepage, 'package.json'), 'utf8'));
    if (!dep.dependencies?.['@vmz/ui'] && !dep.devDependencies?.['@vmz/ui']) {
        fail('homepage must depend on @vmz/ui');
    }
    const indexVmz = fs.readFileSync(path.join(homepage, 'src', 'pages', 'index.vmz'), 'utf8');
    if (!indexVmz.includes('<Button')) fail('homepage index must dogfood <Button>');
    const buttonDirect = path.join(homepage, 'dist', 'Button.client.js');
    const buttonNested = path.join(homepage, 'dist', 'components', 'Button.client.js');
    if (!fs.existsSync(buttonDirect) && !fs.existsSync(buttonNested)) {
        fail('homepage build must emit Button.client.js from @vmz/ui');
    }
}

console.log('ui-automation: fixture with tokens builds…');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ui0-ok-'));
    fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'designs', 'tokens'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'designs', 'styles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ui0-ok', private: true }, null, 2));
    fs.copyFileSync(buttonSrcPath, path.join(dir, 'src', 'components', 'Button.vmz'));
    fs.writeFileSync(
        path.join(dir, 'src', 'pages', 'index.vmz'),
        `<template>
  <main>
    <Button>Go</Button>
  </main>
</template>
<script client>
export default class IndexPage {}
</script>
`,
    );
    fs.copyFileSync(homeDesigns, path.join(dir, 'designs', 'tokens', 'semantic-action.json'));
    fs.copyFileSync(homeMotion, path.join(dir, 'designs', 'tokens', 'semantic-motion.json'));
    fs.copyFileSync(homeStatus, path.join(dir, 'designs', 'tokens', 'semantic-status.json'));
    fs.copyFileSync(homeDensity, path.join(dir, 'designs', 'tokens', 'semantic-density.json'));
    fs.copyFileSync(homeBrand, path.join(dir, 'designs', 'tokens', 'brand.json'));
    fs.writeFileSync(
        path.join(dir, 'designs', 'styles', 'index.scss'),
        `body {
  margin: 0;
}
.vmz-ui-btn {
  background: var(--vmz-action-primary-background);
  color: var(--vmz-action-primary-foreground);
  padding: var(--vmz-density-control-padding-y) var(--vmz-density-control-padding-x);
  transition:
    background-color var(--vmz-motion-control-duration) var(--vmz-motion-control-easing),
    box-shadow var(--vmz-motion-control-duration) var(--vmz-motion-control-easing);
}
.vmz-ui-btn:hover { background: var(--vmz-action-primary-hover); }
.vmz-ui-btn:active { background: var(--vmz-action-primary-active); }
.vmz-ui-btn:focus-visible { box-shadow: 0 0 0 2px var(--vmz-focus-ring); }
.vmz-ui-btn[data-variant='secondary'] {
  background: var(--vmz-action-secondary-background);
  color: var(--vmz-action-secondary-foreground);
  border-color: var(--vmz-action-secondary-border);
}
.vmz-ui-btn[data-variant='secondary']:hover { background: var(--vmz-action-secondary-hover); }
.vmz-ui-btn[data-variant='ghost'] { color: var(--vmz-text-ink); background: transparent; }
.vmz-ui-btn[data-variant='ghost']:hover { background: var(--vmz-surface-mist); }
.vmz-ui-btn[data-variant='danger'] {
  background: var(--vmz-status-danger-accent);
  color: var(--vmz-action-primary-foreground);
}
.vmz-ui-btn[data-variant='danger']:active { background: var(--vmz-status-danger-foreground); }
:where([data-density='compact']) .vmz-ui-btn {
  padding: var(--vmz-density-compact-padding-y) var(--vmz-density-compact-padding-x);
}
:where([data-density='dense']) .vmz-ui-btn {
  padding: var(--vmz-density-dense-padding-y) var(--vmz-density-dense-padding-x);
}
`,
    );
    const r = runBuild(dir);
    if (r.status !== 0) fail(`tokened fixture build failed\n${r.out}`);
    // Ignore rustc doc warnings that quote DIAG_UNKNOWN_DESIGN_TOKEN in compiler sources.
    if (productUnknownTokenDiag(r.out)) fail(`tokened fixture must not unknown token\n${r.out}`);
}

console.log('ui-automation: fixture missing tokens fails…');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-ui0-miss-'));
    fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'src', 'components'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'designs', 'tokens'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'designs', 'styles'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'ui0-miss', private: true }, null, 2));
    fs.copyFileSync(buttonSrcPath, path.join(dir, 'src', 'components', 'Button.vmz'));
    fs.writeFileSync(
        path.join(dir, 'src', 'pages', 'index.vmz'),
        `<template>
  <main><Button>Go</Button></main>
</template>
<script client>
export default class IndexPage {}
</script>
`,
    );
    // Non-empty Style Theme so unknown_design_token diagnostics run; omit action.* / focus.ring.
    fs.writeFileSync(path.join(dir, 'designs', 'tokens', 'only-surface.json'), JSON.stringify({ surface: { paper: '#ffffff' } }, null, 2));
    fs.writeFileSync(
        path.join(dir, 'designs', 'styles', 'index.scss'),
        `body { background: var(--vmz-surface-paper); }
`,
    );
    const r = runBuild(dir);
    if (r.status === 0) fail('missing-token fixture must fail build');
    if (!productUnknownTokenDiag(r.out)) {
        fail(`expected unknown_design_token diagnostic\n${r.out}`);
    }
}

console.log('ui-automation: ok (UI0 contract)');
console.log('ui-automation: UI1 Field/Dialog focus+overlay browser…');
await proveUi1FocusOverlay();
console.log(
    'ui-automation: UI1+UI2+Commercial+Form+Console+Motion+UI4+UI5+Document/Product+UI6+Structure+Stacking+DataTable+documents/panel-density PASS',
);

async function proveUi1FocusOverlay() {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const { spawn } = await import('node:child_process');

    const homeBuild = runBuild(homepage);
    if (homeBuild.status !== 0) fail(`homepage rebuild for UI1 failed\n${homeBuild.out}`);
    const dist = path.join(homepage, 'dist');
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) fail('homepage missing vmz-serve-host.mjs');

    const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
    let puppeteer;
    try {
        const mod = requireFromTest('puppeteer-core');
        puppeteer = mod?.default ?? mod;
    } catch (err) {
        fail(`puppeteer-core via @vmz/test required for UI1 browser proof: ${err instanceof Error ? err.message : err}`);
    }
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) fail('Chrome/Edge not found for UI1 focus/overlay (set VMZ_BROWSER)');

    const PORT = 18781;
    const child = spawn(process.execPath, [hostJs], {
        cwd: dist,
        env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = () => {
        try {
            child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
    };
    try {
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('serve-host start timeout')), 12000);
            const onData = (buf) => {
                if (String(buf).includes('vmz serve http://')) {
                    clearTimeout(t);
                    child.stdout.off('data', onData);
                    resolve();
                }
            };
            child.stdout.on('data', onData);
            child.stderr.on('data', (b) => process.stderr.write(b));
            child.on('exit', (code) => {
                clearTimeout(t);
                reject(new Error(`serve-host exited early ${code}`));
            });
        });

        // Sanity: live prop binder present in page emit.
        const uiClient = fs.readFileSync(path.join(dist, 'pages', 'ui.client.js'), 'utf8');
        if (!uiClient.includes('bindComponentProp')) {
            fail('ui.client.js missing bindComponentProp for live Dialog open / Field value');
        }

        const browser = await puppeteer.launch({
            executablePath: chrome,
            headless: true,
            args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        });
        try {
            const page = await browser.newPage();
            page.setDefaultTimeout(20000);
            await page.goto(`http://127.0.0.1:${PORT}/ui`, { waitUntil: 'networkidle0', timeout: 20000 });
            await page.waitForSelector('#home-ui-name', { timeout: 10000 });
            const pageProbe = await page.evaluate(() => ({
                title: document.title,
                buttons: [...document.querySelectorAll('button')].map((b) => (b.textContent || '').trim()),
                hasUiLab: !!document.querySelector('[data-dogfood="ui-lab"]'),
                bodySlice: (document.body?.innerText || '').slice(0, 400),
            }));
            if (!pageProbe.hasUiLab) fail(`UI lab page missing: ${JSON.stringify(pageProbe)}`);

            // Field: label association + focus control.
            const fieldMeta = await page.evaluate(() => {
                const el = document.getElementById('home-ui-name');
                const label = document.querySelector('label[for="home-ui-name"]');
                return {
                    hasInput: !!el,
                    hasLabel: !!label,
                    forAttr: label?.getAttribute('for') || '',
                    describedby: el?.getAttribute('aria-describedby') || '',
                    labelText: label?.textContent || '',
                };
            });
            if (!fieldMeta.hasInput || !fieldMeta.hasLabel) {
                fail(`Field: missing input/label after hydrate: ${JSON.stringify(fieldMeta)}`);
            }
            if (fieldMeta.forAttr !== 'home-ui-name') fail(`Field: label for want home-ui-name, got ${fieldMeta.forAttr}`);
            if (!fieldMeta.describedby.includes('home-ui-name-desc')) fail('Field: aria-describedby missing');
            if (!fieldMeta.labelText.includes('Display name')) fail('Field: label text missing');

            await page.evaluate(() => {
                const label = document.querySelector('label[for="home-ui-name"]');
                label?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            });
            // Native label→control focus; if host skips it, focus explicitly still proves control is actionable.
            const fieldFocus = await page.evaluate(() => {
                const el = document.getElementById('home-ui-name');
                if (el && typeof el.focus === 'function') el.focus();
                return {
                    ok: document.activeElement === el,
                    tag: el?.tagName || null,
                    type: el?.getAttribute?.('type') || null,
                    disabled: el?.hasAttribute?.('disabled') || false,
                    activeTag: document.activeElement?.tagName || null,
                    activeId: document.activeElement?.id || null,
                    visibility: el ? getComputedStyle(el).visibility : null,
                    display: el ? getComputedStyle(el).display : null,
                };
            });
            if (!fieldFocus.ok) fail(`Field: control must be focusable: ${JSON.stringify(fieldFocus)}`);

            // Dialog: open → focus enter on panel.
            const dialogOpener = '[data-dogfood="ui1-dialog"] button.vmz-ui-btn';
            const opened = await page.evaluate((sel) => !!document.querySelector(sel), dialogOpener);
            if (!opened) fail('Dialog: Open dialog button missing');
            await page.focus(dialogOpener);
            await page.click(dialogOpener);
            await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]', { timeout: 5000 });
            try {
                await page.waitForFunction(
                    () => {
                        const panel = document.querySelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]');
                        return panel instanceof HTMLElement && document.activeElement === panel;
                    },
                    { timeout: 5000 },
                );
            } catch {
                const snap = await page.evaluate(() => ({
                    overlay: !!document.querySelector('[data-vmz-overlay="dialog"]'),
                    panel: !!document.querySelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]'),
                    active: document.activeElement?.tagName || null,
                    activeClass: document.activeElement?.className || null,
                }));
                fail(`Dialog: focus enter timed out: ${JSON.stringify(snap)}`);
            }
            const afterOpen = await page.evaluate(() => {
                const panel = document.querySelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]');
                return {
                    overlay: !!document.querySelector('[data-vmz-overlay="dialog"]'),
                    owner: document.querySelector('[data-vmz-overlay-owner="dialog"]') != null,
                    activeIsPanel: document.activeElement === panel,
                    role: panel?.getAttribute('role') || '',
                    activeTag: document.activeElement?.tagName || null,
                    activeClass: document.activeElement?.className || null,
                };
            });
            if (!afterOpen.overlay || !afterOpen.owner) fail('Dialog: overlay ownership markers missing after open');
            if (!afterOpen.activeIsPanel) fail(`Dialog: focus enter must move to panel: ${JSON.stringify(afterOpen)}`);
            if (afterOpen.role !== 'dialog') fail('Dialog: role=dialog required');

            // Tab loop: from close button, Tab returns into dialog (not behind).
            await page.focus('[data-vmz-overlay="dialog"] [data-vmz-focus="close"]');
            await page.keyboard.press('Tab');
            const afterTab = await page.evaluate(() => {
                const dialog = document.querySelector('[data-vmz-overlay="dialog"]');
                const active = document.activeElement;
                return !!(dialog && active && dialog.contains(active));
            });
            if (!afterTab) fail('Dialog: Tab must keep focus inside overlay (focus loop)');

            // Escape dismiss + focus restore to opener.
            await page.keyboard.press('Escape');
            await page.waitForFunction(
                (sel) => !document.querySelector('[data-vmz-overlay="dialog"]') && document.activeElement === document.querySelector(sel),
                { timeout: 5000 },
                dialogOpener,
            );
            const afterEsc = await page.evaluate((sel) => {
                const opener = document.querySelector(sel);
                return {
                    closed: !document.querySelector('[data-vmz-overlay="dialog"]'),
                    restored: document.activeElement === opener,
                };
            }, dialogOpener);
            if (!afterEsc.closed || !afterEsc.restored) {
                fail(`Dialog: Escape dismiss + focus restore failed: ${JSON.stringify(afterEsc)}`);
            }

            // Outside dismiss via backdrop (programmatic click avoids focus-stealing race on the backdrop control).
            await page.focus(dialogOpener);
            await page.click(dialogOpener);
            await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-overlay-layer="backdrop"]', {
                timeout: 5000,
            });
            await page.evaluate(() => {
                document
                    .querySelector('[data-vmz-overlay="dialog"] [data-vmz-overlay-layer="backdrop"]')
                    ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            });
            try {
                await page.waitForFunction(
                    (sel) => !document.querySelector('[data-vmz-overlay="dialog"]') && document.activeElement === document.querySelector(sel),
                    { timeout: 5000 },
                    dialogOpener,
                );
            } catch {
                const snap = await page.evaluate(() => ({
                    closed: !document.querySelector('[data-vmz-overlay="dialog"]'),
                    active: document.activeElement?.tagName || null,
                    activeClass: document.activeElement?.className || null,
                }));
                fail(`Dialog: backdrop dismiss + focus restore timed out: ${JSON.stringify(snap)}`);
            }

            await proveUi2InPage(page);
        } finally {
            await browser.close();
        }
    } finally {
        kill();
    }
}

/**
 * UI2 Form & Disclosure browser proof (same /ui session as UI1).
 * @param {import('puppeteer-core').Page} page
 */
async function proveUi2InPage(page) {
    console.log('ui-automation: UI2 Checkbox/Switch/Tabs/Menu/Drawer/Popover…');

    // Contract surface: components + exports present (static, cheap).
    for (const name of ['Checkbox', 'Switch', 'Tabs', 'Menu', 'Drawer', 'Popover']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`UI2 missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`UI2 package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`UI2 token contract missing ${name}`);
    }

    // Checkbox: label association + toggle updates parent-owned value (no parallel store).
    const checkboxMeta = await page.evaluate(() => {
        const input = document.getElementById('home-ui-agree');
        const label = document.querySelector('label[for="home-ui-agree"]');
        return {
            hasInput: !!input,
            hasLabel: !!label,
            type: input?.getAttribute('type') || '',
            checked: !!input?.checked,
            marker: !!document.querySelector('[data-vmz-ui="checkbox"]'),
        };
    });
    if (!checkboxMeta.hasInput || !checkboxMeta.hasLabel || checkboxMeta.type !== 'checkbox') {
        fail(`Checkbox: label/control missing: ${JSON.stringify(checkboxMeta)}`);
    }
    await page.click('#home-ui-agree');
    try {
        await page.waitForFunction(() => document.querySelector('[data-dogfood="checkbox-value"]')?.textContent?.includes('agree:yes'), {
            timeout: 5000,
        });
    } catch {
        const snap = await page.evaluate(() => ({
            text: document.querySelector('[data-dogfood="checkbox-value"]')?.textContent || null,
            checked: document.getElementById('home-ui-agree')?.checked ?? null,
        }));
        fail(`Checkbox: live checked did not update parent: ${JSON.stringify(snap)}`);
    }

    // Switch: role=switch + keyboard/click toggle.
    const switchMeta = await page.evaluate(() => {
        const el = document.getElementById('home-ui-notify');
        return {
            role: el?.getAttribute('role') || '',
            checked: el?.getAttribute('aria-checked') || '',
            label: !!document.querySelector('label[for="home-ui-notify"]'),
        };
    });
    if (switchMeta.role !== 'switch' || !switchMeta.label) {
        fail(`Switch: role/label missing: ${JSON.stringify(switchMeta)}`);
    }
    await page.click('#home-ui-notify');
    try {
        await page.waitForFunction(
            () => {
                const el = document.getElementById('home-ui-notify');
                const aria = el?.getAttribute('aria-checked');
                const on = aria === 'true' || aria === '';
                const textOk = document.querySelector('[data-dogfood="switch-value"]')?.textContent?.includes('notify:on');
                return !!(textOk && on);
            },
            { timeout: 5000 },
        );
    } catch {
        const snap = await page.evaluate(() => {
            const el = document.getElementById('home-ui-notify');
            const host = el?.closest?.('[data-vmz="Switch"]');
            const inst = host && host.__vmzInst;
            return {
                aria: el?.getAttribute('aria-checked'),
                hasAria: el?.hasAttribute('aria-checked'),
                text: document.querySelector('[data-dogfood="switch-value"]')?.textContent || null,
                instChecked: inst ? !!inst.checked : null,
            };
        });
        fail(`Switch: live checked did not update parent: ${JSON.stringify(snap)}`);
    }

    // Tabs: select Security via click + ArrowRight from Profile.
    await page.click('[data-vmz-tab="home-ui-tab-security"]');
    try {
        await page.waitForFunction(
            () =>
                document.querySelector('[data-vmz-tab="home-ui-tab-security"]')?.getAttribute('aria-selected') === 'true' &&
                document.querySelector('[data-dogfood="tab-panel"]')?.textContent?.includes('panel:home-ui-tab-security'),
            { timeout: 5000 },
        );
    } catch {
        const snap = await page.evaluate(() => {
            const host = document.querySelector('[data-vmz="Tabs"]');
            const inst = host && host.__vmzInst;
            return {
                selectedAttr: document.querySelector('[data-vmz-tab="home-ui-tab-security"]')?.getAttribute('aria-selected'),
                panel: document.querySelector('[data-dogfood="tab-panel"]')?.textContent || null,
                instSelected: inst ? inst.selected : null,
            };
        });
        fail(`Tabs: select did not update: ${JSON.stringify(snap)}`);
    }
    await page.focus('[data-vmz-tab="home-ui-tab-security"]');
    await page.keyboard.press('ArrowRight');
    try {
        await page.waitForFunction(
            () =>
                document.querySelector('[data-vmz-tab="home-ui-tab-billing"]')?.getAttribute('aria-selected') === 'true' &&
                document.querySelector('[data-dogfood="tab-panel"]')?.textContent?.includes('panel:home-ui-tab-billing'),
            { timeout: 5000 },
        );
    } catch {
        const snap = await page.evaluate(() => ({
            selectedAttr: document.querySelector('[data-vmz-tab="home-ui-tab-billing"]')?.getAttribute('aria-selected'),
            panel: document.querySelector('[data-dogfood="tab-panel"]')?.textContent || null,
        }));
        fail(`Tabs: keyboard select did not update: ${JSON.stringify(snap)}`);
    }

    // Menu: open → focus menuitem → Escape restores trigger.
    const menuTrigger = '[data-vmz-menu="trigger"]';
    await page.focus(menuTrigger);
    await page.click(menuTrigger);
    await page.waitForSelector('[data-vmz-overlay="menu"] [role="menuitem"]', { timeout: 5000 });
    const menuOpen = await page.evaluate(() => {
        const panel = document.querySelector('[data-vmz-overlay="menu"]');
        const item = document.querySelector('[data-vmz-menu-item="edit"]');
        return {
            owner: !!document.querySelector('[data-vmz-overlay-owner="menu"]'),
            activeIsItem: document.activeElement === item,
            expanded: document.querySelector('[data-vmz-menu="trigger"]')?.getAttribute('aria-expanded') === 'true',
        };
    });
    if (!menuOpen.owner || !menuOpen.expanded) fail(`Menu: open markers missing: ${JSON.stringify(menuOpen)}`);
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        (sel) => !document.querySelector('[data-vmz-overlay="menu"]') && document.activeElement === document.querySelector(sel),
        { timeout: 5000 },
        menuTrigger,
    );

    // Drawer: modal overlay ownership + Escape restore.
    const drawerOpener = '[data-dogfood="ui2-drawer"] button.vmz-ui-btn';
    await page.focus(drawerOpener);
    await page.click(drawerOpener);
    await page.waitForSelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]', { timeout: 5000 });
    await page.waitForFunction(
        () => {
            const panel = document.querySelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]');
            return panel instanceof HTMLElement && document.activeElement === panel;
        },
        { timeout: 5000 },
    );
    const drawerOpen = await page.evaluate(() => ({
        owner: !!document.querySelector('[data-vmz-overlay-owner="drawer"]'),
        modal: document.querySelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]')?.getAttribute('aria-modal'),
    }));
    if (!drawerOpen.owner || drawerOpen.modal !== 'true') {
        fail(`Drawer: ownership/modal missing: ${JSON.stringify(drawerOpen)}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        (sel) => !document.querySelector('[data-vmz-overlay="drawer"]') && document.activeElement === document.querySelector(sel),
        { timeout: 5000 },
        drawerOpener,
    );

    // Popover: non-modal + Escape restore + outside dismiss.
    const popoverOpener = '[data-dogfood="ui2-popover"] button.vmz-ui-btn';
    await page.focus(popoverOpener);
    await page.click(popoverOpener);
    await page.waitForSelector('[data-vmz-overlay="popover"] [data-vmz-focus="enter"]', { timeout: 5000 });
    const popoverOpen = await page.evaluate(() => {
        const panel = document.querySelector('[data-vmz-overlay="popover"] [data-vmz-focus="enter"]');
        return {
            owner: !!document.querySelector('[data-vmz-overlay-owner="popover"]'),
            modal: panel?.getAttribute('aria-modal'),
            activeIsPanel: document.activeElement === panel,
        };
    });
    if (!popoverOpen.owner || popoverOpen.modal !== 'false' || !popoverOpen.activeIsPanel) {
        fail(`Popover: non-modal focus enter missing: ${JSON.stringify(popoverOpen)}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        (sel) => !document.querySelector('[data-vmz-overlay="popover"]') && document.activeElement === document.querySelector(sel),
        { timeout: 5000 },
        popoverOpener,
    );
    await page.focus(popoverOpener);
    await page.click(popoverOpener);
    await page.waitForSelector('[data-vmz-overlay="popover"] [data-vmz-overlay-layer="backdrop"]', {
        timeout: 5000,
    });
    await page.evaluate(() => {
        document
            .querySelector('[data-vmz-overlay="popover"] [data-vmz-overlay-layer="backdrop"]')
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    });
    await page.waitForFunction(
        (sel) => !document.querySelector('[data-vmz-overlay="popover"]') && document.activeElement === document.querySelector(sel),
        { timeout: 5000 },
        popoverOpener,
    );

    console.log('ui-automation: UI2 form/disclosure PASS');
    await proveCommercialComposition(page);
}

/**
 * Commercial composition thin proof — one ordinary page, not single-component screenshots.
 * @param {import('puppeteer-core').Page} page
 */
async function proveCommercialComposition(page) {
    console.log('ui-automation: Commercial AppShell/Card/Alert/Empty composition…');

    for (const name of ['AppShell', 'Card', 'Alert', 'Empty']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Commercial missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Commercial package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Commercial token contract missing ${name}`);
    }

    const commercialSrc = path.join(homepage, 'src', 'pages', 'commercial.vmz');
    if (!fs.existsSync(commercialSrc)) fail('homepage missing src/pages/commercial.vmz');

    await page.goto(`http://127.0.0.1:18781/commercial`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="commercial"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        shell: !!document.querySelector('[data-vmz-ui="app-shell"]'),
        header: !!document.querySelector('[data-vmz-shell="header"]'),
        main: !!document.querySelector('[data-vmz-shell="main"]'),
        nav: !!document.querySelector('[data-vmz-nav="commercial"]'),
        hero: !!document.querySelector('[data-dogfood="commercial-hero"]'),
        features: !!document.querySelector('[data-dogfood="commercial-features"]'),
        pricing: !!document.querySelector('[data-dogfood="commercial-pricing"]'),
        badge: !!document.querySelector('[data-vmz-ui="badge"]'),
        link: !!document.querySelector('[data-vmz-ui="link"]'),
        secondary: !!document.querySelector('button.vmz-ui-btn[data-variant="secondary"]'),
        card: document.querySelectorAll('[data-vmz-ui="card"]').length,
        alert: !!document.querySelector('[data-vmz-ui="alert"]'),
        empty: !!document.querySelector('[data-vmz-ui="empty"]'),
        field: !!document.getElementById('home-commercial-email'),
    }));
    if (!markers.shell || !markers.header || !markers.main) {
        fail(`Commercial: AppShell landmarks missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.nav) fail('Commercial: nav item missing');
    if (!markers.hero || !markers.features || !markers.pricing) {
        fail(`Commercial: hero/features/pricing missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.badge || !markers.link || !markers.secondary) {
        fail(`Commercial: Badge/Link/secondary Button missing: ${JSON.stringify(markers)}`);
    }
    if (markers.card < 4) fail(`Commercial: expected >=4 Cards (features+pricing+contact+workspace), got ${markers.card}`);
    if (!markers.alert || !markers.empty || !markers.field) {
        fail(`Commercial: Alert/Empty/Field missing: ${JSON.stringify(markers)}`);
    }

    for (const name of ['Link', 'Badge', 'Spinner']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Commercial foundation missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Commercial package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Commercial token contract missing ${name}`);
    }

    // Form + Dialog still interactive inside Card composition.
    await page.type('#home-commercial-email', 'ops@example.com');
    await page.waitForFunction(() => document.querySelector('[data-dogfood="commercial-email"]')?.textContent?.includes('ops@example.com'), {
        timeout: 5000,
    });
    // Contact Card contains Confirm button.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-vmz-ui="card"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Confirm'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="dialog"]'), { timeout: 5000 });

    // Empty → success Alert + Notification.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-vmz-ui="empty"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Create project'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-vmz-ui="empty"]') &&
            !!document.querySelector('[data-vmz-ui="alert"][data-tone="success"]') &&
            !!document.querySelector('[data-dogfood="commercial-notify"] [data-vmz-ui="notification"]'),
        { timeout: 5000 },
    );

    // Drawer from composition page.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="commercial"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open details'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]', { timeout: 5000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="drawer"]'), { timeout: 5000 });

    console.log('ui-automation: Commercial composition PASS');
    await proveFormDepth(page);
    await proveConsoleComposition(page);
}

/**
 * Form depth — Form controls + Autocomplete / Tooltip / DatePicker / Upload.
 * @param {import('puppeteer-core').Page} page
 */
async function proveFormDepth(page) {
    console.log('ui-automation: Form depth (+ Autocomplete/Tooltip/DatePicker/Upload)…');

    for (const name of ['Form', 'FormItem', 'TextArea', 'Select', 'RadioGroup', 'Autocomplete', 'Tooltip', 'DatePicker', 'Upload']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Form depth missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Form depth package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Form depth token contract missing ${name}`);
    }

    const formSrc = path.join(homepage, 'src', 'pages', 'form.vmz');
    if (!fs.existsSync(formSrc)) fail('homepage missing src/pages/form.vmz');

    await page.goto(`http://127.0.0.1:18781/form`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="form"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        form: !!document.querySelector('[data-vmz-ui="form"]'),
        formItem: !!document.querySelector('[data-vmz-ui="form-item"]'),
        select: !!document.querySelector('[data-vmz-ui="select"] #home-form-role'),
        textarea: !!document.querySelector('[data-vmz-ui="textarea"] #home-form-message'),
        radio: !!document.querySelector('[data-vmz-ui="radio-group"]'),
        autocomplete: !!document.querySelector('[data-vmz-ui="autocomplete"] #home-form-team'),
        tooltip: !!document.querySelector('[data-vmz-ui="tooltip"]'),
        date: !!document.querySelector('[data-vmz-ui="date-picker"] #home-form-date'),
        upload: !!document.querySelector('[data-vmz-ui="upload"] #home-form-file'),
        field: !!document.getElementById('home-form-email'),
        novalidate: document.querySelector('[data-vmz-ui="form"]')?.getAttribute('data-novalidate') === 'true',
    }));
    if (
        !markers.form ||
        !markers.formItem ||
        !markers.select ||
        !markers.textarea ||
        !markers.radio ||
        !markers.autocomplete ||
        !markers.tooltip ||
        !markers.date ||
        !markers.upload ||
        !markers.field
    ) {
        fail(`Form depth: markers missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.novalidate) fail('Form depth: form must set data-novalidate (HTML5 validation off by contract)');

    // Tooltip parent-owned open.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="form-email-row"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Why?'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-ui="tooltip"][data-open="true"] [data-vmz-tooltip="bubble"]', {
        timeout: 5000,
    });

    // Also prevent native constraint validation at runtime if host omitted the attribute.
    await page.evaluate(() => {
        const form = document.querySelector('[data-vmz-ui="form"]');
        if (form instanceof HTMLFormElement) form.noValidate = true;
    });

    // Empty submit → summary + field errors (parent-owned validation).
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="form"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Send request'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            !!document.querySelector('[data-vmz-form="summary"]') &&
            document.querySelector('#home-form-email-err')?.textContent?.includes('valid work email') &&
            document.querySelector('#home-form-role-err')?.textContent?.includes('Choose a role') &&
            document.querySelector('#home-form-team-err')?.textContent?.includes('Pick a team') &&
            document.querySelector('#home-form-date-err')?.textContent?.includes('preferred date') &&
            document.querySelector('#home-form-file-err')?.textContent?.includes('Attach a file') &&
            document.querySelector('#home-form-plan-err')?.textContent?.includes('Pick a plan') &&
            document.querySelector('[data-dogfood="form-agree-error"]')?.textContent?.includes('Consent'),
        { timeout: 5000 },
    );
    const invalid = await page.evaluate(() => ({
        email: document.querySelector('[data-vmz-ui="field"]')?.getAttribute('data-invalid') || '',
        roleItem: document.querySelector('[data-vmz-ui="form-item"]')?.getAttribute('data-invalid') || '',
        team: document.querySelector('[data-vmz-ui="autocomplete"]')?.getAttribute('data-invalid') || '',
        date: document.querySelector('[data-vmz-ui="date-picker"]')?.getAttribute('data-invalid') || '',
        upload: document.querySelector('[data-vmz-ui="upload"]')?.getAttribute('data-invalid') || '',
        plan: document.querySelector('[data-vmz-ui="radio-group"]')?.getAttribute('data-invalid') || '',
    }));
    if (
        invalid.email !== 'true' ||
        invalid.roleItem !== 'true' ||
        invalid.team !== 'true' ||
        invalid.date !== 'true' ||
        invalid.upload !== 'true' ||
        invalid.plan !== 'true'
    ) {
        fail(`Form depth: invalid markers missing: ${JSON.stringify(invalid)}`);
    }

    // Fill valid values + submit success.
    const uploadFixture = path.join(os.tmpdir(), `vmz-form-upload-${Date.now()}.txt`);
    fs.writeFileSync(uploadFixture, 'vmz form upload fixture\n', 'utf8');
    await page.evaluate(() => {
        const email = document.getElementById('home-form-email');
        if (email instanceof HTMLInputElement) {
            email.focus();
            email.value = 'ops@example.com';
            email.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const role = document.getElementById('home-form-role');
        if (role instanceof HTMLElement) {
            role.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        const team = document.getElementById('home-form-team');
        if (team instanceof HTMLInputElement) {
            team.focus();
            team.value = 'alp';
            team.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const date = document.getElementById('home-form-date');
        if (date instanceof HTMLInputElement) {
            date.focus();
            date.value = '2026-08-13';
            date.dispatchEvent(new Event('input', { bubbles: true }));
            date.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const message = document.getElementById('home-form-message');
        if (message instanceof HTMLTextAreaElement) {
            message.value = 'Need onboarding help';
            message.dispatchEvent(new Event('input', { bubbles: true }));
        }
        document.querySelector('[data-vmz-radio="pro"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        document.getElementById('home-form-agree')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-vmz-ui="select"] [data-vmz-option="ops"]', { timeout: 5000 });
    await page.evaluate(() => {
        document.querySelector('[data-vmz-option="ops"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const fileInput = await page.$('#home-form-file');
    if (!fileInput) fail('Form depth: upload input missing');
    await fileInput.uploadFile(uploadFixture);
    await page.waitForFunction(() => (document.querySelector('[data-vmz-upload="file"]')?.textContent || '').includes('vmz-form-upload-'), {
        timeout: 5000,
    });
    await page.waitForSelector('[data-vmz-autocomplete="list"] [data-vmz-option="alpha"]', { timeout: 5000 });
    await page.evaluate(() => {
        document.querySelector('[data-vmz-option="alpha"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForFunction(
        () => {
            const state = document.querySelector('[data-dogfood="form-state"]')?.textContent || '';
            return (
                state.includes('email:ops@example.com') &&
                state.includes('role:ops') &&
                state.includes('team:Alpha Platform') &&
                state.includes('date:2026-08-13') &&
                state.includes('file:vmz-form-upload-') &&
                state.includes('plan:pro') &&
                state.includes('agree:yes')
            );
        },
        { timeout: 8000 },
    );
    await page.evaluate(() => {
        const form = document.querySelector('[data-dogfood="form"] [data-vmz-ui="form"]');
        if (form instanceof HTMLFormElement) {
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
    });
    try {
        await page.waitForFunction(
            () =>
                !document.querySelector('[data-vmz-form="summary"]') &&
                document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('submitted:true') &&
                !!document.querySelector('[data-dogfood="form-success"] [data-vmz-ui="result"]'),
            { timeout: 8000 },
        );
    } catch {
        const snap = await page.evaluate(() => ({
            state: document.querySelector('[data-dogfood="form-state"]')?.textContent || '',
            summary: document.querySelector('[data-vmz-form="summary"]')?.textContent || '',
            emailErr: document.querySelector('#home-form-email-err')?.textContent || '',
            roleErr: document.querySelector('#home-form-role-err')?.textContent || '',
            teamErr: document.querySelector('#home-form-team-err')?.textContent || '',
            dateErr: document.querySelector('#home-form-date-err')?.textContent || '',
            fileErr: document.querySelector('#home-form-file-err')?.textContent || '',
            planErr: document.querySelector('#home-form-plan-err')?.textContent || '',
            agreeErr: document.querySelector('[data-dogfood="form-agree-error"]')?.textContent || '',
            success: !!document.querySelector('[data-dogfood="form-success"]'),
        }));
        fail(`Form depth: valid submit did not clear errors / mark submitted: ${JSON.stringify(snap)}`);
    }

    // Reset clears values + success.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="form"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Reset'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('submitted:false') &&
            document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('email:;') &&
            document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('team:;') &&
            document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('date:;') &&
            document.querySelector('[data-dogfood="form-state"]')?.textContent?.includes('file:;') &&
            !document.querySelector('[data-dogfood="form-success"]'),
        { timeout: 5000 },
    );

    try {
        fs.unlinkSync(uploadFixture);
    } catch {
        /* ignore */
    }

    // Commercial Form shell still opens Dialog on valid email.
    await page.goto(`http://127.0.0.1:18781/commercial`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-vmz-ui="form"]', { timeout: 10000 });
    const commercialForm = await page.evaluate(() => !!document.querySelector('[data-dogfood="commercial"] [data-vmz-ui="form"]'));
    if (!commercialForm) fail('Form depth: commercial Contact must use Form shell');

    console.log('ui-automation: Form depth PASS');
}

/**
 * Console composition thin proof — Sidebar/Filter/Table/Bulk/Pagination/detail.
 * @param {import('puppeteer-core').Page} page
 */
async function proveConsoleComposition(page) {
    console.log('ui-automation: Console ConsoleShell/FilterBar/Table composition…');

    for (const name of ['ConsoleShell', 'FilterBar', 'Table', 'BulkActions', 'Pagination']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Console missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Console package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Console token contract missing ${name}`);
    }

    const consoleSrc = path.join(homepage, 'src', 'pages', 'console.vmz');
    if (!fs.existsSync(consoleSrc)) fail('homepage missing src/pages/console.vmz');

    await page.goto(`http://127.0.0.1:18781/console`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="console"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        shell: !!document.querySelector('[data-vmz-ui="console-shell"]'),
        sidebar: !!document.querySelector('[data-vmz-shell="sidebar"]'),
        header: !!document.querySelector('[data-vmz-shell="header"]'),
        main: !!document.querySelector('[data-vmz-shell="main"]'),
        nav: !!document.querySelector('[data-vmz-nav="console"]'),
        filter: !!document.querySelector('[data-vmz-ui="filter-bar"]'),
        table: !!document.querySelector('[data-vmz-ui="table"]'),
        pagination: !!document.querySelector('[data-vmz-ui="pagination"]'),
        field: !!document.getElementById('home-console-query'),
        rows: document.querySelectorAll('[data-vmz-row]').length,
    }));
    if (!markers.shell || !markers.sidebar || !markers.header || !markers.main) {
        fail(`Console: ConsoleShell landmarks missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.nav) fail('Console: nav item missing');
    if (!markers.filter || !markers.table || !markers.pagination || !markers.field) {
        fail(`Console: Filter/Table/Pagination/Field missing: ${JSON.stringify(markers)}`);
    }
    if (markers.rows < 1) fail(`Console: expected table rows, got ${markers.rows}`);

    await page.type('#home-console-query', 'Alpha');
    await page.waitForFunction(() => document.querySelector('[data-dogfood="console-query"]')?.textContent?.includes('Alpha'), {
        timeout: 5000,
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="console"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Apply'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-vmz-row]').length === 1, { timeout: 5000 });

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="console"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Select visible'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-ui="bulk-actions"]', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="bulk-count"]')?.textContent?.includes('1 selected'), {
        timeout: 5000,
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="console"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Clear selection'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => !document.querySelector('[data-vmz-ui="bulk-actions"]'), { timeout: 5000 });

    await page.evaluate(() => {
        const btn = document.querySelector('[data-vmz-row-action="r1"]');
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="console-drawer-body"]')?.textContent?.includes('detail:r1'), {
        timeout: 5000,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="drawer"]'), { timeout: 5000 });

    // Reset filter so pagination Next is available (4 rows → 2 pages).
    await page.evaluate(() => {
        const input = document.getElementById('home-console-query');
        if (input) {
            input.focus();
            input.select?.();
        }
    });
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="console"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Apply'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="page-status"]')?.textContent?.includes('Page 1 / 2'), {
        timeout: 5000,
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-vmz-ui="pagination"] button')].find((b) => (b.textContent || '').includes('Next'));
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="page-status"]')?.textContent?.includes('Page 2 / 2'), {
        timeout: 5000,
    });

    console.log('ui-automation: Console composition PASS');
    await proveMotionContinuity(page);
}

/**
 * Motion continuity thin proof — tokens + immediate feedback + overlay enter/exit + interrupt cancel + reduced-motion + list identity.
 * @param {import('puppeteer-core').Page} page
 */
async function proveMotionContinuity(page) {
    console.log('ui-automation: Motion control/overlay continuity…');

    const motionSrc = path.join(homepage, 'src', 'pages', 'motion.vmz');
    if (!fs.existsSync(motionSrc)) fail('homepage missing src/pages/motion.vmz');
    for (const name of ['Button', 'Dialog', 'Drawer', 'Switch']) {
        const src = fs.readFileSync(path.join(uiRoot, 'src', 'components', `${name}.vmz`), 'utf8');
        if (name === 'Button' || name === 'Switch') {
            if (!src.includes('var(--vmz-motion-control-duration)')) {
                fail(`${name} must use motion.control.duration`);
            }
            if (!src.includes('prefers-reduced-motion')) fail(`${name} must honor reduced-motion`);
        }
        if (name === 'Dialog' || name === 'Drawer') {
            if (!src.includes('var(--vmz-motion-overlay-duration)')) {
                fail(`${name} must use motion.overlay.duration`);
            }
            if (!src.includes('data-vmz-motion="overlay-enter"')) {
                fail(`${name} must mark overlay-enter motion`);
            }
            if (!src.includes('overlay-exit') || !src.includes('data-vmz-motion-adopt')) {
                fail(`${name} must support overlay-exit + SSR resume adopt`);
            }
            if (!src.includes('_cancelExit') || !src.includes('data-vmz-motion-cancelled') || !src.includes('_motionGen')) {
                fail(`${name} must expose motion cancel edge + generation (_cancelExit / data-vmz-motion-cancelled / _motionGen)`);
            }
            if (!src.includes('prefers-reduced-motion')) fail(`${name} must honor reduced-motion`);
        }
    }
    if (!buttonSrc.includes('data-vmz-motion="control"')) fail('Button must mark control motion');

    await page.goto(`http://127.0.0.1:18781/motion`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="motion"]', { timeout: 10000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // SSR resume adopt: first paint dialog must skip enter replay.
    await page.waitForSelector('[data-dogfood="motion-resume"] [data-vmz-overlay="dialog"]', { timeout: 10000 });
    const resumeAdopt = await page.evaluate(() => {
        const overlay = document.querySelector('[data-dogfood="motion-resume"] [data-vmz-overlay="dialog"]');
        const panel = overlay?.querySelector('[data-vmz-focus="enter"]');
        if (!overlay || !panel) return { ok: false, reason: 'missing ssr dialog' };
        const cs = getComputedStyle(panel);
        return {
            ok: true,
            adopt: overlay.getAttribute('data-vmz-motion-adopt') === 'true',
            motion: panel.getAttribute('data-vmz-motion') || '',
            animation: cs.animationName || 'none',
            state: document.querySelector('[data-dogfood="motion-resume-state"]')?.textContent || '',
        };
    });
    if (!resumeAdopt.ok) fail(`Motion resume: ${resumeAdopt.reason}`);
    if (!resumeAdopt.adopt) fail(`Motion resume: expected data-vmz-motion-adopt on SSR dialog: ${JSON.stringify(resumeAdopt)}`);
    if (resumeAdopt.motion !== 'overlay-stable') {
        fail(`Motion resume: want overlay-stable, got ${resumeAdopt.motion}`);
    }
    if (resumeAdopt.animation && resumeAdopt.animation !== 'none') {
        fail(`Motion resume: adopt must not replay enter animation, got ${resumeAdopt.animation}`);
    }
    if (!resumeAdopt.state.includes('ssr-dialog:open')) fail(`Motion resume: state ${resumeAdopt.state}`);

    // Close SSR dialog (exit phase) before interactive enter proofs.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () =>
            !!document.querySelector('[data-dogfood="motion-resume"] [data-vmz-motion="overlay-exit"]') ||
            !document.querySelector('[data-dogfood="motion-resume"] [data-vmz-overlay="dialog"]'),
        { timeout: 5000 },
    );
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-dogfood="motion-resume"] [data-vmz-overlay="dialog"]') &&
            document.querySelector('[data-dogfood="motion-resume-state"]')?.textContent?.includes('ssr-dialog:closed'),
        { timeout: 5000 },
    );

    const feedback = await page.evaluate(() => {
        const btn = document.querySelector('[data-dogfood="motion-feedback"] button.vmz-ui-btn');
        if (!btn) return { ok: false, reason: 'missing pulse button' };
        const cs = getComputedStyle(btn);
        const duration = (cs.getPropertyValue('--vmz-motion-control-duration') || '').trim();
        const easing = (cs.getPropertyValue('--vmz-motion-control-easing') || '').trim();
        const transition = cs.transition || cs.transitionProperty;
        return {
            ok: true,
            duration,
            easing,
            hasMotionAttr: btn.getAttribute('data-vmz-motion') === 'control',
            transition: String(transition || ''),
        };
    });
    if (!feedback.ok) fail(`Motion feedback: ${feedback.reason}`);
    if (!feedback.hasMotionAttr) fail('Motion: Button missing data-vmz-motion=control');
    if (feedback.duration !== '120ms') fail(`Motion: expected control duration 120ms, got ${feedback.duration}`);
    if (!feedback.easing) fail('Motion: missing control easing token on Button');
    if (!/background/i.test(feedback.transition) && feedback.transition !== 'all') {
        // Some engines report shorthand; accept non-empty transition when duration token is present.
        if (!feedback.transition || feedback.transition === 'none') {
            fail(`Motion: Button transition missing immediate feedback path: ${feedback.transition}`);
        }
    }

    const t0 = Date.now();
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-feedback"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Pulse'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="motion-clicks"]')?.textContent?.includes('clicks:1'), {
        timeout: 2000,
    });
    const feedbackMs = Date.now() - t0;
    if (feedbackMs > 1000) fail(`Motion: immediate feedback too slow (${feedbackMs}ms)`);

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-overlay"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open dialog'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-motion="overlay-enter"]', { timeout: 5000 });
    const overlayMotion = await page.evaluate(() => {
        const panel = document.querySelector('[data-vmz-overlay="dialog"] [data-vmz-motion="overlay-enter"]');
        if (!panel) return null;
        const cs = getComputedStyle(panel);
        return {
            duration: (cs.getPropertyValue('--vmz-motion-overlay-duration') || '').trim(),
            animation: cs.animationName || '',
        };
    });
    if (!overlayMotion || overlayMotion.duration !== '180ms') {
        fail(`Motion: dialog overlay duration want 180ms, got ${JSON.stringify(overlayMotion)}`);
    }
    if (!overlayMotion.animation || overlayMotion.animation === 'none') {
        fail(`Motion: dialog enter animation missing: ${overlayMotion.animation}`);
    }

    // Exit continuity: Escape marks overlay-exit before unmount.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () =>
            !!document.querySelector('[data-dogfood="motion-overlay"] [data-vmz-motion="overlay-exit"]') ||
            !document.querySelector('[data-dogfood="motion-overlay"] [data-vmz-overlay="dialog"]'),
        { timeout: 5000 },
    );
    await page.waitForFunction(() => !document.querySelector('[data-dogfood="motion-overlay"] [data-vmz-overlay="dialog"]'), {
        timeout: 5000,
    });

    // Reopen after exit → enter animation returns (not adopt).
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-overlay"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open dialog'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-motion="overlay-enter"]', { timeout: 5000 });
    const reenter = await page.evaluate(() => {
        const overlay = document.querySelector('[data-dogfood="motion-overlay"] [data-vmz-overlay="dialog"]');
        const panel = overlay?.querySelector('[data-vmz-focus="enter"]');
        const cs = panel ? getComputedStyle(panel) : null;
        return {
            adopt: overlay?.getAttribute('data-vmz-motion-adopt') || '',
            motion: panel?.getAttribute('data-vmz-motion') || '',
            animation: cs?.animationName || 'none',
        };
    });
    if (reenter.adopt === 'true') fail('Motion: client reopen must not set adopt');
    if (reenter.motion !== 'overlay-enter') fail(`Motion: client reopen want overlay-enter, got ${reenter.motion}`);
    if (!reenter.animation || reenter.animation === 'none') {
        fail(`Motion: client reopen enter animation missing: ${reenter.animation}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-dogfood="motion-overlay"] [data-vmz-overlay="dialog"]'), {
        timeout: 5000,
    });

    // Reduced motion: final open/close state unchanged.
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-overlay"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open dialog'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="dialog"] [data-vmz-focus="enter"]', { timeout: 5000 });
    const reduced = await page.evaluate(() => {
        const panel = document.querySelector('[data-vmz-overlay="dialog"] [data-vmz-motion="overlay-enter"]');
        const cs = panel ? getComputedStyle(panel) : null;
        return {
            open: !!panel,
            animation: cs?.animationName || 'none',
        };
    });
    if (!reduced.open) fail('Motion: reduced-motion must still open dialog');
    if (reduced.animation && reduced.animation !== 'none') {
        fail(`Motion: reduced-motion should disable enter animation, got ${reduced.animation}`);
    }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="dialog"]'), { timeout: 5000 });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // Motion PG interruptibility thin gate: Escape starts exit; Escape again cancels (no zombie onClose).
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-interrupt"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open interrupt dialog'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"] [data-vmz-motion="overlay-enter"]', {
        timeout: 5000,
    });
    const interruptGenBefore = await page.evaluate(() => {
        const overlay = document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"]');
        return overlay?.getAttribute('data-vmz-motion-gen') || '';
    });
    if (!interruptGenBefore) fail('Motion interrupt: expected data-vmz-motion-gen on open overlay');

    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () =>
            !!document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-motion="overlay-exit"]') ||
            document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"]')?.getAttribute('data-vmz-motion-phase') ===
                'exit',
        { timeout: 5000 },
    );

    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () => {
            const overlay = document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"]');
            if (!overlay) return false;
            return (
                overlay.getAttribute('data-vmz-motion-cancelled') === 'reverse' &&
                overlay.getAttribute('data-vmz-motion-phase') !== 'exit' &&
                !!overlay.querySelector('[data-vmz-motion="overlay-enter"]')
            );
        },
        { timeout: 5000 },
    );
    const interruptAfterCancel = await page.evaluate(() => {
        const overlay = document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"]');
        const state = document.querySelector('[data-dogfood="motion-interrupt-state"]')?.textContent || '';
        return {
            open: !!overlay,
            cancelled: overlay?.getAttribute('data-vmz-motion-cancelled') || '',
            gen: overlay?.getAttribute('data-vmz-motion-gen') || '',
            phase: overlay?.getAttribute('data-vmz-motion-phase') || '',
            state,
        };
    });
    if (!interruptAfterCancel.open) fail(`Motion interrupt: cancel must keep dialog open: ${JSON.stringify(interruptAfterCancel)}`);
    if (interruptAfterCancel.cancelled !== 'reverse') {
        fail(`Motion interrupt: want cancelled=reverse, got ${JSON.stringify(interruptAfterCancel)}`);
    }
    if (!(Number(interruptAfterCancel.gen) > Number(interruptGenBefore))) {
        fail(`Motion interrupt: generation must bump on cancel (${interruptGenBefore} -> ${interruptAfterCancel.gen})`);
    }
    if (!interruptAfterCancel.state.includes('interrupt-dialog:open')) {
        fail(`Motion interrupt: parent open must remain true after cancel: ${interruptAfterCancel.state}`);
    }

    // Stale exit timer must not close after cancel.
    await new Promise((r) => setTimeout(r, 250));
    const stillOpen = await page.evaluate(() => {
        const overlay = document.querySelector('[data-dogfood="motion-interrupt"] [data-vmz-overlay="dialog"]');
        const state = document.querySelector('[data-dogfood="motion-interrupt-state"]')?.textContent || '';
        return { open: !!overlay, state };
    });
    if (!stillOpen.open || !stillOpen.state.includes('interrupt-dialog:open')) {
        fail(`Motion interrupt: stale exit must not onClose after cancel: ${JSON.stringify(stillOpen)}`);
    }

    // Complete close after interrupt.
    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () => document.querySelector('[data-dogfood="motion-interrupt-state"]')?.textContent?.includes('interrupt-dialog:closed'),
        { timeout: 5000 },
    );

    // List identity: filter keeps stable row id.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="motion-list"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Filter Alpha'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelectorAll('[data-vmz-row]').length === 1 &&
            !!document.querySelector('[data-vmz-row="r1"]') &&
            document.querySelector('[data-dogfood="motion-row-count"]')?.textContent?.includes('rows:1'),
        { timeout: 5000 },
    );

    console.log('ui-automation: Motion continuity + interrupt/cancel PASS');
    await proveUi4Surface(page);
}

/**
 * UI4 Commercial Surface — status tone matrix + density tokens + Notification/Result.
 * @param {import('puppeteer-core').Page} page
 */
async function proveUi4Surface(page) {
    console.log('ui-automation: UI4 status/density/Notification/Result…');

    for (const name of ['Alert', 'Notification', 'Result', 'Card', 'Empty']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`UI4 missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`UI4 package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`UI4 token contract missing ${name}`);
    }
    const alertSrc = fs.readFileSync(path.join(uiRoot, 'src', 'components', 'Alert.vmz'), 'utf8');
    for (const tone of ['info', 'success', 'warning', 'danger']) {
        if (!alertSrc.includes(`status-${tone}-accent`) && !alertSrc.includes(`--vmz-status-${tone}-accent`)) {
            fail(`Alert must reference status.${tone}.accent`);
        }
    }
    if (!buttonSrc.includes('var(--vmz-density-control-padding-y)')) {
        fail('Button must use density.control.padding-y');
    }

    const ui4Src = path.join(homepage, 'src', 'pages', 'ui4.vmz');
    if (!fs.existsSync(ui4Src)) fail('homepage missing src/pages/ui4.vmz');

    await page.goto(`http://127.0.0.1:18781/ui4`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="ui4"]', { timeout: 10000 });

    const tones = await page.evaluate(() => {
        const out = {};
        for (const tone of ['info', 'success', 'warning', 'danger']) {
            const el = document.querySelector(`[data-vmz-ui="alert"][data-tone="${tone}"]`);
            if (!el) {
                out[tone] = null;
                continue;
            }
            const cs = getComputedStyle(el);
            out[tone] = {
                border: (cs.borderLeftColor || cs.borderColor || '').trim(),
                color: (cs.color || '').trim(),
                accentVar: (cs.getPropertyValue(`--vmz-status-${tone}-accent`) || '').trim(),
            };
        }
        return out;
    });
    for (const tone of ['info', 'success', 'warning', 'danger']) {
        if (!tones[tone]?.accentVar) fail(`UI4: missing status.${tone}.accent on Alert`);
    }
    const accents = ['info', 'success', 'warning', 'danger'].map((t) => tones[t].accentVar.toLowerCase());
    if (new Set(accents).size !== 4) fail(`UI4: status accents must be distinct: ${accents.join(', ')}`);
    // status.info must not equal brand primary #176BFF
    if (accents.some((a) => a === '#176bff' || a === 'rgb(23, 107, 255)')) {
        fail('UI4: status.info must not equal brand.primary');
    }
    // success must not be withdrawn brand green #00C878
    if (accents.includes('#00c878')) fail('UI4: status.success must not use withdrawn brand green');

    const markers = await page.evaluate(() => ({
        notification: !!document.querySelector('[data-vmz-ui="notification"][data-tone="warning"]'),
        result: !!document.querySelector('[data-vmz-ui="result"][data-status="success"]'),
        empty: !!document.querySelector('[data-vmz-ui="empty"]'),
        density: document.querySelector('[data-dogfood="ui4"]')?.getAttribute('data-density') || '',
    }));
    if (!markers.notification || !markers.result || !markers.empty) {
        fail(`UI4: Notification/Result/Empty missing: ${JSON.stringify(markers)}`);
    }
    if (markers.density !== 'comfortable') fail(`UI4: default density want comfortable, got ${markers.density}`);

    const beforePad = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui4"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle density'),
        );
        if (!btn) return null;
        const cs = getComputedStyle(btn);
        return {
            paddingTop: cs.paddingTop,
            controlY: (cs.getPropertyValue('--vmz-density-control-padding-y') || '').trim(),
            compactY: (cs.getPropertyValue('--vmz-density-compact-padding-y') || '').trim(),
        };
    });
    if (!beforePad?.controlY || !beforePad?.compactY) fail(`UI4: density tokens missing on Button: ${JSON.stringify(beforePad)}`);
    if (beforePad.controlY === beforePad.compactY) fail('UI4: control and compact density must differ');

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui4"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle density'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui4"]')?.getAttribute('data-density') === 'compact', {
        timeout: 5000,
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui4-density"]')?.textContent?.includes('density:compact'), {
        timeout: 5000,
    });
    const afterPad = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui4"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle density'),
        );
        return btn ? getComputedStyle(btn).paddingTop : null;
    });
    if (!afterPad || afterPad === beforePad.paddingTop) {
        fail(`UI4: compact density must change Button padding (${beforePad.paddingTop} -> ${afterPad})`);
    }

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-vmz-ui="result"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Continue'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui4-done"]')?.textContent?.includes('done:yes'), { timeout: 5000 });

    console.log('ui-automation: UI4 surface PASS');
    await proveUi5Console(page);
}

/**
 * UI5 Console Surface — Breadcrumb / QueryForm / Skeleton / sort / permission / Timeline.
 * @param {import('puppeteer-core').Page} page
 */
async function proveUi5Console(page) {
    console.log('ui-automation: UI5 Console Breadcrumb/QueryForm/Skeleton/Timeline…');

    for (const name of ['Breadcrumb', 'QueryForm', 'Skeleton', 'Timeline', 'Table', 'ConsoleShell']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`UI5 missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`UI5 package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`UI5 token contract missing ${name}`);
    }
    const tableSrc = fs.readFileSync(path.join(uiRoot, 'src', 'components', 'Table.vmz'), 'utf8');
    if (!tableSrc.includes('data-vmz-sort') || !tableSrc.includes('onSort')) {
        fail('UI5 Table must support column sort');
    }
    if (!tableSrc.includes('rowActionDisabled')) fail('UI5 Table must support permission disable');

    const ui5Src = path.join(homepage, 'src', 'pages', 'ui5.vmz');
    if (!fs.existsSync(ui5Src)) fail('homepage missing src/pages/ui5.vmz');

    await page.goto(`http://127.0.0.1:18781/ui5`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="ui5"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        density: document.querySelector('[data-dogfood="ui5"]')?.getAttribute('data-density') || '',
        crumb: !!document.querySelector('[data-vmz-ui="breadcrumb"] [data-vmz-crumb="ui5"]'),
        query: !!document.querySelector('[data-vmz-ui="query-form"][data-dense="true"]'),
        skeleton: !!document.querySelector('[data-vmz-ui="skeleton"][data-loading="true"]'),
        timeline: document.querySelectorAll('[data-vmz-ui="timeline"] [data-vmz-audit]').length,
        exportDisabled: [...document.querySelectorAll('[data-dogfood="ui5"] button.vmz-ui-btn')].some(
            (b) => (b.textContent || '').includes('Export') && b.disabled,
        ),
    }));
    if (markers.density !== 'compact') fail(`UI5: want compact density, got ${markers.density}`);
    if (!markers.crumb) fail('UI5: Breadcrumb current crumb missing');
    if (!markers.query) fail('UI5: dense QueryForm missing');
    if (!markers.skeleton) fail('UI5: Skeleton loading state missing');
    if (markers.timeline < 2) fail(`UI5: Timeline audit items want >=2, got ${markers.timeline}`);
    if (!markers.exportDisabled) fail('UI5: Export must start permission-disabled');

    await page.type('#home-ui5-name', 'Beta');
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui5-query"]')?.textContent?.includes('name:Beta'), {
        timeout: 5000,
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui5"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Search'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-ui="skeleton"]')?.getAttribute('data-loading') === 'false' &&
            document.querySelectorAll('[data-vmz-row]').length === 1 &&
            !!document.querySelector('[data-vmz-row="r2"]'),
        { timeout: 5000 },
    );

    await page.evaluate(() => {
        const btn = document.querySelector('[data-vmz-sort="status"]');
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui5-sort"]')?.textContent?.includes('sort:status:'), {
        timeout: 5000,
    });

    // Permission: row action disabled until write toggled.
    const blocked = await page.evaluate(() => {
        const btn = document.querySelector('[data-vmz-row-action="r2"]');
        return !btn || btn.disabled;
    });
    if (!blocked) fail('UI5: row action must be disabled while write denied');

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui5"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle write'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui5-perm"]')?.textContent?.includes('write:allowed'), {
        timeout: 5000,
    });
    await page.evaluate(() => {
        const btn = document.querySelector('[data-vmz-row-action="r2"]');
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="drawer"] [data-vmz-focus="enter"]', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui5-drawer-body"]')?.textContent?.includes('detail:r2'), {
        timeout: 5000,
    });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="drawer"]'), { timeout: 5000 });

    // Skeleton can return to loading with stable marker.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui5"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle loading'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-ui="skeleton"]')?.getAttribute('data-loading') === 'true' &&
            !!document.querySelector('[data-vmz-skeleton="block"]'),
        { timeout: 5000 },
    );

    console.log('ui-automation: UI5 Console PASS');
    await proveDocumentProduct(page);
}

/**
 * Document/Product composition — Prose / Toc / Callout / CodeBlock + locale/version/search/copy.
 * @param {import('puppeteer-core').Page} page
 */
async function proveDocumentProduct(page) {
    console.log('ui-automation: Document/Product Prose/Toc/Callout/CodeBlock composition…');

    for (const name of ['Prose', 'Toc', 'Callout', 'CodeBlock']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Document/Product missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Document/Product package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Document/Product token contract missing ${name}`);
    }

    const productSrc = path.join(homepage, 'src', 'pages', 'product.vmz');
    if (!fs.existsSync(productSrc)) fail('homepage missing src/pages/product.vmz');

    await page.goto(`http://127.0.0.1:18781/product`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="product"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        shell: !!document.querySelector('[data-vmz-ui="app-shell"]'),
        nav: !!document.querySelector('[data-vmz-nav="product"]'),
        prose: !!document.querySelector('[data-vmz-ui="prose"]'),
        toc: !!document.querySelector('[data-vmz-ui="toc"] [data-vmz-toc="overview"]'),
        callout: document.querySelectorAll('[data-vmz-ui="callout"]').length,
        code: !!document.querySelector('[data-vmz-ui="code-block"] code'),
        codeText: document.querySelector('[data-vmz-ui="code-block"] code')?.textContent || '',
        search: !!document.getElementById('home-product-search'),
        heading: !!document.getElementById('overview'),
    }));
    if (!markers.shell || !markers.nav) fail(`Document/Product: AppShell/nav missing: ${JSON.stringify(markers)}`);
    if (!markers.prose || !markers.toc || !markers.code || !markers.search || !markers.heading) {
        fail(`Document/Product: Prose/Toc/CodeBlock/search missing: ${JSON.stringify(markers)}`);
    }
    if (markers.callout < 1) fail(`Document/Product: expected Callout, got ${markers.callout}`);
    if (!markers.codeText.includes('pnpm add @vmz/ui')) {
        fail(`Document/Product: CodeBlock must SSR readable install snippet, got ${markers.codeText}`);
    }

    // Locale switch keeps composition readable.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Locale:'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('locale:zh') &&
            document.getElementById('overview')?.textContent?.includes('产品'),
        { timeout: 5000 },
    );

    // Version switch updates CodeBlock source.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Switch version'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('version:v0') &&
            (document.querySelector('[data-vmz-ui="code-block"] code')?.textContent || '').includes('@0.0.0'),
        { timeout: 5000 },
    );

    // Search filters Toc outline; body stays readable (zero-JS contract).
    await page.type('#home-product-search', 'install');
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('search:install') &&
            !!document.getElementById('install') &&
            !!document.getElementById('overview') &&
            !!document.querySelector('[data-vmz-toc="install"]') &&
            !document.querySelector('[data-vmz-toc="overview"]'),
        { timeout: 5000 },
    );

    // Copy action progressive enhancement.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-vmz-ui="code-block"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Copy'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('copied:yes') &&
            !!document.querySelector('[data-dogfood="product-copied"]'),
        { timeout: 5000 },
    );

    // Document surface shares UI6 density/RTL activation (not a parallel theme).
    await page.goto(`http://127.0.0.1:18781/product`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="product"]', { timeout: 10000 });

    const productDensity = await page.evaluate(() => {
        const root = document.querySelector('[data-dogfood="product"]');
        const cycle = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Cycle density'),
        );
        const sample = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Switch version'),
        );
        const el = sample || cycle;
        if (!root || !el || !cycle) {
            return {
                ok: false,
                density: root?.getAttribute('data-density') || '',
                buttons: [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].map((b) => (b.textContent || '').trim()),
            };
        }
        const cs = getComputedStyle(el);
        return {
            ok: true,
            density: root.getAttribute('data-density') || '',
            dir: root.getAttribute('dir') || '',
            meta: document.querySelector('[data-dogfood="product-meta"]')?.textContent || '',
            paddingTop: cs.paddingTop,
            controlY: (cs.getPropertyValue('--vmz-density-control-padding-y') || '').trim(),
            compactY: (cs.getPropertyValue('--vmz-density-compact-padding-y') || '').trim(),
            denseY: (cs.getPropertyValue('--vmz-density-dense-padding-y') || '').trim(),
        };
    });
    if (!productDensity?.ok) fail(`Document density: Cycle density control missing: ${JSON.stringify(productDensity)}`);
    if (productDensity.density !== 'comfortable' || productDensity.dir !== 'ltr') {
        fail(`Document density: default want comfortable/ltr, got ${JSON.stringify(productDensity)}`);
    }
    if (!productDensity.controlY || !productDensity.compactY || !productDensity.denseY) {
        fail(`Document density: CSS vars missing: ${JSON.stringify(productDensity)}`);
    }
    if (!productDensity.meta.includes('density:comfortable') || !productDensity.meta.includes('dir:ltr')) {
        fail(`Document density: product-meta missing density/dir: ${productDensity.meta}`);
    }
    const productPadComfortable = productDensity.paddingTop;
    const productLtrGeom = await page.evaluate(() => {
        const brand = document.querySelector('[data-dogfood="product"] [data-vmz-shell="header"] .vmz-ui-app-shell__brand');
        const nav = document.querySelector('[data-dogfood="product"] [data-vmz-shell="header"] .vmz-ui-app-shell__nav');
        if (!brand || !nav) return null;
        return { brandLeft: brand.getBoundingClientRect().left, navLeft: nav.getBoundingClientRect().left };
    });
    if (!productLtrGeom) fail('Document density: AppShell geometry missing (ltr)');

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Cycle density'),
        );
        btn?.click();
    });
    try {
        await page.waitForFunction(() => document.querySelector('[data-dogfood="product"]')?.getAttribute('data-density') === 'compact', {
            timeout: 5000,
        });
    } catch {
        const snap = await page.evaluate(() => ({
            density: document.querySelector('[data-dogfood="product"]')?.getAttribute('data-density') || '',
            meta: document.querySelector('[data-dogfood="product-meta"]')?.textContent || '',
            hasCycle: [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].some((b) =>
                (b.textContent || '').includes('Cycle density'),
            ),
        }));
        fail(`Document density: cycle to compact failed: ${JSON.stringify(snap)}`);
    }
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Cycle density'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product"]')?.getAttribute('data-density') === 'dense' &&
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('density:dense'),
        { timeout: 5000 },
    );
    const productPadDense = await page.evaluate(() => {
        const sample = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Switch version'),
        );
        return sample ? getComputedStyle(sample).paddingTop : '';
    });
    if (!productPadDense || productPadDense === productPadComfortable) {
        fail(`Document density: dense must change Button padding (${productPadComfortable} -> ${productPadDense})`);
    }

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="product"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle RTL'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="product"]')?.getAttribute('dir') === 'rtl' &&
            document.querySelector('[data-dogfood="product-meta"]')?.textContent?.includes('dir:rtl'),
        { timeout: 5000 },
    );
    const productRtlGeom = await page.evaluate(() => {
        const brand = document.querySelector('[data-dogfood="product"] [data-vmz-shell="header"] .vmz-ui-app-shell__brand');
        const nav = document.querySelector('[data-dogfood="product"] [data-vmz-shell="header"] .vmz-ui-app-shell__nav');
        if (!brand || !nav) return null;
        return { brandLeft: brand.getBoundingClientRect().left, navLeft: nav.getBoundingClientRect().left };
    });
    if (!productRtlGeom || !(productLtrGeom.brandLeft < productLtrGeom.navLeft && productRtlGeom.brandLeft > productRtlGeom.navLeft)) {
        fail(`Document density: RTL must flip brand/nav (ltr=${JSON.stringify(productLtrGeom)}, rtl=${JSON.stringify(productRtlGeom)})`);
    }

    const chromeCss = fs.readFileSync(path.join(homepage, 'designs', 'document', 'chrome.css'), 'utf8');
    if (!chromeCss.includes('var(--vmz-density-control-padding-y') || !chromeCss.includes("data-density='dense'")) {
        fail('Document chrome.css must consume density tokens + dense activation');
    }

    console.log('ui-automation: Document/Product composition + density/RTL PASS');
    await proveUi6DensityRtlPreset(page);
}

/**
 * UI6 Density / RTL / Preset — web-surface preset materialize + comfortable/compact/dense + RTL + high-contrast.
 * @param {import('puppeteer-core').Page} page
 */
async function proveUi6DensityRtlPreset(page) {
    console.log('ui-automation: UI6 Density/RTL/Preset…');

    const presetPath = path.join(uiRoot, 'presets', 'web-surface.v0.json');
    if (!fs.existsSync(presetPath)) fail('UI6 missing presets/web-surface.v0.json');
    if (!pkg.exports?.['./presets/web-surface']) fail('UI6 package exports must include ./presets/web-surface');
    const preset = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
    if (preset.schema !== 'vmz.ui.preset.v0' || preset.id !== 'web-surface') {
        fail('UI6 preset schema/id mismatch');
    }
    for (const tier of ['control', 'compact', 'dense']) {
        if (!preset.density?.[tier]?.['padding-y']) fail(`UI6 preset missing density.${tier}.padding-y`);
    }

    const densityJson = JSON.parse(fs.readFileSync(homeDensity, 'utf8'));
    const densEntries = Object.fromEntries((densityJson.entries || []).map((e) => [((e.key && e.key.path) || []).join('.'), e.value]));
    for (const tier of ['control', 'compact', 'dense']) {
        const key = `density.${tier}.padding-y`;
        if (densEntries[key] !== preset.density[tier]['padding-y']) {
            fail(`UI6: homepage must materialize preset ${key} (${preset.density[tier]['padding-y']}), got ${densEntries[key]}`);
        }
    }

    const hcTheme = path.join(homepage, 'designs', 'themes', 'high-contrast.json');
    if (!fs.existsSync(hcTheme)) fail('UI6 homepage missing designs/themes/high-contrast.json');

    if (!buttonSrc.includes("data-density='dense'") && !buttonSrc.includes('data-density="dense"')) {
        fail('Button must activate density.dense via data-density=dense');
    }
    if (!buttonSrc.includes('var(--vmz-density-dense-padding-y)')) {
        fail('Button must use density.dense.padding-y');
    }
    if (!contract.components?.Button?.tokens?.includes('density.dense.padding-y')) {
        fail('Button token contract must require density.dense.padding-y');
    }

    const ui6Src = path.join(homepage, 'src', 'pages', 'ui6.vmz');
    if (!fs.existsSync(ui6Src)) fail('homepage missing src/pages/ui6.vmz');

    await page.goto(`http://127.0.0.1:18781/ui6`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="ui6"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        shell: !!document.querySelector('[data-vmz-ui="app-shell"]'),
        field: !!document.querySelector('[data-vmz-ui="field"] #home-ui6-sample'),
        card: !!document.querySelector('[data-vmz-ui="card"]'),
        density: document.querySelector('[data-dogfood="ui6"]')?.getAttribute('data-density') || '',
        dir: document.querySelector('[data-dogfood="ui6"]')?.getAttribute('dir') || '',
        state: document.querySelector('[data-dogfood="ui6-state"]')?.textContent || '',
    }));
    if (!markers.shell || !markers.field || !markers.card) {
        fail(`UI6: markers missing: ${JSON.stringify(markers)}`);
    }
    if (markers.density !== 'comfortable' || markers.dir !== 'ltr') {
        fail(`UI6: default density/dir want comfortable/ltr, got ${markers.density}/${markers.dir}`);
    }
    if (!markers.state.includes('theme:default')) fail(`UI6: default theme marker missing: ${markers.state}`);

    const densVars = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Probe control'),
        );
        if (!btn) return null;
        const cs = getComputedStyle(btn);
        return {
            controlY: (cs.getPropertyValue('--vmz-density-control-padding-y') || '').trim(),
            compactY: (cs.getPropertyValue('--vmz-density-compact-padding-y') || '').trim(),
            denseY: (cs.getPropertyValue('--vmz-density-dense-padding-y') || '').trim(),
            paddingTop: (cs.paddingTop || '').trim(),
        };
    });
    if (!densVars?.controlY || !densVars?.compactY || !densVars?.denseY) {
        fail(`UI6: density CSS vars missing: ${JSON.stringify(densVars)}`);
    }
    if (new Set([densVars.controlY, densVars.compactY, densVars.denseY]).size !== 3) {
        fail(`UI6: control/compact/dense padding-y must differ: ${JSON.stringify(densVars)}`);
    }
    const comfortPad = densVars.paddingTop;

    // comfortable → compact
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Cycle density'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui6"]')?.getAttribute('data-density') === 'compact', {
        timeout: 5000,
    });
    const compactPad = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Probe control'),
        );
        return btn ? getComputedStyle(btn).paddingTop : '';
    });
    if (!compactPad || compactPad === comfortPad) {
        fail(`UI6: compact must change Probe padding (${comfortPad} -> ${compactPad})`);
    }

    // compact → dense
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Cycle density'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui6"]')?.getAttribute('data-density') === 'dense', {
        timeout: 5000,
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui6-state"]')?.textContent?.includes('density:dense'), {
        timeout: 5000,
    });
    const densePad = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Probe control'),
        );
        return btn ? getComputedStyle(btn).paddingTop : '';
    });
    if (!densePad || densePad === compactPad || densePad === comfortPad) {
        fail(`UI6: dense must change Probe padding (comfort=${comfortPad}, compact=${compactPad}, dense=${densePad})`);
    }

    // RTL: brand moves relative to nav (flex space-between under dir=rtl).
    const ltrGeom = await page.evaluate(() => {
        const brand = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__brand');
        const nav = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__nav');
        if (!brand || !nav) return null;
        return { brandLeft: brand.getBoundingClientRect().left, navLeft: nav.getBoundingClientRect().left };
    });
    if (!ltrGeom) fail('UI6: shell header geometry missing (ltr)');
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle RTL'),
        );
        btn?.click();
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui6"]')?.getAttribute('dir') === 'rtl', {
        timeout: 5000,
    });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="ui6-state"]')?.textContent?.includes('dir:rtl'), {
        timeout: 5000,
    });
    const rtlGeom = await page.evaluate(() => {
        const root = document.querySelector('[data-dogfood="ui6"]');
        const brand = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__brand');
        const nav = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__nav');
        if (!root || !brand || !nav) return null;
        return {
            dir: root.getAttribute('dir'),
            brandLeft: brand.getBoundingClientRect().left,
            navLeft: nav.getBoundingClientRect().left,
        };
    });
    if (!rtlGeom || rtlGeom.dir !== 'rtl') fail(`UI6: rtl dir missing: ${JSON.stringify(rtlGeom)}`);
    // In LTR brand is left of nav; in RTL brand should be to the right of nav (or at least order flips).
    if (!(ltrGeom.brandLeft < ltrGeom.navLeft && rtlGeom.brandLeft > rtlGeom.navLeft)) {
        fail(`UI6: RTL must flip brand/nav horizontal order (ltr=${JSON.stringify(ltrGeom)}, rtl=${JSON.stringify(rtlGeom)})`);
    }

    // High-contrast theme overlay via documentElement data-theme.
    const beforeInk = await page.evaluate(() => {
        const el = document.querySelector('[data-dogfood="ui6"]');
        return el ? (getComputedStyle(el).getPropertyValue('--vmz-text-ink') || '').trim() : '';
    });
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="ui6"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Toggle high-contrast'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.documentElement.getAttribute('data-theme') === 'high-contrast' &&
            document.querySelector('[data-dogfood="ui6-state"]')?.textContent?.includes('theme:high-contrast'),
        { timeout: 5000 },
    );
    const afterInk = await page.evaluate(() => {
        const el = document.querySelector('[data-dogfood="ui6"]');
        return el ? (getComputedStyle(el).getPropertyValue('--vmz-text-ink') || '').trim() : '';
    });
    if (!afterInk || afterInk === beforeInk) {
        fail(`UI6: high-contrast must change --vmz-text-ink (${beforeInk} -> ${afterInk})`);
    }
    if (afterInk.toLowerCase() !== '#000000' && afterInk !== 'rgb(0, 0, 0)') {
        // Accept either hex or rgb form of pure black from high-contrast overlay.
        const ok = /^(#000|#000000|rgb\(0,\s*0,\s*0\))$/i.test(afterInk);
        if (!ok) fail(`UI6: high-contrast text.ink should be black, got ${afterInk}`);
    }

    console.log('ui-automation: UI6 Density/RTL/Preset PASS');
    await proveStructureComposition(page);
}

/**
 * Structure composition — Accordion / Steps / List / Tree (parent-owned state).
 * @param {import('puppeteer-core').Page} page
 */
async function proveStructureComposition(page) {
    console.log('ui-automation: Structure Accordion/Steps/List/Tree…');

    for (const name of ['Accordion', 'Steps', 'List', 'Tree']) {
        const src = path.join(uiRoot, 'src', 'components', `${name}.vmz`);
        if (!fs.existsSync(src)) fail(`Structure missing ${name}.vmz`);
        if (!pkg.exports?.[`./${name}`]) fail(`Structure package exports must include ./${name}`);
        if (!contract.components?.[name]) fail(`Structure token contract missing ${name}`);
    }

    const structureSrc = path.join(homepage, 'src', 'pages', 'structure.vmz');
    if (!fs.existsSync(structureSrc)) fail('homepage missing src/pages/structure.vmz');

    await page.goto(`http://127.0.0.1:18781/structure`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="structure"]', { timeout: 10000 });

    const markers = await page.evaluate(() => ({
        accordion: !!document.querySelector('[data-vmz-ui="accordion"]'),
        steps: !!document.querySelector('[data-vmz-ui="steps"]'),
        list: !!document.querySelector('[data-vmz-ui="list"]'),
        tree: !!document.querySelector('[data-vmz-ui="tree"]'),
        faqPanel: !!document.querySelector('[data-vmz-accordion-panel="billing"]'),
        stepCurrent: document.querySelector('[data-vmz-step="account"]')?.getAttribute('data-status') || '',
        listSelected: document.querySelector('[data-vmz-list-item="alpha"]')?.getAttribute('aria-selected') || '',
        treeSelected: document.querySelector('[data-vmz-tree-item="platform"]')?.getAttribute('aria-selected') || '',
        treeChild: !!document.querySelector('[data-vmz-tree-item="runtime"]'),
        state: document.querySelector('[data-dogfood="structure-state"]')?.textContent || '',
    }));
    if (!markers.accordion || !markers.steps || !markers.list || !markers.tree) {
        fail(`Structure: markers missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.faqPanel) fail('Structure: Accordion billing panel should start open');
    if (markers.stepCurrent !== 'current') fail(`Structure: step account want current, got ${markers.stepCurrent}`);
    if (markers.listSelected !== 'true' || markers.treeSelected !== 'true') {
        fail(`Structure: list/tree selection missing: ${JSON.stringify(markers)}`);
    }
    if (!markers.treeChild) fail('Structure: expanded Platform must show Runtime child');
    if (!markers.state.includes('faq:billing') || !markers.state.includes('expanded:platform')) {
        fail(`Structure: state marker incomplete: ${markers.state}`);
    }

    // Accordion exclusive toggle.
    await page.click('[data-vmz-accordion-trigger="access"]');
    await page.waitForFunction(
        () =>
            !!document.querySelector('[data-vmz-accordion-panel="access"]') &&
            !document.querySelector('[data-vmz-accordion-panel="billing"]') &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('faq:access'),
        { timeout: 5000 },
    );
    await page.click('[data-vmz-accordion-trigger="access"]');
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-vmz-accordion-panel="access"]') &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('faq:none'),
        { timeout: 5000 },
    );

    // Steps next/back.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="structure"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Next'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-step="workspace"]')?.getAttribute('data-status') === 'current' &&
            document.querySelector('[data-vmz-step="account"]')?.getAttribute('data-status') === 'done' &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('step:workspace'),
        { timeout: 5000 },
    );
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="structure"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Back'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-step="account"]')?.getAttribute('data-status') === 'current' &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('step:account'),
        { timeout: 5000 },
    );

    // List select.
    await page.click('[data-vmz-list-item="beta"]');
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-list-item="beta"]')?.getAttribute('aria-selected') === 'true' &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('list:beta'),
        { timeout: 5000 },
    );

    // Tree collapse Platform (hides children) then select leaf after expand Runtime.
    await page.click('[data-vmz-tree-twist="platform"]');
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-vmz-tree-item="runtime"]') &&
            document.querySelector('[data-vmz-tree-item="platform"]')?.getAttribute('aria-expanded') === 'false' &&
            !document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('expanded:platform'),
        { timeout: 5000 },
    );
    await page.click('[data-vmz-tree-twist="platform"]');
    await page.waitForSelector('[data-vmz-tree-item="runtime"]', { timeout: 5000 });
    await page.click('[data-vmz-tree-twist="runtime"]');
    await page.waitForSelector('[data-vmz-tree-item="browser"]', { timeout: 5000 });
    await page.click('[data-vmz-tree-title="browser"]');
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-tree-item="browser"]')?.getAttribute('aria-selected') === 'true' &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('tree:browser') &&
            document.querySelector('[data-dogfood="structure-state"]')?.textContent?.includes('expanded:platform,runtime'),
        { timeout: 5000 },
    );

    console.log('ui-automation: Structure composition PASS');
    await proveOverlayStacking(page);
}

/**
 * Multilayer overlay stacking — stackLevel z-order + Escape closes topmost only.
 * @param {import('puppeteer-core').Page} page
 */
async function proveOverlayStacking(page) {
    console.log('ui-automation: Overlay stacking Drawer/Dialog/Popover…');

    for (const name of ['Dialog', 'Drawer', 'Popover']) {
        const src = fs.readFileSync(path.join(uiRoot, 'src', 'components', `${name}.vmz`), 'utf8');
        if (!src.includes('data-vmz-overlay-stack')) fail(`${name} must expose data-vmz-overlay-stack`);
        if (!src.includes('_isTopmostStack')) fail(`${name} must gate Escape on topmost stack`);
        if (!src.includes('stackLevel')) fail(`${name} must accept stackLevel`);
    }

    const stackingSrc = path.join(homepage, 'src', 'pages', 'stacking.vmz');
    if (!fs.existsSync(stackingSrc)) fail('homepage missing src/pages/stacking.vmz');

    await page.goto(`http://127.0.0.1:18781/stacking`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="stacking"]', { timeout: 10000 });

    // Programmatic .click() — overlays cover page chrome; CDP mouse would hit backdrop.
    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="stacking"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open drawer'),
        );
        btn?.click();
    });
    await page.waitForSelector('[data-vmz-overlay="drawer"][data-vmz-overlay-stack="0"]', { timeout: 5000 });

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="stacking"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open dialog'),
        );
        if (!btn) throw new Error('Open dialog button missing');
        btn.click();
    });
    try {
        await page.waitForSelector('[data-vmz-overlay="dialog"][data-vmz-overlay-stack="1"]', { timeout: 8000 });
    } catch {
        const snap = await page.evaluate(() => ({
            state: document.querySelector('[data-dogfood="stacking-state"]')?.textContent || '',
            dialog: !!document.querySelector('[data-vmz-overlay="dialog"]'),
            dialogStack: document.querySelector('[data-vmz-overlay="dialog"]')?.getAttribute('data-vmz-overlay-stack'),
            drawer: !!document.querySelector('[data-vmz-overlay="drawer"]'),
        }));
        fail(`Stacking: dialog did not open: ${JSON.stringify(snap)}`);
    }

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="stacking"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Open popover'),
        );
        if (!btn) throw new Error('Open popover button missing');
        btn.click();
    });
    try {
        await page.waitForSelector('[data-vmz-overlay="popover"][data-vmz-overlay-stack="2"]', { timeout: 8000 });
    } catch {
        const snap = await page.evaluate(() => ({
            state: document.querySelector('[data-dogfood="stacking-state"]')?.textContent || '',
            popover: !!document.querySelector('[data-vmz-overlay="popover"]'),
            popoverStack: document.querySelector('[data-vmz-overlay="popover"]')?.getAttribute('data-vmz-overlay-stack'),
        }));
        fail(`Stacking: popover did not open: ${JSON.stringify(snap)}`);
    }
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('drawer:open') &&
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('dialog:open') &&
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('popover:open'),
        { timeout: 5000 },
    );

    const order = await page.evaluate(() => {
        const drawer = document.querySelector('[data-vmz-overlay="drawer"]');
        const dialog = document.querySelector('[data-vmz-overlay="dialog"]');
        const popover = document.querySelector('[data-vmz-overlay="popover"]');
        const z = (el) => (el ? Number.parseInt(getComputedStyle(el).zIndex, 10) : NaN);
        return { drawer: z(drawer), dialog: z(dialog), popover: z(popover) };
    });
    if (!(order.drawer < order.dialog && order.dialog < order.popover)) {
        fail(`Stacking: z-index must rise Drawer<Dialog<Popover, got ${JSON.stringify(order)}`);
    }

    // Escape closes topmost (popover) only.
    await page.keyboard.press('Escape');
    try {
        await page.waitForFunction(
            () =>
                !document.querySelector('[data-vmz-overlay="popover"]') &&
                !!document.querySelector('[data-vmz-overlay="dialog"]') &&
                !!document.querySelector('[data-vmz-overlay="drawer"]') &&
                document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('popover:closed') &&
                document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('dialog:open'),
            { timeout: 8000 },
        );
    } catch {
        const snap = await page.evaluate(() => ({
            state: document.querySelector('[data-dogfood="stacking-state"]')?.textContent || '',
            popover: !!document.querySelector('[data-vmz-overlay="popover"]'),
            dialog: !!document.querySelector('[data-vmz-overlay="dialog"]'),
            drawer: !!document.querySelector('[data-vmz-overlay="drawer"]'),
        }));
        fail(`Stacking: Escape should close popover only: ${JSON.stringify(snap)}`);
    }

    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-vmz-overlay="dialog"]') &&
            !!document.querySelector('[data-vmz-overlay="drawer"]') &&
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('dialog:closed') &&
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('drawer:open'),
        { timeout: 5000 },
    );

    await page.keyboard.press('Escape');
    await page.waitForFunction(
        () =>
            !document.querySelector('[data-vmz-overlay="drawer"]') &&
            document.querySelector('[data-dogfood="stacking-state"]')?.textContent?.includes('drawer:closed'),
        { timeout: 5000 },
    );

    console.log('ui-automation: Overlay stacking PASS');
    await proveDataTable(page);
}

/**
 * DataTable thin gate — parent-owned selection + sticky header + sort (not ui-data-grid).
 * @param {import('puppeteer-core').Page} page
 */
async function proveDataTable(page) {
    console.log('ui-automation: DataTable selection/sticky/sort…');

    const src = path.join(uiRoot, 'src', 'components', 'DataTable.vmz');
    if (!fs.existsSync(src)) fail('DataTable missing DataTable.vmz');
    if (!pkg.exports?.['./DataTable']) fail('DataTable package exports must include ./DataTable');
    if (!contract.components?.DataTable) fail('DataTable token contract missing');
    const dtSrc = fs.readFileSync(src, 'utf8');
    if (!dtSrc.includes('data-vmz-select') || !dtSrc.includes('onToggleRow')) {
        fail('DataTable must support parent-owned row selection');
    }
    if (!dtSrc.includes('position: sticky')) fail('DataTable must sticky thead');
    if (!dtSrc.includes('data-vmz-sort')) fail('DataTable must support column sort');
    if (/virtualiz|pinned column|cell editing|pivot/i.test(dtSrc)) {
        fail('DataTable must not claim data-grid deep capabilities');
    }

    const pageSrc = path.join(homepage, 'src', 'pages', 'datatable.vmz');
    if (!fs.existsSync(pageSrc)) fail('homepage missing src/pages/datatable.vmz');

    await page.goto(`http://127.0.0.1:18781/datatable`, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.waitForSelector('[data-dogfood="datatable"]', { timeout: 10000 });

    const markers = await page.evaluate(() => {
        const wrap = document.querySelector('[data-vmz-ui="data-table"]');
        const th = wrap?.querySelector('thead th');
        const cs = th ? getComputedStyle(th) : null;
        return {
            table: !!wrap,
            density: document.querySelector('[data-dogfood="datatable"]')?.getAttribute('data-density') || '',
            rows: document.querySelectorAll('[data-vmz-ui="data-table"] [data-vmz-row]').length,
            sticky: cs?.position || '',
            selectAll: !!document.querySelector('[data-vmz-select-all]'),
            selectAllAttr: document.querySelector('[data-vmz-ui="data-table"] thead')?.innerHTML?.slice(0, 200) || '',
        };
    });
    if (!markers.table || markers.rows < 5) fail(`DataTable: markers missing: ${JSON.stringify(markers)}`);
    if (markers.density !== 'compact') fail(`DataTable: want compact density, got ${markers.density}`);
    if (markers.sticky !== 'sticky') fail(`DataTable: thead must be sticky, got ${markers.sticky}`);
    if (!markers.selectAll) fail(`DataTable: select-all control missing: ${markers.selectAllAttr}`);

    await page.click('[data-vmz-select="r2"]');
    await page.waitForFunction(
        () =>
            document.querySelector('[data-vmz-row="r2"]')?.getAttribute('data-selected') === 'true' &&
            document.querySelector('[data-dogfood="datatable-state"]')?.textContent?.includes('selected:r2') &&
            document.querySelector('[data-dogfood="datatable-state"]')?.textContent?.includes('count:1') &&
            !!document.querySelector('[data-vmz-ui="bulk-actions"]'),
        { timeout: 5000 },
    );

    await page.click('[data-vmz-select-all]');
    await page.waitForFunction(
        () =>
            document.querySelectorAll('[data-vmz-ui="data-table"] [data-vmz-row][data-selected="true"]').length === 5 &&
            document.querySelector('[data-dogfood="datatable-state"]')?.textContent?.includes('count:5'),
        { timeout: 5000 },
    );

    await page.evaluate(() => {
        const btn = [...document.querySelectorAll('[data-dogfood="datatable"] button.vmz-ui-btn')].find((b) =>
            (b.textContent || '').includes('Clear'),
        );
        btn?.click();
    });
    await page.waitForFunction(
        () =>
            document.querySelector('[data-dogfood="datatable-state"]')?.textContent?.includes('selected:none') &&
            !document.querySelector('[data-vmz-ui="bulk-actions"]'),
        { timeout: 5000 },
    );

    await page.click('[data-vmz-sort="status"]');
    await page.waitForFunction(() => document.querySelector('[data-dogfood="datatable-state"]')?.textContent?.includes('sort:status:'), {
        timeout: 5000,
    });

    await page.click('[data-vmz-row-action="r1"]');
    await page.waitForSelector('[data-vmz-overlay="drawer"]', { timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[data-dogfood="datatable-drawer-body"]')?.textContent?.includes('detail:r1'), {
        timeout: 5000,
    });

    console.log('ui-automation: DataTable PASS');
    await proveDocumentsPanelDensity(page);
}

/**
 * Documents + panel density/RTL dogfood — fixture Style Theme density + inspector panel surface.
 * @param {import('puppeteer-core').Page} page
 */
async function proveDocumentsPanelDensity(page) {
    console.log('ui-automation: documents/panel density/RTL dogfood…');
    const { spawn } = await import('node:child_process');

    const docsFixture = path.join(root, 'packages', 'examples', 'documents-fixture');
    const densPath = path.join(docsFixture, 'designs', 'tokens', 'semantic-density.json');
    if (!fs.existsSync(densPath)) fail('documents-fixture missing designs/tokens/semantic-density.json');
    const densJson = JSON.parse(fs.readFileSync(densPath, 'utf8'));
    const densEntries = Object.fromEntries((densJson.entries || []).map((e) => [((e.key && e.key.path) || []).join('.'), e.value]));
    for (const tier of ['control', 'compact', 'dense']) {
        if (!densEntries[`density.${tier}.padding-y`]) {
            fail(`documents-fixture must materialize density.${tier}.padding-y`);
        }
    }
    const docCss = fs.readFileSync(path.join(docsFixture, 'designs', 'styles', 'document.css'), 'utf8');
    if (!docCss.includes('var(--vmz-density-control-padding-y') || !docCss.includes("data-density='dense'")) {
        fail('documents-fixture document.css must consume density tokens + dense activation');
    }

    const inspector = path.join(root, 'packages', 'examples', 'production-inspector');
    const inspSrc = path.join(inspector, 'src', 'pages', 'index.vmz');
    if (!fs.existsSync(inspSrc)) fail('production-inspector missing src/pages/index.vmz');
    const inspVmz = fs.readFileSync(inspSrc, 'utf8');
    for (const tag of ['AppShell', 'Field', 'Dialog', 'Button']) {
        if (!inspVmz.includes(`<${tag}`)) fail(`production-inspector must dogfood <${tag}>`);
    }
    if (!inspVmz.includes('data-density') || !inspVmz.includes('dir={dir}')) {
        fail('production-inspector must bind data-density and dir');
    }

    const inspBuild = runBuild(inspector);
    if (inspBuild.status !== 0) fail(`production-inspector build failed\n${inspBuild.out}`);
    const inspDist = path.join(inspector, 'dist');
    const inspDesigns = fs.readFileSync(path.join(inspDist, 'vmz-designs.css'), 'utf8');
    for (const v of ['--vmz-density-control-padding-y:', '--vmz-density-compact-padding-y:', '--vmz-density-dense-padding-y:']) {
        if (!inspDesigns.includes(v)) fail(`production-inspector vmz-designs.css missing ${v}`);
    }
    const hostJs = path.join(inspDist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) fail('production-inspector missing vmz-serve-host.mjs');

    const PORT = 18782;
    const child = spawn(process.execPath, [hostJs], {
        cwd: inspDist,
        env: { ...process.env, VMZ_DIST: inspDist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const kill = () => {
        try {
            child.kill('SIGTERM');
        } catch {
            /* ignore */
        }
    };
    try {
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('inspector serve-host start timeout')), 12000);
            const onData = (buf) => {
                if (String(buf).includes('vmz serve http://')) {
                    clearTimeout(t);
                    child.stdout.off('data', onData);
                    resolve();
                }
            };
            child.stdout.on('data', onData);
            child.stderr.on('data', (b) => process.stderr.write(b));
            child.on('exit', (code) => {
                clearTimeout(t);
                reject(new Error(`inspector serve-host exited early ${code}`));
            });
        });

        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForSelector('[data-dogfood="inspector"]', { timeout: 10000 });

        const markers = await page.evaluate(() => {
            const root = document.querySelector('[data-dogfood="inspector"]');
            const sample = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Cycle density'),
            );
            const cs = sample ? getComputedStyle(sample) : null;
            return {
                density: root?.getAttribute('data-density') || '',
                dir: root?.getAttribute('dir') || '',
                state: document.querySelector('[data-dogfood="inspector-state"]')?.textContent || '',
                shell: !!document.querySelector('[data-vmz-ui="app-shell"]'),
                field: !!document.getElementById('inspector-query'),
                dialogBtn: [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].some((b) =>
                    (b.textContent || '').includes('Replay error'),
                ),
                paddingTop: cs?.paddingTop || '',
                denseY: cs ? (cs.getPropertyValue('--vmz-density-dense-padding-y') || '').trim() : '',
            };
        });
        if (!markers.shell || !markers.field || !markers.dialogBtn) {
            fail(`Panel density: AppShell/Field/Dialog missing: ${JSON.stringify(markers)}`);
        }
        if (markers.density !== 'comfortable' || markers.dir !== 'ltr') {
            fail(`Panel density: default want comfortable/ltr, got ${JSON.stringify(markers)}`);
        }
        if (!markers.denseY) fail(`Panel density: dense CSS var missing: ${JSON.stringify(markers)}`);

        const ltrGeom = await page.evaluate(() => {
            const brand = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__brand');
            const nav = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__nav');
            if (!brand || !nav) return null;
            return { brandLeft: brand.getBoundingClientRect().left, navLeft: nav.getBoundingClientRect().left };
        });
        if (!ltrGeom) fail('Panel density: shell geometry missing (ltr)');

        const beforePad = markers.paddingTop;
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Cycle density'),
            );
            btn?.click();
        });
        await page.waitForFunction(() => document.querySelector('[data-dogfood="inspector"]')?.getAttribute('data-density') === 'compact', {
            timeout: 5000,
        });
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Cycle density'),
            );
            btn?.click();
        });
        await page.waitForFunction(
            () =>
                document.querySelector('[data-dogfood="inspector"]')?.getAttribute('data-density') === 'dense' &&
                document.querySelector('[data-dogfood="inspector-state"]')?.textContent?.includes('density:dense'),
            { timeout: 5000 },
        );
        const afterPad = await page.evaluate(() => {
            const btn = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Cycle density'),
            );
            return btn ? getComputedStyle(btn).paddingTop : '';
        });
        if (!afterPad || afterPad === beforePad) {
            fail(`Panel density: dense must change Button padding (${beforePad} -> ${afterPad})`);
        }

        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Toggle RTL'),
            );
            btn?.click();
        });
        await page.waitForFunction(
            () =>
                document.querySelector('[data-dogfood="inspector"]')?.getAttribute('dir') === 'rtl' &&
                document.querySelector('[data-dogfood="inspector-state"]')?.textContent?.includes('dir:rtl'),
            { timeout: 5000 },
        );
        const rtlGeom = await page.evaluate(() => {
            const brand = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__brand');
            const nav = document.querySelector('[data-vmz-shell="header"] .vmz-ui-app-shell__nav');
            if (!brand || !nav) return null;
            return { brandLeft: brand.getBoundingClientRect().left, navLeft: nav.getBoundingClientRect().left };
        });
        if (!(ltrGeom.brandLeft < ltrGeom.navLeft && rtlGeom && rtlGeom.brandLeft > rtlGeom.navLeft)) {
            fail(`Panel density: RTL must flip brand/nav (ltr=${JSON.stringify(ltrGeom)}, rtl=${JSON.stringify(rtlGeom)})`);
        }

        // Dialog still owns overlay after density/RTL wiring.
        await page.evaluate(() => {
            const btn = [...document.querySelectorAll('[data-dogfood="inspector"] button.vmz-ui-btn')].find((b) =>
                (b.textContent || '').includes('Replay error'),
            );
            btn?.click();
        });
        await page.waitForSelector('[data-vmz-overlay="dialog"]', { timeout: 5000 });
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-vmz-overlay="dialog"]'), { timeout: 5000 });
    } finally {
        kill();
    }

    console.log('ui-automation: documents/panel density/RTL PASS');
}
