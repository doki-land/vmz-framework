/**
 * Register before `node --test --experimental-strip-types` so `*.js` imports
 * resolve to sibling `*.ts` when present (Vite/Vitest-compatible extension rewrite).
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./resolve-ts-from-js-hook.mjs', import.meta.url);
