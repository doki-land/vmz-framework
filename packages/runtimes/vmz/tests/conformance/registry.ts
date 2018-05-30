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
    'event-flow': {
        description: 'EventEntry + async cancel + HTTP stream (+ zero-js / mixed-pack)',
        pre: ['build:vmz-test'],
        composite: ['event-flow-core', 'zero-js', 'mixed-pack'],
    },
    'event-flow-core': { file: 'runtime/event-flow.ts' },
};

/** Default suite for `pnpm verify` (no args) / `pnpm verify --all`. */
export const CHECK_ALL = [
    'program-ir',
    'node-cli',
    'plugin',
    'affected',
    'protocol-catalog',
    'rename',
    'symbols',
    'incremental',
    'deployment-proof',
    'causal-trace',
    'miniprogram-target',
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
    'locale-tooling',
    'application-contract',
    'application-relocatable',
    'application-artifact',
    'application-isolation',
    'application-composition',
    'application-dev',
    'style-theme',
    'ui-automation',
];
