/**
 * Document Evidence — fence check + API refs from Program Graph.
 *
 * Not a Doc IR: filesystem/manifest projection + Workspace/Program Graph queries.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    DIAG,
    DOCUMENT_EVIDENCE_SCHEMA,
    type DocumentDiagnostic,
    type DocumentEvidence,
    type DocumentManifest,
    type PageRecord,
} from './document-schema.js';
import type { AnalyzedMarkdown } from './document-enrich.js';

const require = createRequire(import.meta.url);

export interface FenceInfoMeta {
    lang: string;
    run: string | null;
    source: string | null;
    playground: boolean;
}

export function parseFenceInfo(info: string | undefined | null): FenceInfoMeta {
    const parts = String(info || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const lang = (parts[0] || '').toLowerCase();
    let run: string | null = null;
    let source: string | null = null;
    let playground = false;
    for (const p of parts.slice(1)) {
        if (p === 'run') run = 'compile';
        else if (p.startsWith('run=')) run = p.slice(4) || 'compile';
        else if (p.startsWith('source=')) source = p.slice(7).replace(/^["']|["']$/g, '');
        else if (p === 'playground') playground = true;
    }
    return { lang, run, source, playground };
}

/** Symbol query (chunkId or name). */
export function parseApiHref(href: string | undefined | null): string | null {
    const h = String(href || '').trim();
    if (h.startsWith('vmz-api:')) return h.slice('vmz-api:'.length).replace(/^\/+/, '');
    if (h.startsWith('api:')) return h.slice('api:'.length).replace(/^\/+/, '');
    return null;
}

export interface ProgramApiIndexRow {
    chunkId: string;
    name: string;
    path: string;
    capabilities: string[];
    programPath: string;
}

