/** VMZ Node host — N-API workspace session + CLI + plugins. */

export {
    HOST_PROTOCOL,
    COMPILER_PROTOCOL,
    PROGRAM_IR_SCHEMA,
    PLAN_SCHEMA,
    PLUGIN_PROTOCOL,
    DX_PROTOCOL,
    DX_SYMBOL_SCHEMA,
    DX_REFERENCE_SCHEMA,
    DX_EXPLAIN_SCHEMA,
    DX_WORKSPACE_EDIT_SCHEMA,
    DX_CODE_ACTION_SCHEMA,
    DX_AFFECTED_SCHEMA,
    DX_RENAME_SCHEMA,
    DX_TEST_SELECTION_SCHEMA,
    DX_SOURCE_MAP_SCHEMA,
    DX_SYMBOL_INDEX_SCHEMA,
    DX_CROSS_SFC_CHECK_SCHEMA,
    DX_SEMANTIC_TRANSACTION_SCHEMA,
    DX_CANCEL_SCHEMA,
    DX_AFFECTED_PREVIEW_SCHEMA,
    DX_HMR_PLAN_SCHEMA,
    DX_BUDGET_SCHEMA,
    DX_TRANSACTION_CHECK_SCHEMA,
    DX_BOUNDARY_VALIDATOR_SCHEMA,
    DX_LEAKAGE_SCHEMA,
    DX_CAPABILITY_TARGET_SCHEMA,
    DX_DEAD_GRAPH_SCHEMA,
    DX_DEPLOYMENT_PROOF_CHECK_SCHEMA,
    DX_TRACE_SCHEMA,
    DX_CAUSAL_REPLAY_SCHEMA,
    DX_CAUSAL_REPLAY_CHECK_SCHEMA,
    APPLICATION_PROTOCOL,
    APPLICATION_DESCRIPTOR_SCHEMA,
    APPLICATIONS_CONFIG_SCHEMA,
    APPLICATION_CATALOG_SCHEMA,
    APPLICATION_CHECK_SCHEMA,
    APPLICATION_BASE_SCHEMA,
    APPLICATION_RELOCATION_SCHEMA,
    APPLICATION_RELOCATED_SCHEMA,
    APPLICATION_RELOCATABLE_CHECK_SCHEMA,
    APPLICATION_ARTIFACT_SCHEMA,
    APPLICATION_MOUNT_TABLE_SCHEMA,
    APPLICATION_ARTIFACT_BOUNDARY_SCHEMA,
    APPLICATION_ISOLATION_SCHEMA,
    APPLICATION_ISOLATION_CHECK_SCHEMA,
    APPLICATION_CROSS_LINK_SCHEMA,
    APPLICATION_HOST_COMPOSITION_SCHEMA,
    APPLICATION_DEV_SESSIONS_SCHEMA,
    APPLICATION_AFFECTED_SCHEMA,
    APPLICATION_PROXY_DISPATCH_SCHEMA,
    APPLICATION_MOUNTED_TEST_SCHEMA,
    APPLICATION_DEPLOY_ADAPTER_SCHEMA,
    APPLICATION_DEV_CHECK_SCHEMA,
    PROTOCOL_CATALOG_SCHEMA,
    TEST_PROTOCOL,
    TEST_MANIFEST_SCHEMA,
    TEST_REPORT_SCHEMA,
    protocolCatalog,
    dxCatalog,
    testCatalog,
    applicationCatalog,
} from '@vmz/protocol';
export type { ProtocolCatalog, ProtocolDomain, DomainCatalog } from '@vmz/protocol';

export interface ProtocolVersions {
    hostProtocol: string;
    compilerProtocol: string;
    programIrSchema: string;
    pluginProtocol: string;
}

export interface WorkspaceOptions {
    root: string;
    outDir?: string;
    /** Absolute path to `@vmz/core` dist/; Node resolves when omitted. */
    runtimeDist?: string;
    protocol?: ProtocolVersions;
}

export interface FileChange {
    path: string;
    kind: 'update' | 'delete';
}

export interface Diagnostic {
    path: string;
    severity: string;
    /** Stable id (`vmz::…`). Required for language-neutral rows. */
    code?: string;
    /** Catalog placeholders. */
    args?: Record<string, string>;
    /** UTF-8 byte offsets. */
    span?: { path?: string; start: number; end: number };
    /** Legacy / empty under language-neutral diagnostics. */
    message?: string;
}

export interface CheckReport {
    filesChecked: number;
    diagnostics: Diagnostic[];
    dirtyCount: number;
}

export interface BuildReport {
    emitted: string[];
    diagnostics: Diagnostic[];
    dirtyCount: number;
    full?: boolean;
    affectedSources?: string[];
    affectedChunks?: string[];
    seedChunks?: string[];
    islandHmr?: boolean;
    writtenOutputs?: string[];
    outputRevision?: string;
    reloadRequired?: boolean;
}

export interface FormatReport {
    filesChecked: number;
    filesWritten: number;
    filesNeedWrite: number;
    diagnostics: Diagnostic[];
}

export interface AffectedPlan {
    full: boolean;
    rebuildRuntime: boolean;
    rebuildServerTree: boolean;
    units: Array<{ source: string; kind: string; chunkId: string }>;
    seedChunks?: string[];
    islandOnly?: boolean;
}

export interface ApplyContributionsReport {
    accepted: number;
    rejected: Array<{ plugin: string; itemId: string; reason: string }>;
    diff: { added: string[]; removed: string[]; unchanged: string[] };
}

export interface Workspace {
    root(): string;

    outDir(): string;

    contributionCount(): number;

    updateFiles(changes: FileChange[]): void;

    dirtyPaths(): string[];

    applyPluginContributions(batch: ContributionBatch): ApplyContributionsReport;

    check(denyWarnings?: boolean): CheckReport;

    /** Lint: check + convention advice. */
    lint(denyWarnings?: boolean): CheckReport;

    format(checkOnly?: boolean): FormatReport;

    build(release?: boolean): BuildReport;

    queryAffected(): AffectedPlan;

    queryProgramGraph(source: string): string;

    querySessionGraph(): string;

    sessionGeneration(): number;

    explain(target: string): string;

