import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
function patchJson(rel, patch) {
    const p = path.join(root, rel);
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    patch(j);
    fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n');
}
patchJson('packages/runtimes/vmz-protocol/package.json', (j) => {
    j.main = './dist/index.js';
    j.types = './dist/index.d.ts';
    j.exports = { '.': { types: './dist/index.d.ts', default: './dist/index.js' } };
    j.files = ['dist', 'README.md'];
    j.scripts = { build: 'tsc -p tsconfig.json' };
    j.devDependencies = { '@types/node': '^22.15.0', typescript: '^5.8.3' };
});
patchJson('packages/runtimes/vmz-fixtures/package.json', (j) => {
    j.main = './dist/index.js';
    j.types = './dist/index.d.ts';
    j.exports = { '.': { types: './dist/index.d.ts', default: './dist/index.js' } };
    j.files = ['dist', 'src', 'README.md'];
    j.scripts = { build: 'tsc -p tsconfig.json' };
    j.devDependencies = { '@types/node': '^22.15.0', typescript: '^5.8.3' };
});
patchJson('packages/runtimes/vmz-runtime/package.json', (j) => {
    j.main = './dist/server.js';
    j.types = './dist/index.d.ts';
    j.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/server.js' },
        './dom': { types: './dist/dom.d.ts', default: './dist/dom.js' },
        './server': { types: './dist/server.d.ts', default: './dist/server.js' },
        './http': { types: './dist/http.d.ts', default: './dist/http.js' },
    };
    j.files = ['dist', 'README.md'];
    j.scripts = { build: 'tsc -p tsconfig.json && node ../../../scripts/copy-serve-host-mjs.mjs' };
    j.devDependencies = { '@types/node': '^22.15.0', typescript: '^5.8.3' };
});
patchJson('packages/runtimes/vmz/package.json', (j) => {
    j.main = './dist/index.js';
    j.types = './dist/index.d.ts';
    j.exports = {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './cli': { types: './dist/cli.d.ts', default: './dist/cli.js' },
        './dev-session': { types: './dist/dev-session.d.ts', default: './dist/dev-session.js' },
        './plugin-host': { types: './dist/plugin-host.d.ts', default: './dist/plugin-host.js' },
        './bundler-adapter': { types: './dist/bundler-adapter.d.ts', default: './dist/bundler-adapter.js' },
        './test-protocol': { types: './dist/test-protocol.d.ts', default: './dist/test-protocol.js' },
        './test-discover': { types: './dist/test-discover.d.ts', default: './dist/test-discover.js' },
        './document-check': { types: './dist/document-check.d.ts', default: './dist/document-check.js' },
        './document-schema': { types: './dist/document-schema.d.ts', default: './dist/document-schema.js' },
    };
    j.files = ['bin', 'dist', '*.node', 'README.md'];
    j.scripts = {
        ...(j.scripts || {}),
        'build:js': 'tsc -p tsconfig.json && node ../../../scripts/copy-vmz-public-api.mjs',
        build: 'pnpm run build:native && pnpm run build:js',
    };
    if (j.devDependencies) delete j.devDependencies['vmz-plugin-conformance'];
    j.devDependencies = { ...(j.devDependencies || {}), '@types/node': '^22.15.0', typescript: '^5.8.3' };
});
fs.writeFileSync(
    'packages/runtimes/vmz/bin/vmz.js',
    "#!/usr/bin/env node\nimport { runCli } from '../dist/cli.js';\nconst code = await runCli(process.argv.slice(2));\nprocess.exit(code ?? 0);\n",
);
const compileRs = 'packages/compilers/vmz-compiler/src/compile.rs';
let rs = fs.readFileSync(compileRs, 'utf8');
if (!rs.includes('vmz-runtime/dist')) {
    rs = rs.replace(
        'let runtime_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../runtimes/vmz-runtime");',
        'let runtime_root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../runtimes/vmz-runtime/dist");',
    );
    fs.writeFileSync(compileRs, rs);
}
patchJson('package.json', (j) => {
    if (j.devDependencies) delete j.devDependencies['vmz-plugin-conformance'];
    j.devDependencies = { ...(j.devDependencies || {}), 'vmz-fixtures': 'workspace:*' };
    j.scripts = j.scripts || {};
    j.scripts['build:runtimes'] =
        'pnpm --filter @vmz/protocol --filter vmz-fixtures --filter @vmz/core --filter vmz --filter @vmz/test run build';
    j.scripts['gate:n3'] = 'pnpm build:runtimes && node scripts/_gate_n3_plugin.mjs';
});
fs.writeFileSync(
    'scripts/copy-serve-host-mjs.mjs',
    `import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst here = path.dirname(fileURLToPath(import.meta.url));\nconst dist = path.join(here, '../packages/runtimes/vmz-runtime/dist');\nconst src = path.join(dist, 'serve-host.js');\nconst dst = path.join(dist, 'serve-host.mjs');\nif (fs.existsSync(src)) fs.copyFileSync(src, dst);\n`,
);
fs.writeFileSync(
    'scripts/copy-vmz-public-api.mjs',
    `import fs from 'node:fs';\nimport path from 'node:path';\nimport { fileURLToPath } from 'node:url';\nconst here = path.dirname(fileURLToPath(import.meta.url));\nconst src = path.join(here, '../packages/runtimes/vmz/src/public-api.d.ts');\nconst dst = path.join(here, '../packages/runtimes/vmz/dist/index.d.ts');\nif (fs.existsSync(src)) fs.copyFileSync(src, dst);\n`,
);
const dels = [
    'packages/runtimes/vmz-protocol/index.js',
    'packages/runtimes/vmz-protocol/index.d.ts',
    'packages/runtimes/vmz-fixtures/index.js',
    'packages/runtimes/vmz/index.js',
    'packages/runtimes/vmz/index.d.ts',
    'packages/runtimes/vmz-runtime/dom.js',
    'packages/runtimes/vmz-runtime/dom.d.ts',
    'packages/runtimes/vmz-runtime/server.js',
    'packages/runtimes/vmz-runtime/server.d.ts',
    'packages/runtimes/vmz-runtime/http.js',
    'packages/runtimes/vmz-runtime/http.d.ts',
    'packages/runtimes/vmz-runtime/serve-host.mjs',
    'packages/runtimes/vmz-runtime/index.d.ts',
];
for (const d of dels) {
    const p = path.join(root, d);
    if (fs.existsSync(p)) fs.unlinkSync(p);
}
if (fs.existsSync('packages/runtimes/vmz-plugin-conformance'))
    fs.rmSync('packages/runtimes/vmz-plugin-conformance', { recursive: true, force: true });
console.log('patch ok');
