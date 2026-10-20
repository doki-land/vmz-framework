/**
 * Fixtures for the VMZ release gate. These prove that a failing CI run cannot
 * pass, including the old bypass where a failed workflow passed because a single
 * required job (`Build Runtimes`) happened to be green.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REQUIRED_JOBS, evaluateGate } from './require-ci-success.mjs';

const SHA = 'a'.repeat(40);
const OTHER_SHA = 'b'.repeat(40);

function allJobsSuccess() {
    return REQUIRED_JOBS.map((name) => ({ name, conclusion: 'success' }));
}

function run(overrides = {}) {
    return {
        databaseId: 1,
        status: 'completed',
        conclusion: 'success',
        createdAt: '2026-10-20T00:00:00Z',
        displayTitle: 'CI',
        event: 'push',
        headSha: SHA,
        ...overrides,
    };
}

test('same SHA, every required job green', () => {
    const result = evaluateGate({
        sha: SHA,
        runs: [run()],
        jobsByRunId: () => allJobsSuccess(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runId, 1);
});

test('failed workflow with a green `Build Runtimes` job must not pass', () => {
    // Regression guard for the removed bypass.
    const result = evaluateGate({
        sha: SHA,
        runs: [run({ conclusion: 'failure' })],
        jobsByRunId: () => [{ name: 'Build Runtimes', conclusion: 'success' }],
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'run-not-success');
    assert.equal(result.conclusion, 'failure');
});

test('workflow success but a required job missing', () => {
    const jobs = allJobsSuccess().filter((job) => job.name !== 'Format Check');
    const result = evaluateGate({ sha: SHA, runs: [run()], jobsByRunId: () => jobs });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'missing-job');
    assert.equal(result.job, 'Format Check');
});

test('workflow success but a required job skipped', () => {
    const jobs = allJobsSuccess().map((job) => (job.name === 'Format Check' ? { name: job.name, conclusion: 'skipped' } : job));
    const result = evaluateGate({ sha: SHA, runs: [run()], jobsByRunId: () => jobs });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'job-not-success');
    assert.equal(result.job, 'Format Check');
    assert.equal(result.conclusion, 'skipped');
});

test('cancelled required job is not success', () => {
    const jobs = allJobsSuccess().map((job) => (job.name === 'Build and Test' ? { name: job.name, conclusion: 'cancelled' } : job));
    const result = evaluateGate({ sha: SHA, runs: [run()], jobsByRunId: () => jobs });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'job-not-success');
});

test('an in-flight run keeps the gate waiting', () => {
    const result = evaluateGate({
        sha: SHA,
        runs: [run({ databaseId: 2, status: 'in_progress', conclusion: null, createdAt: '2026-10-20T01:00:00Z' }), run()],
        jobsByRunId: () => allJobsSuccess(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'active');
});

test('a later failed re-run is not masked by an earlier success', () => {
    const result = evaluateGate({
        sha: SHA,
        runs: [
            run({ databaseId: 9, conclusion: 'failure', createdAt: '2026-10-20T02:00:00Z' }),
            run({ databaseId: 8, conclusion: 'success', createdAt: '2026-10-20T01:00:00Z' }),
        ],
        jobsByRunId: () => allJobsSuccess(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'run-not-success');
    assert.equal(result.runId, 9);
});

test('a later successful re-run clears an earlier failure', () => {
    const result = evaluateGate({
        sha: SHA,
        runs: [
            run({ databaseId: 11, conclusion: 'success', createdAt: '2026-10-20T03:00:00Z' }),
            run({ databaseId: 10, conclusion: 'failure', createdAt: '2026-10-20T02:00:00Z' }),
        ],
        jobsByRunId: () => allJobsSuccess(),
    });
    assert.equal(result.ok, true);
    assert.equal(result.runId, 11);
});

test('runs on a different SHA are ignored', () => {
    const result = evaluateGate({
        sha: SHA,
        runs: [run({ headSha: OTHER_SHA })],
        jobsByRunId: () => allJobsSuccess(),
    });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'no-runs');
});

test('no runs yet', () => {
    const result = evaluateGate({ sha: SHA, runs: [], jobsByRunId: () => allJobsSuccess() });
    assert.equal(result.ok, false);
    assert.equal(result.state, 'no-runs');
});