    /** DX catalog JSON (`vmz.dx.v0`). */
    queryDxCatalog(): string;

    /** Umbrella protocol catalog (`vmz.protocol.v0`). */
    queryProtocolCatalog(): string;

    /** Affected plan as DX JSON (`vmz.dx.affected.v0`). */
    queryAffectedDx(): string;

    /** plan rename → WorkspaceEditPlan JSON. */
    planRename(intentJson: string): string;

    /** atomically apply WorkspaceEditPlan JSON. */
    applyWorkspaceEdit(planJson: string): string;

    /** graph→test selection JSON. */
    selectTestsAffected(): string;

    /** rename causal explain chain JSON. */
    explainRenameChain(intentJson: string): string;

    /** Symbol/Reference/source-map/safe_fix report JSON. */
    checkCrossSfc(): string;

    /** Symbol index document JSON. */
    querySymbols(): string;

    /** references for `kind:id`. */
    queryReferences(target: string): string;

    /** CodeAction list JSON. */
    listCodeActions(): string;

    /** atomic TextEdit batch JSON (`vmz.dx.semantic_transaction.v0`). */
    applySemanticTransaction(editsJson: string): string;

    /** open analysis/build ticket (`vmz.dx.cancel.v0`). */
    beginAnalysis(): string;

    /** cancel analysis ticket. */
    cancelAnalysis(ticketId: number): string;

    /** affected preview JSON (`vmz.dx.affected_preview.v0`). */
    queryAffectedPreview(): string;

    /** HMR plan JSON (`vmz.dx.hmr_plan.v0`). */
    queryHmrPlan(): string;

    /** route/chunk budget JSON (`vmz.dx.budget.v0`). */
    queryBudget(): string;

    /** umbrella incremental DX report (`vmz.dx.transaction_check.v0`). */
    checkTransaction(): string;

    /** boundary validators JSON (`vmz.dx.boundary_validator.v0`). */
    queryBoundaryValidators(): string;

    /** leakage findings JSON (`vmz.dx.leakage.v0`). */
    queryLeakage(): string;

    /** capability targets JSON (`vmz.dx.capability_target.v0`). */
    queryCapabilityTargets(): string;

    /** dead graph JSON (`vmz.dx.dead_graph.v0`). */
    queryDeadGraph(): string;

    /** umbrella deployment proof (`vmz.dx.deployment_proof_check.v0`). */
    checkDeploymentProof(): string;

    /** ingest StableId trace JSON (`vmz.dx.trace.v0`). */
    ingestRuntimeTrace(traceJson: string): string;

    /** causal replay JSON (`vmz.dx.causal_replay.v0`). */
    replayCausal(traceJson: string): string;

    /** umbrella deep-explain report (`vmz.dx.causal_replay_check.v0`). */
    checkCausalReplay(): string;

    /** miniprogram: target-neutral contract check JSON. */
    checkMiniprogramTargetContract(): string;

    /** miniprogram: TemplateSurface static slice (neutral template + logic data). */
    lowerMiniprogramStaticSlice(): string;

    /** miniprogram: BindingId patch table + event table. */
    lowerMiniprogramBindingEvent(): string;

    /** miniprogram: structure (if/each/component/slot) + lifecycle/dispose. */
    lowerMiniprogramStructure(): string;

    /** miniprogram: Route realization + `#server` stubs + Canonical Style. */
    lowerMiniprogramRouteServerStyle(): string;

    /** miniprogram: tooling deploy package + Mini Host handoff. */
    lowerMiniprogramToolingDeploy(): string;

    /** miniprogram: WeChat DevTools project under dist/wechat via vmz-generator. */
    lowerMiniprogramWechatPackaging(): string;

    /** miniprogram: multi-adapter (≥2 packaging stubs) conformance. */
    lowerMiniprogramMultiAdapter(): string;

    /** HostProfile / DeliveryProfile protocol check JSON. */
    checkHostProfileProtocol(): string;

    /** deterministic Surface/capability/route solver check JSON. */
    checkProfileSolver(): string;

    /** Unified Executor algebraic check JSON. */
    checkUnifiedExecutor(): string;

    /** Lifecycle / Recovery algebraic check JSON. */
    checkLifecycleRecovery(): string;

    /** Delivery Proof algebraic check JSON. */
    checkDeliveryProof(): string;

    /** Cross-Host Conformance algebraic check JSON. */
    checkCrossHostConformance(): string;

    /** profile protocol catalog JSON. */
    queryProfileCatalog(): string;

    /** miniprogram: target protocol catalog JSON. */
    queryTargetCatalog(): string;

    /** native: NativeAppHost / WebView contract check JSON. */
    checkNativeHostContract(): string;

    /** native: native-host protocol catalog JSON. */
    queryNativeHostCatalog(): string;

    /** native: Native WebView shell contract check JSON. */
    checkNativeShellContract(): string;

    /** native: typed Native Capability Bridge contract check JSON. */
    checkNativeBridgeContract(): string;

    /** native: NativeAppHost lifecycle contract check JSON. */
    checkNativeLifecycleContract(): string;

    /** native: NativeAppHost full-stack contract check JSON. */
    checkNativeFullstackContract(): string;

    /** native: NativeSurface contract check JSON. */
    checkNativeSurfaceContract(): string;

    /** native: multi-platform shared Host Profile contract check JSON. */
    checkMultiPlatformContract(): string;

    dispose(): void;
}

export interface ContributionBatch {
    pluginName: string;
    pluginVersion: string;
    protocol: string;
    stage: string;
    cacheKey: string;
    deterministic?: boolean;
    items: Array<Record<string, unknown>>;
}

export function contentHash(content: string | Buffer): string;

export function definePlugin(def: import('@vmz/plugin').DefinePluginInput): import('@vmz/plugin').VmzPlugin;

export function defineConfig(config: import('@vmz/plugin').VmzUserConfig): import('@vmz/plugin').VmzUserConfig;

export function loadVmzConfig(project: string): Promise<{
    plugins: import('@vmz/plugin').VmzPlugin[];
    engines: import('@vmz/plugin').VmzEngines;
    path: string | null;
    pluginPath: string | null;
}>;