export function loadProgramApiIndex(projectRoot: string): ProgramApiIndexRow[] {
    const outDir = path.join(projectRoot, 'dist');
    const rows: ProgramApiIndexRow[] = [];
    if (!fs.existsSync(outDir)) return rows;
    walkFiles(outDir, (file) => {
        if (!file.endsWith('.program.json')) return;
        let root;
        try {
            root = JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch {
            return;
        }
        const units = Array.isArray(root.units) ? root.units : [];
        for (const unit of units) {
            const chunkId = unit?.deployment?.chunkId || unit?.name || path.basename(file, '.program.json');
            const name = unit?.name || chunkId;
            const caps = [];
            const list = unit?.server?.capabilities;
            if (Array.isArray(list)) {
                for (const c of list) {
                    if (c?.method) caps.push(String(c.method));
                }
            }
            rows.push({
                chunkId: String(chunkId),
                name: String(name),
                path: String(root.source || file),
                capabilities: caps,
                programPath: file,
            });
        }
    });
    return rows;
}

/** Resolve API symbol against Program Graph index. */
export function resolveApiSymbol(
    index: ProgramApiIndexRow[],
    query: string,
): { status: 'ok' | 'missing' | 'ambiguous'; matches: ProgramApiIndexRow[] } {
    const q = String(query || '').trim();
    if (!q) return { status: 'missing', matches: [] };
    const exact = index.filter((r) => r.chunkId === q || r.name === q);
    if (exact.length === 1) return { status: 'ok', matches: exact };
    if (exact.length > 1) return { status: 'ambiguous', matches: exact };
    const loose = index.filter((r) => r.chunkId.endsWith(`/${q}`) || r.chunkId.endsWith(q) || r.name.toLowerCase() === q.toLowerCase());
    if (loose.length === 1) return { status: 'ok', matches: loose };
    if (loose.length > 1) return { status: 'ambiguous', matches: loose };
    return { status: 'missing', matches: [] };
}

export interface EnrichDocumentEvidenceCtx {
    analyzeMarkdown: (source: string) => AnalyzedMarkdown;
    projectRoot: string;
    createWorkspace?: (opts: { root: string; outDir: string }) => {
        check: (strict?: boolean) => { diagnostics?: Array<{ severity?: string; message?: string }> };
        build: (strict?: boolean) => { diagnostics?: Array<{ severity?: string; message?: string }> };
        dispose?: () => void;
    };
    ensureProgramGraph?: boolean;
}

export async function enrichDocumentEvidence(
    manifest: DocumentManifest,
    ctx: EnrichDocumentEvidenceCtx,
): Promise<{ diagnostics: DocumentDiagnostic[]; evidence: DocumentEvidence }> {
    const projectRoot = path.resolve(ctx.projectRoot || manifest.root);
    const diagnostics: DocumentDiagnostic[] = [...(manifest.diagnostics || [])];
    const fenceRecords: DocumentEvidence['fences'] = [];
    const apiRefs: DocumentEvidence['apiRefs'] = [];
    const testSelections: unknown[] = [];

    // Collect fences + api links from pages.
    const pages: Array<{ page: PageRecord; fences: NonNullable<AnalyzedMarkdown['fences']>; apiQueries: string[]; sourcePath: string }> = [];
    for (const page of manifest.pages) {
        const abs = path.isAbsolute(page.sourcePath) ? page.sourcePath : path.join(manifest.root, page.sourcePath);
        const source = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
        const analyzed = ctx.analyzeMarkdown(source);
        const fences = Array.isArray(analyzed.fences) ? analyzed.fences : [];
        const apiQueries = [];
        for (const link of analyzed.links || []) {
            const q = parseApiHref(link.href);
            if (q) apiQueries.push(q);
        }
        pages.push({ page, fences, apiQueries, sourcePath: page.sourcePath });
    }

    const needsGraph =
        pages.some((p) => p.apiQueries.length > 0) || pages.some((p) => p.fences.some((f) => parseFenceInfo(f.info).lang === 'vmz'));

    if (needsGraph && ctx.ensureProgramGraph !== false && typeof ctx.createWorkspace === 'function') {
        try {
            await ensureSrcProgramGraph(projectRoot, ctx.createWorkspace, diagnostics);
        } catch (e) {
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: `project build for evidence failed: ${e instanceof Error ? e.message : String(e)}`,
                path: projectRoot,
            });
        }
    }

    const apiIndex = loadProgramApiIndex(projectRoot);

    for (const { page, fences, apiQueries, sourcePath } of pages) {
        for (const fence of fences) {
            const meta = parseFenceInfo(fence.info);
            const rec = {
                lang: meta.lang,
                info: fence.info,
                lineStart: fence.lineStart,
                lineEnd: fence.lineEnd,
                pageKey: page.identity.pageKey,
                locale: page.identity.locale,
                path: sourcePath,
                run: meta.run,
                source: meta.source,
                playground: meta.playground,
                status: 'skipped',
            };
            if (
                !meta.lang ||
                meta.lang === 'text' ||
                meta.lang === 'md' ||
                meta.lang === 'bash' ||
                meta.lang === 'sh' ||
                meta.lang === 'shell' ||
                meta.lang === 'json' ||
                meta.lang === 'css' ||
                meta.lang === 'html'
            ) {
                rec.status = 'highlight';
                fenceRecords.push(rec);
                continue;
            }
            if (meta.lang === 'vmz') {
                const result = await checkVmzFence({
                    projectRoot,
                    fence,
                    meta,
                    createWorkspace: ctx.createWorkspace,
                    sourcePath,
                });
                Object.assign(rec, result.record);
                diagnostics.push(...result.diagnostics);
                if (result.testSelection) testSelections.push(result.testSelection);
                fenceRecords.push(rec);
                continue;
            }
            if (meta.lang === 'ts' || meta.lang === 'typescript' || meta.lang === 'js' || meta.lang === 'javascript') {
                const result = checkScriptFence({ fence, meta, sourcePath, page });
                Object.assign(rec, result.record);
                diagnostics.push(...result.diagnostics);
                fenceRecords.push(rec);
                continue;
            }
            rec.status = 'unsupported';
            diagnostics.push({
                code: DIAG.FENCE_UNSUPPORTED,
                severity: 'warning',
                message: `fence lang \`${meta.lang}\` is highlight-only (no sandbox contribution)`,
                path: `${sourcePath}:${fence.lineStart}`,
            });
            fenceRecords.push(rec);
        }

        for (const query of apiQueries) {
            const resolved = resolveApiSymbol(apiIndex, query);
            const ref = {
                query,
                pageKey: page.identity.pageKey,
                locale: page.identity.locale,
                path: sourcePath,
                status: resolved.status,
                matches: resolved.matches.map((m) => ({
                    chunkId: m.chunkId,
                    name: m.name,
                    source: m.path,
                    capabilities: m.capabilities,
                    stableId: { kind: 'chunk', id: m.chunkId },
                })),
            };
            if (resolved.status === 'missing') {
                diagnostics.push({
                    code: DIAG.API_MISSING,
                    severity: 'error',
                    message: `API symbol not found in Program Graph: ${query}`,
                    path: sourcePath,
                });
            } else if (resolved.status === 'ambiguous') {
                diagnostics.push({
                    code: DIAG.API_AMBIGUOUS,
                    severity: 'error',
                    message: `API symbol ambiguous (${resolved.matches.map((m) => m.chunkId).join(', ')}): ${query}`,
                    path: sourcePath,
                });
            }
            apiRefs.push(ref);
        }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    const evidence: DocumentEvidence = {
        schema: DOCUMENT_EVIDENCE_SCHEMA,
        fences: fenceRecords,
        apiRefs,
        testSelections,
        status: hasErrors ? 'failed' : fenceRecords.length || apiRefs.length ? 'ready' : 'empty',
    };
    return { diagnostics, evidence };
}

