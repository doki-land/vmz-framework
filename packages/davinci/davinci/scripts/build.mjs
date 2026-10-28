/**
 * Build the DaVinci facade: one self-contained ESM bundle per public entry plus
 * one bundled `.d.ts` per entry.
 *
 * The `@doki-land/davinci-*` modules are workspace-internal implementation
 * layers (`private`), so they are inlined here instead of being published as
 * runtime dependencies. Consumers reduce the result with ESM tree-shaking.
 *
 * Usage: `pnpm --filter @doki-land/davinci run build`
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDtsBundle } from 'dts-bundle-generator';
import { build } from 'esbuild';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = path.join(PACKAGE_DIR, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8'));

/** Internal workspace modules: bundled into this package, never published as deps. */
const INTERNAL_MODULES = Object.keys(pkg.devDependencies ?? {}).filter((name) =>
    name.startsWith('@doki-land/davinci-'),
);

/** `exports` subpath → source/output stem (`./scene/svg` → `scene-svg`). */
const ENTRIES = Object.entries(pkg.exports).map(([subpath, target]) => ({
    subpath,
    stem: path.basename(target.default).replace(/\.js$/, ''),
}));

/** Build the private layers first so bundling reads current code, not stale dist. */
function buildInternalModules() {
    const args = ['-r'];
    for (const name of INTERNAL_MODULES) args.push('--filter', name);
    args.push('run', 'build');
    execFileSync('pnpm', args, { cwd: PACKAGE_DIR, stdio: 'inherit', shell: true });
}

async function bundleJavaScript({ subpath, stem }) {
    await build({
        absWorkingDir: PACKAGE_DIR,
        entryPoints: [path.join(PACKAGE_DIR, 'src', `${stem}.ts`)],
        outfile: path.join(DIST_DIR, `${stem}.js`),
        bundle: true,
        format: 'esm',
        target: 'es2022',
        platform: 'neutral',
        mainFields: ['module', 'main'],
        treeShaking: true,
        logLevel: 'warning',
    });
    console.log(`davinci build: ${subpath} → dist/${stem}.js`);
}

function bundleTypes({ subpath, stem }) {
    const [declaration] = generateDtsBundle(
        [{ filePath: path.join(PACKAGE_DIR, 'src', `${stem}.ts`) }],
        {
            project: path.join(PACKAGE_DIR, 'tsconfig.json'),
            preferredConfigPath: path.join(PACKAGE_DIR, 'tsconfig.json'),
            followSymlinks: true,
            externalInlines: [...INTERNAL_MODULES, ...INTERNAL_MODULES.map((name) => `${name}/svg`)],
        },
    );
    fs.writeFileSync(path.join(DIST_DIR, `${stem}.d.ts`), declaration);
    console.log(`davinci build: ${subpath} → dist/${stem}.d.ts`);
}

/** The published contract forbids exposing private package specifiers. */
function assertNoInternalReferences() {
    for (const { stem } of ENTRIES) {
        for (const extension of ['js', 'd.ts']) {
            const file = path.join(DIST_DIR, `${stem}.${extension}`);
            const text = fs.readFileSync(file, 'utf8');
            if (text.includes('@doki-land/davinci-')) {
                throw new Error(`davinci build: ${path.relative(PACKAGE_DIR, file)} still references a private module`);
            }
        }
    }
}

buildInternalModules();
fs.mkdirSync(DIST_DIR, { recursive: true });
for (const entry of ENTRIES) {
    await bundleJavaScript(entry);
    bundleTypes(entry);
}
assertNoInternalReferences();
console.log(`davinci build: OK (${ENTRIES.length} entries)`);
