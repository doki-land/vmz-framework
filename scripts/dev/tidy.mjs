#!/usr/bin/env node
/**
 * Local maintenance: pnpm prune, git fetch --prune, tag sync (remote := local), git gc.
 *
 *   pnpm tidy              # all steps
 *   pnpm tidy -- --deps    # pnpm prune (+ store prune)
 *   pnpm tidy -- --git     # fetch --prune + gc
 *   pnpm tidy -- --tags    # delete remote-only tags; push local tags
 *   pnpm tidy -- --dry-run # print tag actions only
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const wantDeps = args.includes('--deps');
const wantGit = args.includes('--git');
const wantTags = args.includes('--tags');
const wantHelp = args.includes('--help') || args.includes('-h');
const all = !wantDeps && !wantGit && !wantTags;

if (wantHelp) {
    console.log(`tidy — local maintenance (deps / git / tags)

  pnpm tidy              run deps + git + tags
  pnpm tidy -- --deps    pnpm prune && pnpm store prune
  pnpm tidy -- --git     git fetch --prune && git gc --prune=now
  pnpm tidy -- --tags    remote tags := local tags
  pnpm tidy -- --dry-run print tag plan only
`);
    process.exit(0);
}

function run(cmd, cmdArgs, opts = {}) {
    console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
    if (dryRun && opts.skipOnDryRun) {
        console.log('(dry-run: skipped)');
        return;
    }
    const r = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        stdio: 'inherit',
        shell: process.platform === 'win32',
        ...opts,
    });
    if (r.status !== 0 && r.status != null) {
        process.exit(r.status);
    }
    if (r.error) {
        console.error(r.error);
        process.exit(1);
    }
}

function capture(cmd, cmdArgs) {
    const r = spawnSync(cmd, cmdArgs, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
        throw new Error(`${cmd} ${cmdArgs.join(' ')} failed: ${r.stderr || r.stdout}`);
    }
    return (r.stdout || '').trim();
}

function localTags() {
    const out = capture('git', ['tag', '-l']);
    if (!out) return new Set();
    return new Set(out.split(/\r?\n/).filter(Boolean));
}

function remoteTags() {
    const out = capture('git', ['ls-remote', '--tags', 'origin']);
    if (!out) return new Set();
    const tags = new Set();
    for (const line of out.split(/\r?\n/)) {
        const ref = line.split(/\s+/)[1];
        if (!ref || !ref.startsWith('refs/tags/')) continue;
        if (ref.endsWith('^{}')) continue;
        tags.add(ref.slice('refs/tags/'.length));
    }
    return tags;
}

function syncTags() {
    console.log('\n> sync tags (remote := local)');
    const local = localTags();
    const remote = remoteTags();
    const toDelete = [...remote].filter((t) => !local.has(t)).sort();
    const toPush = [...local].filter((t) => !remote.has(t)).sort();

    if (toDelete.length === 0 && toPush.length === 0) {
        console.log('tags already in sync');
        return;
    }

    for (const t of toDelete) {
        console.log(`delete remote tag ${t}`);
        if (!dryRun) run('git', ['push', 'origin', `:refs/tags/${t}`]);
    }
    if (toPush.length) {
        console.log(`push local tags: ${toPush.join(', ')}`);
        if (!dryRun) run('git', ['push', 'origin', '--tags']);
    }
    if (dryRun) console.log('(dry-run: no push/delete performed)');
}

if (all || wantDeps) {
    run('pnpm', ['prune'], { skipOnDryRun: true });
    run('pnpm', ['store', 'prune'], { skipOnDryRun: true });
}

if (all || wantGit) {
    run('git', ['fetch', '--prune', 'origin'], { skipOnDryRun: true });
    run('git', ['gc', '--prune=now'], { skipOnDryRun: true });
}

if (all || wantTags) {
    syncTags();
}

console.log('\ntidy: done');