interface CheckVmzFenceOpts {
    projectRoot: string;
    fence: NonNullable<AnalyzedMarkdown['fences']>[number];
    meta: FenceInfoMeta;
    createWorkspace?: EnrichDocumentEvidenceCtx['createWorkspace'];
    sourcePath: string;
}

async function checkVmzFence(opts: CheckVmzFenceOpts) {
    const diagnostics: DocumentDiagnostic[] = [];
    const { fence, meta, projectRoot, sourcePath } = opts;
    let body = fence.content;
    let label = `inline@${sourcePath}:${fence.lineStart}`;

    if (meta.source) {
        const abs = path.isAbsolute(meta.source) ? meta.source : path.join(projectRoot, meta.source);
        if (!fs.existsSync(abs)) {
            diagnostics.push({
                code: DIAG.FENCE_SOURCE_MISSING,
                severity: 'error',
                message: `fence source missing: ${meta.source}`,
                path: `${sourcePath}:${fence.lineStart}`,
            });
            return {
                record: { status: 'failed', detail: 'source_missing' },
                diagnostics,
                testSelection: null,
            };
        }
        body = fs.readFileSync(abs, 'utf8');
        label = meta.source;
    }

    if (typeof opts.createWorkspace !== 'function') {
        diagnostics.push({
            code: DIAG.FENCE_CHECK,
            severity: 'error',
            message: 'createWorkspace unavailable for vmz fence check',
            path: `${sourcePath}:${fence.lineStart}`,
        });
        return { record: { status: 'failed' }, diagnostics, testSelection: null };
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d2-fence-'));
    try {
        const rel = 'src/components/FenceExample.vmz';
        const abs = path.join(tmp, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        // Ensure minimal valid SFC if fence is a fragment; prefer full SFC bodies in docs.
        const content = body.includes('<template') ? body : wrapVmzFragment(body);
        fs.writeFileSync(abs, content, 'utf8');
        const outDir = path.join(tmp, 'dist');
        const ws = opts.createWorkspace({ root: tmp, outDir });
        const report = ws.check(true);
        const errors = (report.diagnostics || []).filter((d) => d.severity === 'error' || d.severity === 'Error');
        if (errors.length) {
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: `vmz fence check failed (${label}): ${errors[0]?.message || 'error'}`,
                path: `${sourcePath}:${fence.lineStart}`,
            });
            ws.dispose?.();
            return { record: { status: 'failed', detail: 'check' }, diagnostics, testSelection: null };
        }

        let testSelection: unknown = null;
        if (meta.run) {
            const mode = meta.run === 'logic' || meta.run === 'browser' ? meta.run : 'compile';
            const build = ws.build(false);
            const buildErrs = (build.diagnostics || []).filter((d) => d.severity === 'error' || d.severity === 'Error');
            if (buildErrs.length) {
                diagnostics.push({
                    code: DIAG.FENCE_RUN_FAILED,
                    severity: 'error',
                    message: `vmz fence run=${mode} build failed (${label}): ${buildErrs[0]?.message || 'error'}`,
                    path: `${sourcePath}:${fence.lineStart}`,
                });
                ws.dispose?.();
                return { record: { status: 'failed', detail: 'run_build' }, diagnostics, testSelection: null };
            }
            const prog = path.join(outDir, 'components', 'FenceExample.program.json');
            if (!fs.existsSync(prog)) {
                diagnostics.push({
                    code: DIAG.FENCE_RUN_FAILED,
                    severity: 'error',
                    message: `vmz fence run=${mode} missing program.json (${label})`,
                    path: `${sourcePath}:${fence.lineStart}`,
                });
                ws.dispose?.();
                return { record: { status: 'failed', detail: 'run_program' }, diagnostics, testSelection: null };
            }
            testSelection = {
                schema: 'vmz.dx.test_selection.v0',
                reason: `document fence run=${mode} @ ${sourcePath}:${fence.lineStart}`,
                testIds: [`document.fence.${pageKeySafe(sourcePath)}.${fence.lineStart}`],
                affectedChunkIds: ['components/FenceExample'],
                status: 'ready',
                mode,
            };
            ws.dispose?.();
            return {
                record: { status: 'ok', detail: `run=${mode}`, source: label },
                diagnostics,
                testSelection,
            };
        }

        ws.dispose?.();
        return { record: { status: 'ok', detail: 'check', source: label }, diagnostics, testSelection: null };
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function wrapVmzFragment(body: string): string {
    const trimmed = String(body || '').trim();
    if (trimmed.startsWith('<')) {
        return `<template>\n${trimmed}\n</template>\n<script client>\nexport default class FenceExample {}\n</script>\n`;
    }
    return `<template><p>ok</p></template>\n<script client>\n${trimmed}\n</script>\n`;
}

function pageKeySafe(p: string): string {
    return String(p || 'page').replace(/[^\w.-]+/g, '_');
}

/** TS/JS fence: oxc-aligned surface via TypeScript parse (syntax only; no execute). */
function checkScriptFence({
    fence,
    meta,
    sourcePath,
}: {
    fence: NonNullable<AnalyzedMarkdown['fences']>[number];
    meta: FenceInfoMeta;
    sourcePath: string;
    page?: PageRecord;
}) {
    const diagnostics: DocumentDiagnostic[] = [];
    try {
        const ts = require('typescript');
        const isTs = meta.lang === 'ts' || meta.lang === 'typescript';
        const fileName = isTs ? 'fence.ts' : 'fence.js';
        const kind = isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS;
        const sf = ts.createSourceFile(fileName, fence.content, ts.ScriptTarget.Latest, true, kind);
        // createSourceFile does not throw on syntax errors — scan for parse diagnostics via transpile.
        const out = ts.transpileModule(fence.content, {
            compilerOptions: {
                target: ts.ScriptTarget.ES2022,
                module: ts.ModuleKind.ESNext,
                strict: false,
            },
            reportDiagnostics: true,
            fileName,
        });
        const errs = (out.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
        if (errs.length) {
            const msg = ts.flattenDiagnosticMessageText(errs[0].messageText, '\n');
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: `${meta.lang} fence check failed: ${msg}`,
                path: `${sourcePath}:${fence.lineStart}`,
            });
            return { record: { status: 'failed', detail: 'syntax' }, diagnostics };
        }
        // Touch sf to keep parse path honest.
        if (!sf || sf.kind == null) {
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: `${meta.lang} fence parse produced no SourceFile`,
                path: `${sourcePath}:${fence.lineStart}`,
            });
            return { record: { status: 'failed', detail: 'parse' }, diagnostics };
        }
        return { record: { status: 'ok' }, diagnostics };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/Cannot find module ['\"]typescript['\"]/i.test(msg) || (e as { code?: string })?.code === 'MODULE_NOT_FOUND') {
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: 'TS/JS fence check needs `typescript` (optional peer of `@vmz/vmz`). Install: pnpm add -D typescript',
                path: `${sourcePath}:${fence.lineStart}`,
            });
            return { record: { status: 'failed', detail: 'missing-typescript' }, diagnostics };
        }
        diagnostics.push({
            code: DIAG.FENCE_CHECK,
            severity: 'error',
            message: `${meta.lang} fence check failed: ${msg}`,
            path: `${sourcePath}:${fence.lineStart}`,
        });
        return { record: { status: 'failed', detail: 'exception' }, diagnostics };
    }
}

