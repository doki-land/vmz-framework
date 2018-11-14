/**
 * `vmz document` / `vmz docs` — registered on `@vmz/commander`.
 */

import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { buildDocuments } from './document-build.js';
import { checkDocuments, manifestHasErrors } from './document-check.js';
import { enrichDocumentContent } from './document-enrich.js';
import { enrichDocumentEvidence } from './document-evidence.js';
import { resolveMarkdownEngine } from './document-markdown.js';
import { createWorkspace } from './index.js';
import { log } from './log.js';
import { emitPrettyJson } from './pretty-json.js';

export function registerDocumentCommands(parent: Command): void {
    const withOpts = (cmd: Command) =>
        cmd
            .option('--root <dir>', 'cli.opt.root')
            .option('--out <dir>', 'cli.opt.out')
            .option('--strict', 'cli.opt.strict')
            .option('--json [file]', 'cli.opt.json');

    withOpts(parent.command('check', 'cli.cmd.document.check')).action((options) => cmdDocumentCheck(options));
    withOpts(parent.command('build', 'cli.cmd.document.build')).action((options) => cmdDocumentBuild(options));
}

async function cmdDocumentCheck(args: ParsedOptions): Promise<number> {
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
        const msg = e instanceof Error ? e.message : String(e);
        log.warn(`document check: markdown/evidence unavailable (${msg}); skipping enrich`);
    }

    const jsonOut = args.json;
    if (jsonOut) {
        emitPrettyJson(typeof jsonOut === 'string' ? jsonOut : true, manifest, {
            logWrote: (p) => log.info(`wrote ${p}`),
        });
    } else {
        log.diagnostics(manifest.diagnostics ?? []);
        log.info(
            `document check: locales=${manifest.locales.join(',') || '(none)'} pages=${manifest.pages.length} defaultLocale=${manifest.defaultLocale ?? '(none)'}`,
        );
    }

    return manifestHasErrors(manifest) ? 1 : 0;
}

async function cmdDocumentBuild(args: ParsedOptions): Promise<number> {
    const project = (typeof args.root === 'string' && args.root) || (typeof args._[0] === 'string' && args._[0]) || '.';
    const projectRoot = path.resolve(project);
    const outDir = (typeof args.out === 'string' && args.out) || path.join(projectRoot, 'dist', 'documents');
    const strict = Boolean(args.strict);

    let result;
    try {
        result = await buildDocuments({ projectRoot, outDir, strict });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error(`document build failed: ${msg}`);
        return 1;
    }

    log.diagnostics(result.manifest.diagnostics || []);

    if (!result.ok) {
        log.errorId('cli.err.document_build_aborted');
        return 1;
    }

    log.info(
        `document build: pages=${result.pages.length} out=${path.relative(process.cwd(), result.outDir) || '.'} designs=${result.manifest.build?.designsCss ?? '(none)'}`,
    );
    return 0;
}
