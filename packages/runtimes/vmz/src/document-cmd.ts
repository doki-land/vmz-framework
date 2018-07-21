// @ts-nocheck
/**
 * `vmz document` / `vmz docs` CLI .
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildDocuments } from './document-build.js';
import { checkDocuments, manifestHasErrors } from './document-check.js';
import { enrichDocumentContent } from './document-enrich.js';
import { enrichDocumentEvidence } from './document-evidence.js';
import { resolveMarkdownEngine } from './document-markdown.js';
import { createWorkspace } from './index.js';
import { log } from './log.js';
import { parseArgs } from './cli.js';
import { emitPrettyJson } from './pretty-json.js';

function printDocumentHelp() {
    console.log(`vmz document — project /documents domain

Usage:
  vmz document check [project]   Check locale tree + links/anchors + fence/API evidence
  vmz document build [project]   Static HTML + view + evidence + search/islands + /designs CSS
  vmz docs check|build […]       Alias of document

Options:
  --root <dir>     Project root (default: . or positional path)
  --out <dir>      Build output (default: <project>/dist/documents)
  --strict         Fail on missing/orphan translations & require defaultLocale
  --json [file]    Emit DocumentManifest JSON to stdout or file
`);
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function cmdDocument(argv) {
    const [sub, ...rest] = argv;
    if (!sub) {
        if (process.stdout.isTTY) {
            printDocumentHelp();
            return 0;
        }
        log.error('vmz document requires a subcommand in non-interactive/CI contexts');
        printDocumentHelp();
        return 1;
    }
    if (sub === 'help' || sub === '-h' || sub === '--help') {
        printDocumentHelp();
        return 0;
    }
    if (sub.startsWith('-')) {
        log.error('vmz document requires a subcommand (check|build)');
        printDocumentHelp();
        return 1;
    }

    const args = parseArgs(rest);
    switch (sub) {
        case 'check':
            return cmdDocumentCheck(args);
        case 'build':
            return cmdDocumentBuild(args);
        case 'dev':
        case 'serve':
        case 'test':
        case 'clean':
            log.error(`vmz document ${sub} is not implemented yet`);
            return 1;
        default:
            log.error(`unknown document subcommand \`${sub}\``);
            printDocumentHelp();
            return 1;
    }
}

/** @param {Record<string, string | boolean> & { _: string[] }} args */
async function cmdDocumentCheck(args) {
    const project = (typeof args.root === 'string' && args.root) || (typeof args._[0] === 'string' && args._[0]) || '.';
    const projectRoot = path.resolve(project);
    const strict = Boolean(args.strict);
    const manifest = checkDocuments({ projectRoot, strict });

    try {
        const engine = await resolveMarkdownEngine({});
        const enriched = enrichDocumentContent(manifest, {
            analyzeMarkdown: engine.analyzeMarkdown,
            projectRoot,
        });
        manifest.diagnostics = enriched.diagnostics;
        const evidence = await enrichDocumentEvidence(manifest, {
            analyzeMarkdown: engine.analyzeMarkdown,
            projectRoot,
            createWorkspace,
        });
        manifest.diagnostics = evidence.diagnostics;
        manifest.evidence = evidence.evidence;
    } catch (e) {
        log.warn(`document check: markdown/evidence unavailable (${e.message}); skipping enrich`);
    }

    const jsonOut = args.json;
    if (jsonOut) {
        emitPrettyJson(jsonOut, manifest, { logWrote: (p) => log.info(`wrote ${p}`) });
    } else {
        for (const d of manifest.diagnostics) {
            const loc = d.path ? ` (${d.path})` : '';
            if (d.severity === 'error') log.error(`${d.code}: ${d.message}${loc}`);
            else console.warn(`vmz warn ${d.code}: ${d.message}${loc}`);
        }
        log.info(
            `document check: locales=${manifest.locales.join(',') || '(none)'} pages=${manifest.pages.length} defaultLocale=${manifest.defaultLocale ?? '(none)'}`,
        );
    }

    return manifestHasErrors(manifest) ? 1 : 0;
}

/** @param {Record<string, string | boolean> & { _: string[] }} args */
async function cmdDocumentBuild(args) {
    const project = (typeof args.root === 'string' && args.root) || (typeof args._[0] === 'string' && args._[0]) || '.';
    const projectRoot = path.resolve(project);
    const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'documents');
    const strict = Boolean(args.strict);

    let result;
    try {
        result = await buildDocuments({ projectRoot, outDir, strict });
    } catch (e) {
        log.error(`document build failed: ${e.message || e}`);
        return 1;
    }

    for (const d of result.manifest.diagnostics || []) {
        const loc = d.path ? ` (${d.path})` : '';
        if (d.severity === 'error') log.error(`${d.code}: ${d.message}${loc}`);
        else console.warn(`vmz warn ${d.code}: ${d.message}${loc}`);
    }

    if (!result.ok) {
        log.error('document build aborted due to diagnostics');
        return 1;
    }

    log.info(
        `document build: pages=${result.pages.length} out=${path.relative(process.cwd(), result.outDir) || '.'} designs=${result.manifest.build?.designsCss ?? '(none)'}`,
    );
    return 0;
}
