/**
 * Client bare package specifier → resolvable relative rewrite (executable graph).
 * verify id: pack-client-packages
 *
 * Author surface may import '@scope/pkg' / '@scope/pkg/subpath' (01/04).
 * Browser ESM cannot resolve bare names; Pack must lower them.
 *
 * What this gate keeps: bare specifiers are rewritten to relative paths that
 * resolve, and the resulting module graph evaluates via dynamic import.
 * The concrete `dist/vendor/**` layout and vendored file counts are only
 * intermediate vendoring behavior of the current thin pack slice — not a
 * product packaging target, so they are not pinned here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);

function fail(msg: string): never {
    console.error(`pack-client-packages FAIL: ${msg}`);
    process.exit(1);
}

const { collectBareSpecs, packClientBareImports, rewriteRelativeTsSpecs } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz', 'dist', 'workspace', 'pack-client-packages.js')).href
);

console.log('pack-client-packages: collectBareSpecs shapes…');
{
    const specs = collectBareSpecs(`
        import { a } from '@vmz/fixture-client-lib';
        import '@vmz/fixture-client-lib/side';
        export { b } from '@vmz/fixture-client-lib/query';
        export * from '@vmz/fixture-client-lib/catalog';
        const x = await import('@vmz/fixture-client-lib/chain');
        import './local.ts';
        import { z } from 'node:fs';
    `);
    for (const want of [
        '@vmz/fixture-client-lib',
        '@vmz/fixture-client-lib/side',
        '@vmz/fixture-client-lib/query',
        '@vmz/fixture-client-lib/catalog',
        '@vmz/fixture-client-lib/chain',
    ]) {
        if (!specs.includes(want)) fail(`missing bare ${want}: ${JSON.stringify(specs)}`);
    }
    if (specs.some((s: string) => s.startsWith('.') || s.startsWith('node:'))) {
        fail(`relative/node must be skipped: ${JSON.stringify(specs)}`);
    }
}

console.log('pack-client-packages: rewriteRelativeTsSpecs…');
{
    const unchanged = `export const runtimeFace = 'server';`;
    if (rewriteRelativeTsSpecs(unchanged) !== unchanged) fail('plain JavaScript should bypass module parsing');
    const sourceMap = `const source = './generated.ts';`;
    if (rewriteRelativeTsSpecs(sourceMap) !== sourceMap) fail('non-module strings should bypass module parsing');
    const exactMap = `const text = '@vmz/missing-package';`;
    if (rewriteRelativeTsSpecs(exactMap, { '@vmz/missing-package': './vendor/missing.js' }) !== exactMap) {
        fail('exact maps without a matching module specifier should bypass module parsing');
    }
    const out = rewriteRelativeTsSpecs(`import { x } from './foo.ts';\nexport { y } from "../bar.tsx";`);
    if (out.includes('.ts') || out.includes('.tsx')) fail(`ts specs remain: ${out}`);
}

console.log('pack-client-packages: vendor + rewrite fixture…');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-pack-client-'));
try {
    const pkgRoot = path.join(tmp, 'packages', 'fixture-client-lib');
    const appRoot = path.join(tmp, 'app');
    const dist = path.join(appRoot, 'dist');
    fs.mkdirSync(path.join(pkgRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dist, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(appRoot, 'node_modules', '@vmz'), { recursive: true });

    fs.writeFileSync(
        path.join(pkgRoot, 'package.json'),
        `${JSON.stringify(
            {
                name: '@vmz/fixture-client-lib',
                type: 'module',
                exports: {
                    '.': { browser: './src/index.ts', default: './src/index.ts' },
                    './query': './src/query.ts',
                },
            },
            null,
            2,
        )}\n`,
    );
    fs.writeFileSync(path.join(pkgRoot, 'src', 'index.ts'), `export { ping } from './query.ts';\nexport const name = 'fixture';\n`);
    fs.writeFileSync(path.join(pkgRoot, 'src', 'query.ts'), `export function ping(): string { return 'pong'; }\n`);
    // Simulate workspace resolution via node_modules link path (dir, not symlink — copy tree).
    const linked = path.join(appRoot, 'node_modules', '@vmz', 'fixture-client-lib');
    fs.cpSync(pkgRoot, linked, { recursive: true });

    fs.writeFileSync(
        path.join(dist, 'lib', 'use.js'),
        `import { ping } from '@vmz/fixture-client-lib';\nimport { ping as ping2 } from '@vmz/fixture-client-lib/query';\nexport const ok = () => ping() + ping2();\n`,
    );
    fs.mkdirSync(path.join(dist, 'pages'), { recursive: true });
    fs.writeFileSync(
        path.join(dist, 'pages', 'index.client.js'),
        `import { ok } from '../lib/use.js';\nexport default class IndexPage { label = ok(); }\n`,
    );

    const result = packClientBareImports(dist, { projectRoot: appRoot });
    if (!result.bareSpecs.includes('@vmz/fixture-client-lib')) {
        fail(`expected bareSpecs to include package root: ${JSON.stringify(result)}`);
    }
    if (!result.bareSpecs.includes('@vmz/fixture-client-lib/query')) {
        fail(`expected subpath bare: ${JSON.stringify(result)}`);
    }
    if ((result.remainingBareSpecs || []).length) {
        fail(`remaining bare after pack: ${JSON.stringify(result.remainingBareSpecs)}`);
    }

    // Keep: bare specifiers are lowered to relative specifiers that resolve on disk.
    const useJsPath = path.join(dist, 'lib', 'use.js');
    const useJs = fs.readFileSync(useJsPath, 'utf8');
    if (useJs.includes("'@vmz/fixture-client-lib'") || useJs.includes('"@vmz/fixture-client-lib"')) {
        fail(`importer still has bare root: ${useJs}`);
    }
    if (useJs.includes('@vmz/fixture-client-lib/query')) {
        fail(`importer still has bare subpath: ${useJs}`);
    }
    const importerSpecs = [...useJs.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    if (!importerSpecs.length || importerSpecs.some((s: string) => !s.startsWith('.'))) {
        fail(`expected relative import specifiers after pack: ${useJs}`);
    }
    for (const spec of importerSpecs) {
        if (!fs.existsSync(path.resolve(path.dirname(useJsPath), spec))) {
            fail(`rewritten specifier does not resolve: ${spec}`);
        }
    }

    // Intermediate vendoring behavior only: the thin pack slice materializes the
    // reachable closure under a vendor tree. Check the transpiled output (no
    // remaining `.ts` module specifiers) across whatever was vendored — do not
    // pin an exact `dist/vendor/**` path set or a vendored file count.
    if (!result.vendoredModules.length) {
        fail(`expected intermediate vendoring to materialize reachable modules: ${JSON.stringify(result)}`);
    }
    const tsSpecifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"][^'"]+\.tsx?['"]/;
    for (const rel of result.vendoredModules) {
        const text = fs.readFileSync(path.join(dist, rel), 'utf8');
        if (tsSpecifier.test(text)) fail(`vendored module still references a .ts specifier (${rel}): ${text}`);
    }

    // Browser-shaped load: dynamic import of rewritten module graph.
    const mod = await import(pathToFileURL(path.join(dist, 'lib', 'use.js')).href);
    if (typeof mod.ok !== 'function' || mod.ok() !== 'pongpong') {
        fail(`vendored graph failed to evaluate: ${String(mod.ok?.())}`);
    }

    console.log(
        `pack-client-packages PASS: bare=${result.bareSpecs.length} vendor=${result.vendoredModules.length} rewritten=${result.rewrittenFiles}`,
    );
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
