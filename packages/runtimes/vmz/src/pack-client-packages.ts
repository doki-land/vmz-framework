/**
 * Browser-safe client package lowering (Pack stage thin slice).
 *
 * Bare npm/workspace imports are legal on the author surface (01/04).
 * Browser ESM cannot resolve them. Pack materializes reachable package
 * modules under `dist/vendor/<pkg>/…` and rewrites importers to relative paths.
 *
 * Not full oxc chunk-split/minify (`oxc-pending` remains for release minify).
 */
// @ts-nocheck

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { resolvePackageRoot } from './packages.js';

const VENDOR_DIR = 'vendor';
const SKIP_PREFIXES = ['node:', 'nodejs:', 'cloudflare:', 'data:', 'http:', 'https:', 'vmz:', '#'];

/**
 * @param {string} outDir
 * @param {{ projectRoot?: string | null }} [opts]
 * @returns {{ rewrittenFiles: number, vendoredModules: string[], bareSpecs: string[] }}
 */
export function packClientBareImports(outDir, opts = {}) {
    const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : path.dirname(path.resolve(outDir));
    /** @type {Map<string, string>} bareSpec → absolute vendored .js path */
    const bareToVendor = new Map();
    /** @type {Set<string>} absolute source files already materialized */
    const materializedSources = new Set();
    /** @type {string[]} */
    const bareQueue = [];
    /** @type {string[]} */
    const unresolved = [];
    /** @type {string[]} */
    const skippedVmz = [];

    for (const file of listClientJs(outDir)) {
        for (const spec of collectBareSpecs(readFileSync(file, 'utf8'))) {
            if (!bareQueue.includes(spec)) bareQueue.push(spec);
        }
    }

    while (bareQueue.length) {
        const spec = bareQueue.shift();
        if (bareToVendor.has(spec)) continue;
        const resolved = resolveBareToSource(projectRoot, spec);
        if (!resolved) {
            if (!unresolved.includes(spec)) unresolved.push(spec);
            continue;
        }
        if (/\.vmz$/i.test(resolved.sourceFile)) {
            if (!skippedVmz.includes(spec)) skippedVmz.push(spec);
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
        after = rewriteRelativeTsSpecs(after);
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
        if (sourceFile === resolved.sourceFile) entryDest = destAbs;

        for (const bare of collectBareSpecs(js)) {
            if (!bareQueue.includes(bare)) bareQueue.push(bare);
        }
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
    const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    while ((m = fromRe.exec(js))) add(m[1]);
    const dynRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = dynRe.exec(js))) add(m[1]);
    // side-effect: import 'x' (not import( and not import … from)
    const sideRe = /\bimport\s+['"]([^'"]+)['"]/g;
    while ((m = sideRe.exec(js))) add(m[1]);
    return [...specs];
}

function collectRelativeSpecs(js) {
    /** @type {Set<string>} */
    const specs = new Set();
    const re = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g;
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

function resolveBareToSource(projectRoot, spec) {
    const { pkgName, subpath } = splitPackageSpec(spec);
    let pkgRoot = resolvePackageRoot(projectRoot, pkgName);
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

function flattenExportTarget(entry) {
    if (typeof entry === 'string') return entry;
    if (!entry || typeof entry !== 'object') return null;
    const v = entry.import || entry.default || entry.require || entry.module || null;
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
    if (ext === '.ts' || ext === '.tsx') return transpileTs(raw, sourceFile);
    return rewriteRelativeTsSpecs(raw);
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
        return rewriteRelativeTsSpecs(out.outputText || '');
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return `/* vmz-pack: typescript transpile failed (${msg}) */\n${rewriteRelativeTsSpecs(source)}`;
    }
}

function rewriteTsExt(p) {
    return String(p)
        .replace(/\.tsx$/i, '.js')
        .replace(/\.ts$/i, '.js');
}

export function rewriteRelativeTsSpecs(js) {
    return js
        .replace(/(from\s+['"])(\.[^'"]+)\.tsx(['"])/g, '$1$2.js$3')
        .replace(/(from\s+['"])(\.[^'"]+)\.ts(['"])/g, '$1$2.js$3')
        .replace(/(import\s*\(\s*['"])(\.[^'"]+)\.tsx(['"]\s*\))/g, '$1$2.js$3')
        .replace(/(import\s*\(\s*['"])(\.[^'"]+)\.ts(['"]\s*\))/g, '$1$2.js$3');
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
    const toRel = (spec) => {
        const dest = bareToVendor.get(spec);
        if (!dest) return null;
        let rel = path.relative(path.dirname(fromFile), dest).replace(/\\/g, '/');
        if (!rel.startsWith('.')) rel = `./${rel}`;
        return rel;
    };
    let out = js;
    out = out.replace(/\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g, (full, quote, spec) => {
        if (isRelativeOrAbsolute(spec) || shouldSkipBare(spec)) return full;
        const rel = toRel(spec);
        return rel ? `import(${quote}${rel}${quote})` : full;
    });
    out = out.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (full, quote, spec) => {
        if (isRelativeOrAbsolute(spec) || shouldSkipBare(spec)) return full;
        const rel = toRel(spec);
        return rel ? `from ${quote}${rel}${quote}` : full;
    });
    out = out.replace(/\bimport\s+(['"])([^'"]+)\1/g, (full, quote, spec) => {
        if (isRelativeOrAbsolute(spec) || shouldSkipBare(spec)) return full;
        const rel = toRel(spec);
        return rel ? `import ${quote}${rel}${quote}` : full;
    });
    return out;
}
