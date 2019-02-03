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
    'deployment-artifacts': {
        file: 'toolchain/deployment-artifacts.ts',
        description: 'Rust vmz-artifacts N-API and @vmz/core deployment host wiring',
    },
    'deployment-parity': {
        file: 'toolchain/deployment-parity.ts',
        description: '0.1.22: deployment N-API ≡ host (wraps deployment-artifacts)',
    },
    'plan-only-host': {
        file: 'toolchain/plan-only-host.ts',
        description: '0.1.22: hosts require Plan pathPattern/layoutChain and N-API ServerArtifact',
    },
    'template-ast-single-source': {
        file: 'toolchain/template-ast-single-source.ts',
        description: '0.1.22: cross_sfc uses name_span not string span_of_*',
    },
    'span-context-conversion': {
        file: 'toolchain/span-context-conversion.ts',
        description: '0.1.22: OffsetIndex N-API → PositionContext',
        pre: ['build:runtimes'],
    },
    'no-duplicate-manifest-parse': {
        file: 'toolchain/no-duplicate-manifest-parse.ts',
        description: '0.1.22: locale/document policy only via N-API Plan loaders',
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
    'dev-rebuild-convergence': {
        file: 'tooling/dev-rebuild-convergence.ts',
        description: '0.1.24: outputRevision stable without dirty input',
        pre: ['build:runtimes'],
    },
    'dev-invalidation-closure': {
        file: 'tooling/dev-invalidation-closure.ts',
        description: '0.1.24: HMR plan includes importer page on component edit',
        pre: ['build:runtimes'],
    },
    'dev-output-write-suppression': {
        file: 'tooling/dev-output-write-suppression.ts',
        description: '0.1.24: generation write-set filtered from author dirty',
    },
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
    'runtime-identity': { file: 'runtime/runtime-identity.ts', pre: ['build:vmz-test'] },
    'resume-composition': {
        file: 'runtime/resume-composition.ts',
        description: 'SSR resume if/else must not steal parent sibling hosts',
        pre: ['build:runtimes'],
    },
    'keyed-list': { file: 'runtime/keyed-list.ts' },
    'slot-projection': { file: 'runtime/slot-projection.ts' },
    invalidation: { file: 'runtime/invalidation.ts' },
    cancellation: { file: 'runtime/cancellation.ts' },
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
    'document-integrated-layout': {
        file: 'document/document-integrated-layout.ts',
        description: 'Compiled DocumentLayout integrated mount (VMZ-11; no regex chrome)',
        pre: ['build:runtimes'],
    },

    // locale/
    'locale-layout': { file: 'locale/locale-layout.ts', pre: ['build:protocol-vmz'] },
    'locale-messages': { file: 'locale/locale-messages.ts', pre: ['build:protocol-vmz'] },
    'locale-routing': { file: 'locale/locale-routing.ts', pre: ['build:protocol-vmz'] },
    'locale-ssr': { file: 'locale/locale-ssr.ts', pre: ['build:protocol-vmz'] },
    'locale-host': { file: 'locale/locale-host.ts', pre: ['build:protocol-vmz'] },
    'locale-transition': { file: 'locale/locale-transition.ts', pre: ['build:runtimes'] },
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
    'ui-direct-host-box': {
        file: 'ui/ui-direct-host-box.ts',
        description: 'Direct chip hosts display:contents (ui-direct-host-box) + Notification stays block',
    },
    'component-event-wire': {
        file: 'ui/component-event-wire.ts',
        description: 'Component @event → onComponentEvent subscribe; :on-* stays prop (orthogonal)',
    },
    'ui-host-box': {
        description: 'Alias — ui-direct-host-box',
        composite: ['ui-direct-host-box'],
    },
    upload: {
        description: 'Upload thin gate — covered by ui-automation Form depth + official-homepage',
        composite: ['ui-automation', 'official-homepage'],
    },
    'official-dogfood': {
        description: 'Alias — official-homepage',
        composite: ['official-homepage'],
    },
    'highlighter-wasm': {
        file: 'ui/highlighter-wasm.ts',
        description: '@vmz/highlighter + unknown-wasm32 + vmz-highlighter CE',
        pre: ['build:content-engines'],
    },
    'markdown-wasm32': {
        file: 'ui/markdown-wasm32.ts',
        description: '@vmz/markdown + unknown-wasm32 plain engines',
        pre: ['build:content-engines'],
    },
    'replaceable-content-plugin': {
        file: 'ui/replaceable-content-plugin.ts',
        description: 'Third-party highlighter registration via @vmz/plugin-syntect shape',
        pre: ['build:content-engines'],
    },
    'ui-v-if-dom': {
        file: 'ui/ui-v-if-dom.ts',
        description: 'False v-if omits empty data-vmz-if layout shell in SSR',
    },
    'ui-nav-button': {
        file: 'ui/ui-nav-button.ts',
        description: 'Button href renders single navigable anchor',
    },
    'ssr-unknown-component-error-node': {
        file: 'ui/ssr-unknown-component-error-node.ts',
        description: 'Unknown Direct leaf → data-vmz-error node; document SSR does not throw',
    },
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

    // production/ — Browser Production Profile (0.1.27: enter default verify-all when green)
    'browser-artifact-boundary': {
        file: 'production/browser-artifact-boundary.ts',
        description: '0.1.27: record browser delivery module boundary (not thin-runtime close)',
    },
    'browser-artifact-inventory': {
        file: 'production/browser-artifact-inventory.ts',
        description: '0.1.28: owner matrix + dist/vmz.runtime-inventory.json',
    },
    'runtime-boundary-audit': {
        file: 'production/runtime-boundary-audit.ts',
        description: '0.1.28: browser import closure must not import Node/host blacklist',
    },
    'runtime-budget-baseline': {
        file: 'production/runtime-budget-baseline.ts',
        description: '0.1.28: record runtime budget baseline (no hard size fail)',
    },
    'runtime-boundary': {
        description: '0.1.28 Slim composite: inventory + closure audit + budget baseline (≠ thin runtime)',
        composite: ['browser-artifact-inventory', 'runtime-boundary-audit', 'runtime-budget-baseline'],
    },
    'handler-symbol-resolution': {
        file: 'production/handler-symbol-resolution.ts',
        description: '0.1.29: bare class method handler scope at compile time',
    },
    'generated-component-code': {
        file: 'production/generated-component-code.ts',
        description: '0.1.29: Direct __vmzCreate artifacts for generated client modules',
    },
    'specialized-bindings': {
        file: 'production/specialized-bindings.ts',
        description: '0.1.29: specFieldText/Attr + onMethod specialized emit in artifacts',
    },
    'no-generic-component-interpreter': {
        file: 'production/no-generic-component-interpreter.ts',
        description: '0.1.29: no blueprint render interpreter in generated client modules',
    },
    'specialized-component-artifact': {
        description: '0.1.29 Slim composite: handler scope + Direct emit + specialized bindings (≠ thin runtime)',
        composite: [
            'handler-symbol-resolution',
            'generated-component-code',
            'specialized-bindings',
            'no-generic-component-interpreter',
            'component-event-wire',
            'resume-composition',
        ],
    },
    'compiled-route-artifact': {
        file: 'production/compiled-route-artifact.ts',
        description: '0.1.30: `_vmz/route-catalog.json` freezes page catalog',
    },
    'compiled-locale-artifact': {
        file: 'production/compiled-locale-artifact.ts',
        description: '0.1.30: locale realization + `_vmz/locale-link-plan.json`',
    },
    'compiled-asset-artifact': {
        file: 'production/compiled-asset-artifact.ts',
        description: '0.1.30: asset-plan + content-addressed with rewrittenHtml: 0',
    },
    'no-runtime-manifest-interpretation': {
        file: 'production/no-runtime-manifest-interpretation.ts',
        description: '0.1.30: host/client consume frozen catalog/hrefs (no live deployment catalog)',
    },
    'no-post-emit-semantic-rewrite': {
        file: 'production/no-post-emit-semantic-rewrite.ts',
        description: '0.1.30: forbid post-hash HTML semantic rewrite',
    },
    'compiled-delivery-artifact': {
        description: '0.1.30 Slim composite: compiled route/locale/asset + no manifest/rewrite (≠ thin runtime)',
        composite: [
            'compiled-route-artifact',
            'compiled-locale-artifact',
            'compiled-asset-artifact',
            'no-runtime-manifest-interpretation',
            'no-post-emit-semantic-rewrite',
        ],
    },
    'thin-runtime-imports': {
        file: 'production/thin-runtime-imports.ts',
        description: '0.1.31: browser entry/components use dom.browser / dom-core (not SSR barrel)',
    },
    'host-runtime-boundary': {
        file: 'production/host-runtime-boundary.ts',
        description: '0.1.31: host companions nest under `_vmz/host/`',
    },
    'single-revision-owner': {
        file: 'production/single-revision-owner.ts',
        description: '0.1.31: outputRevision + payload sole reload decision',
    },
    'no-browser-plan-dispatch': {
        file: 'production/no-browser-plan-dispatch.ts',
        description: '0.1.31: browser must not invent reload/plan scope',
    },
    'thin-runtime-host-boundary': {
        description: '0.1.31 Slim composite: thin imports + host nest + revision owner (≠ thin runtime)',
        composite: ['thin-runtime-imports', 'host-runtime-boundary', 'single-revision-owner', 'no-browser-plan-dispatch'],
    },
    'thin-runtime-production': {
        file: 'production/thin-runtime-production.ts',
        description: '0.1.32: thinRuntimeClaim true + entry without registerComponents + owner flip',
    },
    'browser-artifact-size': {
        file: 'production/browser-artifact-size.ts',
        description: '0.1.32: hard browserClosureBytes + ratioRuntimeToGenerated caps',
    },
    'runtime-forbidden-imports': {
        file: 'production/runtime-forbidden-imports.ts',
        description: '0.1.32: browser closure/entry forbid host registry bootstrap symbols',
    },
    'thin-runtime-production-proof': {
        description: '0.1.32 Slim final: thin claim + size + forbidden + observability + homepage',
        composite: [
            'thin-runtime-production',
            'browser-artifact-size',
            'runtime-forbidden-imports',
            'production-observability',
            'official-homepage',
        ],
    },
    'no-type-check-suppression': {
        file: 'production/no-type-check-suppression.ts',
        description: '0.2.0: forbid @ts-nocheck/@ts-ignore in vmz-runtime/src',
    },
    'no-jsdoc-pseudo-types': {
        file: 'production/no-jsdoc-pseudo-types.ts',
        description: '0.2.0: forbid JSDoc brace types in vmz-runtime/src',
    },
    'authoring-surface-lint': {
        file: 'production/authoring-surface-lint.ts',
        description: '0.2.0: official templates use bare handler authoring',
    },
    'host-runtime-manifest': {
        file: 'production/host-runtime-manifest.ts',
        description: '0.2.0: sole host-runtime-files.json for compile + materialize',
    },
    'skip-native-pre-probe': {
        file: 'production/skip-native-pre-probe.ts',
        description: 'internal probe: body only; exercises pre build:runtimes skip',
        pre: ['build:runtimes'],
    },
    'skip-native-pre': {
        file: 'production/skip-native-pre.ts',
        description: 'CI: VMZ_SKIP_NATIVE_BUILD must short-circuit pre build:runtimes',
    },
    'package-layout-core': {
        file: 'production/package-layout-core.ts',
        description: '0.2.0: @vmz/core src browser/ssr/host/faces/shared',
    },
    'package-layout-cli': {
        file: 'production/package-layout-cli.ts',
        description: '0.2.0: vmz CLI src domain folders + thin index',
    },
    'package-layout-hygiene': {
        description: '0.2.0 Package Layout Hygiene composite',
        composite: ['package-layout-core', 'package-layout-cli', 'host-runtime-manifest'],
    },
    'runtime-quality-baseline': {
        description: '0.2.0 composite: quality + package layout + thin proof',
        composite: [
            'no-type-check-suppression',
            'no-jsdoc-pseudo-types',
            'no-generic-component-interpreter',
            'specialized-bindings',
            'authoring-surface-lint',
            'handler-symbol-resolution',
            'package-layout-hygiene',
            'thin-runtime-production-proof',
        ],
    },
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
    'delivery-closure': {
        file: 'production/delivery-closure.ts',
        description: 'Deployment dependsOn + static-delivery + content-addressed assets parity',
    },
    // M-PR0: public semantic ids as composites over existing evidence (no parallel fake gates).
    'resume-lazy': {
        description: 'P3 Resume/lazy — resume + runtime-identity + resume-composition + event-flow + browser-core',
        composite: ['resume', 'runtime-identity', 'resume-composition', 'event-flow', 'browser-core'],
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
        description: 'Browser Production Profile v1 aggregate (0.1.27 evidence baseline; ≠ thin runtime)',
        composite: [
            'browser-artifact-boundary',
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
    'deployment-artifacts',
    'deployment-parity',
    'plan-only-host',
    'template-ast-single-source',
    'span-context-conversion',
    'no-duplicate-manifest-parse',
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
    'runtime-identity',
    'resume-composition',
    'keyed-list',
    'slot-projection',
    'invalidation',
    'cancellation',
    'delivery-closure',
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
    'document-integrated-layout',
    'locale-layout',
    'locale-messages',
    'locale-routing',
    'locale-transition',
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
    'ui-direct-host-box',
    'component-event-wire',
    'highlighter-wasm',
    'markdown-wasm32',
    'replaceable-content-plugin',
    'ui-v-if-dom',
    'ui-nav-button',
    'ssr-unknown-component-error-node',
    'ui-data-grid',
    'ui-icons',
    'ui7',
    // 0.1.27 Production Evidence Baseline — aggregate (includes official-dogfood via official-homepage)
    'browser-production',
    // 0.1.28 Slim inventory / boundary / budget (not part of browser-production)
    'runtime-boundary',
    // 0.1.29 Specialized component artifact (not part of browser-production)
    'specialized-component-artifact',
    // 0.1.30 Compiled delivery / navigation artifacts (not part of browser-production)
    'compiled-delivery-artifact',
    // 0.1.31 Thin runtime host boundary (not part of browser-production)
    'thin-runtime-host-boundary',
    // 0.1.32 Thin runtime production proof (Slim final — still ≠ production-ready)
    'thin-runtime-production-proof',
    // 0.2.0 Runtime Quality Baseline + Package Layout Hygiene (tag gate)
    'runtime-quality-baseline',
];