export function applyPlugins(
    workspace: Workspace,
    plugins: import('@vmz/plugin').VmzPlugin[],
    opts: {
        project: string;
        outDir: string;
        stages?: string[];
        engines?: import('@vmz/plugin').VmzEngines;
    },
): Promise<ApplyContributionsReport[]>;

export type {
    VmzUserConfig,
    VmzEngines,
    VmzPlugin,
    PluginContext,
    DefinePluginInput,
} from '@vmz/plugin';

export function loadDeploymentIr(outDir: string): {
    schema: string;
    units: Array<Record<string, unknown>>;
    affectedChunks?: string[];
    seedChunks?: string[];
    islandHmr?: boolean;
    full?: boolean;
};

export function planBundleInputs(
    outDir: string,
    ir?: ReturnType<typeof loadDeploymentIr>,
): Array<{
    chunkId: string;
    kind: string;
    entry: string;
    programIr: string;
    source: string;
    rebuilt: boolean;
}>;

export function planAffectedBundleInputs(outDir: string, ir?: ReturnType<typeof loadDeploymentIr>): ReturnType<typeof planBundleInputs>;

export function createVitePluginVmzAdapter(options?: { outDir?: string; root?: string }): {
    name: string;
};

export function createRolldownPluginVmzAdapter(options?: { outDir?: string; root?: string }): {
    name: string;
};

export interface DevSessionOptions {
    project: string;
    outDir: string;
    host?: string;
    port?: number;
    pollMs?: number;
    /** `mini-program-wechat`: pack `dist/wechat` and skip browser serve-host. */
    target?: 'browser' | 'mini-program-wechat';
    signal?: AbortSignal;
}

export interface DevSession {
    ws: Workspace;

    rebuild(changes?: FileChange[]): BuildReport;

    start(): Promise<void>;

    stop(): Promise<void>;

    project: string;
    outDir: string;
    host: string;
    port: number;
}

export function expectedProtocol(): ProtocolVersions;

export function resolveNativePath(): string;

/** Absolute path to `@vmz/core` dist/ (via `@vmz/core/server`), or null. */
export function resolveCoreRuntimeDist(): string | null;

export function loadNative(): unknown;

export function getProtocolVersions(): ProtocolVersions;

export function handshake(host?: ProtocolVersions): void;

export function createWorkspace(options: WorkspaceOptions): Workspace;

/** frozen application composition protocol catalog JSON. */
export function queryApplicationProtocolCatalog(): string;

/** ApplicationCheckReport JSON for host + workspace package roots. */
export function checkApplicationsJson(hostRoot: string, packageRoots: string[]): string;

/** ApplicationRelocatableReport JSON for a package root (+ optional relocate base). */
export function checkApplicationRelocatableJson(packageRoot: string, relocateBase?: string | null): string;

/** apply ApplicationBase to a logical relocation manifest JSON. */
export function relocateApplicationManifestJson(manifestJson: string, base: string): string;

/** ApplicationArtifactBoundaryReport JSON (artifacts + MountTable/Catalog refs). */
export function checkApplicationArtifactBoundaryJson(hostRoot: string, packageRoots: string[]): string;

/** ApplicationIsolationCheckReport JSON (namespaces + failure containment). */
export function checkApplicationIsolationJson(hostRoot: string, packageRoots: string[]): string;

/** ApplicationHostCompositionReport JSON (catalog + cross-app Links). */
export function checkApplicationHostCompositionJson(hostRoot: string, packageRoots: string[]): string;

/** ApplicationDevCheckReport JSON (sessions / affected / proxy / tests / deploy). */
export function checkApplicationDevTestDeployJson(hostRoot: string, packageRoots: string[], dirtyPaths?: string[]): string;

export function createDevSession(options: DevSessionOptions): DevSession;

export function srcFingerprint(srcDir: string): number;

export function listWatchedFiles(srcDir: string): string[];

export function resolveWorkspaceDirs(opts?: { cwd?: string; path?: string; outDir?: string }): {
    project: string;
    outDir: string;
    cwd: string;
};

export function findPackageJson(startDir: string): string | null;

export function readPackageMeta(projectRoot: string): { name?: string } | null;

export function resolveWorkspacePackages(project: string): Array<{
    name: string;
    root: string;
    private?: boolean;
    hasSrc: boolean;
    version?: string;
}>;

export function resolvePackageRoot(project: string, name: string): string | null;

export function runCli(argv: string[]): Promise<number>;

export function printHelp(): void;

export const STATIC_DELIVERY_MANIFEST_SCHEMA: string;

export function emitWebStatic(
    distDir: string,
    opts?: {
        origin?: string;
        applicationId?: string;
        staticParams?: Record<string, Array<Record<string, string>>>;
    },
): Promise<{
    manifest: Record<string, unknown>;
    htmlFiles: string[];
    skipped: Array<Record<string, unknown>>;
    digest: string;
    assets?: Record<string, unknown>;
    cdnPolicy?: Record<string, unknown>;
    cdnAdapters?: Record<string, unknown>;
}>;

export const CONTENT_ADDRESSED_ASSETS_SCHEMA: string;
export function emitContentAddressedAssets(
    distDir: string,
    opts?: { candidates?: string[]; rewriteHtml?: boolean },
): {
    manifest: Record<string, unknown>;
    assetsDir: string;
    rewrites: Record<string, string>;
    manifestPath: string;
};
export function resolveAssetByDigest(
    distDir: string,
    digest: string,
    ext?: string,
): { assetPath: string; digest: string; bytes: number } | null;
export function assertSharedAssetPath(
    distDir: string,
    a: Buffer | string,
    b: Buffer | string,
    ext?: string,
): { ok: boolean; assetPath?: string; digest?: string; reason?: string; digestA?: string; digestB?: string; rel?: string };
export function contentAddressedAssetsDigest(manifest: Record<string, unknown>): string;
export function rewriteCssImports(cssText: string, rewrites: Record<string, string>): string;
export function rewriteJsEntryRelativeImports(jsText: string, rewrites?: Record<string, string>): string;

export const SITE_FAVICON_SCHEMA: string;
export function emitSiteFavicon(distDir: string, opts?: { projectRoot?: string; skipNative?: boolean }): Record<string, unknown>;
export function readSiteFaviconHeadHtml(distDir: string): string;
export function packPngsIntoIco(images: Array<{ png: Buffer; size: number }>): Buffer;

