/**
 * Official dogfood — homepage + documents + inspector as ordinary applications,
 * plus @vmz/ui Button/Field/Dialog minimum surface (no framework special-case).
 * verify id: official-dogfood
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { addLimitation, readProof, runVmzBuild, upsertCheck, writeProof } from '../_lib/production-proof.ts';

const root = repoRoot(import.meta.url);
const HOMEPAGE = 'packages/homepage';
const DOCUMENTS = 'packages/examples/documents-fixture';
const INSPECTOR = 'packages/examples/production-inspector';
const UI = 'packages/ui/vmz-ui';
const PORT = 18795;

function fail(msg: string): never {
    console.error(`official-dogfood FAIL: ${msg}`);
    process.exit(1);
}

const errors: string[] = [];

function existsRel(...parts: string[]): boolean {
    return fs.existsSync(path.join(root, ...parts));
}

console.log('official-dogfood: forbid framework special-case hooks…');
{
    const cli = fs.readFileSync(path.join(root, 'packages/runtimes/vmz/src/cli.ts'), 'utf8');
    for (const bad of ['homepage-mode', 'documents-mode', 'panel-mode', 'vmz.homepage', 'specialHomepage']) {
        if (cli.includes(bad)) errors.push(`CLI must not special-case ${bad}`);
    }
}

console.log('official-dogfood: @vmz/ui Button/Field/Dialog contract…');
const uiRoot = path.join(root, UI);
const contract = JSON.parse(fs.readFileSync(path.join(uiRoot, 'contracts/token-requirements.v0.json'), 'utf8'));
if (contract.package !== '@vmz/ui') errors.push('ui contract package');
for (const name of [
    'Button',
    'Field',
    'Form',
    'FormItem',
    'TextArea',
    'Select',
    'RadioGroup',
    'Dialog',
    'Checkbox',
    'Switch',
    'Tabs',
    'Menu',
    'Drawer',
    'Popover',
]) {
    const row = contract.components?.[name];
    if (!row?.source) {
        errors.push(`missing contract for ${name}`);
        continue;
    }
    const srcPath = path.join(uiRoot, row.source);
    if (!fs.existsSync(srcPath)) {
        errors.push(`missing ${row.source}`);
        continue;
    }
    const src = fs.readFileSync(srcPath, 'utf8');
    for (const tok of row.tokens || []) {
        const cssVar = `--vmz-${String(tok).split('.').join('-')}`;
        if (!src.includes(`var(${cssVar})`)) errors.push(`${name} missing ${cssVar}`);
    }
    for (const hex of contract.forbiddenBrandHex || []) {
        if (src.toLowerCase().includes(String(hex).toLowerCase())) {
            errors.push(`${name} contains brand hex ${hex}`);
        }
    }
}
const fieldSrc = fs.readFileSync(path.join(uiRoot, 'src/components/Field.vmz'), 'utf8');
const dialogSrc = fs.readFileSync(path.join(uiRoot, 'src/components/Dialog.vmz'), 'utf8');
if (!fieldSrc.includes('aria-describedby') || !fieldSrc.includes('data-vmz-ui="field"')) {
    errors.push('Field must expose label/description association markers');
}
if (!dialogSrc.includes('data-vmz-overlay="dialog"') || !dialogSrc.includes('data-vmz-focus="enter"')) {
    errors.push('Dialog must expose overlay ownership + focus-enter markers');
}
if (!dialogSrc.includes('_enterFocus') || !dialogSrc.includes('_exitFocus') || !dialogSrc.includes('MutationObserver')) {
    errors.push('Dialog must implement focus enter/restore via overlay DOM observer');
}
if (!dialogSrc.includes('dismiss') || !dialogSrc.includes('Escape')) {
    errors.push('Dialog must support outside dismiss + Escape');
}

console.log('official-dogfood: build homepage…');
const homeBuild = runVmzBuild(HOMEPAGE, root);
if (homeBuild.status !== 0) {
    errors.push(`homepage build failed: ${(homeBuild.stderr || homeBuild.stdout).slice(0, 1200)}`);
} else {
    for (const file of ['Button.client.js', 'Field.client.js', 'Dialog.client.js', 'vmz-designs.css']) {
        // Button may live at dist/Button.client.js; Field/Dialog similarly after ui.vmz dogfood
        const direct = path.join(homeBuild.dist, file);
        const nested = path.join(homeBuild.dist, 'components', file);
        if (!fs.existsSync(direct) && !fs.existsSync(nested)) {
            // search dist tree
            const hit = walkFind(homeBuild.dist, file);
            if (!hit) errors.push(`homepage dist missing ${file}`);
        }
    }
    if (!existsRel(HOMEPAGE, 'documents', 'documents.config.ts')) {
        errors.push('homepage missing documents.config.ts');
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'ui.vmz')) {
        errors.push('homepage missing /ui dogfood page');
    }
    const indexVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/index.vmz'), 'utf8');
    if (!indexVmz.includes('<Button')) errors.push('homepage index must dogfood Button');
    const uiVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/ui.vmz'), 'utf8');
    if (!uiVmz.includes('<Field') || !uiVmz.includes('<Dialog')) {
        errors.push('homepage /ui must dogfood Field + Dialog');
    }
    for (const tag of ['Checkbox', 'Switch', 'Tabs', 'Menu', 'Drawer', 'Popover']) {
        if (!uiVmz.includes(`<${tag}`)) errors.push(`homepage /ui must dogfood <${tag}>`);
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'commercial.vmz')) {
        errors.push('homepage missing /commercial composition page');
    } else {
        const commercialVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/commercial.vmz'), 'utf8');
        for (const tag of ['AppShell', 'Card', 'Alert', 'Empty', 'Form', 'Field', 'Dialog', 'Drawer']) {
            if (!commercialVmz.includes(`<${tag}`)) {
                errors.push(`homepage /commercial must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'form.vmz')) {
        errors.push('homepage missing /form composition page');
    } else {
        const formVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/form.vmz'), 'utf8');
        for (const tag of [
            'Form',
            'FormItem',
            'Field',
            'Select',
            'TextArea',
            'RadioGroup',
            'Autocomplete',
            'Tooltip',
            'DatePicker',
            'Upload',
            'Checkbox',
            'Result',
        ]) {
            if (!formVmz.includes(`<${tag}`)) {
                errors.push(`homepage /form must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'console.vmz')) {
        errors.push('homepage missing /console composition page');
    } else {
        const consoleVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/console.vmz'), 'utf8');
        for (const tag of ['ConsoleShell', 'FilterBar', 'Table', 'BulkActions', 'Pagination', 'Field', 'Drawer']) {
            if (!consoleVmz.includes(`<${tag}`)) {
                errors.push(`homepage /console must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'motion.vmz')) {
        errors.push('homepage missing /motion continuity page');
    } else {
        const motionVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/motion.vmz'), 'utf8');
        for (const tag of ['Button', 'Dialog', 'Drawer', 'Table']) {
            if (!motionVmz.includes(`<${tag}`)) {
                errors.push(`homepage /motion must dogfood <${tag}>`);
            }
        }
        if (!motionVmz.includes('data-dogfood="motion-interrupt"')) {
            errors.push('homepage /motion must dogfood interrupt/cancel section');
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'ui4.vmz')) {
        errors.push('homepage missing /ui4 surface page');
    } else {
        const ui4Vmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/ui4.vmz'), 'utf8');
        for (const tag of ['AppShell', 'Alert', 'Notification', 'Result', 'Empty', 'Card', 'Button']) {
            if (!ui4Vmz.includes(`<${tag}`)) {
                errors.push(`homepage /ui4 must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'ui5.vmz')) {
        errors.push('homepage missing /ui5 console surface page');
    } else {
        const ui5Vmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/ui5.vmz'), 'utf8');
        for (const tag of ['ConsoleShell', 'Breadcrumb', 'QueryForm', 'Skeleton', 'Table', 'Timeline', 'Field', 'Drawer']) {
            if (!ui5Vmz.includes(`<${tag}`)) {
                errors.push(`homepage /ui5 must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'ui6.vmz')) {
        errors.push('homepage missing /ui6 density/rtl/preset page');
    } else {
        const ui6Vmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/ui6.vmz'), 'utf8');
        for (const tag of ['AppShell', 'Alert', 'Card', 'Field', 'Button']) {
            if (!ui6Vmz.includes(`<${tag}`)) {
                errors.push(`homepage /ui6 must dogfood <${tag}>`);
            }
        }
        if (!ui6Vmz.includes('data-density') || !ui6Vmz.includes('dir={dir}')) {
            errors.push('homepage /ui6 must bind data-density and dir');
        }
    }
    if (!existsRel(HOMEPAGE, 'designs', 'themes', 'high-contrast.json')) {
        errors.push('homepage missing designs/themes/high-contrast.json');
    }
    if (!existsRel('packages/ui/vmz-ui', 'presets', 'web-surface.v0.json')) {
        errors.push('@vmz/ui missing presets/web-surface.v0.json');
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'structure.vmz')) {
        errors.push('homepage missing /structure composition page');
    } else {
        const structureVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/structure.vmz'), 'utf8');
        for (const tag of ['Accordion', 'Steps', 'List', 'Tree', 'AppShell', 'Card']) {
            if (!structureVmz.includes(`<${tag}`)) {
                errors.push(`homepage /structure must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'stacking.vmz')) {
        errors.push('homepage missing /stacking overlay page');
    } else {
        const stackingVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/stacking.vmz'), 'utf8');
        for (const tag of ['Drawer', 'Dialog', 'Popover']) {
            if (!stackingVmz.includes(`<${tag}`)) {
                errors.push(`homepage /stacking must dogfood <${tag}>`);
            }
        }
        if (!stackingVmz.includes('stackLevel')) {
            errors.push('homepage /stacking must set stackLevel');
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'datatable.vmz')) {
        errors.push('homepage missing /datatable page');
    } else {
        const dtVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/datatable.vmz'), 'utf8');
        for (const tag of ['DataTable', 'BulkActions', 'ConsoleShell', 'Drawer']) {
            if (!dtVmz.includes(`<${tag}`)) {
                errors.push(`homepage /datatable must dogfood <${tag}>`);
            }
        }
    }
    if (!existsRel(HOMEPAGE, 'src', 'pages', 'product.vmz')) {
        errors.push('homepage missing /product document surface page');
    } else {
        const productVmz = fs.readFileSync(path.join(root, HOMEPAGE, 'src/pages/product.vmz'), 'utf8');
        for (const tag of ['AppShell', 'Prose', 'Toc', 'Callout', 'CodeBlock', 'Field', 'Button']) {
            if (!productVmz.includes(`<${tag}`)) {
                errors.push(`homepage /product must dogfood <${tag}>`);
            }
        }
        if (!productVmz.includes('data-density') || !productVmz.includes('dir={dir}')) {
            errors.push('homepage /product must bind data-density and dir');
        }
    }
    if (!existsRel(HOMEPAGE, 'designs', 'document', 'chrome.css')) {
        errors.push('homepage missing designs/document/chrome.css');
    } else {
        const chrome = fs.readFileSync(path.join(root, HOMEPAGE, 'designs/document/chrome.css'), 'utf8');
        if (!chrome.includes('var(--vmz-density-control-padding-y') || !chrome.includes("data-density='dense'")) {
            errors.push('homepage document chrome must consume density tokens');
        }
    }
}

console.log('official-dogfood: serve homepage SSR…');
let homeSsrOk = false;
let homeSsrDetail = '';
if (homeBuild.status === 0) {
    const dist = homeBuild.dist;
    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) {
        homeSsrDetail = 'missing serve-host';
    } else {
        const child = spawn(process.execPath, [hostJs], {
            cwd: dist,
            env: { ...process.env, VMZ_DIST: dist, VMZ_HOST: '127.0.0.1', VMZ_PORT: String(PORT) },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        try {
            await waitServe(child, 10000);
            const home = await get(`http://127.0.0.1:${PORT}/`);
            const ui = await get(`http://127.0.0.1:${PORT}/ui`);
            const commercial = await get(`http://127.0.0.1:${PORT}/commercial`);
            const formPage = await get(`http://127.0.0.1:${PORT}/form`);
            const consolePage = await get(`http://127.0.0.1:${PORT}/console`);
            const motionPage = await get(`http://127.0.0.1:${PORT}/motion`);
            const ui4Page = await get(`http://127.0.0.1:${PORT}/ui4`);
            const ui5Page = await get(`http://127.0.0.1:${PORT}/ui5`);
            const ui6Page = await get(`http://127.0.0.1:${PORT}/ui6`);
            const structurePage = await get(`http://127.0.0.1:${PORT}/structure`);
            const stackingPage = await get(`http://127.0.0.1:${PORT}/stacking`);
            const datatablePage = await get(`http://127.0.0.1:${PORT}/datatable`);
            const productPage = await get(`http://127.0.0.1:${PORT}/product`);
            if (home.status !== 200 || !home.body.includes('landing-brand')) {
                homeSsrDetail = `GET / ${home.status}`;
            } else if (ui.status !== 200 || !ui.body.includes('data-dogfood="ui-lab"')) {
                homeSsrDetail = `GET /ui ${ui.status} missing ui-lab`;
            } else if (!ui.body.includes('data-vmz-ui="field"')) {
                homeSsrDetail = 'GET /ui missing Field marker';
            } else if (commercial.status !== 200 || !commercial.body.includes('data-dogfood="commercial"')) {
                homeSsrDetail = `GET /commercial ${commercial.status} missing commercial dogfood`;
            } else if (!commercial.body.includes('data-vmz-ui="app-shell"')) {
                homeSsrDetail = 'GET /commercial missing AppShell marker';
            } else if (!commercial.body.includes('data-vmz-ui="form"')) {
                homeSsrDetail = 'GET /commercial missing Form marker';
            } else if (formPage.status !== 200 || !formPage.body.includes('data-dogfood="form"')) {
                homeSsrDetail = `GET /form ${formPage.status} missing form dogfood`;
            } else if (
                !formPage.body.includes('data-vmz-ui="form-item"') ||
                !formPage.body.includes('data-vmz-ui="select"') ||
                !formPage.body.includes('data-vmz-ui="textarea"') ||
                !formPage.body.includes('data-vmz-ui="radio-group"') ||
                !formPage.body.includes('data-vmz-ui="date-picker"') ||
                !formPage.body.includes('data-vmz-ui="upload"')
            ) {
                homeSsrDetail = 'GET /form missing FormItem/Select/TextArea/RadioGroup/DatePicker/Upload markers';
            } else if (consolePage.status !== 200 || !consolePage.body.includes('data-dogfood="console"')) {
                homeSsrDetail = `GET /console ${consolePage.status} missing console dogfood`;
            } else if (!consolePage.body.includes('data-vmz-ui="console-shell"')) {
                homeSsrDetail = 'GET /console missing ConsoleShell marker';
            } else if (motionPage.status !== 200 || !motionPage.body.includes('data-dogfood="motion"')) {
                homeSsrDetail = `GET /motion ${motionPage.status} missing motion dogfood`;
            } else if (!motionPage.body.includes('data-vmz-motion="control"')) {
                homeSsrDetail = 'GET /motion missing Button motion marker';
            } else if (ui4Page.status !== 200 || !ui4Page.body.includes('data-dogfood="ui4"')) {
                homeSsrDetail = `GET /ui4 ${ui4Page.status} missing ui4 dogfood`;
            } else if (!ui4Page.body.includes('data-vmz-ui="notification"') || !ui4Page.body.includes('data-vmz-ui="result"')) {
                homeSsrDetail = 'GET /ui4 missing Notification/Result markers';
            } else if (ui5Page.status !== 200 || !ui5Page.body.includes('data-dogfood="ui5"')) {
                homeSsrDetail = `GET /ui5 ${ui5Page.status} missing ui5 dogfood`;
            } else if (
                !ui5Page.body.includes('data-vmz-ui="breadcrumb"') ||
                !ui5Page.body.includes('data-vmz-ui="query-form"') ||
                !ui5Page.body.includes('data-vmz-ui="timeline"')
            ) {
                homeSsrDetail = 'GET /ui5 missing Breadcrumb/QueryForm/Timeline markers';
            } else if (ui6Page.status !== 200 || !ui6Page.body.includes('data-dogfood="ui6"')) {
                homeSsrDetail = `GET /ui6 ${ui6Page.status} missing ui6 dogfood`;
            } else if (
                !ui6Page.body.includes('data-density="comfortable"') ||
                !ui6Page.body.includes('dir="ltr"') ||
                !ui6Page.body.includes('data-vmz-ui="field"')
            ) {
                homeSsrDetail = 'GET /ui6 missing density/dir/Field markers';
            } else if (structurePage.status !== 200 || !structurePage.body.includes('data-dogfood="structure"')) {
                homeSsrDetail = `GET /structure ${structurePage.status} missing structure dogfood`;
            } else if (
                !structurePage.body.includes('data-vmz-ui="accordion"') ||
                !structurePage.body.includes('data-vmz-ui="steps"') ||
                !structurePage.body.includes('data-vmz-ui="list"') ||
                !structurePage.body.includes('data-vmz-ui="tree"')
            ) {
                homeSsrDetail = 'GET /structure missing Accordion/Steps/List/Tree markers';
            } else if (stackingPage.status !== 200 || !stackingPage.body.includes('data-dogfood="stacking"')) {
                homeSsrDetail = `GET /stacking ${stackingPage.status} missing stacking dogfood`;
            } else if (!stackingPage.body.includes('Open drawer (stack 0)')) {
                homeSsrDetail = 'GET /stacking missing stacking controls';
            } else if (datatablePage.status !== 200 || !datatablePage.body.includes('data-dogfood="datatable"')) {
                homeSsrDetail = `GET /datatable ${datatablePage.status} missing datatable dogfood`;
            } else if (!datatablePage.body.includes('data-vmz-ui="data-table"') || !datatablePage.body.includes('data-vmz-select-all')) {
                homeSsrDetail = 'GET /datatable missing DataTable markers';
            } else if (productPage.status !== 200 || !productPage.body.includes('data-dogfood="product"')) {
                homeSsrDetail = `GET /product ${productPage.status} missing product dogfood`;
            } else if (
                !productPage.body.includes('data-density="comfortable"') ||
                !productPage.body.includes('dir="ltr"') ||
                !productPage.body.includes('data-vmz-ui="prose"')
            ) {
                homeSsrDetail = 'GET /product missing density/dir/Prose markers';
            } else {
                homeSsrOk = true;
                homeSsrDetail =
                    'SSR / + /ui + /commercial + /form + /console + /motion + /ui4 + /ui5 + /ui6 + /structure + /stacking + /datatable + /product';
            }
        } catch (e) {
            homeSsrDetail = e instanceof Error ? e.message : String(e);
        } finally {
            try {
                child.kill('SIGTERM');
            } catch {
                /* ignore */
            }
        }
    }
}
if (!homeSsrOk) errors.push(`homepage SSR: ${homeSsrDetail}`);

