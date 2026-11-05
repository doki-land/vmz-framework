import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REGISTRY_PAIR = /"([^"]+)":\s*\(\)\s*=>\s*import\("\.\/([^"]+\.js)"\)/g;

function parseArgs(argv) {
    const args = {
        dist: 'packages/homepage/dist/static',
        pages: 'pages/index,pages/charts,pages/icons',
    };
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dist') args.dist = argv[++i];
        else if (arg === '--pages') args.pages = argv[++i];
        else if (arg === '--json') args.json = argv[++i];
        else if (arg === '--help') {
            console.log(
                'Usage: node scripts/dev/pack-build-evidence.mjs [--dist <dir>] [--pages <ids>] [--json <file>]',
            );
            process.exit(0);
        } else throw new Error(`unknown argument: ${arg}`);
    }
    return args;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function htmlPathOf(page) {
    if (page === 'pages/index') return 'index.html';
    return `${page.replace(/^pages\//, '')}/index.html`;
}

const args = parseArgs(process.argv.slice(2));
const distDir = path.resolve(ROOT, args.dist);
const packDir = path.join(distDir, '_vmz', 'pack');
const manifest = readJson(path.join(packDir, 'manifest.json'));
const proof = readJson(path.join(distDir, '_vmz', 'build-proof.json'));
const planFile = path.join(distDir, '_vmz', 'pack-manifest.json');
const plan = fs.existsSync(planFile) ? readJson(planFile) : {};

const chunkByFile = new Map();
const sizes = new Map();
for (const chunk of manifest.chunks) {
    const filePath = path.join(packDir, chunk.file);
    const bytes = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    sizes.set(chunk.file, bytes);
    chunkByFile.set(chunk.file, { ...chunk, bytes });
}

const indexHtml = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const scriptMatch = /<script[^>]*\ssrc="([^"]+\.js)"/.exec(indexHtml);
if (!scriptMatch) throw new Error('index.html has no module script');
const entryFile = path.basename(scriptMatch[1]);
if (!chunkByFile.has(entryFile)) throw new Error(`entry chunk missing from manifest: ${entryFile}`);

const registry = new Map();
for (const m of fs.readFileSync(path.join(packDir, entryFile), 'utf8').matchAll(REGISTRY_PAIR)) {
    registry.set(m[1], m[2]);
}

const classOf = (file) => (chunkByFile.get(file)?.id || '').split('/')[0] || 'other';

function walk(rootFile, followDynamic) {
    const seen = new Set();
    const queue = [rootFile];
    while (queue.length > 0) {
        const file = queue.shift();
        if (seen.has(file)) continue;
        seen.add(file);
        const chunk = chunkByFile.get(file);
        if (!chunk) continue;
        const next = followDynamic ? [...chunk.imports, ...chunk.dynamic] : chunk.imports;
        for (const dep of next) if (!seen.has(dep)) queue.push(dep);
    }
    return seen;
}

function bytesOf(files) {
    let total = 0;
    for (const file of files) total += sizes.get(file) || 0;
    return total;
}

function classesOf(files) {
    const out = {};
    for (const file of files) {
        const kind = classOf(file);
        out[kind] ??= { files: 0, bytes: 0 };
        out[kind].files += 1;
        out[kind].bytes += sizes.get(file) || 0;
    }
    return out;
}

const allFiles = new Set(manifest.chunks.map((c) => c.file));
const initial = walk(entryFile, false);

const pages = args.pages
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const pageEvidence = pages.map((page) => {
    const pageFile = registry.get(page);
    if (!pageFile) throw new Error(`page chunk not found in registry: ${page}`);
    const navigation = walk(pageFile, false);
    const reachable = walk(pageFile, true);
    const navLazy = new Set([...navigation].filter((f) => !initial.has(f)));
    const deferred = new Set([...reachable].filter((f) => !initial.has(f) && !navigation.has(f)));
    const htmlFile = path.join(distDir, htmlPathOf(page));
    const largest = [...deferred]
        .sort((a, b) => (sizes.get(b) || 0) - (sizes.get(a) || 0))
        .slice(0, 5)
        .map((file) => ({ file, bytes: sizes.get(file) || 0 }));
    return {
        page,
        htmlFile: htmlPathOf(page),
        htmlBytes: fs.existsSync(htmlFile) ? fs.statSync(htmlFile).size : 0,
        pageChunk: pageFile,
        pageChunkBytes: sizes.get(pageFile) || 0,
        firstRequest: { files: initial.size, bytes: bytesOf(initial), classes: classesOf(initial) },
        navigation: { files: navLazy.size, bytes: bytesOf(navLazy), classes: classesOf(navLazy) },
        deferred: { files: deferred.size, bytes: bytesOf(deferred), classes: classesOf(deferred) },
        largestDeferred: largest,
    };
});

const evidence = {
    schema: 'vmz.pack.build_evidence.v0',
    generatedAt: new Date().toISOString(),
    dist: args.dist,
    profileId: proof.profileId,
    packDigest: proof.packDigest,
    chunkCount: manifest.chunks.length,
    target: plan.target,
    minify: plan.minify,
    treeShake: plan.treeShake,
    sourceMaps: plan.sourceMaps,
    js: {
        files: allFiles.size,
        bytes: bytesOf(allFiles),
        classes: classesOf(allFiles),
        sourceMapBytes: fs
            .readdirSync(packDir)
            .filter((f) => f.endsWith('.js.map'))
            .reduce((sum, f) => sum + fs.statSync(path.join(packDir, f)).size, 0),
    },
    entryFile,
    firstRequest: { files: initial.size, bytes: bytesOf(initial), classes: classesOf(initial) },
    pages: pageEvidence,
};

const text = `${JSON.stringify(evidence, null, 2)}\n`;
if (args.json) fs.writeFileSync(path.resolve(ROOT, args.json), text);
console.log(text);
