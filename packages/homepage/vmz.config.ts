import { defineConfig } from '@vmz/plugin';
import shiki from '@vmz/plugin-shiki';

export default defineConfig({
    plugins: [shiki()],
    engines: { code: 'shiki' },
});
