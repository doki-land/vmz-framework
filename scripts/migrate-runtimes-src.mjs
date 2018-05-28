import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const tsconfig = JSON.stringify(
    {
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            declaration: true,
            outDir: 'dist',
            rootDir: 'src',
            strict: false,
            skipLibCheck: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
        },
        include: ['src/**/*.ts'],
    },
    null,
    4,
);
const tsconfigStrict = JSON.stringify(
    {
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            declaration: true,
            outDir: 'dist',
            rootDir: 'src',
            strict: true,
            skipLibCheck: true,
            esModuleInterop: true,
            forceConsistentCasingInFileNames: true,
        },
        include: ['src/**/*.ts'],
    },
    null,
    4,
);
function write(rel, content) {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, 'utf8');
}
for (const [pkg, cfg] of [
    ['vmz-protocol', tsconfigStrict],
    ['vmz-fixtures', tsconfigStrict],
    ['vmz-runtime', tsconfig],
    ['vmz', tsconfig],
])
    write(`packages/runtimes/${pkg}/tsconfig.json`, cfg);
const js = fs.readFileSync('packages/runtimes/vmz-protocol/index.js', 'utf8');
const dts = fs.readFileSync('packages/runtimes/vmz-protocol/index.d.ts', 'utf8');
let ifaces = dts
    .slice(dts.indexOf('export interface'))
    .replace(/^export function.*$/gm, '')
    .trim();
const jsClean = js.replace(/^\/\*\*[\s\S]*?\*\/\s*/, '').replace(/\/\*\*\s*@returns[\s\S]*?\*\/\s*/g, '');
write('packages/runtimes/vmz-protocol/src/index.ts', ['/** VMZ versioned wire protocols. */', '', jsClean.trim(), '', ifaces, ''].join('\n'));
const fixJs = fs.readFileSync('packages/runtimes/vmz-fixtures/index.js', 'utf8');
write('packages/runtimes/vmz-fixtures/src/index.ts', fixJs.replace(/^\/\*\*[\s\S]*?\*\/\s*/, ''));
const coreRoot = 'packages/runtimes/vmz-runtime';
for (const [src, dest] of [
    ['dom.js', 'dom.ts'],
    ['server.js', 'server.ts'],
    ['http.js', 'http.ts'],
    ['serve-host.mjs', 'serve-host.ts'],
]) {
    let c = fs.readFileSync(path.join(coreRoot, src), 'utf8');
    write(`${coreRoot}/src/${dest}`, '// @ts-nocheck\n' + c);
}
write(`${coreRoot}/src/index.ts`, "export * from './server.js';\n");
const vmzSrc = 'packages/runtimes/vmz/src';
for (const f of fs.readdirSync(vmzSrc)) {
    if (f.endsWith('.js')) {
        const c = fs.readFileSync(path.join(vmzSrc, f), 'utf8');
        fs.writeFileSync(path.join(vmzSrc, f.replace(/\.js$/, '.ts')), '// @ts-nocheck\n' + c, 'utf8');
        fs.unlinkSync(path.join(vmzSrc, f));
    }
}
let idx = fs.readFileSync('packages/runtimes/vmz/index.js', 'utf8');
idx = idx.replace(/from '\.\/src\//g, "from './");
const hereLine = 'const here = path.dirname(fileURLToPath(import.meta.url));';
idx = idx.replace(hereLine, hereLine + "\nconst pkgRoot = path.join(here, '..');");
idx = idx.replace(/path\.join\(here, `vmz\.\$\{triple\}\.node`\)/g, 'path.join(pkgRoot, `vmz.${triple}.node`)');
idx = idx.replace(/path\.join\(here, 'vmz\.node'\)/g, "path.join(pkgRoot, 'vmz.node')");
idx = idx.replace(/path\.join\(here, '\.\.', `vmz-\$\{triple\}`/g, "path.join(pkgRoot, '..', `vmz-${triple}`");
idx = idx.replace(
    /path\.join\(here, '\.\.', `vmz-\$\{triple\}`, `vmz\.\$\{triple\}\.node`\)/g,
    "path.join(pkgRoot, '..', `vmz-${triple}`, `vmz.${triple}.node`)",
);
idx = idx.replace(/path\.join\(here, '\.\.', `vmz-\$\{triple\}`, 'vmz\.node'\)/g, "path.join(pkgRoot, '..', `vmz-${triple}`, 'vmz.node')");
idx = idx.replace(/path\.join\(here, `\.\.\/vmz-\$\{triple\}`/g, 'path.join(pkgRoot, `../vmz-${triple}`');
idx = idx.replace(/path\.join\(here, '\.\.\/\.\.\/\.\.\/target/g, "path.join(pkgRoot, '../../../target");
write('packages/runtimes/vmz/src/index.ts', '// @ts-nocheck\n' + idx);
if (fs.existsSync('packages/runtimes/vmz/index.d.ts'))
    fs.copyFileSync('packages/runtimes/vmz/index.d.ts', 'packages/runtimes/vmz/src/public-api.d.ts');
console.log('migrate ok');
