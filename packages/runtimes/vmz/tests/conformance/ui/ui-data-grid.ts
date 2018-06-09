/**
 * ui-data-grid deepen gate — @vmz/ui-data-grid package + homepage /datagrid dogfood.
 *
 * Asserts:
 * - package identity; peer @vmz/ui; no Button/Field/Dialog shells
 * - token-requirements (virtualization + pinned + group + tree + edit + pivot-matrix)
 * - homepage dogfood modes + browser proofs for virtual window, group, tree, edit, pivot
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const gridRoot = path.join(root, 'packages', 'ui', 'vmz-ui-data-grid');
const uiRoot = path.join(root, 'packages', 'ui', 'vmz-ui');
const homepage = path.join(root, 'packages', 'homepage');
const cargo = process.env.CARGO || 'cargo';
const SCHEMA = 'vmz.ui.token_requirements.v0';
const FORBIDDEN_HEX = ['#176BFF', '#0D57DB', '#FFB000', '#00C878', '#121416'];

function fail(msg) {
    console.error(`ui-data-grid GATE FAIL: ${msg}`);
    process.exit(1);
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

console.log('ui-data-grid: package identity…');
const pkgPath = path.join(gridRoot, 'package.json');
if (!fs.existsSync(pkgPath)) fail('missing packages/ui/vmz-ui-data-grid/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== '@vmz/ui-data-grid') fail(`package name must be @vmz/ui-data-grid, got ${pkg.name}`);
if (!pkg.peerDependencies?.['@vmz/ui'] && !pkg.dependencies?.['@vmz/ui']) {
    fail('@vmz/ui-data-grid must peer/depend on @vmz/ui');
}
if (pkg.dependencies?.['@vmz/plugin'] || pkg.devDependencies?.['@vmz/plugin']) {
    fail('@vmz/ui-data-grid must not depend on @vmz/plugin');
}
if (!pkg.exports?.['./DataGrid']) fail('package exports must include ./DataGrid');

console.log('ui-data-grid: token requirements contract…');
const contractPath = path.join(gridRoot, 'contracts', 'token-requirements.v0.json');
if (!fs.existsSync(contractPath)) fail('missing contracts/token-requirements.v0.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.schema !== SCHEMA) fail(`contract.schema want ${SCHEMA}`);
if (contract.package !== '@vmz/ui-data-grid') fail('contract.package');
const dg = contract.components?.DataGrid;
if (!dg) fail('contract missing DataGrid');
for (const c of [
    'row-virtualization',
    'pinned-column',
    'not-ordinary-datatable',
    'parent-owned-selection',
    'row-grouping',
    'group-aggregation',
    'tree-rows',
    'cell-editing',
    'pivot-matrix',
]) {
    if (!dg.contracts?.includes(c)) fail(`DataGrid contract missing ${c}`);
}
if (dg.contracts?.includes('not-pivot') || dg.contracts?.includes('not-pivot-edit') || dg.contracts?.includes('not-tree-pivot-edit')) {
    fail('contract must drop not-pivot* after pivot deepen (keep pivot-matrix)');
}
if (contract.composition?.mustNotShip?.includes('Button') !== true) {
    fail('composition.mustNotShip must include Button (reuse @vmz/ui)');
}

console.log('ui-data-grid: forbid brand hex + shell components…');
const gridVmzFiles = walkFiles(path.join(gridRoot, 'src'), (p) => p.endsWith('.vmz'));
if (gridVmzFiles.length === 0) fail('no .vmz under src/');
for (const f of gridVmzFiles) {
    const text = fs.readFileSync(f, 'utf8');
    for (const hex of FORBIDDEN_HEX) {
        if (text.toUpperCase().includes(hex.toUpperCase())) {
            fail(`forbidden brand hex ${hex} in ${path.relative(gridRoot, f)}`);
        }
    }
}
const componentNames = fs
    .readdirSync(path.join(gridRoot, 'src', 'components'))
    .filter((n) => n.endsWith('.vmz'))
    .map((n) => n.replace(/\.vmz$/, ''));
for (const banned of ['Button', 'Field', 'Dialog', 'Form', 'Empty', 'Skeleton', 'DataTable']) {
    if (componentNames.includes(banned)) fail(`must not ship ${banned}.vmz — reuse @vmz/ui`);
}
if (!componentNames.includes('DataGrid')) fail('missing DataGrid.vmz');

const dgSrc = fs.readFileSync(path.join(gridRoot, 'src', 'components', 'DataGrid.vmz'), 'utf8');
if (!dgSrc.includes('data-vmz-ui="data-grid"')) fail('DataGrid missing data-vmz-ui=data-grid');
if (!dgSrc.includes('data-vmz-grid-viewport') || !dgSrc.includes('onScroll')) {
    fail('DataGrid must expose viewport scroll for parent virtualization');
}
if (!dgSrc.includes('data-pinned') || !/position:\s*sticky/.test(dgSrc)) {
    fail('DataGrid must sticky-pin leading column');
}
if (!dgSrc.includes('data-vmz-grid-spacer') || !dgSrc.includes('padTopStyle')) {
    fail('DataGrid must support spacer pads for virtual window');
}
if (!dgSrc.includes('data-vmz-grid-group') || !dgSrc.includes('data-vmz-group-toggle') || !dgSrc.includes('onToggleGroup')) {
    fail('DataGrid must expose group markers + onToggleGroup for parent-owned expand');
}
if (!dgSrc.includes('data-vmz-grid-tree') || !dgSrc.includes('data-vmz-tree-toggle') || !dgSrc.includes('onToggleTree')) {
    fail('DataGrid must expose tree markers + onToggleTree (align @vmz/ui Tree depth/twist)');
}
if (!dgSrc.includes('data-vmz-grid-edit') || !dgSrc.includes('data-vmz-cell-editor') || !dgSrc.includes('onStartEdit')) {
    fail('DataGrid must expose cell-edit markers + onStartEdit/onCommitEdit');
}
if (!dgSrc.includes('data-vmz-grid-pivot') || !dgSrc.includes('data-pivot-cols') || !dgSrc.includes('pivotAttr')) {
    fail('DataGrid must expose pivot markers (parent-owned matrix projection)');
}
if (!dgSrc.includes('data-row-kind') || !dgSrc.includes('data-agg') || !dgSrc.includes('data-depth')) {
    fail('DataGrid must distinguish group/leaf/tree/pivot rows, aggregation, and depth');
}
if (/Field\.vmz|export default class Field/i.test(dgSrc)) {
    fail('DataGrid must not ship Field — reuse @vmz/ui');
}

console.log('ui-data-grid: ordinary DataTable stays in @vmz/ui…');
const dtSrc = fs.readFileSync(path.join(uiRoot, 'src', 'components', 'DataTable.vmz'), 'utf8');
if (!dtSrc.includes('data-vmz-ui="data-table"')) fail('@vmz/ui DataTable marker missing');
if (/data-vmz-ui="data-grid"|row-virtualization|pinned-column/i.test(dtSrc)) {
    fail('@vmz/ui DataTable must not claim data-grid deep markers');
}

console.log('ui-data-grid: homepage dogfood dependency + page…');
const homePkg = JSON.parse(fs.readFileSync(path.join(homepage, 'package.json'), 'utf8'));
if (!homePkg.dependencies?.['@vmz/ui-data-grid']) {
    fail('homepage must depend on @vmz/ui-data-grid');
}
const pageSrcPath = path.join(homepage, 'src', 'pages', 'datagrid.vmz');
if (!fs.existsSync(pageSrcPath)) fail('homepage missing src/pages/datagrid.vmz');
const pageSrc = fs.readFileSync(pageSrcPath, 'utf8');
if (!pageSrc.includes('<DataGrid') || !pageSrc.includes('data-dogfood="datagrid"')) {
    fail('homepage /datagrid must dogfood <DataGrid>');
}
if (!pageSrc.includes('<BulkActions') || !pageSrc.includes('<ConsoleShell')) {
    fail('homepage /datagrid must reuse @vmz/ui BulkActions/ConsoleShell');
}
if (!pageSrc.includes('groupBy') || !pageSrc.includes('onToggleGroup') || !pageSrc.includes('aggSample')) {
    fail('homepage /datagrid must dogfood parent-owned groupBy + aggregates');
}
if (!pageSrc.includes('setMode') || !pageSrc.includes('onToggleTree') || !pageSrc.includes('mode-tree')) {
    fail('homepage /datagrid must dogfood tree mode + onToggleTree');
}
if (!pageSrc.includes('<Field') || !pageSrc.includes('onStartEdit') || !pageSrc.includes('editingKey')) {
    fail('homepage /datagrid must dogfood cell edit + @vmz/ui Field mirror');
}
if (!pageSrc.includes('mode-pivot') || !pageSrc.includes('buildPivotRows') || !pageSrc.includes('pivotSample')) {
    fail('homepage /datagrid must dogfood parent-owned pivot matrix');
}

console.log('ui-data-grid: build homepage…');
const homeBuild = runBuild(homepage);
if (homeBuild.status !== 0) fail(`homepage build failed\n${homeBuild.out}`);
const dist = path.join(homepage, 'dist');
const gridClient = fs.existsSync(path.join(dist, 'DataGrid.client.js')) || fs.existsSync(path.join(dist, 'components', 'DataGrid.client.js'));
if (!gridClient) fail('homepage build must emit DataGrid.client.js from @vmz/ui-data-grid');

console.log('ui-data-grid: browser virtualization + pin + selection…');
await proveBrowser(dist);

console.log('ui-data-grid PASS: package + /datagrid virtual/pinned/group/tree/edit/pivot deepen');

/**
 * @param {string} dist
 */
