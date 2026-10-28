/**
 * Ensure the `@doki-land/davinci` facade `dist` exists before suites that
 * consume it (`packages/homepage` chart preview and `@vmz/ui-charts`).
 *
 * Suites spawn `vmz build` directly, which skips pnpm `pre*` hooks, so a
 * checkout without the facade build would fail to resolve
 * `@doki-land/davinci/*`. CI restores the facade from the runtime artifact.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function ensureDavinciFacade(root: string): void {
    const dist = path.join(root, 'packages', 'davinci', 'davinci', 'dist');
    if (fs.existsSync(path.join(dist, 'chart.js')) && fs.existsSync(path.join(dist, 'index.js'))) return;
    console.log('ensure-davinci-facade: `@doki-land/davinci` `dist` missing, building…');
    const build = spawnSync('pnpm', ['--filter', '@doki-land/davinci', 'run', 'build'], {
        cwd: root,
        stdio: 'inherit',
        shell: true,
    });
    if ((build.status ?? 1) !== 0) {
        throw new Error('ensure-davinci-facade: `pnpm --filter @doki-land/davinci run build` failed');
    }
    if (!fs.existsSync(path.join(dist, 'chart.js'))) {
        throw new Error('ensure-davinci-facade: facade `dist` still missing after build');
    }
    console.log('ensure-davinci-facade: facade built');
}
