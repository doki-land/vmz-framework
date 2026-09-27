// Nifty project configuration for vmz-framework (hybrid cargo + pnpm).
import { defineConfig } from '@doki-land/nifty';

export default defineConfig({
    authorMap: 'documentation/maintenance/author-github.json',
    changelog: {
        repo: 'doki-land/vmz-framework',
        releasesDir: 'documentation/maintenance/releases',
    },
});