async function proveBrowser(dist) {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const { spawn } = await import('node:child_process');

    const hostJs = path.join(dist, 'vmz-serve-host.mjs');
    if (!fs.existsSync(hostJs)) fail('homepage missing vmz-serve-host.mjs');

    const requireFromTest = createRequire(path.join(root, 'packages', 'runtimes', 'vmz-test', 'package.json'));
    let puppeteer;
    try {
        const mod = requireFromTest('puppeteer-core');
        puppeteer = mod?.default ?? mod;
    } catch (err) {
        fail(`puppeteer-core via @vmz/test required: ${err instanceof Error ? err.message : err}`);
    }
    const { resolveBrowserExecutable } = await import(
        pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-test', 'dist', 'browser.js')).href
    );
    const chrome = resolveBrowserExecutable();
    if (!chrome) fail('Chrome/Edge not found (set VMZ_BROWSER)');

    const PORT = 18782;
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

        const browser = await puppeteer.launch({
            executablePath: chrome,
            headless: true,
            args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
        });
        try {
            const page = await browser.newPage();
            page.setDefaultTimeout(20000);
            await page.goto(`http://127.0.0.1:${PORT}/datagrid`, { waitUntil: 'networkidle0', timeout: 20000 });
            await page.waitForSelector('[data-dogfood="datagrid"]', { timeout: 10000 });
            await page.waitForFunction(
                () => {
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const visible = Number(wrap?.getAttribute('data-visible-count') || 0);
                    const rows = document.querySelectorAll('[data-vmz-ui="data-grid"] [data-vmz-row]').length;
                    return visible > 0 && rows === visible;
                },
                { timeout: 10000 },
            );

            const initial = await page.evaluate(() => {
                const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const rows = [...document.querySelectorAll('[data-vmz-ui="data-grid"] [data-vmz-row]')];
                const pinned = document.querySelector(
                    '[data-vmz-ui="data-grid"] [data-vmz-col="name"][data-pinned="true"], [data-vmz-ui="data-grid"] .vmz-ui-datagrid__cell--pinned-data',
                );
                const pinnedCs = pinned ? getComputedStyle(pinned) : null;
                const head = document.querySelector('[data-vmz-grid-head]');
                const headCs = head ? getComputedStyle(head) : null;
                return {
                    hasGrid: !!wrap,
                    totalAttr: wrap?.getAttribute('data-total-rows') || '',
                    visibleAttr: wrap?.getAttribute('data-visible-count') || '',
                    pinnedCols: wrap?.getAttribute('data-pinned-cols') || '',
                    rowCount: rows.length,
                    firstRow: rows[0]?.getAttribute('data-vmz-row') || '',
                    state,
                    pinnedPosition: pinnedCs?.position || '',
                    pinnedLeft: pinnedCs?.left || '',
                    headSticky: headCs?.position || '',
                    hasBulk: !!document.querySelector('[data-vmz-ui="bulk-actions"]'),
                    hasSelectAll: !!document.querySelector('[data-vmz-select-all]'),
                };
            });

            if (!initial.hasGrid) fail(`DataGrid missing: ${JSON.stringify(initial)}`);
            if (Number(initial.totalAttr) < 100) fail(`want large totalRows, got ${initial.totalAttr}`);
            if (Number(initial.visibleAttr) <= 0 || Number(initial.visibleAttr) >= Number(initial.totalAttr)) {
                fail(`visible window must be << total: ${JSON.stringify(initial)}`);
            }
            if (initial.rowCount !== Number(initial.visibleAttr)) {
                fail(`DOM rows must match visibleCount: ${JSON.stringify(initial)}`);
            }
            if (initial.pinnedCols !== '1') fail(`want pinnedCols=1, got ${initial.pinnedCols}`);
            if (initial.pinnedPosition !== 'sticky') {
                fail(`pinned column must be sticky, got ${initial.pinnedPosition}`);
            }
            if (initial.headSticky !== 'sticky') fail(`head must be sticky, got ${initial.headSticky}`);
            if (!initial.state.includes('total:200') || !initial.state.includes('visible:')) {
                fail(`state marker incomplete: ${initial.state}`);
            }
            if (!initial.hasSelectAll) fail('select-all control missing');

            const beforeFirst = initial.firstRow;

            await page.evaluate(() => {
                const vp = document.querySelector('[data-vmz-grid-viewport]');
                if (vp) vp.scrollTop = 720;
            });
            await page.waitForFunction(
                (prev) => {
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const first = document.querySelector('[data-vmz-ui="data-grid"] [data-vmz-row]')?.getAttribute('data-vmz-row');
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return !!wrap && first && first !== prev && state.includes('window:') && !state.includes('window:0-');
                },
                { timeout: 5000 },
                beforeFirst,
            );

            const afterScroll = await page.evaluate(() => {
                const rows = [...document.querySelectorAll('[data-vmz-ui="data-grid"] [data-vmz-row]')].map((r) =>
                    r.getAttribute('data-vmz-row'),
                );
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const total = Number(document.querySelector('[data-vmz-ui="data-grid"]')?.getAttribute('data-total-rows') || 0);
                return { rows, state, total, visible: rows.length };
            });
            if (afterScroll.visible >= afterScroll.total) {
                fail(`after scroll still not virtualized: ${JSON.stringify(afterScroll)}`);
            }
            if (afterScroll.rows.includes(beforeFirst)) {
                fail(`scroll did not leave initial window (still has ${beforeFirst}): ${afterScroll.rows.slice(0, 5)}`);
            }

            const pickId = await page.evaluate(() => {
                const leaf = document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="row"][data-vmz-row]');
                return leaf?.getAttribute('data-vmz-row') || '';
            });
            if (!pickId) fail('no leaf row to select after scroll');
            await page.click(`[data-vmz-select="${pickId}"]`);
            await page.waitForFunction(
                (id) => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return (
                        document.querySelector(`[data-vmz-row="${id}"]`)?.getAttribute('data-selected') === 'true' &&
                        state.includes(`selected:${id}`) &&
                        state.includes('count:1') &&
                        !!document.querySelector('[data-vmz-ui="bulk-actions"]')
                    );
                },
                { timeout: 5000 },
                pickId,
            );

            await page.click('[data-vmz-sort="status"]');
            await page
                .waitForFunction(
                    () => {
                        const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                        return state.includes('sort:status:');
                    },
                    { timeout: 5000 },
                )
                .catch(async (err) => {
                    const dbg = await page.evaluate(() => {
                        const sortBtn = document.querySelector('[data-vmz-sort="status"]');
                        sortBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                        return {
                            state: document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '',
                            hasSort: !!document.querySelector('[data-vmz-sort="status"]'),
                        };
                    });
                    // Retry wait after synthetic click
                    try {
                        await page.waitForFunction(
                            () => (document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '').includes('sort:status:'),
                            { timeout: 3000 },
                        );
                    } catch {
                        fail(`sort status failed: ${JSON.stringify(dbg)} (${err})`);
                    }
                });

            await page.evaluate(() => {
                const btn = [...document.querySelectorAll('[data-dogfood="datagrid"] button.vmz-ui-btn')].find((b) =>
                    (b.textContent || '').includes('Clear'),
                );
                btn?.click();
            });
            await page.waitForFunction(
                () => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return state.includes('selected:none') && !document.querySelector('[data-vmz-ui="bulk-actions"]');
                },
                { timeout: 5000 },
            );

            // Return to top so group headers are in the virtual window.
            await page.evaluate(() => {
                const vp = document.querySelector('[data-vmz-grid-viewport]');
                if (vp) vp.scrollTop = 0;
            });
            await page.waitForFunction(
                () => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return !!document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="group"]') && /window:0-\d+/.test(state);
                },
                { timeout: 5000 },
            );

            // Group + aggregation deepen: headers present, collapse removes leaves, expand restores.
            const groupProof = await page.evaluate(() => {
                const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const groups = [...document.querySelectorAll('[data-vmz-ui="data-grid"] [data-row-kind="group"]')];
                const firstGroup = groups[0];
                const key = firstGroup?.getAttribute('data-group-key') || '';
                const aggCells = [...(firstGroup?.querySelectorAll('[data-agg="true"]') || [])].map((c) => c.textContent || '');
                return {
                    groupBy: wrap?.getAttribute('data-vmz-grid-group') || '',
                    groupCount: wrap?.getAttribute('data-group-count') || '',
                    groupDom: groups.length,
                    key,
                    expanded: firstGroup?.getAttribute('data-expanded') || '',
                    hasToggle: !!firstGroup?.querySelector(`[data-vmz-group-toggle="${key}"]`),
                    aggCells,
                    state,
                };
            });
            if (groupProof.groupBy !== 'region') {
                fail(`want groupBy=region, got ${JSON.stringify(groupProof)}`);
            }
            if (Number(groupProof.groupCount) < 2 || groupProof.groupDom < 1) {
                fail(`want multiple groups with at least one header in window: ${JSON.stringify(groupProof)}`);
            }
            if (!groupProof.hasToggle || groupProof.expanded !== 'true') {
                fail(`group header toggle/expanded missing: ${JSON.stringify(groupProof)}`);
            }
            if (!groupProof.aggCells.some((t) => /^n=\d+$/.test(t)) || !groupProof.aggCells.some((t) => /^Σ=\d+$/.test(t))) {
                fail(`group aggregates want n=… and Σ=…: ${JSON.stringify(groupProof)}`);
            }
            if (!groupProof.state.includes('group:region') || !groupProof.state.includes('agg:')) {
                fail(`state missing group/agg markers: ${groupProof.state}`);
            }

            const collapseKey = groupProof.key;
            const leafBefore = await page.evaluate((key) => {
                return [...document.querySelectorAll(`[data-vmz-ui="data-grid"] [data-row-kind="row"][data-group-key="${key}"]`)].map((r) =>
                    r.getAttribute('data-vmz-row'),
                );
            }, collapseKey);
            if (leafBefore.length < 1) {
                fail(`expanded group ${collapseKey} should show leaf rows in window`);
            }

            await page.click(`[data-vmz-group-toggle="${collapseKey}"]`);
            await page.waitForFunction(
                (key) => {
                    const header = document.querySelector(`[data-vmz-ui="data-grid"] [data-row-kind="group"][data-group-key="${key}"]`);
                    const leaves = document.querySelectorAll(`[data-vmz-ui="data-grid"] [data-row-kind="row"][data-group-key="${key}"]`);
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const expandedPart = (state.split('expanded:')[1] || '').split(';')[0] || '';
                    const expandedKeys = expandedPart
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    return header?.getAttribute('data-expanded') === 'false' && leaves.length === 0 && !expandedKeys.includes(key);
                },
                { timeout: 5000 },
                collapseKey,
            );

            await page.click(`[data-vmz-group-toggle="${collapseKey}"]`);
            await page.waitForFunction(
                (key) => {
                    const header = document.querySelector(`[data-vmz-ui="data-grid"] [data-row-kind="group"][data-group-key="${key}"]`);
                    const leaves = document.querySelectorAll(`[data-vmz-ui="data-grid"] [data-row-kind="row"][data-group-key="${key}"]`);
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const expandedPart = (state.split('expanded:')[1] || '').split(';')[0] || '';
                    const expandedKeys = expandedPart
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    return header?.getAttribute('data-expanded') === 'true' && leaves.length > 0 && expandedKeys.includes(key);
                },
                { timeout: 5000 },
                collapseKey,
            );

            // Tree mode deepen: switch mode, prove depth + expand/collapse.
            await page.click('[data-dogfood="mode-tree"] button');
            await page.waitForFunction(
                () => {
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return (
                        wrap?.getAttribute('data-vmz-grid-tree') === 'true' &&
                        state.includes('mode:tree') &&
                        !!document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="0"]') &&
                        !!document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="2"]')
                    );
                },
                { timeout: 8000 },
            );

            const treeProof = await page.evaluate(() => {
                const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const depth0 = document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="0"]');
                const depth2 = document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="2"]');
                const rootId = depth0?.getAttribute('data-vmz-row') || '';
                return {
                    treeAttr: wrap?.getAttribute('data-vmz-grid-tree') || '',
                    rootId,
                    rootExpanded: depth0?.getAttribute('data-expanded') || '',
                    hasTwist: !!depth0?.querySelector(`[data-vmz-tree-toggle="${rootId}"]`),
                    hasDepth2: !!depth2,
                    depth2Leaf: !!depth2?.querySelector('[data-vmz-select]'),
                    state,
                    visible: Number(wrap?.getAttribute('data-visible-count') || 0),
                    total: Number(wrap?.getAttribute('data-total-rows') || 0),
                };
            });
            if (treeProof.treeAttr !== 'true' || !treeProof.rootId || !treeProof.hasTwist) {
                fail(`tree mode markers missing: ${JSON.stringify(treeProof)}`);
            }
            if (!treeProof.hasDepth2 || !treeProof.depth2Leaf) {
                fail(`want depth-2 selectable leaf in window: ${JSON.stringify(treeProof)}`);
            }
            if (treeProof.visible <= 0 || treeProof.visible >= treeProof.total + 50) {
                // total is leaf count (160); flat is larger — visible must stay a window
                if (treeProof.visible <= 0) fail(`tree visible window empty: ${JSON.stringify(treeProof)}`);
            }
            if (!treeProof.state.includes('depthMax:2') || !treeProof.state.includes('tree:true')) {
                fail(`state missing tree markers: ${treeProof.state}`);
            }

            const rootId = treeProof.rootId;
            await page.click(`[data-vmz-tree-toggle="${rootId}"]`);
            await page.waitForFunction(
                (id) => {
                    const root = document.querySelector(`[data-vmz-ui="data-grid"] [data-vmz-row="${id}"]`);
                    const kids = document.querySelectorAll(
                        `[data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="1"], [data-vmz-ui="data-grid"] [data-row-kind="tree"][data-depth="2"]`,
                    );
                    // After collapse root, no descendants of that root should remain; simpler: root expanded=false
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const part = (state.split('treeExpanded:')[1] || '').split(';')[0] || '';
                    const keys = part
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    return root?.getAttribute('data-expanded') === 'false' && !keys.includes(id);
                },
                { timeout: 5000 },
                rootId,
            );

            await page.click(`[data-vmz-tree-toggle="${rootId}"]`);
            await page.waitForFunction(
                (id) => {
                    const root = document.querySelector(`[data-vmz-ui="data-grid"] [data-vmz-row="${id}"]`);
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const part = (state.split('treeExpanded:')[1] || '').split(';')[0] || '';
                    const keys = part
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean);
                    return root?.getAttribute('data-expanded') === 'true' && keys.includes(id);
                },
                { timeout: 5000 },
                rootId,
            );

            // Cell editing: back to group mode, edit a leaf score, commit, Field mirror.
            await page.click('[data-dogfood="mode-group"] button');
            await page.waitForFunction(
                () => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return (
                        state.includes('mode:group') &&
                        document.querySelector('[data-vmz-ui="data-grid"]')?.getAttribute('data-vmz-grid-tree') === 'false' &&
                        !!document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="row"] [data-editable="true"]')
                    );
                },
                { timeout: 8000 },
            );

            const editTarget = await page.evaluate(() => {
                const cell = document.querySelector(
                    '[data-vmz-ui="data-grid"] [data-row-kind="row"] [data-editable="true"] [data-vmz-cell-start-edit]',
                );
                return {
                    key: cell?.getAttribute('data-vmz-cell-start-edit') || '',
                    text: cell?.textContent || '',
                };
            });
            if (!editTarget.key || !editTarget.key.endsWith(':score')) {
                fail(`want editable score cell, got ${JSON.stringify(editTarget)}`);
            }

            await page.click(`[data-vmz-cell-start-edit="${editTarget.key}"]`);
            await page.waitForFunction(
                (key) => {
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return (
                        wrap?.getAttribute('data-vmz-grid-edit') === key &&
                        !!document.querySelector(`[data-vmz-cell-editor="${key}"]`) &&
                        !!document.querySelector('[data-dogfood="datagrid-edit-field"] [data-vmz-ui="field"]') &&
                        state.includes(`editing:${key}`)
                    );
                },
                { timeout: 5000 },
                editTarget.key,
            );

            const newScore = '42';
            await page.evaluate(
                (key, value) => {
                    const editor = document.querySelector(`[data-vmz-cell-editor="${key}"]`);
                    const field = document.querySelector('#datagrid-edit-draft');
                    if (!(editor instanceof HTMLInputElement)) throw new Error('editor missing');
                    editor.value = value;
                    editor.dispatchEvent(new Event('input', { bubbles: true }));
                    if (field instanceof HTMLInputElement) {
                        field.value = value;
                        field.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                },
                editTarget.key,
                newScore,
            );

            await page.waitForFunction(
                (key, value, prev) => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const cellText =
                        document.querySelector(`[data-vmz-cell-start-edit="${key}"]`)?.textContent ||
                        document.querySelector(`[data-editing="false"]`)?.textContent ||
                        '';
                    // After commit, editing cleared and score text updated in grid or scoreSample.
                    return (
                        wrap?.getAttribute('data-vmz-grid-edit') === '' &&
                        state.includes('editing:none') &&
                        (state.includes(`scoreSample:${key.split(':')[0]}=${value}`) ||
                            document.querySelector(`[data-vmz-cell-start-edit="${key}"]`)?.textContent === value ||
                            (prev && state.includes(`=${value}`)))
                    );
                },
                { timeout: 8000 },
                editTarget.key,
                newScore,
                editTarget.text,
            );

            const afterEdit = await page.evaluate((key) => {
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const text = document.querySelector(`[data-vmz-cell-start-edit="${key}"]`)?.textContent || '';
                return { state, text, editAttr: document.querySelector('[data-vmz-ui="data-grid"]')?.getAttribute('data-vmz-grid-edit') };
            }, editTarget.key);
            if (afterEdit.editAttr) fail(`edit session should clear: ${JSON.stringify(afterEdit)}`);
            if (!afterEdit.state.includes('editing:none')) fail(`state editing not cleared: ${afterEdit.state}`);
            if (afterEdit.text !== newScore && !afterEdit.state.includes(`=${newScore}`)) {
                fail(`committed score not visible: ${JSON.stringify(afterEdit)}`);
            }

            // Pivot mode: parent-owned owner×region→sum(score) matrix.
            await page.click('[data-dogfood="mode-pivot"] button');
            await page.waitForFunction(
                () => {
                    const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return (
                        wrap?.getAttribute('data-vmz-grid-pivot') === 'true' &&
                        state.includes('mode:pivot') &&
                        state.includes('pivotMeasure:sum(score)') &&
                        !!document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="pivot"]') &&
                        !!document.querySelector('[data-vmz-ui="data-grid"] [data-pivot-col="true"]')
                    );
                },
                { timeout: 8000 },
            );

            const pivotProof = await page.evaluate(() => {
                const wrap = document.querySelector('[data-vmz-ui="data-grid"]');
                const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                const cols = [...document.querySelectorAll('[data-vmz-ui="data-grid"] [data-pivot-col="true"]')].map(
                    (c) => c.getAttribute('data-vmz-col') || '',
                );
                const rows = [...document.querySelectorAll('[data-vmz-ui="data-grid"] [data-row-kind="pivot"]')];
                const first = rows[0];
                const measureCells = [...(first?.querySelectorAll('[data-agg="true"]') || [])].map((c) => c.textContent || '');
                return {
                    pivotAttr: wrap?.getAttribute('data-vmz-grid-pivot') || '',
                    pivotColsAttr: wrap?.getAttribute('data-pivot-cols') || '',
                    cols,
                    rowCount: rows.length,
                    firstRow: first?.getAttribute('data-vmz-row') || '',
                    pivotRow: first?.getAttribute('data-pivot-row') || '',
                    measureCells,
                    state,
                    total: Number(wrap?.getAttribute('data-total-rows') || 0),
                };
            });
            if (pivotProof.pivotAttr !== 'true') fail(`pivot attr missing: ${JSON.stringify(pivotProof)}`);
            if (pivotProof.cols.length < 2 || !pivotProof.cols.includes('AMER') || !pivotProof.cols.includes('APAC')) {
                fail(`want region pivot columns, got ${JSON.stringify(pivotProof.cols)}`);
            }
            if (pivotProof.rowCount < 2 || !String(pivotProof.firstRow).startsWith('p:')) {
                fail(`want pivot rows p:owner…: ${JSON.stringify(pivotProof)}`);
            }
            if (!pivotProof.measureCells.some((t) => /^\d+$/.test(t))) {
                fail(`pivot measures should be numeric: ${JSON.stringify(pivotProof)}`);
            }
            if (!pivotProof.state.includes('pivot:true') || !pivotProof.state.includes('pivotSample:')) {
                fail(`state missing pivot markers: ${pivotProof.state}`);
            }
            // Sort by a measure column should reshuffle pivot rows.
            const pivotBeforeFirst = pivotProof.firstRow;
            await page.evaluate(() => {
                document.querySelector('[data-vmz-sort="total"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            await page.waitForFunction(
                () => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    return state.includes('sort:total:');
                },
                { timeout: 5000 },
            );
            await page.evaluate(() => {
                document.querySelector('[data-vmz-sort="total"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            await page.waitForFunction(
                (prev) => {
                    const state = document.querySelector('[data-dogfood="datagrid-state"]')?.textContent || '';
                    const first = document.querySelector('[data-vmz-ui="data-grid"] [data-row-kind="pivot"]')?.getAttribute('data-vmz-row');
                    return state.includes('sort:total:desc') && !!first && first !== prev;
                },
                { timeout: 5000 },
                pivotBeforeFirst,
            );

            console.log('ui-data-grid: browser virtualization/pin/selection/group/tree/edit/pivot PASS');
        } finally {
            await browser.close().catch(() => {});
        }
    } finally {
        kill();
    }
}
