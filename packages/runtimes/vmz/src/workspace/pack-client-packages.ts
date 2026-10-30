/**
 * Browser-safe client package lowering (Pack stage thin slice).
 *
 * Bare npm/workspace imports are legal on the author surface (01/04).
 * Browser ESM cannot resolve them. Pack materializes reachable package
 * modules under `dist/vendor/<pkg>/…` and rewrites importers to relative paths
 * via a bounded rewrite of generated module syntax. Pack must not re-enter the
 * parser pipeline for every emitted JavaScript file.
 *
 * This stage is only that thin slice. Linking, dead-code elimination, chunk
 * splitting, and minification are NOT implemented here — the pack manifest
 * reports their absence rather than a placeholder backend.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolvePackageRoot } from './packages.js';
import { requireNativeAddon } from './native-addon.js';

const VENDOR_DIR = 'vendor';
const SKIP_PREFIXES = ['node:', 'nodejs:', 'cloudflare:', 'data:', 'http:', 'https:', 'vmz:', '#'];
const STYLE_EXT = /\.css$/i;
/** `new URL('<file>', import.meta.url)` — runtime assets a vendored module loads itself. */
const IMPORT_META_URL_RE = /\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g;
/** `url(<file>)` inside a vendored stylesheet. */
const CSS_URL_RE = /\burl\s*\(\s*(['"]?)([^'")\n]+)\1\s*\)/g;

/**
 * @param {string} outDir
 * @param {{ projectRoot?: string | null }} [opts]
 * @returns {{ rewrittenFiles: number, vendoredModules: string[], bareSpecs: string[] }}
 */
interface PackClientBareImportsOpts {
    projectRoot?: string | null;
}

export function packClientBareImports(outDir: string, opts: PackClientBareImportsOpts = {}) {
    const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : path.dirname(path.resolve(outDir));
    /** @type {Map<string, string>} bareSpec → absolute vendored .js path */
    const bareToVendor = new Map();
    /** @type {Set<string>} absolute source files already materialized */
    const materializedSources = new Set();
    /** @type {string[]} */
    const bareQueue: Array<{ spec: string; from: string }> = [];
    /** @type {string[]} */
    const unresolved = [];
    /** @type {string[]} */
    const skippedVmz = [];

    for (const file of listClientJs(outDir)) {
        for (const spec of collectBareSpecs(readFileSync(file, 'utf8'))) {
            bareQueue.push({ spec: String(spec), from: file });
        }
    }

    while (bareQueue.length) {
        const item = bareQueue.shift()!;
        const { spec } = item;
        if (bareToVendor.has(spec)) continue;
        const resolved = resolveBareToSource(projectRoot, spec, item.from);
        if (!resolved) {
            if (!unresolved.includes(spec)) unresolved.push(spec);
            continue;
        }
        if (/\.vmz$/i.test(resolved.sourceFile)) {
            if (!skippedVmz.includes(spec)) skippedVmz.push(spec);
            continue;
        }

        // Stylesheets are not browser modules: materialize the CSS (plus its
        // `url()` assets) and expose a loader module that links it once.
        if (STYLE_EXT.test(resolved.sourceFile)) {
            const styleDest = vendorPathForSource(
                outDir,
                resolved.pkgName,
                resolved.pkgRoot,
                resolved.sourceFile,
            );
            materializeStyleFile(resolved.sourceFile, styleDest);
            const loaderDest = `${styleDest}.js`;
            writeFileSync(loaderDest, styleLoaderSource(path.basename(styleDest)), 'utf8');
            bareToVendor.set(spec, loaderDest);
            continue;
        }

        const destAbs = materializeSourceTree(outDir, resolved, materializedSources, bareQueue);
        if (destAbs) bareToVendor.set(spec, destAbs);
        else if (!unresolved.includes(spec)) unresolved.push(spec);
    }

    /** @type {string[]} */
    const rewritten = [];
    for (const file of [...listClientJs(outDir), ...listVendorJs(outDir)]) {
        const before = readFileSync(file, 'utf8');
        let after = rewriteBareImports(before, file, bareToVendor);
        try {
            after = rewritePackModuleSpecifiers(after);
        } catch (error) {
            throw new Error(`pack module ${file}: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (after !== before) {
            writeFileSync(file, after, 'utf8');
            rewritten.push(path.relative(outDir, file).replace(/\\/g, '/'));
        }
    }

    // Any bare that remains in client (non-vendor) JS after rewrite is still browser-broken.
    /** @type {string[]} */
    const remaining = [];
    for (const file of listClientJs(outDir)) {
        for (const spec of collectBareSpecs(readFileSync(file, 'utf8'))) {
            if (!remaining.includes(spec)) remaining.push(spec);
        }
    }

    return {
        rewrittenFiles: rewritten.length,
        vendoredModules: [...bareToVendor.values()].map((abs) => path.relative(outDir, abs).replace(/\\/g, '/')),
        bareSpecs: [...bareToVendor.keys()],
        unresolvedBareSpecs: unresolved,
        skippedVmzExports: skippedVmz,
        remainingBareSpecs: remaining,
    };
}

/**
 * Materialize `resolved.sourceFile` and its relative import closure under vendor/.
 * @returns {string | null} vendor path for the entry source
 */
function materializeSourceTree(outDir, resolved, materializedSources, bareQueue) {
    /** @type {string[]} */
    const sourceQueue = [resolved.sourceFile];
    // Subpath bare specs often land on a file already vendored via a relative
    // import from the package root — still map the bare name to that vendor path.
    /** @type {string | null} */
    let entryDest = vendorPathForSource(outDir, resolved.pkgName, resolved.pkgRoot, resolved.sourceFile);

    while (sourceQueue.length) {
        const sourceFile = sourceQueue.shift();
        if (materializedSources.has(sourceFile)) continue;
        materializedSources.add(sourceFile);

        const destAbs = vendorPathForSource(outDir, resolved.pkgName, resolved.pkgRoot, sourceFile);
        mkdirSync(path.dirname(destAbs), { recursive: true });
        const js = materializeModule(sourceFile);
        writeFileSync(destAbs, js, 'utf8');
        materializeRuntimeAssets(sourceFile, destAbs, js);
        if (sourceFile === resolved.sourceFile) entryDest = destAbs;

        for (const bare of collectBareSpecs(js)) bareQueue.push({ spec: String(bare), from: sourceFile });
        for (const rel of collectRelativeSpecs(js)) {
            const target = resolveRelativeSource(path.dirname(sourceFile), rel);
            if (target && !materializedSources.has(target)) sourceQueue.push(target);
        }
        // Also follow relative imports as written in the *source* (before transpile),
        // so `./catalog.ts` is discovered even if transpile already rewrote to `.js`.
        const raw = readFileSync(sourceFile, 'utf8');
        for (const rel of collectRelativeSpecs(raw)) {
            const target = resolveRelativeSource(path.dirname(sourceFile), rel);
            if (target && !materializedSources.has(target)) sourceQueue.push(target);
        }
    }
    return entryDest;
}

function listClientJs(outDir) {
    /** @type {string[]} */
    const out = [];
    walk(outDir, (file) => {
        const rel = path.relative(outDir, file).replace(/\\/g, '/');
        if (rel.startsWith('_vmz/') || rel.startsWith(`${VENDOR_DIR}/`) || rel.startsWith('#server/') || rel.startsWith('_vmz_server/')) {
            return;
        }
        if (rel.endsWith('.js') || rel.endsWith('.mjs')) out.push(file);
    });
    return out;
}

function listVendorJs(outDir) {
    const root = path.join(outDir, VENDOR_DIR);
    if (!existsSync(root)) return [];
    /** @type {string[]} */
    const out = [];
    walk(root, (file) => {
        if (file.endsWith('.js') || file.endsWith('.mjs')) out.push(file);
    });
    return out;
}

function walk(dir, visit) {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const full = path.join(dir, name);
        let st;
        try {
            st = statSync(full);
        } catch {
            continue;
        }
        if (st.isDirectory()) walk(full, visit);
        else visit(full);
    }
}

/** @param {string} js */
export function collectBareSpecs(js) {
    /** @type {Set<string>} */
    const specs = new Set();
    const add = (spec) => {
        if (!spec || isRelativeOrAbsolute(spec) || shouldSkipBare(spec)) return;
        specs.add(spec);
    };
    // `from 'x'` covers import/export … from
    let m;
    const fromRe = /\bfrom\s*['"]([^'"]+)['"]/g;
    while ((m = fromRe.exec(js))) add(m[1]);
    const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynRe.exec(js))) add(m[1]);
    // side-effect: import 'x' (not import( and not import … from)
    const sideRe = /\bimport\s*['"]([^'"]+)['"]/g;
    while ((m = sideRe.exec(js))) add(m[1]);
    return [...specs];
}

function collectRelativeSpecs(js) {
    /** @type {Set<string>} */
    const specs = new Set();
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(js))) specs.add(m[1]);
    return [...specs];
}

function isRelativeOrAbsolute(spec) {
    return spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('\\');
}

function shouldSkipBare(spec) {
    return SKIP_PREFIXES.some((p) => spec.startsWith(p));
}

function resolveBareToSource(projectRoot, spec, fromFile) {
    const { pkgName, subpath } = splitPackageSpec(spec);
    let pkgRoot = null;
    if (fromFile && existsSync(fromFile)) {
        let cur = path.dirname(realpathSync(fromFile));
        for (let i = 0; i < 12; i++) {
            const nested = path.join(cur, 'node_modules', ...pkgName.split('/'));
            if (existsSync(path.join(nested, 'package.json'))) {
                pkgRoot = nested;
                break;
            }
            const parent = path.dirname(cur);
            if (parent === cur) break;
            cur = parent;
        }
    }
    if (!pkgRoot) pkgRoot = resolvePackageRoot(projectRoot, pkgName);
    if (!pkgRoot) {
        let cur = projectRoot;
        for (let i = 0; i < 8; i++) {
            pkgRoot = resolvePackageRoot(cur, pkgName);
            if (pkgRoot) break;
            const parent = path.dirname(cur);
            if (parent === cur) break;
            cur = parent;
        }
    }
    if (!pkgRoot) return null;
    const sourceFile = resolveExportFile(pkgRoot, subpath);
    if (!sourceFile) return null;
    return { pkgName, pkgRoot, subpath, sourceFile };
}

function splitPackageSpec(spec) {
    if (spec.startsWith('@')) {
        const parts = spec.split('/');
        if (parts.length < 2) return { pkgName: spec, subpath: '' };
        return { pkgName: `${parts[0]}/${parts[1]}`, subpath: parts.slice(2).join('/') };
    }
    const i = spec.indexOf('/');
    if (i < 0) return { pkgName: spec, subpath: '' };
    return { pkgName: spec.slice(0, i), subpath: spec.slice(i + 1) };
}

function resolveExportFile(pkgRoot, subpath) {
    const pkgPath = path.join(pkgRoot, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const key = subpath ? `./${subpath}` : '.';
    let target = null;
    if (pkg.exports && typeof pkg.exports === 'object' && !Array.isArray(pkg.exports)) {
        const entry = pkg.exports[key] ?? (!subpath ? pkg.exports['.'] : null);
        target = flattenExportTarget(entry);
        if (!target && subpath) target = matchWildcardExport(pkg.exports, key);
    }
    if (!target && !subpath) target = pkg.module || pkg.main || './index.js';
    if (!target && subpath) {
        for (const cand of [
            path.join(pkgRoot, 'src', `${subpath}.ts`),
            path.join(pkgRoot, 'src', `${subpath}.js`),
            path.join(pkgRoot, `${subpath}.ts`),
            path.join(pkgRoot, `${subpath}.js`),
            path.join(pkgRoot, 'src', subpath, 'index.ts'),
            path.join(pkgRoot, 'src', subpath, 'index.js'),
        ]) {
            if (existsSync(cand) && statSync(cand).isFile()) return cand;
        }
        return null;
    }
    if (!target || typeof target !== 'string') return null;
    const abs = path.resolve(pkgRoot, target);
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
    for (const ext of ['.ts', '.tsx', '.js', '.mjs']) {
        const c = abs.endsWith(ext) ? abs : abs + ext;
        if (existsSync(c) && statSync(c).isFile()) return c;
    }
    return null;
}

/** Longest-prefix `./*` / `./js/*` style export match for a subpath key. */
function matchWildcardExport(exportsMap, key) {
    let best = null;
    let bestPrefix = -1;
    for (const [pattern, entry] of Object.entries(exportsMap)) {
        const star = pattern.indexOf('*');
        if (star < 0) continue;
        const prefix = pattern.slice(0, star);
        const suffix = pattern.slice(star + 1);
        if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
        const target = flattenExportTarget(entry);
        if (typeof target !== 'string') continue;
        const middle = key.slice(prefix.length, key.length - suffix.length);
        if (prefix.length > bestPrefix) {
            best = target.replace('*', middle);
            bestPrefix = prefix.length;
        }
    }
    return best;
}

function flattenExportTarget(entry) {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return null;
    // Package authors commonly put browser-first TypeScript sources behind a
    // conditional export. Resolve conditions before falling back to Node's
    // import/default branches so the pack stage can transpile the source into
    // the browser-safe vendor tree before static SSR imports it.
    const v = entry.browser || entry.import || entry.default || entry.require || entry.module || entry.node || null;
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') return flattenExportTarget(v);
    return null;
}

function vendorPathForSource(outDir, pkgName, pkgRoot, sourceFile) {
    const rel = path.relative(pkgRoot, sourceFile).replace(/\\/g, '/');
    return path.join(outDir, VENDOR_DIR, packageDirName(pkgName), rewriteTsExt(rel));
}

function packageDirName(pkgName) {
    return pkgName.replace(/^@/, '');
}

function materializeModule(sourceFile) {
    const ext = path.extname(sourceFile).toLowerCase();
    const raw = readFileSync(sourceFile, 'utf8');
    if (ext === '.json') return raw;
    if (ext === '.ts' || ext === '.tsx') return transpileTs(raw, sourceFile);
    try {
        return rewritePackModuleSpecifiers(raw);
    } catch (error) {
        throw new Error(`pack source ${sourceFile}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function isLocalAssetRef(ref) {
    const value = ref.trim();
    if (!value) return false;
    if (value.startsWith('/') || value.startsWith('\\') || value.startsWith('#')) return false;
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
}

function copyVendoredAsset(fromDir, destDir, ref) {
    const cleaned = ref.replace(/[?#].*$/, '');
    if (!isLocalAssetRef(cleaned)) return;
    const source = path.resolve(fromDir, cleaned);
    let stat;
    try {
        stat = statSync(source);
    } catch {
        return;
    }
    if (!stat.isFile()) return;
    const dest = path.resolve(destDir, cleaned);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(source, dest);
}

/**
 * Copy files a vendored module loads by URL at runtime (`new URL(…, import.meta.url)`),
 * so `.wasm`, `.json` payloads, … stay reachable next to their module.
 */
function materializeRuntimeAssets(sourceFile, destAbs, js) {
    IMPORT_META_URL_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_META_URL_RE.exec(js))) {
        copyVendoredAsset(path.dirname(sourceFile), path.dirname(destAbs), match[2]);
    }
}

/** Copy a stylesheet and everything its `url()` references. */
function materializeStyleFile(sourceFile, destAbs) {
    const css = readFileSync(sourceFile, 'utf8');
    mkdirSync(path.dirname(destAbs), { recursive: true });
    writeFileSync(destAbs, css, 'utf8');
    CSS_URL_RE.lastIndex = 0;
    let match;
    while ((match = CSS_URL_RE.exec(css))) {
        copyVendoredAsset(path.dirname(sourceFile), path.dirname(destAbs), match[2]);
    }
}

/**
 * Loader module for a vendored stylesheet: links it once and exposes the load
 * promise as the default export.
 */
function styleLoaderSource(fileName) {
    return `const href = new URL(${JSON.stringify(`./${fileName}`)}, import.meta.url).href;
const ready =
    typeof document === 'undefined'
        ? Promise.resolve()
        : Array.from(document.querySelectorAll('link[rel="stylesheet"]')).some((el) => el.href === href)
            ? Promise.resolve()
            : new Promise((resolve, reject) => {
                  const link = document.createElement('link');
                  link.rel = 'stylesheet';
                  link.href = href;
                  link.onload = () => resolve();
                  link.onerror = () => reject(new Error('VMZ stylesheet failed to load: ' + href));
                  document.head.appendChild(link);
              });
export default ready;
`;
}

function transpileTs(source, filename) {
    try {
        const require = createRequire(import.meta.url);
        const ts = require('typescript');
        const out = ts.transpileModule(source, {
            fileName: filename,
            compilerOptions: {
                module: ts.ModuleKind.ESNext,
                target: ts.ScriptTarget.ES2022,
                moduleResolution: ts.ModuleResolutionKind.Bundler,
                esModuleInterop: true,
                skipLibCheck: true,
            },
        });
        return rewritePackModuleSpecifiers(out.outputText || '');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `/* vmz-pack: typescript transpile failed (${msg}) */\n${rewritePackModuleSpecifiers(source)}`;
    }
}

function rewriteTsExt(p) {
    // Path basename only (output layout) — not ESM source rewrite.
    return String(p)
        .replace(/\.tsx$/i, '.js')
        .replace(/\.ts$/i, '.js');
}

/** Native (N-API) module specifier rewrite (`.ts`→`.js` + optional exact map). */
export function rewriteRelativeTsSpecs(js, exactMap = null) {
    const source = String(js ?? '');
    const hasModuleTsSpecifier = /(?:import\s*(?:[^'"()]*?\s*from\s*)?|export\s+[^'"()]*?\s*from\s*|import\s*\()(['"])[^'"\r\n]+\.tsx?\1/i.test(
        source,
    );
    const exactKeys = Object.keys(exactMap ?? {});
    const hasExactSpecifier = exactKeys.some((spec) => source.includes(`'${spec}'`) || source.includes(`"${spec}"`));
    if (!hasModuleTsSpecifier && !hasExactSpecifier) {
        return source;
    }
    const native = requireNativeAddon();
    if (typeof native.rewriteModuleSpecifiers !== 'function') {
        throw new Error('native missing rewriteModuleSpecifiers — run `pnpm napi:build`');
    }
    const rules = {
        tsExtToJs: true,
        exact: exactMap && typeof exactMap === 'object' ? exactMap : {},
    };
    return native.rewriteModuleSpecifiers(String(js ?? ''), JSON.stringify(rules));
}

function resolveRelativeSource(fromDir, rel) {
    const cleaned = rel.replace(/\?.*$/, '').replace(/#.*$/, '');
    const base = path.resolve(fromDir, cleaned);
    for (const cand of [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        path.join(base, 'index.ts'),
        path.join(base, 'index.js'),
    ]) {
        try {
            if (existsSync(cand) && statSync(cand).isFile()) return cand;
        } catch {
            /* ignore */
        }
    }
    return null;
}

function rewriteBareImports(js, fromFile, bareToVendor) {
    /** @type {Record<string, string>} */
    const exact = {};
    for (const [spec, dest] of bareToVendor.entries()) {
        if (isRelativeOrAbsolute(spec) || shouldSkipBare(spec)) continue;
        let rel = path.relative(path.dirname(fromFile), dest).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        exact[spec] = rel;
    }
    return rewritePackModuleSpecifiers(js, exact);
}

function rewritePackModuleSpecifiers(source, exactMap = null) {
    const rewrite = (spec) => {
        const exact = exactMap && exactMap[spec];
        if (typeof exact === 'string') return exact;
        return /\.tsx?$/i.test(spec) ? spec.replace(/\.tsx?$/i, '.js') : spec;
    };
    const replace = (match, quote, spec) => {
        const next = rewrite(spec);
        return next === spec ? match : match.replace(`${quote}${spec}${quote}`, `${quote}${next}${quote}`);
    };

    let out = source.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, replace);
    out = out.replace(/\bimport\s+[^;\n]*?\sfrom\s+(['"])([^'"]+)\1/g, replace);
    out = out.replace(/\bimport\s*(['"])([^'"]+)\1/g, replace);
    return out.replace(/\bfrom\s*(['"])([^'"]+)\1/g, replace);
}
