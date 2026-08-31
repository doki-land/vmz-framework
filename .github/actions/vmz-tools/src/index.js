'use strict';

const core = require('@actions/core');
const github = require('@actions/github');
const { runGithubActionsTool } = require('./github-actions.js');

async function main() {
  const tool = (core.getInput('tool') || 'github-actions').trim().toLowerCase();
  const token = core.getInput('token') || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('vmz-tools: missing token (pass token input or GITHUB_TOKEN)');
  }

  const octokit = github.getOctokit(token);
  const owner =
    core.getInput('owner') || github.context.repo.owner;
  const repoName =
    core.getInput('repo') || github.context.repo.repo;

  if (tool === 'github-actions') {
    await runGithubActionsTool({
      core,
      octokit,
      repo: { owner, repo: repoName },
      opts: {
        mode: core.getInput('mode') || 'status',
        workflow: core.getInput('workflow'),
        runId: core.getInput('run-id'),
        ref: core.getInput('ref'),
        branch: core.getInput('branch'),
        timeoutMinutes: positiveNumber(core.getInput('timeout-minutes'), 45),
        intervalSeconds: positiveNumber(core.getInput('interval-seconds'), 15),
        requiredConclusion: core.getInput('required-conclusion') || 'success',
      },
    });
    return;
  }

  throw new Error(
    `vmz-tools: unknown tool "${tool}" (known: github-actions)`,
  );
}

function positiveNumber(raw, fallback) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
