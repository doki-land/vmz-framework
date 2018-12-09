/**
 * `vmz github-actions` — monitor workflow runs via N-API → Rust `vmz-github` (octocrab).
 */

import type { Cli, ParsedOptions } from '@vmz/commander';
import { loadNative } from './index.js';
import { log } from './log.js';
import { emitPrettyJson } from './pretty-json.js';

export function registerGithubActionsCommand(cli: Cli): void {
    cli.command('github-actions|gha', 'cli.cmd.github-actions')
        .option('--mode <mode>', 'cli.opt.gha.mode')
        .option('--workflow <id>', 'cli.opt.gha.workflow')
        .option('--run-id <id>', 'cli.opt.gha.run-id')
        .option('--ref <sha>', 'cli.opt.gha.ref')
        .option('--branch <name>', 'cli.opt.gha.branch')
        .option('--owner <owner>', 'cli.opt.gha.owner')
        .option('--repo <repo>', 'cli.opt.gha.repo')
        .option('--token <token>', 'cli.opt.gha.token')
        .option('--timeout-minutes <n>', 'cli.opt.gha.timeout-minutes')
        .option('--interval-seconds <n>', 'cli.opt.gha.interval-seconds')
        .option('--required-conclusion <c>', 'cli.opt.gha.required-conclusion')
        .option('--json [file]', 'cli.opt.json')
        .action((options) => cmdGithubActions(options));
}

export function cmdGithubActions(args: ParsedOptions): number {
    const native = loadNative() as {
        githubActionsMonitorJson?: (requestJson: string) => string;
    };
    if (typeof native.githubActionsMonitorJson !== 'function') {
        log.error('githubActionsMonitorJson missing — rebuild native (`pnpm napi:build`)');
        return 1;
    }

    const modeRaw = String(args.mode ?? 'status')
        .trim()
        .toLowerCase();
    if (modeRaw !== 'status' && modeRaw !== 'wait') {
        log.errorId('cli.err.gha.mode', { mode: modeRaw });
        return 1;
    }

    const { owner, repo } = resolveOwnerRepo(args);
    if (!owner || !repo) {
        log.errorId('cli.err.gha.repo');
        return 1;
    }

    const token = (typeof args.token === 'string' && args.token.trim()) || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || undefined;

    const timeoutMinutes = positiveNumber(args['timeout-minutes'], 45);
    const intervalSeconds = positiveNumber(args['interval-seconds'], 15);

    const request = {
        owner,
        repo,
        token: token || null,
        mode: modeRaw,
        workflow: strOrNull(args.workflow),
        runId: parseRunId(args['run-id']),
        headSha: strOrNull(args.ref),
        branch: strOrNull(args.branch),
        timeoutSecs: Math.round(timeoutMinutes * 60),
        intervalSecs: Math.round(intervalSeconds),
        requiredConclusion: String(args['required-conclusion'] ?? 'success'),
    };

    let resultJson: string;
    try {
        resultJson = native.githubActionsMonitorJson(JSON.stringify(request));
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error(msg);
        return 1;
    }

    let result: {
        runId: number;
        status: string;
        conclusion?: string | null;
        htmlUrl: string;
        name?: string | null;
    };
    try {
        result = JSON.parse(resultJson);
    } catch {
        log.error('githubActionsMonitorJson returned invalid JSON');
        return 1;
    }

    log.info(
        `github-actions: run_id=${result.runId} status=${result.status} conclusion=${result.conclusion ?? 'null'} html_url=${result.htmlUrl}`,
    );

    if (args.json !== undefined && args.json !== false) {
        emitPrettyJson(typeof args.json === 'string' ? args.json : true, result);
    }

    return 0;
}

function resolveOwnerRepo(args: ParsedOptions): { owner: string; repo: string } {
    let owner = typeof args.owner === 'string' ? args.owner.trim() : '';
    let repo = typeof args.repo === 'string' ? args.repo.trim() : '';
    if (!owner || !repo) {
        const fromEnv = (process.env.GITHUB_REPOSITORY || '').trim();
        const slash = fromEnv.indexOf('/');
        if (slash > 0) {
            if (!owner) owner = fromEnv.slice(0, slash);
            if (!repo) repo = fromEnv.slice(slash + 1);
        }
    }
    if (!owner || !repo) {
        const fallback = (process.env.VMZ_GITHUB_REPO || 'doki-land/vmz-framework').trim();
        const slash = fallback.indexOf('/');
        if (slash > 0) {
            if (!owner) owner = fallback.slice(0, slash);
            if (!repo) repo = fallback.slice(slash + 1);
        }
    }
    return { owner, repo };
}

function strOrNull(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t ? t : null;
}

function parseRunId(v: unknown): number | null {
    if (v === undefined || v === null || v === true || v === false) return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function positiveNumber(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
