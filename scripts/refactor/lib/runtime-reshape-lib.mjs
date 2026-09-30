/**
 * Runtime reshape helpers — manifest validation, TS declaration scan, apply primitives.
 * Used by scripts/refactor/reshape-runtime.mjs (Host and Package Contract 0.2.4).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

export const MANIFEST_SCHEMA = 'vmz.runtime-reshape.v0';

/** @typedef {{ name: string, exported: boolean, kind: string, start: number, end: number, text: string }} TopDecl */
/** @typedef {{ path: string, declarations: string[], note?: string }} SplitModule */
/** @typedef {{ from: string, to: string, distAliases?: string[], note?: string }} WholeMove */
/** @typedef {{ from: string, to: string, files?: string[] }} ReferenceRewrite */
/** @typedef {{ layer: string, forbidden: string[], scope?: string }} ForbiddenImportRule */

/**
 * @param {string} root
 * @param {string} [manifestRel]
 */
export function loadManifest(root, manifestRel = 'scripts/refactor/manifest/runtime-reshape.v0.json') {
    const abs = path.join(root, manifestRel);
    if (!fs.existsSync(abs)) {
        throw new Error(`manifest missing: ${manifestRel}`);
    }
    const manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (manifest.schema !== MANIFEST_SCHEMA) {
        throw new Error(`unexpected manifest schema ${manifest.schema}`);
    }
    return { manifest, abs, rel: manifestRel };
}

/**
 * @param {string} absPath
 * @returns {TopDecl[]}
 */
export function scanTopLevelDeclarations(absPath) {
    const text = fs.readFileSync(absPath, 'utf8');
    const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    /** @type {TopDecl[]} */
    const out = [];
    for (const st of sf.statements) {
        if (ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st) || ts.isExportDeclaration(st)) {
            continue;
        }
        /** @type {string[]} */
        const names = [];
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) names.push(d.name.text);
            }
        } else if (st.name && ts.isIdentifier(st.name)) {
            names.push(st.name.text);
        } else if (ts.isExportAssignment(st)) {
            names.push('default');
        }
        const exported = !!(st.modifiers && st.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
        const kind = ts.SyntaxKind[st.kind] || 'Unknown';
        for (const name of names) {
            out.push({
                name,
                exported,
                kind,
                start: st.getStart(sf, false),
                end: st.getEnd(),
                text: text.slice(st.getStart(sf, false), st.getEnd()),
            });
        }
    }
    return out;
}

/**
 * @param {string} absPath
 */
export function sha256Prefix(absPath, len = 16) {
    return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex').slice(0, len);
}

/**
 * @param {string} root
 * @param {ReturnType<typeof loadManifest>['manifest']} manifest
 */
