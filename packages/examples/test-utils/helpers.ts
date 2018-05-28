import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const packagesRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function exampleDist(name: 'counter' | 'island' | 'fullstack'): string {
    return path.join(packagesRoot, 'examples', name, 'dist');
}

export function exampleRoot(name: 'counter' | 'island' | 'fullstack'): string {
    return path.join(packagesRoot, 'examples', name);
}

export async function importDist<T = any>(dist: string, rel: string): Promise<T> {
    const href = pathToFileURL(path.join(dist, rel)).href;
    return import(/* @vite-ignore */ href) as Promise<T>;
}

export async function loadDom(dist: string): Promise<any> {
    return importDist(dist, 'vmz-dom.js');
}

export async function loadRuntime(dist: string): Promise<any> {
    return importDist(dist, 'vmz-runtime.js');
}

/** Recursive copy — avoid `fs.cpSync` on `#server` (Node/Windows crash). */
function copyDirSync(src: string, dst: string) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) {
        const from = path.join(src, name);
        const to = path.join(dst, name);
        if (fs.statSync(from).isDirectory()) copyDirSync(from, to);
        else fs.copyFileSync(from, to);
    }
}

/**
 * Mirror `dist/#server` → `dist/_vmz_server` so Node ESM can import
 * without treating `#` as a URL fragment.
 */
export function mirrorServerModules(dist: string): string {
    const src = path.join(dist, '#server');
    const dst = path.join(dist, '_vmz_server');
    if (!fs.existsSync(src)) return dst;
    // Windows can keep ESM locks briefly; retry rm before copy.
    for (let i = 0; i < 5; i++) {
        try {
            fs.rmSync(dst, { recursive: true, force: true });
            break;
        } catch {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        }
    }
    copyDirSync(src, dst);
    return dst;
}

/** Wire `#server/...`  - ?mirrored dist modules (no `#` in path). */
export function installServerResolver(setServerModuleResolver: (fn: (id: string) => string) => void, dist: string) {
    const mirror = mirrorServerModules(dist);
    setServerModuleResolver((moduleId) => {
        const rel = moduleId.replace(/^#server\//, '') + '.js';
        return pathToFileURL(path.join(mirror, rel)).href;
    });
}

export function installDocument(html: string) {
    const { window, document } = parseHTML(html);
    globalThis.document = document;
    globalThis.window = window as unknown as Window & typeof globalThis;
    return { window, document, app: document.getElementById('app') };
}

export function readJson<T = unknown>(file: string): T {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}
