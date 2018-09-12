/**
 * Conformance check registry — paths are domain-relative under tests/conformance/.
 *
 * IDs stay semantic (not opaque codes). Prefer migrating each driver into
 * `vmz test` / `cargo test` over time.
 */

export type CheckFile = {
    file: string;
    description?: string;
    pre?: string[];
};

export type CheckComposite = {
    composite: string[];
    description?: string;
    pre?: string[];
};

export type CheckEntry = CheckFile | CheckComposite;

export const CHECKS: Record<string, CheckEntry> = {
    // toolchain/
    'program-ir': {
        file: 'toolchain/program-ir.ts',
        description: 'CLI vs N-API *.program.json identity',
    },
    'node-cli': { file: 'toolchain/node-cli.ts', description: 'Node CLI / Workspace host' },
    plugin: {
        file: 'toolchain/plugin.ts',
        description: 'Plugin contribution protocol',
        pre: ['build:runtimes'],
    },
    'plugin-shiki': {
        file: 'toolchain/plugin-shiki.ts',
        description: 'Shiki plugin textmate peer + published runtime',
        pre: ['build:plugin-shiki'],
    },
    affected: { file: 'toolchain/affected.ts', description: 'Affected rebuild' },

    // tooling/
    'protocol-catalog': {
        file: 'tooling/protocol-catalog.ts',
        description: 'Umbrella + tool protocol catalog',
    },
    rename: { file: 'tooling/rename.ts', description: 'Rename + test selection' },
    symbols: { file: 'tooling/symbols.ts', description: 'Cross-SFC symbol index' },
    incremental: { file: 'tooling/incremental.ts', description: 'Semantic transaction / HMR plan' },
    'deployment-proof': {
        file: 'tooling/deployment-proof.ts',
        description: 'Deployment boundary proof',
    },
    'pack-client-packages': {
        file: 'toolchain/pack-client-packages.ts',
        description: 'Pack: bare client package → dist/vendor + relative rewrite',
        pre: ['build:runtimes'],
    },
    'causal-trace': { file: 'tooling/causal-trace.ts', description: 'Trace ingest / causal replay' },

    // profile/
    'host-profile': { file: 'profile/host-profile.ts' },
    'profile-solver': { file: 'profile/profile-solver.ts' },
    'unified-executor': { file: 'profile/unified-executor.ts' },
    'lifecycle-recovery': { file: 'profile/lifecycle-recovery.ts' },
    'delivery-proof': { file: 'profile/delivery-proof.ts' },
    'cross-host-conformance': { file: 'profile/cross-host-conformance.ts' },

    // miniprogram/
    'miniprogram-target': { file: 'miniprogram/miniprogram-target.ts' },
    'miniprogram-static-slice': {
        file: 'miniprogram/miniprogram-static-slice.ts',
        description: 'Mini TemplateSurface static slice — neutral template + logic data',
        pre: ['build:runtimes'],
    },
    'miniprogram-binding-event': {
        file: 'miniprogram/miniprogram-binding-event.ts',
        description: 'Mini BindingId patch + event table (counter slice)',
        pre: ['build:runtimes'],
    },
    'miniprogram-structure': {
        file: 'miniprogram/miniprogram-structure.ts',
        description: 'Mini if/each/component/slot + lifecycle/dispose tables',
        pre: ['build:runtimes'],
    },
    'miniprogram-route-server-style': {
        file: 'miniprogram/miniprogram-route-server-style.ts',
        description: 'Mini Route realization + #server stubs + Canonical Style',
        pre: ['build:runtimes'],
    },
    'miniprogram-tooling-deploy': {
        file: 'miniprogram/miniprogram-tooling-deploy.ts',
        description: 'Mini deploy package + deterministic host + vendor tooling handoff',
        pre: ['build:runtimes'],
    },
    'miniprogram-wechat-pack': {
        file: 'miniprogram/miniprogram-wechat-pack.ts',
        description: 'WeChat pages/**/*.wxml|wxss via vmz-generator (not authoring truth)',
        pre: ['build:runtimes'],
    },
    'miniprogram-multi-adapter': {
        file: 'miniprogram/miniprogram-multi-adapter.ts',
        description: 'Mini ≥2 packaging adapters share one neutral deploy package',
        pre: ['build:runtimes'],
    },

    // native/
    'native-host': { file: 'native/native-host.ts' },
    'native-shell': { file: 'native/native-shell.ts' },
    'native-bridge': { file: 'native/native-bridge.ts' },
    'native-lifecycle': { file: 'native/native-lifecycle.ts' },
    'native-fullstack': { file: 'native/native-fullstack.ts' },
    'native-surface': { file: 'native/native-surface.ts' },
    'multi-platform': { file: 'native/multi-platform.ts' },

    // runtime/
    'shared-plan': { file: 'runtime/shared-plan.ts', pre: ['build:vmz-test'] },
    lifetime: { file: 'runtime/lifetime.ts', pre: ['build:vmz-test'] },
    'async-graph': { file: 'runtime/async-graph.ts', pre: ['build:vmz-test'] },
    'motion-ir': {
        file: 'runtime/motion-ir.ts',
        description: 'Motion Program IR — overlay/control transitions + cancel edges',
    },
    ui7: {
        file: 'ui/ui7.ts',
        description: 'UI7 conformance pack — Motion IR depth fixtures (token/affects/cancel)',
        pre: ['build:vmz-test'],
    },
    'write-barrier': { file: 'runtime/write-barrier.ts' },
    'write-barrier-array': { file: 'runtime/write-barrier-array.ts' },
    'write-barrier-shared': { file: 'runtime/write-barrier-shared.ts' },
    'write-barrier-logical': { file: 'runtime/write-barrier-logical.ts' },
    'write-barrier-suite': {
        description: 'WriteBarrier static + array + shared + logical',
        composite: ['write-barrier', 'write-barrier-array', 'write-barrier-shared', 'write-barrier-logical'],
    },
    resume: { file: 'runtime/resume.ts', pre: ['build:vmz-test'] },
    'zero-js': { file: 'runtime/zero-js.ts', pre: ['build:vmz-test'] },
    'mixed-pack': { file: 'runtime/mixed-pack.ts', pre: ['build:vmz-test'] },

    // test-host/
    'test-protocol': { file: 'test-host/test-protocol.ts', pre: ['build:vmz-test'] },
    'test-compile': { file: 'test-host/test-compile.ts', pre: ['build:vmz-test'] },
    'test-logic': { file: 'test-host/test-logic.ts', pre: ['build:vmz-test'] },
    'test-stream': { file: 'test-host/test-stream.ts', pre: ['build:vmz-test'] },
    'test-stream-cancel': { file: 'test-host/test-stream-cancel.ts', pre: ['build:vmz-test'] },
    'test-browser': { file: 'test-host/test-browser.ts', pre: ['build:vmz-test'] },
    'ssr-resume': {
        description: 'Shared plan + resume + stream + browser hosts',
        pre: ['build:vmz-test'],
        composite: ['shared-plan', 'resume', 'test-stream', 'test-stream-cancel', 'test-browser'],
    },
    'unload-vitest': { file: 'test-host/unload-vitest.ts' },

    // document/
    'document-contract': { file: 'document/document-contract.ts' },
    'document-static': { file: 'document/document-static.ts' },
    'document-evidence': { file: 'document/document-evidence.ts' },
    'document-host': { file: 'document/document-host.ts' },

    // locale/
    'locale-layout': { file: 'locale/locale-layout.ts', pre: ['build:protocol-vmz'] },
    'locale-messages': { file: 'locale/locale-messages.ts', pre: ['build:protocol-vmz'] },
    'locale-routing': { file: 'locale/locale-routing.ts', pre: ['build:protocol-vmz'] },
    'locale-ssr': { file: 'locale/locale-ssr.ts', pre: ['build:protocol-vmz'] },
    'locale-host': { file: 'locale/locale-host.ts', pre: ['build:protocol-vmz'] },
    'locale-none': {
        file: 'locale/locale-none.ts',
        description: 'routing.strategy none Host preference + SSR negotiate + prefix cookie regression (v0.1.8)',
    },
    'locale-tooling': { file: 'locale/locale-tooling.ts', pre: ['build:protocol-vmz'] },

    // application/
    'application-contract': { file: 'application/application-contract.ts' },
    'application-relocatable': { file: 'application/application-relocatable.ts' },
    'application-artifact': { file: 'application/application-artifact.ts' },
    'application-isolation': { file: 'application/application-isolation.ts' },
    'application-composition': { file: 'application/application-composition.ts' },
    'application-dev': { file: 'application/application-dev.ts' },

    // style/ + ui/
    'style-theme': { file: 'style/style-theme.ts' },
    'ui-automation': { file: 'ui/ui-automation.ts' },
    'ui-data-grid': {
        file: 'ui/ui-data-grid.ts',
        description: '@vmz/ui-data-grid thin gate — virtualization + pinned column + homepage /datagrid',
    },
    'ui-icons': {
        file: 'ui/ui-icons.ts',
        description: '@vmz/ui-icons thin gate — semantic Icon registry (not loose SVG dump)',
    },
    'event-flow': {
        description: 'EventEntry + async cancel + HTTP stream (+ zero-js / mixed-pack)',
        pre: ['build:vmz-test'],
        composite: ['event-flow-core', 'zero-js', 'mixed-pack'],
    },
    'event-flow-core': { file: 'runtime/event-flow.ts' },

    // production/ — Browser Production Profile (not in default verify-all until green)
    'browser-core': {
        file: 'production/browser-core.ts',
        description: 'A1 catalog: compile+logic+ssr+resume+browser+async + no-render',
        pre: ['build:vmz-test'],
    },
    'router-production': {
        file: 'production/router-production.ts',
        description: 'A2 SSR + Link + SPA takeover + load/access/action + nav-cancel + layout',
    },
    'server-host': {
        file: 'production/server-host.ts',
        description: 'ServerArtifact emit + Node/Fetch parity + public/internal isolation',
    },
    'release-artifact': {
        file: 'production/release-artifact.ts',
        description: 'A3 filesystem pack / atomic publish / rollback / artifact diff',
    },
    'static-delivery': {
        file: 'production/static-delivery.ts',
        description: 'A3-static static HTML + 404 + SEO + StaticDeliveryManifest',
    },
    'cdn-policy': {
        file: 'production/cdn-policy.ts',
        description: 'A3-cdn: routing + cache-policy + static-resume + static-rollback',
    },
    'cdn-routing': {
        file: 'production/cdn-policy.ts',
        description: 'A3-cdn redirects / deep links / no SPA fallback (same driver as cdn-policy)',
    },
    'cdn-cache-policy': {
        file: 'production/cdn-policy.ts',
        description: 'A3-cdn Cache-Control contract (same driver as cdn-policy)',
    },
    'static-resume': {
        file: 'production/cdn-policy.ts',
        description: 'A3-cdn static HTML resume assets (same driver as cdn-policy)',
    },
    'static-rollback': {
        file: 'production/cdn-policy.ts',
        description: 'A3-cdn static artifact rollback (same driver as cdn-policy)',
    },
    'content-addressed-assets': {
        file: 'production/content-addressed-assets.ts',
        description: 'A3 assets/<hash> content-addressed immutable layout',
    },
    'site-delivery': {
        file: 'production/site-delivery.ts',
        description: 'A3-site SiteDeliveryContract embedded + fallback',
    },
    'embedded-site': {
        file: 'production/site-delivery.ts',
        description: 'A3-site embedded-only activate (same driver as site-delivery)',
    },
    'site-fallback': {
        file: 'production/site-delivery.ts',
        description: 'A3-site release fallback + anti-mix (same driver as site-delivery)',
    },
    'production-test': {
        file: 'production/production-test.ts',
        description: 'A4 production scenario pack + deterministic CI profile',
    },
    'production-observability': {
        file: 'production/production-observability.ts',
        description: 'A5 trace / redaction / CSP / budget / health',
    },
    'official-homepage': {
        file: 'production/official-homepage.ts',
        description: 'Official homepage + documents + inspector fixture + @vmz/ui Field/Dialog',
    },
    // M-PR0: public semantic ids as composites over existing evidence (no parallel fake gates).
    'resume-lazy': {
        description: 'P3 Resume/lazy — resume + event-flow + browser-core (lazy/EventEntry seed)',
        composite: ['resume', 'event-flow', 'browser-core'],
    },
    'asset-graph': {
        description: 'P5 Asset Graph v0 — content-addressed assets + static SEO seed (image variants still open)',
        composite: ['content-addressed-assets', 'static-delivery'],
    },
    'ui-commercial': {
        description: 'Commercial surface — ui-automation + official-homepage',
        composite: ['ui-automation', 'official-homepage'],
    },
    'ui-console': {
        description: 'Console surface — ui-automation + official-homepage',
        composite: ['ui-automation', 'official-homepage'],
    },
    'motion-continuity': {
        description: 'Motion continuity — motion-ir + ui7 + official-homepage',
        composite: ['motion-ir', 'ui7', 'official-homepage'],
    },
    'browser-production': {
        description: 'Browser Production Profile v1 aggregate',
        composite: [
            'browser-core',
            'router-production',
            'server-host',
            'release-artifact',
            'static-delivery',
            'cdn-policy',
            'content-addressed-assets',
            'site-delivery',
            'production-test',
            'production-observability',
            'official-homepage',
        ],
    },
};

