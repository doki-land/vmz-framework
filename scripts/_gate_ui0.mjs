/**
 * UI0 gate — @vmz/ui package skeleton + token requirements + Button probe.
 *
 * Design: 规划设计/vmz/31 §3 UI0 · §7
 * Naming: 规划设计/vmz/29
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiRoot = path.join(root, 'packages', 'ui', 'vmz-ui');
const homepage = path.join(root, 'packages', 'homepage');
const cargo = process.env.CARGO || 'cargo';
const DIAG_UNKNOWN = 'vmz::style::unknown_design_token';
const SCHEMA = 'vmz.ui.token_requirements.v0';

function fail(msg) {
    console.error(`UI0 GATE FAIL: ${msg}`);
    process.exit(1);
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

console.log('UI0: package identity…');
const pkg = JSON.parse(fs.readFileSync(path.join(uiRoot, 'package.json'), 'utf8'));
if (pkg.name !== '@vmz/ui') fail(`package name must be @vmz/ui, got ${pkg.name}`);
if (pkg.dependencies?.['@vmz/plugin'] || pkg.devDependencies?.['@vmz/plugin']) {
    fail('@vmz/ui must not depend on @vmz/plugin');
}
for (const bad of ['vmz-design', '@vmz/design']) {
    if (JSON.stringify(pkg).includes(bad)) fail(`forbidden name residue: ${bad}`);
}

console.log('UI0: token requirements contract…');
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

console.log('UI0: forbid brand hex inside @vmz/ui…');
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

console.log('UI0: @vmz/ui keeps src/components convention…');
if (!fs.existsSync(path.join(uiRoot, 'src', 'components', 'Button.vmz'))) {
    fail('Button must live at src/components/Button.vmz (no componentsRoot config)');
}
if (pkg.vmz?.componentsRoot) {
    fail('forbid package.json vmz.componentsRoot — convention is src/components');
}

console.log('UI0: homepage semantic action tokens…');
const homeDesigns = path.join(homepage, 'designs', 'tokens', 'semantic-action.json');
if (!fs.existsSync(homeDesigns)) fail('homepage missing designs/tokens/semantic-action.json');
const homeBuild = runBuild(homepage);
if (homeBuild.status !== 0) fail(`homepage build failed\n${homeBuild.out}`);
const designsCss = fs.readFileSync(path.join(homepage, 'dist', 'vmz-designs.css'), 'utf8');
for (const tok of button.tokens) {
    const cssVar = dottedToCssVar(tok);
    if (!designsCss.includes(`${cssVar}:`)) {
        fail(`homepage vmz-designs.css missing ${cssVar}`);
    }
}

console.log('UI0: homepage dogfood discovers Button from @vmz/ui…');
{
    const dep = JSON.parse(fs.readFileSync(path.join(homepage, 'package.json'), 'utf8'));
    if (!dep.dependencies?.['@vmz/ui'] && !dep.devDependencies?.['@vmz/ui']) {
        fail('homepage must depend on @vmz/ui');
    }
    const indexVmz = fs.readFileSync(path.join(homepage, 'src', 'pages', 'index.vmz'), 'utf8');
    if (!indexVmz.includes('<Button')) fail('homepage index must dogfood <Button>');
    if (!fs.existsSync(path.join(homepage, 'dist', 'Button.client.js'))) {
        fail('homepage build must emit Button.client.js from @vmz/ui');
    }
}

console.log('UI0: fixture with tokens builds…');
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
    fs.writeFileSync(
        path.join(dir, 'designs', 'styles', 'index.scss'),
        `body { margin: 0; }
.vmz-ui-btn { /* keep component vars live */ }
`,
    );
    // Reference tokens from global style so unused warnings don't obscure the gate.
    fs.writeFileSync(
        path.join(dir, 'designs', 'styles', 'index.scss'),
        `body {
  margin: 0;
}
.vmz-ui-btn {
  background: var(--vmz-action-primary-background);
  color: var(--vmz-action-primary-foreground);
}
.vmz-ui-btn:hover { background: var(--vmz-action-primary-hover); }
.vmz-ui-btn:active { background: var(--vmz-action-primary-active); }
.vmz-ui-btn:focus-visible { box-shadow: 0 0 0 2px var(--vmz-focus-ring); }
`,
    );
    const r = runBuild(dir);
    if (r.status !== 0) fail(`tokened fixture build failed\n${r.out}`);
    if (r.out.includes(DIAG_UNKNOWN)) fail(`tokened fixture must not unknown token\n${r.out}`);
}

console.log('UI0: fixture missing tokens fails…');
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
    if (!r.out.includes(DIAG_UNKNOWN) && !r.out.includes('unknown design token')) {
        fail(`expected unknown_design_token diagnostic\n${r.out}`);
    }
}

console.log('UI0 gate: ok');