console.log('official-dogfood: documents-fixture…');
let docsOk = false;
let docsDetail = '';
{
    const docProject = path.join(root, DOCUMENTS);
    const r = spawnSync(process.execPath, [vmzBin(root), 'document', 'build', docProject], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status !== 0) {
        // fallback: some fixtures use `vmz document build` without path as cwd
        const r2 = spawnSync(process.execPath, [vmzBin(root), 'document', 'build'], {
            cwd: docProject,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        if (r2.status !== 0) {
            docsDetail = (r2.stderr || r2.stdout || r.stderr || r.stdout || '').slice(0, 800);
        } else {
            docsOk = true;
        }
    } else {
        docsOk = true;
    }
    if (docsOk) {
        const en = path.join(docProject, 'dist/documents/en-us/index.html');
        const zh = path.join(docProject, 'dist/documents/zh-hans/index.html');
        const evidence = path.join(docProject, 'documents/en-us/guide/evidence.md');
        if (!fs.existsSync(en) || !fs.existsSync(zh)) {
            docsOk = false;
            docsDetail = 'missing locale HTML under dist/documents';
        } else if (!fs.existsSync(evidence) || !fs.readFileSync(evidence, 'utf8').includes('vmz-api:')) {
            docsOk = false;
            docsDetail = 'evidence.md missing vmz-api source evidence';
        } else {
            const densTok = path.join(docProject, 'designs/tokens/semantic-density.json');
            const cssCandidates = [
                path.join(docProject, 'dist/documents/assets/vmz-designs.css'),
                path.join(docProject, 'dist/documents/vmz-designs.css'),
            ];
            const cssPath = cssCandidates.find((p) => fs.existsSync(p));
            if (!fs.existsSync(densTok)) {
                docsOk = false;
                docsDetail = 'documents-fixture missing semantic-density.json';
            } else if (!cssPath) {
                docsOk = false;
                docsDetail = 'documents build missing vmz-designs.css asset';
            } else {
                const css = fs.readFileSync(cssPath, 'utf8');
                if (
                    !css.includes('--vmz-density-control-padding-y') ||
                    !css.includes('--vmz-density-dense-padding-y') ||
                    !css.includes("data-density='dense'")
                ) {
                    docsOk = false;
                    docsDetail = 'documents CSS missing density token emit / dense activation';
                } else {
                    docsDetail = 'documents HTML + evidence + density tokens';
                }
            }
        }
    }
}
if (!docsOk) errors.push(`documents: ${docsDetail}`);

console.log('official-dogfood: production-inspector…');
const inspBuild = runVmzBuild(INSPECTOR, root);
let inspOk = false;
let inspDetail = '';
if (inspBuild.status !== 0) {
    inspDetail = (inspBuild.stderr || inspBuild.stdout).slice(0, 1200);
} else {
    const need = ['Field.client.js', 'Dialog.client.js', 'Button.client.js'];
    const missing = need.filter((f) => !walkFind(inspBuild.dist, f));
    if (missing.length) {
        inspDetail = `missing ${missing.join(',')}`;
    } else {
        const page = fs.readFileSync(path.join(inspBuild.dist, 'pages/index.client.js'), 'utf8');
        const src = fs.readFileSync(path.join(root, INSPECTOR, 'src/pages/index.vmz'), 'utf8');
        if (!src.includes('data-dogfood') && !page.includes('data-dogfood')) {
            inspDetail = 'inspector page missing dogfood markers';
        } else if (!src.includes('<AppShell') || !src.includes('data-density') || !src.includes('dir={dir}')) {
            inspDetail = 'inspector must dogfood AppShell + density/dir';
        } else {
            const designsCss = path.join(inspBuild.dist, 'vmz-designs.css');
            if (!fs.existsSync(designsCss) || !fs.readFileSync(designsCss, 'utf8').includes('--vmz-density-dense-padding-y')) {
                inspDetail = 'inspector vmz-designs.css missing density.dense';
            } else {
                inspOk = true;
                inspDetail = 'ordinary Application + AppShell/Field/Dialog + density/RTL markers';
            }
        }
    }
}
if (!inspOk) errors.push(`inspector: ${inspDetail}`);

const proof = readProof(root);
upsertCheck(proof, {
    id: 'official-dogfood.ui',
    status: errors.some(
        (e) => e.includes('Field') || e.includes('Dialog') || e.includes('Button') || e.includes('ui contract') || e.includes('brand hex'),
    )
        ? 'failed'
        : 'passed',
    detail: 'Button/Field/Dialog token contract + overlay/focus markers',
});
upsertCheck(proof, {
    id: 'official-dogfood.homepage',
    status: homeSsrOk ? 'passed' : 'failed',
    detail: homeSsrDetail,
});
upsertCheck(proof, {
    id: 'official-dogfood.documents',
    status: docsOk ? 'passed' : 'failed',
    detail: docsDetail,
});
upsertCheck(proof, {
    id: 'official-dogfood.panel',
    status: inspOk ? 'passed' : 'failed',
    detail: inspDetail,
});
upsertCheck(proof, {
    id: 'official-dogfood',
    status: errors.length ? 'failed' : 'passed',
    detail: 'homepage + documents + inspector via ordinary Application/@vmz/ui composition',
});

const gaps = [
    'Dogfood: sibling vmz-panel product app not gated in this driver (production-inspector stands in as ordinary panel-shaped app)',
    'Dogfood: I2 LocaleTransition / I3 hreflang / homepage locale switch matrix not covered (I1 runtime emit thin slice only)',
    'Dogfood: documents search UX not covered',
];
for (const g of gaps) addLimitation(proof, g);
proof.knownLimitations = proof.knownLimitations.filter(
    (l) =>
        !l.includes('Dogfood: homepage/documents/panel') &&
        !l.includes('Dogfood: VMZ UI Field/Dialog') &&
        !l.includes('Dogfood: Field/Dialog focus-loop') &&
        !l.includes('Dogfood: homepage locale switch matrix + documents search UX'),
);

writeProof(proof, root);
if (errors.length) fail(errors.join('\n'));

console.log('official-dogfood PASS: homepage SSR + documents + inspector + @vmz/ui Field/Dialog');
console.log('official-dogfood NOTE: sibling vmz-panel / @vmz/ui-data-grid deep / UI7 browser-timing still open');
console.log(
    'official-dogfood NOTE: UI1–UI6 + Form depth + Structure + Stacking + DataTable + documents/panel density + Commercial/Console/Motion browser proof lives in `pnpm verify -- ui-automation`; Motion IR depth + UI7 pack in `pnpm verify -- ui7`',
);

function walkFind(dir: string, fileName: string): string | null {
    if (!fs.existsSync(dir)) return null;
    const stack = [dir];
    while (stack.length) {
        const cur = stack.pop()!;
        for (const name of fs.readdirSync(cur)) {
            const full = path.join(cur, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
                if (name === 'node_modules') continue;
                stack.push(full);
            } else if (name === fileName) {
                return full;
            }
        }
    }
    return null;
}

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
            const parts: Buffer[] = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8') }));
        });
        req.on('error', reject);
    });
}

function waitServe(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('serve-host start timeout')), timeoutMs);
        const onData = (buf: Buffer) => {
            if (String(buf).includes('vmz serve http://')) {
                clearTimeout(t);
                child.stdout?.off('data', onData);
                resolve();
            }
        };
        child.stdout?.on('data', onData);
        child.stderr?.on('data', (b) => process.stderr.write(b));
        child.on('exit', (code) => {
            clearTimeout(t);
            reject(new Error(`serve-host exited early ${code}`));
        });
    });
}
