/**
 * @vmz/test — programmable VMZ native test surface.
 * CLI automation lives in `vmz` (`vmz test`); this package runs without it.
 */

export * from './protocol.js';
export * from './discover.js';
export {
    buildForCompile,
    resolveChunkArtifacts,
    runCompileManifest,
    type BuildOptions,
    type BuildResult,
    type CompileResult,
    type CreateWorkspaceFn,
} from './compile.js';
export {
    createLogicHost,
    installHeadlessDocument,
    runLogicManifest,
    type LogicHost,
    type LogicResult,
} from './logic.js';
export { runSsrManifest, type SsrResult } from './ssr.js';
export { runResumeManifest, type ResumeResult } from './resume.js';
export { runDeploymentManifest, type DeploymentResult } from './deployment.js';
export {
    runBrowserManifest,
    resolveBrowserExecutable,
    type BrowserResult,
} from './browser.js';
export {
    BROWSER_LOCATOR_KINDS,
    defaultClickLocator,
    parseActionLocator,
    type BrowserActionOptions,
    type BrowserLocator,
    type LocatorResolveResult,
} from './browser-protocol.js';
export {
    runManifest,
    resultsToReport,
    type ManifestRunResult,
    type RunManifestOptions,
} from './run.js';
