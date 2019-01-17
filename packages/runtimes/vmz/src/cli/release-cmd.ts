/**
 * `vmz artifact` — pack / publish / rollback / diff; registered on `@vmz/commander`.
 */

import path from 'node:path';
import type { Command, ParsedOptions } from '@vmz/commander';
import { log } from '../workspace/log.js';
import { diffArtifacts, loadReleaseEnvelope, packRelease, publishRelease, readPointer, rollbackRelease } from '../workspace/release-pack.js';

export type ArtifactSub = 'pack' | 'publish' | 'rollback' | 'current' | 'diff';

export function registerArtifactCommands(parent: Command): void {
    const withOpts = (cmd: Command) =>
        cmd.option('--releases <dir>', 'cli.opt.releases').option('--app-id <id>', 'cli.opt.app-id').option('--json', 'cli.opt.json');

    withOpts(parent.command('pack', 'cli.cmd.artifact.pack')).action((o) => runArtifact('pack', o));
    withOpts(parent.command('publish', 'cli.cmd.artifact.publish')).action((o) => runArtifact('publish', o));
    withOpts(parent.command('rollback', 'cli.cmd.artifact.rollback')).action((o) => runArtifact('rollback', o));
    withOpts(parent.command('current', 'cli.cmd.artifact.current')).action((o) => runArtifact('current', o));
    withOpts(parent.command('diff', 'cli.cmd.artifact.diff')).action((o) => runArtifact('diff', o));
}

export function runArtifact(sub: ArtifactSub, options: ParsedOptions, ctx: { root?: string } = {}): number {
    const cwd = path.resolve(ctx.root || process.cwd());
    const pos = options._ || [];
    const dist = path.resolve(cwd, pos[0] || 'dist');
    const releases = path.resolve(typeof options.releases === 'string' ? options.releases : path.join(cwd, 'dist', 'releases'));
    const appId = typeof options['app-id'] === 'string' ? options['app-id'] : undefined;
    const asJson = Boolean(options.json);

    try {
        if (sub === 'pack') {
            const envelope = packRelease(dist, { applicationId: appId });
            if (asJson) console.log(JSON.stringify(envelope, null, 2));
            else log.info(`artifact pack: digest=${envelope.artifactDigest} files=${Object.keys(envelope.fileDigests || {}).length}`);
            return 0;
        }
        if (sub === 'publish') {
            const envelope = packRelease(dist, { applicationId: appId });
            const pub = publishRelease(releases, dist, envelope);
            const out = { ...pub, artifactDigest: envelope.artifactDigest };
            if (asJson) console.log(JSON.stringify(out, null, 2));
            else log.info(`artifact publish: CURRENT=${pub.digest} PREVIOUS=${pub.previous || '-'}`);
            return 0;
        }
        if (sub === 'rollback') {
            const root = pos[0] ? path.resolve(cwd, pos[0]) : releases;
            const rb = rollbackRelease(root);
            if (asJson) console.log(JSON.stringify(rb, null, 2));
            else log.info(`artifact rollback: restored=${rb.restored} demoted=${rb.demoted || '-'}`);
            return 0;
        }
        if (sub === 'current') {
            const root = pos[0] ? path.resolve(cwd, pos[0]) : releases;
            const cur = readPointer(path.join(root, 'CURRENT'));
            if (asJson) console.log(JSON.stringify({ current: cur }, null, 2));
            else console.log(cur || '');
            return cur ? 0 : 1;
        }
        if (sub === 'diff') {
            const aDig = pos[0];
            const bDig = pos[1];
            if (!aDig || !bDig) {
                log.errorId('cli.err.artifact_diff_usage');
                return 1;
            }
            const a = loadReleaseEnvelope(releases, aDig);
            const b = loadReleaseEnvelope(releases, bDig);
            const diff = diffArtifacts(a, b);
            if (asJson) console.log(JSON.stringify(diff, null, 2));
            else {
                log.info(
                    `artifact diff: identical=${diff.identical} changed=${diff.changed.length} added=${diff.added.length} removed=${diff.removed.length}`,
                );
            }
            return 0;
        }
        log.errorId('commander.err.unknown_command', { cmd: `artifact ${sub}` });
        return 1;
    } catch (e) {
        const err = e as { message?: string } | null;
        log.error(String(err && err.message ? err.message : e));
        return 1;
    }
}
