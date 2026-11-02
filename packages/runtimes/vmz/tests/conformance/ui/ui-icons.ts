/**
 * ui-icons thin gate — @vmz/ui-icons package + semantic Icon registry.
 *
 * Asserts:
 * - package identity; peer @vmz/ui; no Button/Field/Dialog/Tooltip shells
 * - token-requirements (semantic-name + registry-not-loose-svg + a11y + token color)
 * - Icon.vmz markers + registry entries for tool.* / action.*
 */

import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const iconsRoot = path.join(root, 'packages', 'ui', 'vmz-ui-icons');
const SCHEMA = 'vmz.ui.token_requirements.v0';
const FORBIDDEN_HEX = ['#176BFF', '#0D57DB', '#FFB000', '#00C878', '#121416'];

function fail(msg) {
    console.error(`ui-icons GATE FAIL: ${msg}`);
    process.exit(1);
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

console.log('ui-icons: package identity…');
const pkgPath = path.join(iconsRoot, 'package.json');
if (!fs.existsSync(pkgPath)) fail('missing packages/ui/vmz-ui-icons/package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (pkg.name !== '@vmz/ui-icons') fail(`package name must be @vmz/ui-icons, got ${pkg.name}`);
if (!pkg.peerDependencies?.['@vmz/ui'] && !pkg.dependencies?.['@vmz/ui']) {
    fail('@vmz/ui-icons must peer/depend on @vmz/ui');
}
if (pkg.dependencies?.['@vmz/plugin'] || pkg.devDependencies?.['@vmz/plugin']) {
    fail('@vmz/ui-icons must not depend on @vmz/plugin');
}
if (!pkg.exports?.['./Icon']) fail('package exports must include ./Icon');
if (!pkg.exports?.['./registry']) fail('package exports must include ./registry');

console.log('ui-icons: token requirements contract…');
const contractPath = path.join(iconsRoot, 'contracts', 'token-requirements.v0.json');
if (!fs.existsSync(contractPath)) fail('missing contracts/token-requirements.v0.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
if (contract.schema !== SCHEMA) fail(`contract.schema want ${SCHEMA}`);
if (contract.package !== '@vmz/ui-icons') fail('contract.package');
const icon = contract.components?.Icon;
if (!icon) fail('contract missing Icon');
for (const c of ['semantic-name', 'registry-not-loose-svg', 'decorative-or-labelled', 'token-color-only']) {
    if (!icon.contracts?.includes(c)) fail(`Icon contract missing ${c}`);
}
if (contract.composition?.mustNotShip?.includes('Button') !== true) {
    fail('composition.mustNotShip must include Button (reuse @vmz/ui)');
}
if (contract.composition?.mustNotShip?.includes('Tooltip') !== true) {
    fail('composition.mustNotShip must include Tooltip (reuse @vmz/ui)');
}

console.log('ui-icons: forbid brand hex + shell components…');
const iconPath = path.join(iconsRoot, 'src', 'Icon.vmz');
if (!fs.existsSync(iconPath)) fail('missing src/Icon.vmz export');
const iconVmzFiles = walkFiles(path.join(iconsRoot, 'src'), (p) => p.endsWith('.vmz'));
if (iconVmzFiles.length === 0) fail('no .vmz under src/');
for (const f of iconVmzFiles) {
    const text = fs.readFileSync(f, 'utf8');
    for (const hex of FORBIDDEN_HEX) {
        if (text.toUpperCase().includes(hex.toUpperCase())) {
            fail(`forbidden brand hex ${hex} in ${path.relative(iconsRoot, f)}`);
        }
    }
}
for (const banned of ['Button', 'Field', 'Dialog', 'Form', 'Empty', 'Skeleton', 'Tooltip']) {
    const bannedPath = path.join(iconsRoot, 'src', 'components', `${banned}.vmz`);
    if (fs.existsSync(bannedPath)) fail(`must not ship ${banned}.vmz — reuse @vmz/ui`);
}

const iconSrc = fs.readFileSync(iconPath, 'utf8');
const registrySrc = fs.readFileSync(path.join(iconsRoot, 'src', 'registry.ts'), 'utf8');
if (!iconSrc.includes('data-vmz-ui="icon"')) fail('Icon missing data-vmz-ui=icon');
if (!iconSrc.includes('data-icon={name}') && !iconSrc.includes('data-icon=')) {
    fail('Icon must expose data-icon from semantic name');
}
if (!iconSrc.includes('registry.ts') || !iconSrc.includes('resolveIconDef')) {
    fail('Icon must import shared registry.ts via resolveIconDef');
}
const categoriesDir = path.join(iconsRoot, 'src', 'icons');
const CATEGORY_PREFIX = {
    action: 'action',
    brand: 'brand',
    commerce: 'commerce',
    data: 'data',
    feature: 'feature',
    file: 'file',
    media: 'media',
    navigation: 'nav',
    social: 'social',
    status: 'status',
    tool: 'tool',
};
const REQUIRED_CATEGORIES = Object.keys(CATEGORY_PREFIX);
const EXPECTED_MIN_ICONS = 117;
const categoryFiles = fs.existsSync(categoriesDir)
    ? fs.readdirSync(categoriesDir).filter((name) => name.endsWith('.ts'))
    : [];
if (categoryFiles.length === 0) fail('src/icons/ must ship one module per category');
const categorySources = new Map();
for (const file of categoryFiles) {
    categorySources.set(file.replace(/\.ts$/, ''), fs.readFileSync(path.join(categoriesDir, file), 'utf8'));
}
for (const category of REQUIRED_CATEGORIES) {
    if (!categorySources.has(category)) fail(`src/icons/ missing the ${category} category module`);
}
for (const [category] of categorySources) {
    if (!registrySrc.includes(`./icons/${category}.ts`)) {
        fail(`registry.ts must import ./icons/${category}.ts — orphan category module`);
    }
}
for (const [category, source] of categorySources) {
    const prefix = CATEGORY_PREFIX[category];
    if (!prefix) fail(`src/icons/${category}.ts is not a registered category — add it to CATEGORY_PREFIX or remove it`);
    for (const keyMatch of source.matchAll(/^\s*'([^']+)':\s*\{/gm)) {
        if (!keyMatch[1].startsWith(`${prefix}.`)) {
            fail(`src/icons/${category}.ts holds "${keyMatch[1]}" which belongs to the ${keyMatch[1].split('.')[0]} category`);
        }
    }
}
const mergedIconSrc = [...categorySources.values()].join('\n');
const actionSrc = categorySources.get('action');
const toolSrc = categorySources.get('tool');
const legacyFillPath = path.join(iconsRoot, 'src', 'icons-legacy-fill.ts');
if (fs.existsSync(legacyFillPath)) {
    fail('icons-legacy-fill.ts must be removed — registry uses stroke and text-badge only');
}
if (
    fs.existsSync(path.join(iconsRoot, 'src', 'icons-stroke.ts')) ||
    fs.existsSync(path.join(iconsRoot, 'src', 'icons-text-badge.ts'))
) {
    fail('flat icon modules must be removed — registry splits per category under src/icons/');
}
if (
    !registrySrc.includes('export const REGISTRY') ||
    !toolSrc.includes("'tool.base64'") ||
    !actionSrc.includes("'action.search'") ||
    !toolSrc.includes("'tool.url'") ||
    !toolSrc.includes("'tool.speed'")
) {
    fail('registry must ship semantic registry (tool.* + action.*), not loose per-page SVG');
}
if (registrySrc.includes('LEGACY_FILL_ICONS') || registrySrc.includes('icons-legacy-fill')) {
    fail('registry.ts must not import legacy fill silhouettes');
}
if (!toolSrc.includes("kind: 'text-badge'") || !iconSrc.includes('vmz-ui-icon__badge')) {
    fail('proprietary tool.* names must use text-badge marks in Icon');
}
if (!registrySrc.includes('resolveIconDef') || !mergedIconSrc.includes("kind: 'stroke'")) {
    fail('registry must use structured IconDef entries via per-category modules');
}
if (registrySrc.includes('LEGACY_ICON_ALIASES') || registrySrc.includes('resolveIconPath')) {
    fail('registry.ts must not keep legacy alias tables or the deprecated resolveIconPath export');
}
if (!/throw new Error\([\s\S]*unknown icon name/.test(registrySrc)) {
    fail('registry must fail loudly on unknown icon names');
}
const iconKeys = [...mergedIconSrc.matchAll(/^\s*'([^']+)':\s*\{/gm)].map((match) => match[1]);
if (iconKeys.length === 0) fail('registry ships no icon entries');
const duplicateKeys = [...new Set(iconKeys.filter((key, index) => iconKeys.indexOf(key) !== index))];
if (duplicateKeys.length > 0) {
    fail(`registry keys must be unique, duplicated: ${duplicateKeys.join(', ')}`);
}
for (const key of iconKeys) {
    if (!/^[a-z][a-z0-9-]*\.[a-z0-9-]+$/.test(key)) {
        fail(`registry key "${key}" must be a dotted semantic name`);
    }
}

console.log('ui-icons: visual geometry rules…');
if (/strokeWidth:\s*[0-9]/.test(mergedIconSrc)) {
    fail('category modules must not override strokeWidth per icon — one 1.75 weight for the whole set');
}
for (const dotsBlock of mergedIconSrc.matchAll(/dots:\s*\[([\s\S]*?)\]/g)) {
    for (const radiusMatch of dotsBlock[1].matchAll(/r:\s*([0-9.]+)/g)) {
        if (Number(radiusMatch[1]) < 1.5) {
            fail(`filled dot radius ${radiusMatch[1]} is below the 1.5 optical weight floor`);
        }
    }
}
for (const [category, source] of categorySources) {
    const strokeEntries = source.split(/\n {4}'/).slice(1);
    const strokeKeyCount = [...source.matchAll(/^\s*'([^']+)':\s*\{/gm)].length;
    if (strokeEntries.length !== strokeKeyCount) {
        fail(`${category}.ts entry parsing drifted — keep one 4-space indented entry per icon`);
    }
    for (const entry of strokeEntries) {
        if (/kind:\s*'text-badge'/.test(entry)) {
            if (!/label:\s*'.+'/.test(entry)) {
                fail(`text-badge entry "${entry.slice(0, entry.indexOf(':')).trim()}" ships an empty label`);
            }
            continue;
        }
        if (!/paths:\s*\[\s*'|circles:\s*\[\s*\{|dots:\s*\[\s*\{|d:\s*'/.test(entry)) {
            fail(`stroke entry "${entry.slice(0, entry.indexOf(':')).trim()}" ships no visible geometry`);
        }
    }
}
if (iconKeys.length < EXPECTED_MIN_ICONS) {
    fail(`registry must not shrink below ${EXPECTED_MIN_ICONS} semantic marks, got ${iconKeys.length}`);
}

for (const px of ['16px', '20px', '24px']) {
    if (!iconSrc.includes(px)) fail(`Icon must ship the ${px} size step`);
}
if (!iconSrc.includes(':role="roleAttr()"') || !iconSrc.includes(':aria-hidden="hiddenAttr()"')) {
    fail('Icon a11y must be derived during render (SSR-stable), not from onMount state');
}
if (!iconSrc.includes('public name') || !iconSrc.includes('public label') || !iconSrc.includes('public size')) {
    fail('Icon must expose public name / size / label props');
}
if (!iconSrc.includes('aria-hidden') || !iconSrc.includes('aria-label')) {
    fail('Icon must support decorative vs labelled a11y');
}
if (
    !iconSrc.includes('color: inherit') &&
    !iconSrc.includes('var(--vmz-action-primary-background)') &&
    !iconSrc.includes('var(--vmz-text-ink)')
) {
    fail('Icon color must inherit parent tokens or use semantic token vars');
}

console.log('ui-icons PASS: package + Icon semantic registry thin gate');
