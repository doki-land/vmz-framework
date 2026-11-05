import fs from 'node:fs';
import path from 'node:path';

const PACK_MANIFEST_REL = ['_vmz', 'pack-manifest.json'];
const PACK_OUTPUT_DIR_REL = ['_vmz', 'pack'];
const DEFAULT_PUBLIC_BASE = '/';

interface PackManifest {
    publicBase?: string;
    entryFiles?: Array<{ logical?: string; file?: string }>;
    unitChunks?: Array<{ logical?: string; chunkId?: string | null; fileName?: string | null }>;
    chunks?: Array<{ chunkId?: string; fileName?: string; modules?: string[] }>;
}

function readPackManifest(distDir: string, caller: string): PackManifest {
    const manifestPath = path.join(distDir, ...PACK_MANIFEST_REL);
    if (!fs.existsSync(manifestPath)) {
        throw new Error(`${caller}: missing pack manifest at ${manifestPath} — run vmz build (pack) first`);
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackManifest;
}

function chunkHref(manifest: PackManifest, fileName: string): string {
    const base = String(manifest.publicBase || DEFAULT_PUBLIC_BASE).replace(/\/$/, '');
    return `${base}/${PACK_OUTPUT_DIR_REL.join('/')}/${fileName}`;
}

/**
 * 模块路径比较键：去掉 Windows verbatim 前缀（Rust `canonicalize` 给
 * `//?/E:/…`，Node 给 `E:/…`）并统一分隔符，避免同一文件因前缀差异查不到。
 */
function moduleKey(filePath: string): string {
    return filePath.replace(/^(?:\\\\\?\\|\/\/\?\/)/, '').replace(/\\/g, '/');
}

/**
 * Resolve the browser URL of a packed bootstrap entry from
 * `_vmz/pack-manifest.json`.
 *
 * The manifest is the only logical → physical map for browser delivery. A
 * missing manifest or a missing logical name is an explicit error: serving the
 * unpacked root module would hand the browser bare package specifiers that only
 * `vmz-pack` rewrites.
 */
export function packEntryHref(distDir: string, logical: string): string {
    const manifest = readPackManifest(distDir, 'packEntryHref');
    const hit = (manifest.entryFiles || []).find((entry) => entry && entry.logical === logical);
    if (!hit || typeof hit.file !== 'string' || !hit.file) {
        throw new Error(`packEntryHref: pack manifest has no entry file for "${logical}"`);
    }
    return chunkHref(manifest, hit.file);
}

/**
 * 部署单元逻辑 `chunkId` → 浏览器 chunk URL。
 *
 * 只读 `unitChunks[]` 的精确 `logical` 匹配：逻辑 `chunkId` 与 pack chunk id
 * 不保证相同，禁止前缀推导或后缀猜测。单元未进客户端图（`fileName: null`）
 * 视为错误，消费方不得回退到未打包文件。
 */
export function packChunkHref(distDir: string, logical: string): string {
    const manifest = readPackManifest(distDir, 'packChunkHref');
    const hit = (manifest.unitChunks || []).find((entry) => entry && entry.logical === logical);
    if (!hit) {
        throw new Error(`packChunkHref: pack manifest has no unit chunk for "${logical}"`);
    }
    if (typeof hit.fileName !== 'string' || !hit.fileName) {
        throw new Error(`packChunkHref: unit "${logical}" is not in the browser client graph`);
    }
    return chunkHref(manifest, hit.fileName);
}

/** 含指定产物模块的 chunk URL（精确路径匹配，如 `dom.browser.js`）。 */
export function packModuleChunkHref(distDir: string, moduleRel: string): string {
    const manifest = readPackManifest(distDir, 'packModuleChunkHref');
    const target = moduleKey(path.join(distDir, ...moduleRel.split('/')));
    for (const chunk of manifest.chunks || []) {
        if (typeof chunk.fileName !== 'string' || !chunk.fileName) continue;
        for (const module of chunk.modules || []) {
            if (moduleKey(String(module)) === target) return chunkHref(manifest, chunk.fileName);
        }
    }
    throw new Error(`packModuleChunkHref: no chunk carries "${moduleRel}"`);
}

export interface PackIslandHrefs {
    /** 含 `dom.browser` 的共享 chunk（`hydrate` 由该 chunk 导出）。 */
    dom: string;
    /** 部署单元逻辑 `chunkId` → 其客户端 chunk URL（未进图的不列出）。 */
    pages: Record<string, string>;
}

/**
 * island 热更新地址表：一次读 manifest，给出 runtime 共享 chunk 与各页面 chunk
 * 的 URL。调用方只按 `data-vmz-page` 逻辑名查表，缺失即走整页 reload。
 */
export function packIslandHrefs(distDir: string): PackIslandHrefs {
    const manifest = readPackManifest(distDir, 'packIslandHrefs');
    const pages: Record<string, string> = {};
    for (const unit of manifest.unitChunks || []) {
        if (!unit || typeof unit.logical !== 'string' || !unit.logical) continue;
        if (typeof unit.fileName !== 'string' || !unit.fileName) continue;
        pages[unit.logical] = chunkHref(manifest, unit.fileName);
    }
    const target = moduleKey(path.join(distDir, 'dom.browser.js'));
    for (const chunk of manifest.chunks || []) {
        if (typeof chunk.fileName !== 'string' || !chunk.fileName) continue;
        for (const module of chunk.modules || []) {
            if (moduleKey(String(module)) === target) {
                return { dom: chunkHref(manifest, chunk.fileName), pages };
            }
        }
    }
    throw new Error('packIslandHrefs: no chunk carries "dom.browser.js"');
}
