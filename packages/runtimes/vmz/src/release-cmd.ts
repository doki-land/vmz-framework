// @ts-nocheck
/**
 * `vmz artifact` — pack / publish / rollback / diff (A3 filesystem Delivery Profile).
 */

import path from 'node:path';
import { log } from './log.js';
import { diffArtifacts, loadReleaseEnvelope, packRelease, publishRelease, readPointer, rollbackRelease } from './release-pack.js';

function usage() {
    console.log(`vmz artifact — filesystem release packaging (A3)

Usage:
  vmz artifact pack [dist]              Write dist/_vmz manifests + envelope
  vmz artifact publish [dist]           Pack + publish under dist/releases (atomic CURRENT)
  vmz artifact rollback [releases]      Restore PREVIOUS pointer (no rebuild)
  vmz artifact diff <aDigest> <bDigest> Structured file digest diff
  vmz artifact current [releases]       Print CURRENT digest

Options:
  --releases <dir>   Releases root (default: <app>/dist/releases)
  --app-id <id>      applicationId for envelope
  --json             Machine-readable stdout
`);
}

/**
 * @param {string[]} argv
 * @param {{ root?: string }} [ctx]
 */
export function cmdArtifact(argv, ctx = {}) {
    const args = [...argv];
    if (!args.length || args[0] === 'help' || args[0] === '--help') {
        usage();
        return 0;
    }
    const sub = args.shift();
    /** @type {Record<string, string | boolean>} */
    const flags = {};
    /** @type {string[]} */
    const pos = [];
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--json') {
            flags.json = true;
            continue;
        }
        if (a === '--releases' || a === '--app-id') {
            flags[a.slice(2)] = args[++i];
            continue;
        }
        if (a.startsWith('--')) {
            const eq = a.indexOf('=');
            if (eq !== -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
            else flags[a.slice(2)] = true;
            continue;
        }
        pos.push(a);
    }

    const cwd = path.resolve(ctx.root || process.cwd());
    const dist = path.resolve(cwd, pos[0] || 'dist');
    const releases = path.resolve(typeof flags.releases === 'string' ? flags.releases : path.join(cwd, 'dist', 'releases'));
    const appId = typeof flags['app-id'] === 'string' ? flags['app-id'] : undefined;
    const asJson = Boolean(flags.json);

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
                log.error('artifact diff requires <aDigest> <bDigest>');
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
        log.error(`unknown artifact subcommand: ${sub}`);
        usage();
        return 1;
    } catch (e) {
        log.error(String(e && e.message ? e.message : e));
        return 1;
    }
}