function walkFiles(dir: string, fn: (file: string) => void): void {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) walkFiles(full, fn);
        else if (ent.isFile()) fn(full);
    }
}

/**
 * Build only project src .vmz files into dist for API Program Graph queries.
 * Avoids coupling document evidence to site /designs theme diagnostics.
 */
async function ensureSrcProgramGraph(
    projectRoot: string,
    createWorkspace: NonNullable<EnrichDocumentEvidenceCtx['createWorkspace']>,
    diagnostics: DocumentDiagnostic[],
): Promise<void> {
    const srcDir = path.join(projectRoot, 'src');
    if (!fs.existsSync(srcDir)) return;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-d2-api-'));
    try {
        copyDir(srcDir, path.join(tmp, 'src'));
        const outDir = path.join(tmp, 'dist');
        const ws = createWorkspace({ root: tmp, outDir });
        const report = ws.build(false);
        const errors = (report.diagnostics || []).filter((d) => d.severity === 'error' || d.severity === 'Error');
        if (errors.length) {
            diagnostics.push({
                code: DIAG.FENCE_CHECK,
                severity: 'error',
                message: `src Program Graph build failed: ${errors[0]?.message || 'error'}`,
                path: projectRoot,
            });
            ws.dispose?.();
            return;
        }
        ws.dispose?.();
        // Materialize program artifacts into project dist for loadProgramApiIndex.
        const destDist = path.join(projectRoot, 'dist');
        copyDir(outDir, destDist);
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
}

function copyDir(from: string, to: string): void {
    fs.mkdirSync(to, { recursive: true });
    for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, ent.name);
        const dst = path.join(to, ent.name);
        if (ent.isDirectory()) copyDir(src, dst);
        else fs.copyFileSync(src, dst);
    }
}

/** Lazy note: callers pass `createWorkspace` from `./index.js` (see document-cmd / document-build). */
