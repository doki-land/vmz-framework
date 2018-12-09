/**
 * Publish gate: require a green CI workflow run on a specific commit.
 *
 * Why not `gh run list … -q '.[0].conclusion'`?
 * - Tag push can race dev CI (run still queued → "missing").
 * - A newer failed re-run hides an older success on the same SHA.
 *
 * Pass when any completed `ci.yml` run on TAG_SHA has conclusion `success`, after
 * in-flight runs for that commit settle (or timeout waiting for first CI).
 */

import { spawnSync } from 'node:child_process';

const REPO = process.env.GITHUB_REPOSITORY || process.env.VMZ_GITHUB_REPO || 'doki-land/vmz-framework';
const TAG_SHA = String(process.env.TAG_SHA || process.argv.find((a) => a.startsWith('--sha='))?.slice(6) || '')
    .trim()
    .toLowerCase();
const WORKFLOW = process.env.CI_WORKFLOW_FILE || 'ci.yml';
const TIMEOUT_MS = Number(process.env.CI_WAIT_TIMEOUT_MS || 45 * 60 * 1000);
const INTERVAL_MS = Number(process.env.CI_WAIT_INTERVAL_MS || 20 * 1000);

function fail(msg) {
    console.error(`require-ci-success: ${msg}`);
    process.exit(1);
}

function gh(args) {
    const r = spawnSync('gh', args, {
        encoding: 'utf8',
        shell: false,
        env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '' },
    });
    if (r.status !== 0) {
        fail(r.stderr?.trim() || r.stdout?.trim() || `gh ${args.join(' ')} exit ${r.status}`);
    }
    return String(r.stdout ?? '').trim();
}

function listRuns() {
    const raw = gh([
        'run',
        'list',
        '--repo',
        REPO,
        '--commit',
        TAG_SHA,
        '--workflow',
        WORKFLOW,
        '--limit',
        '20',
        '--json',
        'databaseId,status,conclusion,createdAt,displayTitle,event',
    ]);
    try {
        return JSON.parse(raw);
    } catch {
        fail(`invalid gh json: ${raw.slice(0, 200)}`);
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
    if (!/^[0-9a-f]{40}$/.test(TAG_SHA)) {
        fail(`TAG_SHA must be 40-char hex (got '${TAG_SHA || '(empty)'}')`);
    }

    const deadline = Date.now() + TIMEOUT_MS;
    let attempt = 0;

    while (Date.now() < deadline) {
        attempt += 1;
        const runs = listRuns();
        const active = runs.filter((r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'pending');
        const successes = runs.filter((r) => r.status === 'completed' && r.conclusion === 'success');
        const failures = runs.filter(
            (r) => r.status === 'completed' && r.conclusion && r.conclusion !== 'success' && r.conclusion !== 'skipped',
        );

        if (successes.length > 0 && active.length === 0) {
            const pick = successes[0];
            console.log(`CI success confirmed for ${TAG_SHA} (run ${pick.databaseId} "${pick.displayTitle}" event=${pick.event})`);
            return;
        }

        if (runs.length === 0) {
            console.log(`[${attempt}] waiting for first ${WORKFLOW} run on ${TAG_SHA.slice(0, 7)}…`);
        } else if (active.length > 0) {
            console.log(`[${attempt}] ${active.length} CI run(s) still active on ${TAG_SHA.slice(0, 7)}…`);
        } else if (successes.length === 0 && failures.length > 0) {
            const last = failures[0];
            fail(
                `CI on ${TAG_SHA} has no success (${failures.length} completed non-success; latest ${last.databaseId} conclusion=${last.conclusion})`,
            );
        } else {
            console.log(`[${attempt}] CI runs present but no success yet on ${TAG_SHA.slice(0, 7)}…`);
        }

        await sleep(INTERVAL_MS);
    }

    fail(`timed out after ${TIMEOUT_MS}ms waiting for green ${WORKFLOW} on ${TAG_SHA}`);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
