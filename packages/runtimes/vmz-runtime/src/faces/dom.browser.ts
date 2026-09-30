/**
 * Browser delivery face (0.1.31): DOM core + hydrate/resume/route attach.
 * Does NOT re-export Node SSR `renderToString` / `renderToStream`.
 * Full barrel remains `@vmz/core/dom` (`dom.js` / dist `vmz-dom.js`) for Node host.
 */
export * from '../browser/dom-core.js';
export { hydrate, hydrateIslands, hydrateRoute, hydrateRoutePage } from '../browser/resume/hydrate.js';
export { attachEventEntries, resume, resumeIslands } from '../browser/resume/resume.js';
