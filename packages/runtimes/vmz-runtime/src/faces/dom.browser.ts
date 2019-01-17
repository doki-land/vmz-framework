/**
 * Browser delivery face (0.1.31): DOM core + hydrate/resume/route attach.
 * Does NOT re-export Node SSR `renderToString` / `renderToStream`.
 * Full barrel remains `@vmz/core/dom` (`dom.js` / dist `vmz-dom.js`) for Node host.
 */
export * from '../browser/dom-core.js';
export {
    attachEventEntries,
    hydrate,
    hydrateIslands,
    hydrateRoute,
    hydrateRoutePage,
    resume,
    resumeIslands,
} from '../ssr/dom-ssr.js';
