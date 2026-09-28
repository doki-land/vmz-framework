// VMZ project configuration for the vmz-framework hybrid monorepo.
import { defineConfig } from '@vmz/plugin';

export default defineConfig({
    format: {
        includes: [
            'scripts/**',
            'packages/runtimes/**',
            'packages/examples/**',
            'packages/editors/**',
            'packages/ui/**',
            'packages/plugins/**',
            'packages/content/**',
            'packages/homepage/**',
            'package.json',
            'biome.json',
            'vmz.config.ts',
            'nifty.config.ts',
        ],
        excludes: ['**/fixtures/**'],
        rust: true,
        javascript: true,
        // vmz mass format off: formatter corrupts dynamic :class bindings
        vmz: false,
        style: 'biome.json',
    },
});