export function validateManifest(root, manifest) {
    /** @type {string[]} */
    const errors = [];
    /** @type {string[]} */
    const warnings = [];
    /** @type {Record<string, unknown>} */
    const report = {
        schema: manifest.schema,
        revision: manifest.revision,
        sources: {},
        wholeFileMoves: [],
        directories: [],
        forbiddenImports: [],
        referenceDrift: [],
        unassignedDeclarations: [],
        duplicateOwners: [],
        orphanManifestEntries: [],
        productPathDrift: [],
    };

    const pkgRoot = path.join(root, manifest.packageRoot);

    for (const dir of manifest.ensureDirectories || []) {
        const abs = path.join(pkgRoot, dir);
        const exists = fs.existsSync(abs) && fs.statSync(abs).isDirectory();
        report.directories.push({ dir, exists });
        if (!exists) {
            warnings.push(`pending directory ${manifest.packageRoot}/${dir} (run --apply --phase ensure-dirs)`);
        }
    }

    /** @type {Map<string, { source: string, module: string }>} */
    const owners = new Map();

    for (const [sourceRel, spec] of Object.entries(manifest.sources || {})) {
        if (spec.completed) {
            report.sources[sourceRel] = { completed: true };
            continue;
        }
        const abs = path.join(pkgRoot, sourceRel);
        if (!fs.existsSync(abs)) {
            errors.push(`missing source ${manifest.packageRoot}/${sourceRel}`);
            continue;
        }
        const hash = sha256Prefix(abs);
        const decls = scanTopLevelDeclarations(abs);
        const declNames = new Set(decls.map((d) => d.name));
        /** @type {Set<string>} */
        const manifestNames = new Set();

        if (spec.sha256 && spec.sha256 !== hash) {
            errors.push(
                `${sourceRel}: sha256 mismatch (manifest ${spec.sha256}, working tree ${hash}) — refresh manifest before apply`,
            );
        }

        /** @type {Record<string, unknown>} */
        const sourceReport = {
            sha256: hash,
            declarationCount: decls.length,
            modules: [],
            unassigned: [],
        };

        for (const mod of spec.splitInto || []) {
            for (const name of mod.declarations || []) {
                const ownerKey = `${sourceRel}::${name}`;
                if (manifestNames.has(name)) {
                    errors.push(`${sourceRel}: duplicate manifest owner for declaration ${name}`);
                }
                manifestNames.add(name);
                if (owners.has(ownerKey)) {
                    duplicateOwnersPush(errors, name, owners.get(ownerKey), { source: sourceRel, module: mod.path });
                } else {
                    owners.set(ownerKey, { source: sourceRel, module: mod.path });
                }
                if (!declNames.has(name)) {
                    orphanManifestEntriesPush(report, sourceRel, mod.path, name);
                    errors.push(`${sourceRel}: manifest lists missing declaration ${name} (module ${mod.path})`);
                }
            }
            sourceReport.modules.push({
                path: mod.path,
                count: (mod.declarations || []).length,
            });
        }

        for (const d of decls) {
            if (!manifestNames.has(d.name)) {
                if (spec.barrel?.mode === 'partial') {
                    sourceReport.remaining = sourceReport.remaining || [];
                    sourceReport.remaining.push(d.name);
                    continue;
                }
                sourceReport.unassigned.push(d.name);
                report.unassignedDeclarations.push({ source: sourceRel, name: d.name, exported: d.exported });
                errors.push(`${sourceRel}: unassigned declaration ${d.name}`);
            }
        }

        report.sources[sourceRel] = sourceReport;
    }

    for (const move of manifest.wholeFileMoves || []) {
        const fromAbs = path.join(pkgRoot, move.from);
        const toAbs = path.join(pkgRoot, move.to);
        const fromExists = fs.existsSync(fromAbs);
        const toExists = fs.existsSync(toAbs);
        report.wholeFileMoves.push({ ...move, fromExists, toExists });
        if (move.requiredSource && fromExists && !move.allowAlreadyMoved) {
            warnings.push(`${move.from} still at legacy path (target ${move.to})`);
        }
        if (toExists && fromExists && move.from !== move.to) {
            errors.push(`whole-file move blocked: both ${move.from} and ${move.to} exist`);
        }
    }

    for (const rule of manifest.forbiddenImportRules || []) {
        const layerDir = path.join(pkgRoot, 'src', rule.layer);
        const hits = scanForbiddenImports(layerDir, rule.forbidden, rule.scope || 'production', rule.exceptFiles || []);
        if (hits.length) {
            report.forbiddenImports.push({ layer: rule.layer, hits });
            for (const hit of hits) {
                errors.push(`${hit.file}: forbidden import ${hit.specifier} (${rule.layer} → ${rule.forbidden.join('|')})`);
            }
        }
    }

    for (const drift of checkProductPathDrift(root, manifest)) {
        report.productPathDrift.push(drift);
        errors.push(`product path drift: ${drift.message}`);
    }

    for (const rewrite of manifest.referenceRewrites || []) {
        const hits = scanReferenceNeedingRewrite(root, rewrite);
        if (hits.length) {
            report.referenceDrift.push({ rewrite: rewrite.from, hits });
        }
    }

    return { errors, warnings, report };
}

