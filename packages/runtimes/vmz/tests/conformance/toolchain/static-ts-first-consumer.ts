/**
 * Static/prerender assembly for TS-first workspace packages.
 * verify id: static-ts-first-consumer
 *
 * A pnpm-workspace site imports its own TS-first package (`exports` → `./src/*.ts`,
 * no dist) with a browser/default conditional export, a subpath, and one transitive
 * TS-first dependency. The real `vmz build` CLI must lower that graph to executable
 * JS so Node prerender runs with plain `node` (no tsx/jiti/loader), the emitted
 * static HTML carries the computed value from the package, and dist keeps no bare
 * or `.ts` module specifiers.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { repoRoot, vmzBin } from '../_lib/repo-root.ts';
import { serveHostChildEnv } from '../_lib/serve-host-env.ts';

const root = repoRoot(import.meta.url);
const ORIGIN = 'https://static-ts-first.example.test';

function fail(msg: string): never {
    console.error(`static-ts-first-consumer FAIL: ${msg}`);
    process.exit(1);
}

const { collectBareSpecs } = await import(
    pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz', 'dist', 'workspace', 'pack-client-packages.js')).href
);

function write(file: string, text: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

/** Workspace link first (junction), copy fallback when symlinks are unavailable. */
function linkDir(target: string, link: string) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
        fs.symlinkSync(target, link, 'junction');
    } catch {
        fs.cpSync(target, link, { recursive: true });
    }
}

function listJs(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string) => {
        for (const name of fs.readdirSync(current)) {
            if (name === 'node_modules') continue;
            const full = path.join(current, name);
            const st = fs.statSync(full);
            if (st.isDirectory()) walk(full);
            else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(full);
        }
    };
    walk(dir);
    return out;
}

function collectTsSpecs(js: string): string[] {
    const specs: string[] = [];
    const re = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(js))) {
        if (/\.tsx?$/i.test(m[1])) specs.push(m[1]);
    }
    return specs;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-static-ts-first-'));
try {
    const app = path.join(tmp, 'app');
    const lib = path.join(tmp, 'packages', 'ts-first-lib');
    const transitive = path.join(tmp, 'packages', 'ts-first-transitive');

    write(path.join(tmp, 'package.json'), json({ name: 'fixture-ts-first-workspace', private: true, type: 'module' }));
    write(path.join(tmp, 'pnpm-workspace.yaml'), 'packages:\n  - "app"\n  - "packages/*"\n');

    write(
        path.join(app, 'package.json'),
        json({
            name: 'fixture-ts-first-app',
            private: true,
            type: 'module',
            dependencies: { '@fixture/ts-first-lib': 'workspace:*' },
        }),
    );
    write(
        path.join(app, 'src', 'Application.vmz'),
        `<template>
    <slot />
</template>
<script client>
export default class Application {}
</script>`,
    );
    write(
        path.join(app, 'src', 'pages', 'index.vmz'),
        `<template>
    <main>
        <h1 data-testid="ts-first">
            {{ message }}
        </h1>
    </main>
</template>
<script client>
import { greeting } from '@fixture/ts-first-lib';
import { extraSuffix } from '@fixture/ts-first-lib/extra';

export default class IndexPage {
    public message: string = \`\${greeting()} \${extraSuffix()}\`;
}
</script>`,
    );

    write(
        path.join(lib, 'package.json'),
        json({
            name: '@fixture/ts-first-lib',
            type: 'module',
            exports: {
                '.': { browser: './src/index.ts', default: './src/index.ts' },
                './extra': { browser: './src/extra.ts', default: './src/extra.ts' },
            },
        }),
    );
    write(
        path.join(lib, 'src', 'index.ts'),
        `import { transitiveTag } from '@fixture/ts-first-transitive';

export function greeting(): string {
    return \`hello-ts-first-\${transitiveTag()}\`;
}
`,
    );
    write(path.join(lib, 'src', 'extra.ts'), `export function extraSuffix(): string {\n    return 'subpath';\n}\n`);

    write(
        path.join(transitive, 'package.json'),
        json({
            name: '@fixture/ts-first-transitive',
            type: 'module',
            exports: { '.': { browser: './src/index.ts', default: './src/index.ts' } },
        }),
    );
    write(path.join(transitive, 'src', 'index.ts'), `export function transitiveTag(): string {\n    return 'transitive';\n}\n`);

    // pnpm layout: dependents see workspace packages through node_modules links,
    // and the TS-first package sees its own transitive dependency one level deeper.
    linkDir(transitive, path.join(lib, 'node_modules', '@fixture', 'ts-first-transitive'));
    linkDir(lib, path.join(app, 'node_modules', '@fixture', 'ts-first-lib'));

    console.log('static-ts-first-consumer: vmz build --profile static…');
    const build = spawnSync(process.execPath, [vmzBin(root), 'build', app, '--profile', 'static', '--origin', ORIGIN], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: serveHostChildEnv(),
    });
    if (build.status !== 0) {
        fail(`vmz build exited ${build.status}\n${build.stdout}\n${build.stderr}`);
    }

    const dist = path.join(app, 'dist', 'static');
    const indexPath = path.join(dist, 'index.html');
    if (!fs.existsSync(indexPath)) fail(`missing static HTML ${indexPath}`);
    const html = fs.readFileSync(indexPath, 'utf8');
    for (const want of ['hello-ts-first-transitive', 'subpath']) {
        if (!html.includes(want)) fail(`prerendered HTML missing '${want}': ${html.slice(0, 600)}`);
    }

    for (const rel of [
        ['vendor', 'fixture', 'ts-first-lib', 'src', 'index.js'],
        ['vendor', 'fixture', 'ts-first-lib', 'src', 'extra.js'],
        ['vendor', 'fixture', 'ts-first-transitive', 'src', 'index.js'],
    ]) {
        const vendored = path.join(dist, ...rel);
        if (!fs.existsSync(vendored)) fail(`missing vendored module ${vendored}`);
    }

    const bare: string[] = [];
    const tsSpecs: string[] = [];
    for (const file of listJs(dist)) {
        const text = fs.readFileSync(file, 'utf8');
        for (const spec of collectBareSpecs(text)) {
            if (!bare.includes(spec)) bare.push(spec);
        }
        for (const spec of collectTsSpecs(text)) {
            tsSpecs.push(`${path.relative(dist, file)} → ${spec}`);
        }
    }
    if (bare.length) fail(`dist still carries bare specifiers: ${JSON.stringify(bare)}`);
    if (tsSpecs.length) fail(`dist still imports .ts specifiers: ${JSON.stringify(tsSpecs)}`);

    // Node prerender input: import the emitted page graph with plain node (no loader flags).
    const pageModule = path.join(dist, 'pages', 'index.client.js');
    if (!fs.existsSync(pageModule)) fail(`missing prerender page module ${pageModule}`);
    const plainEnv = { ...process.env };
    delete plainEnv.NODE_OPTIONS;
    const plain = spawnSync(
        process.execPath,
        [
            '--input-type=module',
            '-e',
            `const m = await import(${JSON.stringify(pathToFileURL(pageModule).href)}); if (!m.default) throw new Error('missing default export'); console.log(String(m.default.name));`,
        ],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: plainEnv },
    );
    if (plain.status !== 0) {
        fail(`plain node import of prerender module failed: ${plain.stdout}\n${plain.stderr}`);
    }
    if (!plain.stdout.includes('IndexPage')) fail(`plain node import did not evaluate IndexPage: ${plain.stdout}`);

    console.log(`static-ts-first-consumer PASS: html=index.html vendored=3 bare=0 tsSpecs=0 plainNode=OK`);
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
