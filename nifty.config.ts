// Nifty project configuration for vmz-framework (hybrid cargo + pnpm).
import { defineConfig } from '@doki-land/nifty';

export default defineConfig({
    authorMap: 'documentation/maintenance/author-github.json',
    changelog: {
        repo: 'doki-land/vmz-framework',
        releasesDir: 'documentation/maintenance/releases',
    },
    trust: {
        npm: {
            repo: 'doki-land/vmz-framework',
            file: 'publish-npm.yml',
            environment: 'NPM_PUBLISH',
        },
    },
    lint: {
        rules: [
            // Rust unit tests live beside the private helpers they cover. A `tests/`-only rule would force internals
            // public for no gain, so this repository keeps inline `#[cfg(test)]` modules.
            { id: 'cargo/misplaced-test', enabled: false },
            // `README.md` is this repository's spelling and the Rust ecosystem convention. The lowercase rule is
            // another project's house style rather than a convention this repository follows.
            { id: 'cargo/readme-case', enabled: false },
            // The workspace root is a virtual manifest: it has no `[package]` section by design. Members are still
            // real crates and keep their own manifests.
            { id: 'cargo/package-section', enabled: false },
            // The commit scan covers immutable history whose emoji are not in Nifty's known list yet. Keep the
            // finding visible without blocking every run on commits that cannot be rewritten.
            { id: 'gitmoji/subject', severity: 'warning' },
        ],
    },
});