/**
 * @param {string[]} errors
 * @param {string} name
 * @param {{ source: string, module: string } | undefined} prev
 * @param {{ source: string, module: string }} next
 */
function duplicateOwnersPush(errors, name, prev, next) {
    errors.push(`declaration ${name} owned by both ${prev?.module} and ${next.module}`);
}

/** @param {Record<string, unknown>} report */
function orphanManifestEntriesPush(report, source, modulePath, name) {
    report.orphanManifestEntries.push({ source, module: modulePath, name });
}

/**
 * @param {string} layerDir
 * @param {string[]} forbiddenSegments
 * @param {string} scope
 * @param {string[]} exceptFiles basename or rel paths to skip
 */
function scanForbiddenImports(layerDir, forbiddenSegments, scope, exceptFiles = []) {
    /** @type {{ file: string, specifier: string, line: number }[]} */
    const hits = [];
    /** @type {Set<string>} */
    const seen = new Set();
    if (!fs.existsSync(layerDir)) return hits;
    walkFiles(layerDir, /\.(ts|tsx|mts)$/, (abs) => {
        if (scope === 'production' && abs.includes(`${path.sep}tests${path.sep}`)) return;
        const rel = path.relative(layerDir, abs).replace(/\\/g, '/');
        if (exceptFiles.some((ex) => rel === ex || rel.endsWith(`/${ex}`) || path.basename(abs) === ex)) return;
        const text = fs.readFileSync(abs, 'utf8');
        const re = /(?:import\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?|export\s+(?:type\s+)?(?:[^'";]*?\sfrom\s+)?)['"]([^'"]+)['"]/g;
        for (const m of text.matchAll(re)) {
            const spec = m[1];
            for (const seg of forbiddenSegments) {
                if (spec.includes(seg)) {
                    const line = text.slice(0, m.index).split(/\r?\n/).length;
                    const key = `${rel}:${line}:${spec}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    hits.push({ file: rel, specifier: spec, line });
                    break;
                }
            }
        }
    });
    return hits;
}

/**
 * @param {string} root
 * @param {ReturnType<typeof loadManifest>['manifest']} manifest
 */
function checkProductPathDrift(root, manifest) {
    /** @type {{ message: string, file: string, expected: string }[]} */
    const drift = [];
    const artifacts = manifest.productArtifacts || {};
    for (const [checkFile, expectations] of Object.entries(artifacts.checks || {})) {
        const abs = path.join(root, checkFile);
        if (!fs.existsSync(abs)) {
            drift.push({ message: `missing artifact check file ${checkFile}`, file: checkFile, expected: '' });
            continue;
        }
        const text = fs.readFileSync(abs, 'utf8');
        for (const [symbol, expectedPath] of Object.entries(expectations)) {
            if (!text.includes(expectedPath)) {
                drift.push({
                    message: `${checkFile} missing expected path ${expectedPath} for ${symbol}`,
                    file: checkFile,
                    expected: expectedPath,
                });
            }
        }
    }
    return drift;
}

/**
 * @param {string} root
 * @param {ReferenceRewrite} rewrite
 */
function scanReferenceNeedingRewrite(root, rewrite) {
    /** @type {{ file: string, count: number }[]} */
    const hits = [];
    const files = rewrite.files?.length
        ? rewrite.files.map((f) => path.join(root, f))
        : collectRepoFiles(root, ['packages/runtimes/vmz-runtime/src', 'packages/runtimes/vmz/src', 'packages/compilers']);
    for (const abs of files) {
        if (!fs.existsSync(abs) || !/\.(ts|rs|mjs|json)$/.test(abs)) continue;
        const text = fs.readFileSync(abs, 'utf8');
        if (text.includes(rewrite.from)) {
            hits.push({ file: path.relative(root, abs).replace(/\\/g, '/'), count: text.split(rewrite.from).length - 1 });
        }
    }
    return hits;
}

/**
 * @param {string} dir
 * @param {RegExp} pattern
 * @param {(abs: string) => void} fn
 */
function walkFiles(dir, pattern, fn) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
        const abs = path.join(dir, name);
        const st = fs.statSync(abs);
        if (st.isDirectory()) walkFiles(abs, pattern, fn);
        else if (pattern.test(name)) fn(abs);
    }
}

/**
 * @param {string} root
 * @param {string[]} roots
 */
function collectRepoFiles(root, roots) {
    /** @type {string[]} */
    const out = [];
    for (const rel of roots) walkFiles(path.join(root, rel), /\.(ts|tsx|rs|mjs|json)$/, (abs) => out.push(abs));
    return out;
}

/**
 * @param {string} root
 * @param {ReturnType<typeof loadManifest>['manifest']} manifest
 * @param {{ phases?: string[], dryRun?: boolean }} opts
 */
export function applyManifest(root, manifest, opts = {}) {
    const phases = new Set(opts.phases || ['ensure-dirs', 'whole-file-moves']);
    const sourceFilter = opts.source || null;
    const pkgRoot = path.join(root, manifest.packageRoot);
    /** @type {string[]} */
    const actions = [];

    if (phases.has('ensure-dirs')) {
        for (const dir of manifest.ensureDirectories || []) {
            const abs = path.join(pkgRoot, dir);
            if (!fs.existsSync(abs)) {
                actions.push(`mkdir ${dir}`);
                if (!opts.dryRun) fs.mkdirSync(abs, { recursive: true });
            }
        }
    }

    if (phases.has('whole-file-moves')) {
        for (const move of manifest.wholeFileMoves || []) {
            if (move.blockUntilSplit) continue;
            const fromAbs = path.join(pkgRoot, move.from);
            const toAbs = path.join(pkgRoot, move.to);
            if (!fs.existsSync(fromAbs)) {
                if (fs.existsSync(toAbs)) actions.push(`skip move (already at ${move.to})`);
                continue;
            }
            actions.push(`move ${move.from} -> ${move.to}`);
            if (!opts.dryRun) {
                fs.mkdirSync(path.dirname(toAbs), { recursive: true });
                fs.renameSync(fromAbs, toAbs);
            }
        }
    }

    if (phases.has('split-modules')) {
        for (const [sourceRel, spec] of Object.entries(manifest.sources || {})) {
            if (spec.completed) continue;
            if (sourceFilter && sourceRel !== sourceFilter) continue;
            if (!spec.splitInto?.length) continue;
            actions.push(...applySplitModule(pkgRoot, sourceRel, spec, opts));
        }
    }

    if (phases.has('rewrite-refs')) {
        for (const rewrite of manifest.referenceRewrites || []) {
            actions.push(...applyReferenceRewrite(root, rewrite, opts));
        }
    }

    return actions;
}

/**
 * @param {string} pkgRoot
 * @param {string} sourceRel
 * @param {{ splitInto: SplitModule[], barrel?: { path?: string, header?: string[] } }} spec
 * @param {{ dryRun?: boolean }} opts
 */
function applySplitModule(pkgRoot, sourceRel, spec, opts) {
    const sourceAbs = path.join(pkgRoot, sourceRel);
    const decls = scanTopLevelDeclarations(sourceAbs);
    const byName = new Map(decls.map((d) => [d.name, d]));
    const originalText = fs.readFileSync(sourceAbs, 'utf8');
    const { imports: importBlock, reexports: reexportBlock } = extractHeaderBlocks(originalText);
    /** @type {string[]} */
    const actions = [];

    /** @type {Map<string, string>} */
    const ownerPath = new Map();
    /** @type {Map<string, string>} */
    const declTextsByName = new Map();
    for (const mod of spec.splitInto) {
        for (const name of mod.declarations) ownerPath.set(name, mod.path);
    }
    for (const d of decls) declTextsByName.set(d.name, d.text);

    /** @type {Set<string>} */
    const assigned = new Set();
    for (const mod of spec.splitInto) {
        for (const name of mod.declarations) assigned.add(name);
    }
    const remainingDecls = decls.filter((d) => !assigned.has(d.name));

    /** @type {Set<string>} */
    const needsExport = new Set();
    for (const mod of spec.splitInto) {
        const own = new Set(mod.declarations);
        for (const name of mod.declarations) {
            const text = declTextsByName.get(name) || '';
            for (const ref of collectFreeIdentifiers(text, own)) {
                const owner = ownerPath.get(ref);
                if (owner && owner !== mod.path) needsExport.add(ref);
            }
        }
    }
    if (spec.barrel?.mode === 'partial') {
        const remainingNames = new Set(remainingDecls.map((d) => d.name));
        for (const d of remainingDecls) {
            for (const ref of collectFreeIdentifiers(d.text, remainingNames)) {
                if (ownerPath.has(ref)) needsExport.add(ref);
            }
        }
    }

    for (const mod of spec.splitInto) {
        const parts = [];
        for (const name of mod.declarations) {
            const decl = byName.get(name);
            if (!decl) throw new Error(`${sourceRel}: cannot extract missing declaration ${name}`);
            parts.push(
                rewriteRelativeImports(
                    ensureDeclarationExported(decl.text, decl.exported || needsExport.has(name)),
                    sourceRel,
                    mod.path,
                    pkgRoot,
                ),
            );
        }
        const crossImports = buildCrossImports(mod, ownerPath, importBlock, declTextsByName, sourceRel, pkgRoot);
        const body = `${crossImports}\n\n${parts.join('\n\n')}\n`;
        const outAbs = path.join(pkgRoot, mod.path);
        actions.push(`write ${mod.path} (${mod.declarations.length} decls)`);
        if (!opts.dryRun) {
            fs.mkdirSync(path.dirname(outAbs), { recursive: true });
            fs.writeFileSync(outAbs, body, 'utf8');
        }
    }

    const barrelPath = spec.barrel?.path || sourceRel;
    const header = (spec.barrel?.header || []).join('\n');

    if (spec.barrel?.mode === 'partial') {
        /** @type {Map<string, Set<string>>} */
        const remainingImports = new Map();
        const remainingNames = new Set(remainingDecls.map((d) => d.name));
        for (const d of remainingDecls) {
            for (const ref of collectFreeIdentifiers(d.text, remainingNames)) {
                const modPath = ownerPath.get(ref);
                if (!modPath) continue;
                if (!remainingImports.has(modPath)) remainingImports.set(modPath, new Set());
                remainingImports.get(modPath).add(ref);
            }
        }
        /** @type {string[]} */
        const importLines = [];
        for (const [modPath, names] of [...remainingImports.entries()].sort(([a], [b]) => a.localeCompare(b))) {
            const rel = toPosixRelative(path.dirname(barrelPath), modPath).replace(/\.ts$/, '.js');
            importLines.push(`import { ${[...names].sort().join(', ')} } from '${rel}';`);
        }
        const remainingParts = remainingDecls.map((d) =>
            rewriteRelativeImports(d.text, sourceRel, barrelPath, pkgRoot),
        );
        const partialBody = [
            header,
            rewriteRelativeImports(importBlock, sourceRel, barrelPath, pkgRoot),
            rewriteRelativeImports(reexportBlock, sourceRel, barrelPath, pkgRoot),
            importLines.join('\n'),
            remainingParts.join('\n\n'),
        ]
            .filter(Boolean)
            .join('\n\n');
        actions.push(`write partial ${barrelPath} (${remainingDecls.length} remaining decls)`);
        if (!opts.dryRun) {
            fs.writeFileSync(path.join(pkgRoot, barrelPath), `${partialBody}\n`, 'utf8');
        }
        return actions;
    }

    const exportLines = [];
    for (const mod of spec.splitInto) {
        const rel = toPosixRelative(path.dirname(barrelPath), mod.path).replace(/\.ts$/, '.js');
        for (const name of mod.declarations) {
            const decl = byName.get(name);
            if (decl?.exported) exportLines.push(`export { ${name} } from '${rel}';`);
        }
    }
    const barrel = `${header ? `${header}\n` : ''}${reexportBlock ? `${reexportBlock}\n` : ''}${exportLines.join('\n')}\n`;
    actions.push(`write barrel ${barrelPath}`);
    if (!opts.dryRun) {
        fs.writeFileSync(path.join(pkgRoot, barrelPath), barrel, 'utf8');
    }

    return actions;
}

const GLOBAL_IDENTIFIERS = new Set([
    'undefined',
    'null',
    'true',
    'false',
    'NaN',
    'Infinity',
    'Object',
    'Array',
    'String',
    'Number',
    'Boolean',
    'Symbol',
    'BigInt',
    'Function',
    'Promise',
    'Map',
    'Set',
    'WeakMap',
    'WeakSet',
    'Date',
    'RegExp',
    'Error',
    'TypeError',
    'RangeError',
    'JSON',
    'Math',
    'console',
    'document',
    'window',
    'globalThis',
    'self',
    'fetch',
    'Request',
    'Response',
    'Headers',
    'URL',
    'URLSearchParams',
    'Event',
    'CustomEvent',
    'SubmitEvent',
    'Element',
    'Node',
    'Document',
    'DocumentFragment',
    'Text',
    'HTMLElement',
    'HTMLAnchorElement',
    'history',
    'location',
    'setTimeout',
    'clearTimeout',
    'queueMicrotask',
    'performance',
    'AbortController',
    'TextEncoder',
    'TextDecoder',
]);

/**
 * @param {SplitModule} mod
 * @param {Map<string, string>} ownerPath
 * @param {string} importBlock
 * @param {Map<string, string>} declTextsByName
 * @param {string} sourceRel
 * @param {string} pkgRoot
 */
function buildCrossImports(mod, ownerPath, importBlock, declTextsByName, sourceRel, pkgRoot) {
    const own = new Set(mod.declarations);
    /** @type {Set<string>} */
    const needed = new Set();
    for (const name of mod.declarations) {
        const text = declTextsByName.get(name) || '';
        for (const ref of collectFreeIdentifiers(text, own)) {
            if (ownerPath.has(ref) && !own.has(ref)) needed.add(ref);
        }
    }
    /** @type {Map<string, Set<string>>} */
    const byModule = new Map();
    for (const ref of needed) {
        const modPath = ownerPath.get(ref);
        if (!modPath) continue;
        if (!byModule.has(modPath)) byModule.set(modPath, new Set());
        byModule.get(modPath).add(ref);
    }
    /** @type {string[]} */
    const importLines = [];
    for (const [modPath, names] of [...byModule.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const rel = toPosixRelative(path.dirname(mod.path), modPath).replace(/\.ts$/, '.js');
        importLines.push(`import { ${[...names].sort().join(', ')} } from '${rel}';`);
    }
    return [rewriteRelativeImports(importBlock.trim(), sourceRel, mod.path, pkgRoot), ...importLines]
        .filter(Boolean)
        .join('\n');
}

/**
 * @param {string} text
 * @param {string} sourceRel
 * @param {string} moduleRel
 * @param {string} pkgRoot
 */
function rewriteRelativeImports(text, sourceRel, moduleRel, pkgRoot) {
    if (!text) return text;
    const sourceDir = path.dirname(path.join(pkgRoot, sourceRel));
    const moduleDir = path.dirname(path.join(pkgRoot, moduleRel));
    return text.replace(/(from\s+['"]|import\s*\(\s*['"])(\.[^'"]+)(['"])/g, (_m, prefix, spec, suffix) => {
        const abs = path.resolve(sourceDir, spec);
        let next = path.relative(moduleDir, abs).replace(/\\/g, '/');
        if (!next.startsWith('.')) next = `./${next}`;
        return `${prefix}${next}${suffix}`;
    });
}

/**
 * @param {string} text
 * @returns {{ imports: string, reexports: string }}
 */
function extractHeaderBlocks(text) {
    const sf = ts.createSourceFile('header.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    /** @type {string[]} */
    const imports = [];
    /** @type {string[]} */
    const reexports = [];
    for (const st of sf.statements) {
        if (ts.isImportDeclaration(st)) {
            imports.push(text.slice(st.getStart(sf, false), st.getEnd()));
            continue;
        }
        if (ts.isExportDeclaration(st)) {
            reexports.push(text.slice(st.getStart(sf, false), st.getEnd()));
            continue;
        }
        break;
    }
    return { imports: imports.join('\n'), reexports: reexports.join('\n') };
}

/**
 * @param {string} declText
 * @param {Set<string>} ownNames
 * @returns {Set<string>}
 */
function collectFreeIdentifiers(declText, ownNames) {
    const sf = ts.createSourceFile('decl.ts', declText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    /** @type {Set<string>} */
    const refs = new Set();
    /** @type {Set<string>} */
    const locals = new Set(ownNames);

    function bindName(name) {
        if (name && ts.isIdentifier(name)) locals.add(name.text);
    }

    function visit(node) {
        if (ts.isIdentifier(node)) {
            const text = node.text;
            if (locals.has(text) || GLOBAL_IDENTIFIERS.has(text)) return;
            const parent = node.parent;
            if (ts.isPropertyAccessExpression(parent) && parent.name === node && parent.expression !== node) {
                return;
            }
            if (ts.isPropertyAssignment(parent) && parent.name === node) return;
            if (ts.isMethodDeclaration(parent) && parent.name === node) return;
            if (ts.isPropertySignature(parent) && parent.name === node) return;
            if (ts.isBindingElement(parent) && parent.name === node) return;
            refs.add(text);
            return;
        }
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
            for (const param of node.parameters) {
                if (ts.isIdentifier(param.name)) locals.add(param.name.text);
            }
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
            locals.add(node.name.text);
        }
        ts.forEachChild(node, visit);
    }

    for (const st of sf.statements) {
        if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                if (ts.isIdentifier(d.name)) locals.add(d.name.text);
            }
        } else if (st.name && ts.isIdentifier(st.name)) {
            locals.add(st.name.text);
        }
        visit(st);
    }
    return refs;
}

/**
 * @param {string} declText
 * @param {boolean} shouldExport
 */
function ensureDeclarationExported(declText, shouldExport) {
    if (!shouldExport || /^\s*export\s/.test(declText)) return declText;
    if (/^\s*(async\s+)?function\b/.test(declText)) {
        return declText.replace(/^(\s*)(async\s+)?function\b/, '$1export $2function');
    }
    if (/^\s*const\b/.test(declText)) {
        return declText.replace(/^(\s*)const\b/, '$1export const');
    }
    if (/^\s*let\b/.test(declText)) {
        return declText.replace(/^(\s*)let\b/, '$1export let');
    }
    if (/^\s*class\b/.test(declText)) {
        return declText.replace(/^(\s*)class\b/, '$1export class');
    }
    return declText;
}

/**
 * @param {string} fromDir
 * @param {string} toFile
 */
function toPosixRelative(fromDir, toFile) {
    let rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return rel;
}

/**
 * @param {string} root
 * @param {ReferenceRewrite} rewrite
 * @param {{ dryRun?: boolean }} opts
 */
function applyReferenceRewrite(root, rewrite, opts) {
    /** @type {string[]} */
    const actions = [];
    const files = rewrite.files?.length
        ? rewrite.files.map((f) => path.join(root, f))
        : collectRepoFiles(root, ['packages/runtimes/vmz-runtime/src', 'packages/runtimes/vmz/src', 'packages/compilers']);
    for (const abs of files) {
        if (!fs.existsSync(abs)) continue;
        const text = fs.readFileSync(abs, 'utf8');
        if (!text.includes(rewrite.from)) continue;
        const next = text.split(rewrite.from).join(rewrite.to);
        actions.push(`rewrite ${path.relative(root, abs)}: ${rewrite.from} -> ${rewrite.to}`);
        if (!opts.dryRun) fs.writeFileSync(abs, next, 'utf8');
    }
    return actions;
}
