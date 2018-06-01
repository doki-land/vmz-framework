/**
 * Inspect GitHub Actions status for this repo (no rewrite-each-time helper).
 *
 * Public API works without auth for public repos. Optional GH_TOKEN / GITHUB_TOKEN
 * unlocks private data and job logs.
 *
 * Usage:
 *   node scripts/ci/status.mjs
 *   node scripts/ci/status.mjs --branch=dev
 *   node scripts/ci/status.mjs --sha=e816daa
 *   node scripts/ci/status.mjs --run=31759520568
 *   node scripts/ci/status.mjs --run=31759520568 --jobs
 *   pnpm ci:status -- --branch=dev --jobs
 */

import { spawnSync } from 'node:child_process';
import https from 'node:https';

const REPO = process.env.VMZ_GITHUB_REPO || 'doki-land/vmz-framework';
const API = `https://api.github.com/repos/${REPO}`;
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

const argv = process.argv.slice(2).filter((a) => a !== '--');
function flag(name) {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
    return undefined;
}
const wantJobs = argv.includes('--jobs');
const wantHelp = argv.includes('--help') || argv.includes('-h');

function fail(msg) {
    console.error(`ci-status: ${msg}`);
    process.exit(1);
}

function git(args) {
    const r = spawnSync('git', args, { encoding: 'utf8' });
    if (r.status !== 0) return '';
    return String(r.stdout || '').trim();
}

function apiGet(path) {
    return new Promise((resolve, reject) => {
        const headers = {
            'User-Agent': 'vmz-ci-status',
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };
        if (token) headers.Authorization = `Bearer ${token}`;
        https
            .get(`${API}${path}`, { headers }, (res) => {
                let body = '';
                res.on('data', (c) => {
                    body += c;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`${res.statusCode} ${path}: ${body.slice(0, 400)}`));
                        return;
                    }
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on('error', reject);
    });
}

function shortSha(sha) {
    return String(sha || '').slice(0, 7);
}

function pad(s, n) {
    s = String(s ?? '');
    return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function listRuns({ branch, sha, limit }) {
    const q = new URLSearchParams({ per_page: String(limit) });
    if (branch) q.set('branch', branch);
    const data = await apiGet(`/actions/runs?${q}`);
    let runs = data.workflow_runs || [];
    if (sha) {
        const needle = sha.toLowerCase();
        runs = runs.filter((r) =>
            String(r.head_sha || '')
                .toLowerCase()
                .startsWith(needle),
        );
    }
    return runs;
}

async function listJobs(runId) {
    const data = await apiGet(`/actions/runs/${runId}/jobs`);
    return data.jobs || [];
}

function printRuns(runs) {
    if (!runs.length) {
        console.log('ci-status: no matching runs');
        return;
    }
    console.log(`${pad('workflow', 18)} ${pad('status', 10)} ${pad('conclusion', 10)} ${pad('sha', 8)} ${pad('event', 8)} url`);
    for (const r of runs) {
        console.log(
            `${pad(r.name, 18)} ${pad(r.status, 10)} ${pad(r.conclusion || '-', 10)} ${pad(shortSha(r.head_sha), 8)} ${pad(r.event, 8)} ${r.html_url}`,
        );
    }
}

function printJobs(jobs) {
    if (!jobs.length) {
        console.log('ci-status: no jobs');
        return;
    }
    console.log(`${pad('job', 22)} ${pad('conclusion', 10)} failed-step`);
    for (const j of jobs) {
        const failed = (j.steps || []).find((s) => s.conclusion === 'failure');
        console.log(`${pad(j.name, 22)} ${pad(j.conclusion || j.status || '-', 10)} ${failed ? failed.name : '-'}`);
    }
}

async function main() {
    if (wantHelp) {
        console.log(`Usage:
  pnpm ci:status
  pnpm ci:status -- --branch=dev
  pnpm ci:status -- --sha=<prefix>
  pnpm ci:status -- --run=<id> [--jobs]
  pnpm ci:status -- --branch=dev --jobs   # jobs for newest matching run

Env:
  VMZ_GITHUB_REPO   default doki-land/vmz-framework
  GH_TOKEN / GITHUB_TOKEN   optional; needed for private repos / logs`);
        return;
    }

    const branch = flag('branch') || git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'dev';
    const sha = flag('sha') || flag('commit');
    const runId = flag('run');
    const limit = Number(flag('limit') || 8);

    if (runId) {
        const run = await apiGet(`/actions/runs/${runId}`);
        printRuns([run]);
        if (wantJobs) printJobs(await listJobs(runId));
        const failed = (await listJobs(runId)).some((j) => j.conclusion === 'failure');
        process.exitCode = failed || run.conclusion === 'failure' ? 1 : 0;
        return;
    }

    const runs = await listRuns({ branch, sha, limit });
    printRuns(runs);

    if (wantJobs && runs[0]) {
        console.log(`\njobs for run ${runs[0].id} (${shortSha(runs[0].head_sha)}):`);
        printJobs(await listJobs(runs[0].id));
    }

    const newest = runs[0];
    if (!newest) {
        process.exitCode = 1;
        return;
    }
    if (newest.status !== 'completed') {
        console.log(`\nci-status: newest run still ${newest.status}`);
        process.exitCode = 2;
        return;
    }
    if (newest.conclusion !== 'success') {
        console.log(`\nci-status: newest run conclusion=${newest.conclusion}`);
        process.exitCode = 1;
        return;
    }
    console.log('\nci-status: green');
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