/** Default suite for `pnpm verify` (no args) / `pnpm verify --all`. */
export const CHECK_ALL = [
    'program-ir',
    'node-cli',
    'plugin',
    'plugin-shiki',
    'affected',
    'protocol-catalog',
    'rename',
    'symbols',
    'incremental',
    'deployment-proof',
    'causal-trace',
    'miniprogram-target',
    'miniprogram-static-slice',
    'miniprogram-binding-event',
    'miniprogram-structure',
    'miniprogram-route-server-style',
    'miniprogram-tooling-deploy',
    'miniprogram-wechat-pack',
    'miniprogram-multi-adapter',
    'host-profile',
    'profile-solver',
    'unified-executor',
    'lifecycle-recovery',
    'delivery-proof',
    'cross-host-conformance',
    'native-host',
    'native-shell',
    'native-bridge',
    'native-lifecycle',
    'native-fullstack',
    'native-surface',
    'multi-platform',
    'shared-plan',
    'lifetime',
    'write-barrier-suite',
    'async-graph',
    'motion-ir',
    'resume',
    'event-flow',
    'test-protocol',
    'test-compile',
    'test-logic',
    'ssr-resume',
    'unload-vitest',
    'document-contract',
    'document-static',
    'document-evidence',
    'document-host',
    'locale-layout',
    'locale-messages',
    'locale-routing',
    'locale-ssr',
    'locale-host',
    'locale-none',
    'locale-tooling',
    'application-contract',
    'application-relocatable',
    'application-artifact',
    'application-isolation',
    'application-composition',
    'application-dev',
    'style-theme',
    'ui-automation',
    'ui-data-grid',
    'ui-icons',
    'ui7',
];