export const PUBLIC_STATIC_ASSETS_SCHEMA: string;
export function emitPublicStaticAssets(distDir: string, opts?: { projectRoot?: string; publicDir?: string }): Record<string, unknown>;

export const CDN_POLICY_MANIFEST_SCHEMA: string;
export const CDN_ADAPTER_PROJECTION_SCHEMA: string;
export const CACHE_HTML: string;
export const CACHE_ASSET_IMMUTABLE: string;
export const CACHE_META: string;

export function buildCdnPolicyManifest(
    staticManifest: Record<string, unknown>,
    opts?: {
        redirects?: Array<{ from: string; to: string; status?: number; reason?: string }>;
        localeArtifact?: Record<string, unknown> | null;
    },
): Record<string, unknown>;

export function emitCdnPolicy(
    distDir: string,
    staticManifest: Record<string, unknown>,
    opts?: {
        redirects?: Array<{ from: string; to: string; status?: number; reason?: string }>;
        localeArtifact?: Record<string, unknown> | null;
    },
): { policy: Record<string, unknown>; adapters: Record<string, unknown> };

export function projectCdnAdapter(policy: Record<string, unknown>, adapterId: 'local-static' | 'netlify'): Record<string, unknown>;

export function createLocalStaticHandler(
    distDir: string,
    policy: Record<string, unknown>,
): (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void;

export function listenLocalStaticHost(
    distDir: string,
    policy: Record<string, unknown>,
    opts?: { host?: string; port?: number },
): Promise<{ host: string; port: number; baseUrl: string; close: () => Promise<void> }>;

export function matchGlob(pattern: string, pathname: string): boolean;

export const SITE_DELIVERY_CONTRACT_SCHEMA: string;
export const SITE_DELIVERY_RESOLUTION_SCHEMA: string;

export function defineSite<T extends Record<string, unknown>>(delivery: T): T;

export function normalizeSiteDelivery(
    raw: unknown,
    opts?: { siteId?: string; projectRoot?: string },
): { ok: true; contract: Record<string, unknown> } | { ok: false; diagnostics: Array<{ code: string; message: string }> };

export function normalizeSourceProbe(probe?: Record<string, unknown>): Record<string, unknown>;

export function resolveSiteRelease(
    contract: Record<string, unknown>,
    probes?: Record<string, Record<string, unknown>>,
): Record<string, unknown>;

export function probeReleaseDirectory(releaseDir: string): Record<string, unknown>;

export function emitSiteDelivery(
    outDir: string,
    deliveryRaw: unknown,
    opts?: { siteId?: string; probes?: Record<string, unknown> },
): { contract: Record<string, unknown>; resolution: Record<string, unknown> | null };

export const WECHAT_PACKAGING_SCHEMA: string;
export const WECHAT_PACKAGING_REL: string;
export function wechatPackagingFromDelivery(delivery: unknown): {
    schema: string;
    appId: string;
    projectName?: string;
    title?: string;
};
export function materializeWechatPackaging(project: string): {
    schema: string;
    appId: string;
    projectName?: string;
    title?: string;
};

export const DELIVERY_PROFILE_AUTHORING_SCHEMA: string;
export const BUILD_PROFILE_SELECTION_SCHEMA: string;
export const ASSEMBLIES: readonly string[];
export const SERVER_RUNTIMES: readonly string[];
export const BUILTIN_PROFILES: Record<string, { host: string; assembly: string; serverRuntime?: string }>;

export function pickSiteAuthoring(raw: Record<string, unknown>): Record<string, unknown> | null;
export function pickDeliveryPackaging(
    raw: Record<string, unknown>,
    diagnostics: Array<{ code: string; message: string }>,
): Record<string, unknown> | null;
export function normalizeProfileArtifactName(
    id: string,
    rawName: unknown,
    diagnostics: Array<{ code: string; message: string }>,
): string | null;
export function resolveProfileArtifactDir(
    outDir: string,
    profile: { name?: string; id?: string; nameExplicit?: boolean } | null | undefined,
): string;
export function normalizeDeliveryAuthoring(
    raw: unknown,
): { ok: true; table: Record<string, unknown> } | { ok: false; diagnostics: Array<{ code: string; message: string }> };
export function selectBuildProfile(
    table: Record<string, unknown>,
    cliProfile?: string,
):
    | { ok: true; selection: Record<string, unknown>; profile: Record<string, unknown> }
    | { ok: false; diagnostics: Array<{ code: string; message: string }> };
export function semanticIdsForAssembly(assembly: string): string[];

export const PACK_MANIFEST_SCHEMA: string;
export function ensureRuntimeCompanions(outDir: string, coreDist?: string | null): string[];
export function packFromDeploymentIr(
    outDir: string,
    opts?: {
        release?: boolean;
        profileId?: string;
        assembly?: string;
        preferredClientFace?: string;
        coreDist?: string | null;
    },
): { manifest: Record<string, unknown>; path: string };

export const SERVER_ARTIFACT_SCHEMA: string;
export const HTTP_CONTRACT_SCHEMA: string;
export const SERVER_RUNTIME_ADAPTER_SCHEMA: string;
export function emitServerArtifact(
    outDir: string,
    opts?: {
        profileId?: string | null;
        assembly?: string | null;
        serverRuntime?: string | null;
        packDigest?: string | null;
    },
): { artifact: Record<string, unknown>; path: string; httpContractDigest: string };
export function projectServerRuntimeAdapter(artifact: Record<string, unknown>, adapterId: string): Record<string, unknown>;

export const BUILD_PROOF_SCHEMA: string;
export const ASSEMBLE_MANIFEST_SCHEMA: string;
export function assembleDelivery(outDir: string, ctx: Record<string, unknown>): Promise<{ manifest: Record<string, unknown>; path: string }>;
export function emitBuildProof(outDir: string, ctx: Record<string, unknown>): { proof: Record<string, unknown>; path: string };

export function buildProjectToOutDirRoot(
    project: string,
    outDirRoot: string,
    opts?: {
        profile?: string;
        release?: boolean;
        origin?: string;
        quiet?: boolean;
    },
): Promise<
    | {
          ok: true;
          outDirRoot: string;
          artifactDir: string;
          deliveryName: string;
          profileId: string;
          assembly: string;
          diagnostics: unknown[];
      }
    | {
          ok: false;
          outDirRoot: string;
          artifactDir: string | null;
          deliveryName: string | null;
          diagnostics: unknown[];
          error: string;
      }
>;

export const PRODUCTION_SCENARIO_PACK_SCHEMA: string;
export const PRODUCTION_CI_PROFILE_SCHEMA: string;
export const PRODUCTION_TEST_REPORT_SCHEMA: string;

export function browserProductionScenarioPack(): Record<string, unknown>;
export function browserProductionCiProfile(overrides?: Record<string, unknown>): Record<string, unknown>;
export function normalizeScenarioPack(
    raw: unknown,
): { ok: true; pack: Record<string, unknown> } | { ok: false; diagnostics: Array<{ code: string; message: string }> };
export function normalizeCiProfile(raw: unknown): Record<string, unknown>;
export function scenarioPackDigest(pack: Record<string, unknown>): string;
export function ciProfileDigest(profile: Record<string, unknown>): string;
export function buildProductionTestReport(input: {
    pack: Record<string, unknown>;
    profile: Record<string, unknown>;
    results: Array<Record<string, unknown>>;
    artifactsDir?: string;
}): Record<string, unknown>;
export function productionTestReportDigest(report: Record<string, unknown>): string;
export function emitProductionTestArtifacts(
    root: string,
    report: Record<string, unknown>,
    pack: Record<string, unknown>,
    profile: Record<string, unknown>,
): {
    reportPath: string;
    packPath: string;
    profilePath: string;
    report: Record<string, unknown>;
};
export function assertNoForbiddenRunners(profile: Record<string, unknown>, importedNames?: string[]): string[];

export const PRODUCTION_OBSERVABILITY_SCHEMA: string;
export const PRODUCTION_TRACE_SCHEMA: string;
export const REQUIRED_TRACE_FACETS: readonly string[];

export function browserProductionObservability(overrides?: Record<string, unknown>): Record<string, unknown>;
export function normalizeObservability(raw: unknown): Record<string, unknown>;
export function redactSensitive(value: unknown, policy?: Record<string, unknown>, opts?: { privilege?: 'public' | 'operator' }): unknown;
export function validateProductionTrace(raw: unknown, requiredFacets?: string[]): { ok: boolean; covered: string[]; errors: string[] };
export function buildCoveringProductionTrace(meta?: Record<string, unknown>): Record<string, unknown>;
export function checkProductionBudgets(
    measured: Record<string, unknown>,
    budgets: Record<string, unknown>,
): { ok: boolean; violations: string[] };
export function checkCapabilityClosure(cap: Record<string, unknown>, policy: Record<string, unknown>): { ok: boolean; errors: string[] };
export function applySecurityHeadersToCdnPolicy(cdnPolicy: Record<string, unknown>, security: Record<string, unknown>): Record<string, unknown>;
export function measureDistBudgets(distDir: string): Record<string, number>;
export function emitProductionObservability(
    distDir: string,
    overrides?: Record<string, unknown>,
    meta?: { applicationId?: string; artifactDigest?: string },
): {
    contract: Record<string, unknown>;
    trace: Record<string, unknown>;
    contractPath: string;
    tracePath: string;
};
export function observabilityDigest(contract: Record<string, unknown>): string;

export declare const log: {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    diagnostic(d: Diagnostic): void;
    diagnostics(diagnostics: Diagnostic[]): number;
};

declare const _default: {
    HOST_PROTOCOL: string;
    COMPILER_PROTOCOL: string;
    PROGRAM_IR_SCHEMA: string;
    PLUGIN_PROTOCOL: string;
    expectedProtocol: typeof expectedProtocol;
    resolveNativePath: typeof resolveNativePath;
    loadNative: typeof loadNative;
    getProtocolVersions: typeof getProtocolVersions;
    handshake: typeof handshake;
    createWorkspace: typeof createWorkspace;
};
export default _default;

export const TARGET_PROTOCOL: string;
export const TARGET_VIEW_OPS_SCHEMA: string;
export const TARGET_PLATFORM_PROFILE_SCHEMA: string;
export const TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA: string;
export const TARGET_CHECK_SCHEMA: string;
export function targetCatalog(): {
    schema: string;
    protocol: string;
    documents: Array<{ kind: string; schema: string }>;
    diagnostics: string[];
    viewOperations: string[];
};
export function queryTargetProtocolCatalog(): string;
export function checkMiniprogramTargetContractJson(rootPath: string): string;
/** miniprogram: TemplateSurface static slice JSON. */
export function lowerMiniprogramStaticSliceJson(rootPath: string): string;
/** miniprogram: BindingId patch + event table JSON. */
export function lowerMiniprogramBindingEventJson(rootPath: string): string;
/** miniprogram: structure + lifecycle/dispose JSON. */
export function lowerMiniprogramStructureJson(rootPath: string): string;
/** miniprogram: Route + `#server` + Canonical Style JSON. */
export function lowerMiniprogramRouteServerStyleJson(rootPath: string): string;

export function lowerMiniprogramToolingDeployJson(rootPath: string): string;

/** miniprogram: write dist/wechat (WeChat DevTools project) via vmz-generator. */
export function lowerMiniprogramWechatPackagingJson(rootPath: string): string;

export function lowerMiniprogramMultiAdapterJson(rootPath: string): string;

export function createMiniHost(opts: {
    package: {
        schema: string;
        platformId?: string;
        host?: { schema?: string; kind?: string; [k: string]: unknown };
        vendorTooling?: {
            role?: string;
            invokedInCi?: boolean;
            [k: string]: unknown;
        };
        constraints?: {
            wxmlEmitter?: boolean;
            wxssEmitter?: boolean;
            serverImplInMiniPackage?: boolean;
            [k: string]: unknown;
        };
        artifacts?: Array<{ chunkId?: string; artifactPath?: string }>;
        pages?: Array<{ routeId?: string; chunkId?: string }>;
        routeLinks?: Array<{ routeId?: string; fromChunkId?: string }>;
        serverCapabilities?: Array<{ method?: string; chunkId?: string }>;
        [k: string]: unknown;
    };
    loadArtifact: (artifactPath: string) => {
        template?: string;
        logic?: string;
        eventTable?: string;
        dataPatchTable?: string;
        manifest?: string;
        style?: string;
        platformId?: string;
        [k: string]: unknown;
    };
}): {
    mount(chunkId?: string): { chunkId: string; data: Record<string, unknown> };
    dispatchEvent(handlerId: string): {
        handlerId: string;
        method?: string;
        patchPaths: string[];
        data: Record<string, unknown>;
    };
    navigate(routeId: string): {
        routeId: string;
        chunkId: string;
        data: Record<string, unknown>;
    };
    callServerStub(method: string): {
        method: string;
        scheme: string;
        transport: string;
        pending: boolean;
        bodyShipped: boolean;
    };
    getState(): {
        chunkId: string | null;
        data: Record<string, unknown>;
        appliedPatches: string[];
        navigations: string[];
        serverCalls: Array<{ method: string; scheme: string }>;
        lifecycle: string[];
    };
    package: unknown;
};

export const PROFILE_PROTOCOL: string;
export const PROFILE_HOST_SCHEMA: string;
export const PROFILE_DELIVERY_SCHEMA: string;
export const PROFILE_CHECK_SCHEMA: string;
export const PROFILE_DIAG_HOST_PROFILE_INVALID: string;
export const PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH: string;
export const PROFILE_DIAG_CORE_ID_OVERRIDE: string;
export const PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED: string;
export const PROFILE_SURFACE_KINDS: string[];
export const PROFILE_UNIFIED_LIFECYCLE_EVENTS: string[];
export const PROFILE_CORE_ID_PREFIX: string;
export function profileCatalog(): {
    schema: string;
    protocol: string;
    documents: Array<{ kind: string; schema: string }>;
    diagnostics: string[];
    surfaceKinds: string[];
    unifiedLifecycleEvents: string[];
    coreIdPrefix: string;
};

export const LOCALE_PROTOCOL: string;
export const LOCALE_MANIFEST_SCHEMA: string;
export const LOCALE_MESSAGE_CATALOG_SCHEMA: string;
export const LOCALE_MESSAGE_NODE_SCHEMA: string;
export const LOCALE_CHECK_SCHEMA: string;
export const LOCALE_TYPED_MODULE_SCHEMA: string;
export const LOCALE_RENAME_SCHEMA: string;
export const LOCALE_APPLICATION_CONTEXT_SCHEMA: string;
export const LOCALE_FORMATTER_CONTEXT_SCHEMA: string;
export const LOCALE_TRANSITION_SCHEMA: string;
export const LOCALE_RUNTIME_CHECK_SCHEMA: string;
export const LOCALE_FALLBACK_RESOLUTION_SCHEMA: string;
export const FORMATTER_DATA_VERSION: string;
export const LOCALE_ROUTE_REALIZATION_SCHEMA: string;
export const LOCALE_PAGE_META_SCHEMA: string;
export const LOCALE_LINK_RESOLUTION_SCHEMA: string;
export const LOCALE_ROUTER_CHECK_SCHEMA: string;
export const LOCALE_DELIVERY_RESOLUTION_SCHEMA: string;
export const LOCALE_CHUNK_MANIFEST_SCHEMA: string;
export const LOCALE_NATIVE_PACK_SCHEMA: string;
export const LOCALE_MINI_PACKAGE_PROOF_SCHEMA: string;
export const LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA: string;
export const LOCALE_DELIVERY_CHECK_SCHEMA: string;
export const LOCALE_EXPLAIN_SCHEMA: string;
export const LOCALE_DIFF_SCHEMA: string;
export const LOCALE_EXTRACT_SCHEMA: string;
export const LOCALE_PSEUDO_SCHEMA: string;
export const LOCALE_CONFORMANCE_SCHEMA: string;
export const LOCALE_DIAG_MANIFEST_MISSING: string;
export const LOCALE_DIAG_ID_INVALID: string;
export const LOCALE_DIAG_FALLBACK_CYCLE: string;
export const LOCALE_DIAG_MESSAGE_PARAMETER_MISMATCH: string;
export const LOCALE_DIAG_MESSAGE_UNUSED: string;
export const LOCALE_DIAG_FORMATTER_CONTEXT_INCOMPLETE: string;
export const LOCALE_DIAG_FORMATTER_VERSION_MISMATCH: string;
export const LOCALE_DIAG_DIGEST_MISMATCH: string;
export const LOCALE_DIAG_TRANSITION_PARTIAL: string;
export const LOCALE_DIAG_TRANSITION_UNSUPPORTED: string;
export const LOCALE_DIAG_TRANSITION_LOAD_FAILED: string;
export const LOCALE_DIAG_MACHINE_DEFAULT_FORBIDDEN: string;
export const LOCALE_DIAG_MESSAGE_MIXED_LOCALE: string;
export const LOCALE_DIAG_STALE_GENERATION: string;
export const LOCALE_DIAG_ROUTE_COLLISION: string;
export const LOCALE_DIAG_CANONICAL_MISSING: string;
export const LOCALE_DIAG_HREFLANG_INCOMPLETE: string;
export const LOCALE_DIAG_META_LOCALE_MISMATCH: string;
export const LOCALE_DIAG_LINK_HARDCODED_PATH: string;
export const LOCALE_DIAG_CACHE_KEY_STEALS_CONTENT: string;
export const LOCALE_DIAG_PREFIX_OMIT_WITHOUT_REDIRECT: string;
export const LOCALE_DIAG_DELIVERY_FULL_BUNDLE: string;
export const LOCALE_DIAG_CHUNK_HASH_MISMATCH: string;
export const LOCALE_DIAG_NATIVE_PACK_UNSIGNED: string;
export const LOCALE_DIAG_NATIVE_PACK_HAS_JS: string;
export const LOCALE_DIAG_NATIVE_PACK_APP_MISMATCH: string;
export const LOCALE_DIAG_MINI_CROSS_PACKAGE_UNPROVEN: string;
export const LOCALE_DIAG_SERVER_TRANSLATED_ERROR: string;
export const LOCALE_DIAG_SERVER_FORMAT_WITHOUT_CONTEXT: string;
export const LOCALE_DIAG_HOST_MESSAGE_DIVERGENCE: string;
export const LOCALE_DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED: string;
export const LOCALE_DIAG_HARDCODED_TEXT: string;
export const LOCALE_DIAG_PSEUDO_PRODUCTION_FORBIDDEN: string;
export const LOCALE_DIAG_CONFORMANCE_DIVERGENCE: string;
export const LOCALE_DIAG_EXPLAIN_UNKNOWN: string;
export const LOCALE_VIRTUAL_MODULE_PREFIX: string;
export function localeCatalog(): {
    schema: string;
    protocol: string;
    documents: Array<{ kind: string; schema: string }>;
    diagnostics: string[];
    virtualModulePrefix: string;
    formatterDataVersion: string;
};
export function negotiateLocale(input: {
    supportedLocales: string[];
    defaultLocale: string;
    routeLocale?: string | null;
    userChoice?: string | null;
    preference?: string | null;
    hostCandidates?: string[];
}): string;
export function buildApplicationContext(opts: {
    applicationId: string;
    deliveryId: string;
    localeId: string;
    timeZone: string;
    calendar?: string;
    numberingSystem?: string;
    direction?: string;
    generation?: number;
}): Record<string, unknown>;
export function buildFormatterContext(app: Record<string, unknown>, opts?: { currency?: string }): Record<string, unknown>;
export function formatterContextDigest(formatter: Record<string, unknown>): string;
export function validateFormatterContext(
    formatter: Record<string, unknown>,
    opts?: { allowMachineDefault?: boolean },
): { ok: boolean; diagnostics: Array<{ code: string; severity: string; message: string }> };
export function checkSsrClientParity(input: {
    ssr: {
        localeId: string;
        formatterDigest: string;
        formatterDataVersion?: string;
        texts: Record<string, string>;
    };
    client: {
        localeId: string;
        formatterDigest: string;
        formatterDataVersion?: string;
        texts: Record<string, string>;
    };
}): { schema: string; status: string; diagnostics: Array<{ code: string; severity: string; message: string }> };
export function createLocaleSession(opts: Record<string, unknown>): {
    transition: (targetLocaleId: string, opts?: Record<string, unknown>) => Promise<Record<string, unknown>>;
    renderAll: (argMap?: Record<string, Record<string, unknown>>) => {
        bindings: Record<string, { text: string; resolvedLocale: string }>;
        resolvedLocales: string[];
    };
    snapshot: () => Record<string, unknown>;
    applicationContext: Record<string, unknown>;
    formatterContext: Record<string, unknown>;
    formatterDigest: string;
};
export function formatMessageTemplate(template: string, args?: Record<string, unknown>): string;
export function resolveMessageVariant(input: Record<string, unknown>): Record<string, unknown>;
export function checkLocaleRuntime(input: Record<string, unknown>): Record<string, unknown>;
export function realizeRoutePath(localeId: string, pathPattern: string, routing?: Record<string, unknown>): Record<string, unknown>;
export function localizeSameAppHref(
    href: string,
    localeId: string,
    artifact: {
        locales?: Array<{ id: string } | string>;
        defaultLocale?: string;
        routing?: { strategy?: string; defaultPrefix?: string; defaultLocale?: string };
    },
): string;
export function localizeBodyLinks(
    html: string,
    localeId: string,
    artifact: {
        locales?: Array<{ id: string } | string>;
        defaultLocale?: string;
        routing?: { strategy?: string; defaultPrefix?: string; defaultLocale?: string };
    },
    escapeAttr?: (s: string) => string,
): string;
export function buildLocaleRouteRealizationTable(input: Record<string, unknown>): Record<string, unknown>;
export function buildLocalePageMeta(input: Record<string, unknown>): Record<string, unknown>;
export function resolveLinkHref(input: Record<string, unknown>): Record<string, unknown>;
export function planLocalePathNavigation(input: Record<string, unknown>): Record<string, unknown>;
export function localeAwareCacheKey(input: { routeId: string; localeId: string; path: string }): string;
export function assertLocaleCacheKey(input: Record<string, unknown>): {
    ok: boolean;
    diagnostics: Array<{ code: string; severity: string; message: string }>;
};
export function commitLocaleRouteMetaTransition(input: Record<string, unknown>): Record<string, unknown>;
export function checkLocaleRouter(input: Record<string, unknown>): Record<string, unknown>;
export function buildLocaleDeliveryResolution(input: Record<string, unknown>): Record<string, unknown>;
export function validateNativeLocalePack(input: Record<string, unknown>): Record<string, unknown>;
export function proveMiniPackageMessages(input: Record<string, unknown>): Record<string, unknown>;
export function assertServerErrorEnvelope(payload: unknown): Record<string, unknown>;
export function assertServerFormatContext(input: Record<string, unknown>): {
    ok: boolean;
    diagnostics: Array<{ code: string; severity: string; message: string }>;
};
export function assertHostMessageInvariant(resolutions: Array<Record<string, unknown>>): {
    ok: boolean;
    diagnostics: Array<{ code: string; severity: string; message: string }>;
};
export function checkLocaleDelivery(input: Record<string, unknown>): Record<string, unknown>;
export function fallbackDigest(fallback?: Record<string, string[]>): string;
export function messageCatalogHash(messages: Array<Record<string, unknown>>, localeId: string, reachableIds?: string[]): string;
export function explainLocaleMessage(input: Record<string, unknown>): Record<string, unknown>;
export function diffLocaleCatalogs(input: Record<string, unknown>): Record<string, unknown>;
export function extractHardcodedText(projectRoot: string, opts?: { check?: boolean }): Record<string, unknown>;
export function pseudoLocalizeCatalog(input: Record<string, unknown>): Record<string, unknown>;
export function checkLocaleConformance(input: Record<string, unknown>): Record<string, unknown>;

export function queryProfileProtocolCatalog(): string;
export function checkHostProfileProtocolJson(rootPath: string): string;

export const PROFILE_SOLVER_CHECK_SCHEMA: string;
export const PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA: string;
export const PROFILE_EXECUTOR_CHECK_SCHEMA: string;
export const PROFILE_EXECUTOR_SCENARIO_SCHEMA: string;
export const PROFILE_DIAG_SURFACE_NO_MATCH: string;
export const PROFILE_DIAG_SURFACE_AMBIGUOUS: string;
export const PROFILE_DIAG_CAPABILITY_UNRESOLVED: string;
export const PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED: string;
export const PROFILE_DIAG_ROUTE_UNREALIZABLE: string;
export const PROFILE_DIAG_STALE_GENERATION: string;
export const PROFILE_DIAG_MISSING_ENVELOPE_IDS: string;
export const PROFILE_DIAG_SURFACE_OWNS_STATE: string;
export const PROFILE_DIAG_PRIVATE_OBJECT_CROSSING: string;
export const PROFILE_DIAG_SPLIT_TRANSACTION: string;
export const PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE: string;
export const PROFILE_DIAG_CANCEL_NOT_PROPAGATED: string;
export const PROFILE_LIFECYCLE_MAPPING_ENTRY_SCHEMA: string;
export const PROFILE_LIFECYCLE_MAPPING_TABLE_SCHEMA: string;
export const PROFILE_RECOVERY_POLICY_SCHEMA: string;
export const PROFILE_LIFECYCLE_SCENARIO_SCHEMA: string;
export const PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA: string;
export const PROFILE_LIFECYCLE_HOST_KINDS: string[];
export const PROFILE_PERSISTENCE_WINDOWS: string[];
export const PROFILE_DIAG_LIFECYCLE_UNPROVEN: string;
export const PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE: string;
export const PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER: string;
export const PROFILE_DIAG_RECOVERY_ASSUMES_HEAP: string;
export const PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID: string;
export function checkProfileSolverJson(rootPath: string): string;
export function checkUnifiedExecutorJson(rootPath: string): string;
export function checkLifecycleRecoveryJson(rootPath: string): string;
export const PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA: string;
export const PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA: string;
export const PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA: string;
export const PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA: string;
export const PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA: string;
export const PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA: string;
export const PROFILE_DELIVERY_PROOF_CHECK_SCHEMA: string;
export const PROFILE_DELIVERY_UPDATE_CHANNELS: string[];
export const PROFILE_DELIVERY_ASSET_STRATEGIES: string[];
export const PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED: string;
export const PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH: string;
export const PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE: string;
export const PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR: string;
export const PROFILE_DIAG_UPDATE_WITHOUT_REPROOF: string;
export const PROFILE_DIAG_SECURITY_POLICY_INSECURE: string;
export function checkDeliveryProofJson(rootPath: string): string;
export const PROFILE_CONFORMANCE_FIXTURE_SCHEMA: string;
export const PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA: string;
export const PROFILE_CONFORMANCE_TRACE_SCHEMA: string;
export const PROFILE_CONFORMANCE_HOST_RUN_SCHEMA: string;
export const PROFILE_CONFORMANCE_SCENARIO_SCHEMA: string;
export const PROFILE_CONFORMANCE_CHECK_SCHEMA: string;
export const PROFILE_CONFORMANCE_SURFACE_ROLES: string[];
export const PROFILE_DIAG_STABLE_ID_DIVERGENCE: string;
export const PROFILE_DIAG_STATE_RESULT_DIVERGENCE: string;
export const PROFILE_DIAG_TRACE_INVARIANT_BROKEN: string;
export const PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE: string;
export const PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH: string;
export function checkCrossHostConformanceJson(rootPath: string): string;

export const NATIVE_HOST_PROTOCOL: string;
export const NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA: string;
export const NATIVE_HOST_CAPABILITY_SCHEMA: string;
export const NATIVE_HOST_BRIDGE_SCHEMA: string;
export const NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA: string;
export const NATIVE_HOST_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_ARBITRARY_BRIDGE: string;
export function nativeHostCatalog(): {
    schema: string;
    protocol: string;
    documents: Array<{ kind: string; schema: string }>;
    diagnostics: string[];
    capabilityClasses: string[];
    forbiddenBridgePatterns: string[];
};
export function queryNativeHostProtocolCatalog(): string;
export function checkNativeHostContractJson(rootPath: string): string;

export const NATIVE_HOST_SHELL_SCHEMA: string;
export const NATIVE_HOST_SHELL_CHECK_SCHEMA: string;
export const NATIVE_HOST_DEEP_LINK_SCHEMA: string;
export const NATIVE_HOST_LOCAL_BUNDLE_SCHEMA: string;
export const NATIVE_HOST_DIAG_MISSING_SHELL_HOOK: string;
export const NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK: string;
export const NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT: string;
export const NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT: string;
export const NATIVE_HOST_REQUIRED_SHELL_HOOKS: string[];
export function checkNativeShellContractJson(rootPath: string): string;

export const NATIVE_HOST_CAPABILITY_CALL_SCHEMA: string;
export const NATIVE_HOST_BRIDGE_TRACE_SCHEMA: string;
export const NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA: string;
export const NATIVE_HOST_BRIDGE_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_MISSING_NONCE: string;
export const NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED: string;
export const NATIVE_HOST_FIRST_BATCH_STUB_IDS: string[];
export function checkNativeBridgeContractJson(rootPath: string): string;

export const NATIVE_HOST_LIFECYCLE_SCHEMA: string;
export const NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY: string;
export const NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP: string;
export const NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT: string;
export const NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS: string[];
export function checkNativeLifecycleContractJson(rootPath: string): string;

export const NATIVE_HOST_FULLSTACK_SCHEMA: string;
export const NATIVE_HOST_FULLSTACK_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER: string;
export const NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY: string;
export const NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT: string;
export function checkNativeFullstackContractJson(rootPath: string): string;

export const NATIVE_HOST_NATIVE_SURFACE_SCHEMA: string;
export const NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY: string;
export const NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE: string;
export const NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS: string[];
export function checkNativeSurfaceContractJson(rootPath: string): string;

export const NATIVE_HOST_MULTI_PLATFORM_SCHEMA: string;
export const NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA: string;
export const NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA: string;
export const NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK: string;
export const NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER: string;
export const NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA: string;
export const NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE: string;
export const NATIVE_HOST_REQUIRED_MULTI_PLATFORMS: string[];
export const NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND: string;
export function checkMultiPlatformContractJson(rootPath: string): string;
