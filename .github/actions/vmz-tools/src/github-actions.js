'use strict';

/**
 * Monitor GitHub Actions via Octokit (@actions/github).
 * Does not spawn the `gh` CLI.
 */

/**
 * @param {object} args
 * @param {import('@actions/core')} args.core
 * @param {ReturnType<import('@actions/github')['getOctokit']>} args.octokit
 * @param {{ owner: string, repo: string }} args.repo
 * @param {{
 *   mode: string,
 *   workflow: string,
 *   runId: string,
 *   ref: string,
 *   branch: string,
 *   timeoutMinutes: number,
 *   intervalSeconds: number,
 *   requiredConclusion: string,
 * }} args.opts
 */
async function runGithubActionsTool({ core, octokit, repo, opts }) {
  const mode = (opts.mode || 'status').trim().toLowerCase();
  if (mode !== 'status' && mode !== 'wait') {
    throw new Error(`github-actions: unsupported mode "${opts.mode}" (use status|wait)`);
  }

  const run = opts.runId
    ? await getRunById(octokit, repo, opts.runId)
    : await findLatestRun(octokit, repo, opts);

  if (!run) {
    throw new Error(
      'github-actions: no matching workflow run found' +
        (opts.workflow ? ` (workflow=${opts.workflow})` : '') +
        (opts.ref ? ` (ref=${opts.ref})` : '') +
        (opts.branch ? ` (branch=${opts.branch})` : ''),
    );
  }

  core.info(
    `github-actions: run_id=${run.id} status=${run.status} conclusion=${run.conclusion ?? 'null'} ` +
      `workflow=${run.name ?? opts.workflow} html_url=${run.html_url}`,
  );
  core.setOutput('run-id', String(run.id));
  core.setOutput('status', run.status ?? '');
  core.setOutput('conclusion', run.conclusion ?? '');
  core.setOutput('html-url', run.html_url ?? '');

  if (mode === 'status') {
    return;
  }

  let current = run;
  const deadline = Date.now() + opts.timeoutMinutes * 60_000;
  while (current.status !== 'completed') {
    if (Date.now() >= deadline) {
      throw new Error(
        `github-actions: timed out after ${opts.timeoutMinutes}m waiting for run ${current.id} ` +
          `(last status=${current.status})`,
      );
    }
    core.info(
      `github-actions: waiting… status=${current.status} (sleep ${opts.intervalSeconds}s)`,
    );
    await sleep(opts.intervalSeconds * 1000);
    current = await getRunById(octokit, repo, String(current.id));
    core.setOutput('status', current.status ?? '');
    core.setOutput('conclusion', current.conclusion ?? '');
  }

  core.info(
    `github-actions: completed run_id=${current.id} conclusion=${current.conclusion ?? 'null'}`,
  );

  const required = (opts.requiredConclusion || 'success').trim().toLowerCase();
  const actual = (current.conclusion || '').toLowerCase();
  if (actual !== required) {
    throw new Error(
      `github-actions: run ${current.id} conclusion="${current.conclusion}" ` +
        `(required "${required}") — ${current.html_url}`,
    );
  }
}

async function getRunById(octokit, repo, runId) {
  const id = Number(runId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error(`github-actions: invalid run-id "${runId}"`);
  }
  const { data } = await octokit.rest.actions.getWorkflowRun({
    owner: repo.owner,
    repo: repo.repo,
    run_id: id,
  });
  return data;
}

async function findLatestRun(octokit, repo, opts) {
  const workflow = (opts.workflow || '').trim();
  if (!workflow) {
    throw new Error('github-actions: provide workflow (file name or id) or run-id');
  }

  /** @type {Record<string, string | number>} */
  const params = {
    owner: repo.owner,
    repo: repo.repo,
    per_page: 20,
  };
  if (opts.branch) params.branch = opts.branch;
  if (opts.ref) {
    // GitHub API: head_sha filters exact commit
    params.head_sha = opts.ref;
  }

  const isNumericId = /^\d+$/.test(workflow);
  const { data } = isNumericId
    ? await octokit.rest.actions.listWorkflowRuns({
        ...params,
        workflow_id: Number(workflow),
      })
    : await octokit.rest.actions.listWorkflowRuns({
        ...params,
        workflow_id: workflow,
      });

  const runs = data.workflow_runs || [];
  return runs.length > 0 ? runs[0] : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { runGithubActionsTool };
