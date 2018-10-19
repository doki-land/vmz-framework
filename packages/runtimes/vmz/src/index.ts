// @ts-nocheck
/**
 * VMZ Node host: N-API workspace + npm CLI.
 * Coarse-grained only — no transform hooks / per-AST callbacks.
 */

import { createRequire } from 'node:module';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { materializeWechatPackaging } from './wechat-packaging.js';

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
    TARGET_PROTOCOL,
    TARGET_VIEW_OPS_SCHEMA,
    TARGET_PLATFORM_PROFILE_SCHEMA,
    TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA,
    TARGET_CHECK_SCHEMA,
    TARGET_DIAG_DOM_LEAK_IN_PLAN,
    targetCatalog,
    PROFILE_PROTOCOL,
    PROFILE_HOST_SCHEMA,
    PROFILE_DELIVERY_SCHEMA,
    PROFILE_CHECK_SCHEMA,
    PROFILE_DIAG_HOST_PROFILE_INVALID,
    PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH,
    PROFILE_DIAG_CORE_ID_OVERRIDE,
    PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED,
    PROFILE_SURFACE_KINDS,
    PROFILE_UNIFIED_LIFECYCLE_EVENTS,
    PROFILE_CORE_ID_PREFIX,
    PROFILE_SOLVER_CHECK_SCHEMA,
    PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA,
    PROFILE_EXECUTOR_CHECK_SCHEMA,
    PROFILE_EXECUTOR_SCENARIO_SCHEMA,
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
    PROFILE_LIFECYCLE_MAPPING_ENTRY_SCHEMA,
    PROFILE_LIFECYCLE_MAPPING_TABLE_SCHEMA,
    PROFILE_RECOVERY_POLICY_SCHEMA,
    PROFILE_LIFECYCLE_SCENARIO_SCHEMA,
    PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA,
    PROFILE_LIFECYCLE_HOST_KINDS,
    PROFILE_PERSISTENCE_WINDOWS,
    PROFILE_DIAG_LIFECYCLE_UNPROVEN,
    PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
    PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
    PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
    PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
    PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA,
    PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA,
    PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA,
    PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA,
    PROFILE_DELIVERY_PROOF_CHECK_SCHEMA,
    PROFILE_DELIVERY_UPDATE_CHANNELS,
    PROFILE_DELIVERY_ASSET_STRATEGIES,
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
    PROFILE_CONFORMANCE_FIXTURE_SCHEMA,
    PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA,
    PROFILE_CONFORMANCE_TRACE_SCHEMA,
    PROFILE_CONFORMANCE_HOST_RUN_SCHEMA,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    profileCatalog,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA,
    NATIVE_HOST_CAPABILITY_SCHEMA,
    NATIVE_HOST_BRIDGE_SCHEMA,
    NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA,
    NATIVE_HOST_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
    NATIVE_HOST_SHELL_SCHEMA,
    NATIVE_HOST_SHELL_CHECK_SCHEMA,
    NATIVE_HOST_DEEP_LINK_SCHEMA,
    NATIVE_HOST_LOCAL_BUNDLE_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_SHELL_HOOK,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT,
    NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT,
    NATIVE_HOST_REQUIRED_SHELL_HOOKS,
    NATIVE_HOST_CAPABILITY_CALL_SCHEMA,
    NATIVE_HOST_BRIDGE_TRACE_SCHEMA,
    NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA,
    NATIVE_HOST_BRIDGE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_NONCE,
    NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED,
    NATIVE_HOST_FIRST_BATCH_STUB_IDS,
    NATIVE_HOST_LIFECYCLE_SCHEMA,
    NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY,
    NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP,
    NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT,
    NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS,
    NATIVE_HOST_FULLSTACK_SCHEMA,
    NATIVE_HOST_FULLSTACK_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER,
    NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY,
    NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT,
    NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY,
    NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE,
    NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS,
    NATIVE_HOST_MULTI_PLATFORM_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER,
    NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
    NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE,
    NATIVE_HOST_REQUIRED_MULTI_PLATFORMS,
    NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND,
    nativeHostCatalog,
    LOCALE_PROTOCOL,
    LOCALE_MANIFEST_SCHEMA,
    LOCALE_MESSAGE_CATALOG_SCHEMA,
    LOCALE_MESSAGE_NODE_SCHEMA,
    LOCALE_CHECK_SCHEMA,
    LOCALE_TYPED_MODULE_SCHEMA,
    LOCALE_RENAME_SCHEMA,
    LOCALE_APPLICATION_CONTEXT_SCHEMA,
    LOCALE_FORMATTER_CONTEXT_SCHEMA,
    LOCALE_TRANSITION_SCHEMA,
    LOCALE_RUNTIME_CHECK_SCHEMA,
    LOCALE_FALLBACK_RESOLUTION_SCHEMA,
    FORMATTER_DATA_VERSION,
    LOCALE_ROUTE_REALIZATION_SCHEMA,
    LOCALE_PAGE_META_SCHEMA,
    LOCALE_LINK_RESOLUTION_SCHEMA,
    LOCALE_ROUTER_CHECK_SCHEMA,
    LOCALE_DELIVERY_RESOLUTION_SCHEMA,
    LOCALE_CHUNK_MANIFEST_SCHEMA,
    LOCALE_NATIVE_PACK_SCHEMA,
    LOCALE_MINI_PACKAGE_PROOF_SCHEMA,
    LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA,
    LOCALE_DELIVERY_CHECK_SCHEMA,
    LOCALE_EXPLAIN_SCHEMA,
    LOCALE_DIFF_SCHEMA,
    LOCALE_EXTRACT_SCHEMA,
    LOCALE_PSEUDO_SCHEMA,
    LOCALE_CONFORMANCE_SCHEMA,
    LOCALE_DIAG_MANIFEST_MISSING,
    LOCALE_DIAG_ID_INVALID,
    LOCALE_DIAG_FALLBACK_CYCLE,
    LOCALE_DIAG_MESSAGE_PARAMETER_MISMATCH,
    LOCALE_DIAG_MESSAGE_UNUSED,
    LOCALE_DIAG_FORMATTER_CONTEXT_INCOMPLETE,
    LOCALE_DIAG_FORMATTER_VERSION_MISMATCH,
    LOCALE_DIAG_DIGEST_MISMATCH,
    LOCALE_DIAG_TRANSITION_PARTIAL,
    LOCALE_DIAG_TRANSITION_UNSUPPORTED,
    LOCALE_DIAG_TRANSITION_LOAD_FAILED,
    LOCALE_DIAG_MACHINE_DEFAULT_FORBIDDEN,
    LOCALE_DIAG_MESSAGE_MIXED_LOCALE,
    LOCALE_DIAG_STALE_GENERATION,
    LOCALE_DIAG_ROUTE_COLLISION,
    LOCALE_DIAG_CANONICAL_MISSING,
    LOCALE_DIAG_HREFLANG_INCOMPLETE,
    LOCALE_DIAG_META_LOCALE_MISMATCH,
    LOCALE_DIAG_LINK_HARDCODED_PATH,
    LOCALE_DIAG_CACHE_KEY_STEALS_CONTENT,
    LOCALE_DIAG_PREFIX_OMIT_WITHOUT_REDIRECT,
    LOCALE_DIAG_DELIVERY_FULL_BUNDLE,
    LOCALE_DIAG_CHUNK_HASH_MISMATCH,
    LOCALE_DIAG_NATIVE_PACK_UNSIGNED,
    LOCALE_DIAG_NATIVE_PACK_HAS_JS,
    LOCALE_DIAG_NATIVE_PACK_APP_MISMATCH,
    LOCALE_DIAG_MINI_CROSS_PACKAGE_UNPROVEN,
    LOCALE_DIAG_SERVER_TRANSLATED_ERROR,
    LOCALE_DIAG_SERVER_FORMAT_WITHOUT_CONTEXT,
    LOCALE_DIAG_HOST_MESSAGE_DIVERGENCE,
    LOCALE_DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED,
    LOCALE_DIAG_HARDCODED_TEXT,
    LOCALE_DIAG_PSEUDO_PRODUCTION_FORBIDDEN,
    LOCALE_DIAG_CONFORMANCE_DIVERGENCE,
    LOCALE_DIAG_EXPLAIN_UNKNOWN,
    LOCALE_VIRTUAL_MODULE_PREFIX,
    localeCatalog,
} from '@vmz/protocol';
import {
    HOST_PROTOCOL,
    COMPILER_PROTOCOL,
    PROGRAM_IR_SCHEMA,
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
    TARGET_PROTOCOL,
    TARGET_VIEW_OPS_SCHEMA,
    TARGET_PLATFORM_PROFILE_SCHEMA,
    TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA,
    TARGET_CHECK_SCHEMA,
    TARGET_DIAG_DOM_LEAK_IN_PLAN,
    targetCatalog,
    PROFILE_PROTOCOL,
    PROFILE_HOST_SCHEMA,
    PROFILE_DELIVERY_SCHEMA,
    PROFILE_CHECK_SCHEMA,
    PROFILE_DIAG_HOST_PROFILE_INVALID,
    PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH,
    PROFILE_DIAG_CORE_ID_OVERRIDE,
    PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED,
    PROFILE_SURFACE_KINDS,
    PROFILE_UNIFIED_LIFECYCLE_EVENTS,
    PROFILE_CORE_ID_PREFIX,
    PROFILE_SOLVER_CHECK_SCHEMA,
    PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA,
    PROFILE_EXECUTOR_CHECK_SCHEMA,
    PROFILE_EXECUTOR_SCENARIO_SCHEMA,
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
    PROFILE_LIFECYCLE_MAPPING_ENTRY_SCHEMA,
    PROFILE_LIFECYCLE_MAPPING_TABLE_SCHEMA,
    PROFILE_RECOVERY_POLICY_SCHEMA,
    PROFILE_LIFECYCLE_SCENARIO_SCHEMA,
    PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA,
    PROFILE_LIFECYCLE_HOST_KINDS,
    PROFILE_PERSISTENCE_WINDOWS,
    PROFILE_DIAG_LIFECYCLE_UNPROVEN,
    PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
    PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
    PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
    PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
    PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA,
    PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA,
    PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA,
    PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA,
    PROFILE_DELIVERY_PROOF_CHECK_SCHEMA,
    PROFILE_DELIVERY_UPDATE_CHANNELS,
    PROFILE_DELIVERY_ASSET_STRATEGIES,
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
    PROFILE_CONFORMANCE_FIXTURE_SCHEMA,
    PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA,
    PROFILE_CONFORMANCE_TRACE_SCHEMA,
    PROFILE_CONFORMANCE_HOST_RUN_SCHEMA,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    profileCatalog,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA,
    NATIVE_HOST_CAPABILITY_SCHEMA,
    NATIVE_HOST_BRIDGE_SCHEMA,
    NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA,
    NATIVE_HOST_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
    NATIVE_HOST_SHELL_SCHEMA,
    NATIVE_HOST_SHELL_CHECK_SCHEMA,
    NATIVE_HOST_DEEP_LINK_SCHEMA,
    NATIVE_HOST_LOCAL_BUNDLE_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_SHELL_HOOK,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT,
    NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT,
    NATIVE_HOST_REQUIRED_SHELL_HOOKS,
    NATIVE_HOST_CAPABILITY_CALL_SCHEMA,
    NATIVE_HOST_BRIDGE_TRACE_SCHEMA,
    NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA,
    NATIVE_HOST_BRIDGE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_NONCE,
    NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED,
    NATIVE_HOST_FIRST_BATCH_STUB_IDS,
    NATIVE_HOST_LIFECYCLE_SCHEMA,
    NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY,
    NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP,
    NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT,
    NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS,
    NATIVE_HOST_FULLSTACK_SCHEMA,
    NATIVE_HOST_FULLSTACK_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER,
    NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY,
    NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT,
    NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY,
    NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE,
    NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS,
    NATIVE_HOST_MULTI_PLATFORM_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER,
    NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
    NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE,
    NATIVE_HOST_REQUIRED_MULTI_PLATFORMS,
    NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND,
    nativeHostCatalog,
    LOCALE_PROTOCOL,
    LOCALE_MANIFEST_SCHEMA,
    LOCALE_MESSAGE_CATALOG_SCHEMA,
    LOCALE_MESSAGE_NODE_SCHEMA,
    LOCALE_CHECK_SCHEMA,
    LOCALE_TYPED_MODULE_SCHEMA,
    LOCALE_RENAME_SCHEMA,
    LOCALE_APPLICATION_CONTEXT_SCHEMA,
    LOCALE_FORMATTER_CONTEXT_SCHEMA,
    LOCALE_TRANSITION_SCHEMA,
    LOCALE_RUNTIME_CHECK_SCHEMA,
    LOCALE_FALLBACK_RESOLUTION_SCHEMA,
    FORMATTER_DATA_VERSION,
    LOCALE_ROUTE_REALIZATION_SCHEMA,
    LOCALE_PAGE_META_SCHEMA,
    LOCALE_LINK_RESOLUTION_SCHEMA,
    LOCALE_ROUTER_CHECK_SCHEMA,
    LOCALE_DELIVERY_RESOLUTION_SCHEMA,
    LOCALE_CHUNK_MANIFEST_SCHEMA,
    LOCALE_NATIVE_PACK_SCHEMA,
    LOCALE_MINI_PACKAGE_PROOF_SCHEMA,
    LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA,
    LOCALE_DELIVERY_CHECK_SCHEMA,
    LOCALE_EXPLAIN_SCHEMA,
    LOCALE_DIFF_SCHEMA,
    LOCALE_EXTRACT_SCHEMA,
    LOCALE_PSEUDO_SCHEMA,
    LOCALE_CONFORMANCE_SCHEMA,
    LOCALE_DIAG_MANIFEST_MISSING,
    LOCALE_DIAG_ID_INVALID,
    LOCALE_DIAG_FALLBACK_CYCLE,
    LOCALE_DIAG_MESSAGE_PARAMETER_MISMATCH,
    LOCALE_DIAG_MESSAGE_UNUSED,
    LOCALE_DIAG_FORMATTER_CONTEXT_INCOMPLETE,
    LOCALE_DIAG_FORMATTER_VERSION_MISMATCH,
    LOCALE_DIAG_DIGEST_MISMATCH,
    LOCALE_DIAG_TRANSITION_PARTIAL,
    LOCALE_DIAG_TRANSITION_UNSUPPORTED,
    LOCALE_DIAG_TRANSITION_LOAD_FAILED,
    LOCALE_DIAG_MACHINE_DEFAULT_FORBIDDEN,
    LOCALE_DIAG_MESSAGE_MIXED_LOCALE,
    LOCALE_DIAG_STALE_GENERATION,
    LOCALE_DIAG_ROUTE_COLLISION,
    LOCALE_DIAG_CANONICAL_MISSING,
    LOCALE_DIAG_HREFLANG_INCOMPLETE,
    LOCALE_DIAG_META_LOCALE_MISMATCH,
    LOCALE_DIAG_LINK_HARDCODED_PATH,
    LOCALE_DIAG_CACHE_KEY_STEALS_CONTENT,
    LOCALE_DIAG_PREFIX_OMIT_WITHOUT_REDIRECT,
    LOCALE_DIAG_DELIVERY_FULL_BUNDLE,
    LOCALE_DIAG_CHUNK_HASH_MISMATCH,
    LOCALE_DIAG_NATIVE_PACK_UNSIGNED,
    LOCALE_DIAG_NATIVE_PACK_HAS_JS,
    LOCALE_DIAG_NATIVE_PACK_APP_MISMATCH,
    LOCALE_DIAG_MINI_CROSS_PACKAGE_UNPROVEN,
    LOCALE_DIAG_SERVER_TRANSLATED_ERROR,
    LOCALE_DIAG_SERVER_FORMAT_WITHOUT_CONTEXT,
    LOCALE_DIAG_HOST_MESSAGE_DIVERGENCE,
    LOCALE_DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED,
    LOCALE_DIAG_HARDCODED_TEXT,
    LOCALE_DIAG_PSEUDO_PRODUCTION_FORBIDDEN,
    LOCALE_DIAG_CONFORMANCE_DIVERGENCE,
    LOCALE_DIAG_EXPLAIN_UNKNOWN,
    LOCALE_VIRTUAL_MODULE_PREFIX,
    localeCatalog,
} from '@vmz/protocol';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(here, '..');

/**
 * @returns {{ hostProtocol: string, compilerProtocol: string, programIrSchema: string, pluginProtocol: string }}
 */
export function expectedProtocol() {
    return {
        hostProtocol: HOST_PROTOCOL,
        compilerProtocol: COMPILER_PROTOCOL,
        programIrSchema: PROGRAM_IR_SCHEMA,
        pluginProtocol: PLUGIN_PROTOCOL,
    };
}

function platformTriple() {
    const { platform, arch } = process;
    if (platform === 'win32' && arch === 'x64') return 'win32-x64-msvc';
    if (platform === 'win32' && arch === 'arm64') return 'win32-arm64-msvc';
    if (platform === 'darwin' && arch === 'arm64') return 'darwin-arm64';
    if (platform === 'darwin' && arch === 'x64') return 'darwin-x64';
    if (platform === 'linux' && arch === 'x64') return 'linux-x64-gnu';
    if (platform === 'linux' && arch === 'arm64') return 'linux-arm64-gnu';
    return `${platform}-${arch}`;
}

/** npm optionalDependency short id (@vmz/vmz-win32-x64) from cargo triple */
function platformShort(triple = platformTriple()) {
    if (triple === 'win32-x64-msvc') return 'win32-x64';
    if (triple === 'win32-arm64-msvc') return 'win32-arm64';
    if (triple === 'linux-x64-gnu') return 'linux-x64';
    if (triple === 'linux-arm64-gnu') return 'linux-arm64';
    return triple;
}

/**
 * Resolve native `.node` via the platform optionalDependency
 * (`@vmz/vmz-<short>`; transitional fallback `@vmz/vmz-<short>`).
 * @returns {string}
 */
export function resolveNativePath() {
    const triple = platformTriple();
    const short = platformShort(triple);
    const names = [`@vmz/vmz-${short}`, `@vmz/vmz-${short}`];
    /** @type {string[]} */
    const candidates = [];
    for (const name of names) {
        try {
            const resolved = require.resolve(`${name}/package.json`);
            const dir = path.dirname(resolved);
            // Prefer platform-named binary; plain `vmz.node` is legacy-only.
            candidates.push(path.join(dir, `vmz.${triple}.node`), path.join(dir, 'vmz.node'));
        } catch {
            /* optional dep not installed */
        }
        // pnpm may nest under the @vmz/vmz package's node_modules
        candidates.push(path.join(pkgRoot, 'node_modules', name, `vmz.${triple}.node`), path.join(pkgRoot, 'node_modules', name, 'vmz.node'));
    }
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    throw new Error(
        `vmz native addon not found for @vmz/vmz-${short}. Run: pnpm napi:build (writes packages/runtimes/vmz-${short}/)\n` +
            `Looked in:\n${candidates.map((c) => `  - ${c}`).join('\n')}`,
    );
}

let _native;

/**
 * @returns {typeof import('./index.js') extends never ? any : any}
 */
export function loadNative() {
    if (_native) return _native;
    const addonPath = resolveNativePath();
    _native = require(addonPath);
    return _native;
}

/**
 * @typedef {object} ProtocolVersions
 * @property {string} hostProtocol
 * @property {string} compilerProtocol
 * @property {string} programIrSchema
 * @property {string} pluginProtocol
 */

/**
 * @returns {ProtocolVersions}
 */
export function getProtocolVersions() {
    const native = loadNative();
    const n = native.getProtocolVersions();
    return {
        hostProtocol: n.hostProtocol,
        compilerProtocol: n.compilerProtocol,
        programIrSchema: n.programIrSchema,
        pluginProtocol: n.pluginProtocol,
    };
}

/**
 * @param {ProtocolVersions} [host]
 */
export function handshake(host = expectedProtocol()) {
    const native = loadNative();
    native.handshakeProtocols({
        hostProtocol: host.hostProtocol,
        compilerProtocol: host.compilerProtocol,
        programIrSchema: host.programIrSchema,
        pluginProtocol: host.pluginProtocol,
    });
}

/**
 * Resolve `@vmz/core` package `dist/` for runtime JS copies into app outDir.
 * @returns {string | null}
 */
export function resolveCoreRuntimeDist() {
    try {
        // Prefer a real export subpath — `package.json` is often blocked by "exports".
        const serverJs = require.resolve('@vmz/core/server');
        return path.dirname(serverJs);
    } catch {
        /* not installed / not linked beside this host */
    }
    const nested = path.join(pkgRoot, 'node_modules', '@vmz', 'core', 'dist');
    if (existsSync(path.join(nested, 'server.js'))) return nested;
    return null;
}

/** Runtime companions required by dist/vmz-serve-host.mjs relative imports. */
export const SERVE_HOST_RUNTIME_FILES = [
    ['serve-host.mjs', 'vmz-serve-host.mjs'],
    ['native-addon.js', 'native-addon.js'],
    ['list-client-components.js', 'list-client-components.js'],
    ['deployment-registry.js', 'deployment-registry.js'],
    ['render-host.js', 'render-host.js'],
    ['route-layout-chain.js', 'route-layout-chain.js'],
];

/**
 * Copy serve-host + registry bootstrap modules from `@vmz/core` into app outDir.
 * @param {string} outDir
 * @param {string} [coreDist]
 */
export function materializeServeHostRuntime(outDir, coreDist = resolveCoreRuntimeDist()) {
    if (!coreDist) {
        throw new Error('materializeServeHostRuntime: @vmz/core dist not found');
    }
    for (const [srcName, outName] of SERVE_HOST_RUNTIME_FILES) {
        const src = path.join(coreDist, srcName);
        const dst = path.join(outDir, outName);
        if (!existsSync(src)) {
            throw new Error(`materializeServeHostRuntime: missing ${src}`);
        }
        copyFileSync(src, dst);
    }
}

/**
 * @typedef {object} WorkspaceOptions
 * @property {string} root
 * @property {string} [outDir]
 * @property {string} [runtimeDist]
 * @property {ProtocolVersions} [protocol]
 */

/**
 * Create a long-lived compile workspace .
 * @param {WorkspaceOptions} options
 */
export function createWorkspace(options) {
    const native = loadNative();
    const protocol = options.protocol ?? expectedProtocol();
    const runtimeDist = options.runtimeDist ?? resolveCoreRuntimeDist() ?? undefined;
    const ws = native.JsWorkspace.create({
        root: options.root,
        outDir: options.outDir,
        runtimeDist,
        protocol: {
            hostProtocol: protocol.hostProtocol,
            compilerProtocol: protocol.compilerProtocol,
            programIrSchema: protocol.programIrSchema,
            pluginProtocol: protocol.pluginProtocol,
        },
    });
    const pack = ws.lowerMiniprogramWechatPackaging.bind(ws);
    const wrappedPack = () => {
        materializeWechatPackaging(options.root);
        return pack();
    };
    try {
        ws.lowerMiniprogramWechatPackaging = wrappedPack;
        return ws;
    } catch {
        return new Proxy(ws, {
            get(target, prop, receiver) {
                if (prop === 'lowerMiniprogramWechatPackaging') return wrappedPack;
                const value = Reflect.get(target, prop, receiver);
                return typeof value === 'function' ? value.bind(target) : value;
            },
        });
    }
}

/**
 * frozen application composition protocol catalog.
 * @returns {string}
 */
export function queryApplicationProtocolCatalog() {
    const native = loadNative();
    return native.queryApplicationProtocolCatalog();
}

/**
 * check host applications.config.json5 against workspace package descriptors.
 * @param {string} hostRoot
 * @param {string[]} packageRoots
 * @returns {string} ApplicationCheckReport JSON
 */
export function checkApplicationsJson(hostRoot, packageRoots) {
    const native = loadNative();
    return native.checkApplicationsJson(hostRoot, packageRoots);
}

export function queryTargetProtocolCatalog() {
    const native = loadNative();
    return native.queryTargetProtocolCatalog();
}

export function checkMiniprogramTargetContractJson(rootPath) {
    const native = loadNative();
    return native.checkMiniprogramTargetContractJson(rootPath);
}

export function lowerMiniprogramStaticSliceJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramStaticSliceJson(rootPath);
}

export function lowerMiniprogramBindingEventJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramBindingEventJson(rootPath);
}

export function lowerMiniprogramStructureJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramStructureJson(rootPath);
}

export function lowerMiniprogramRouteServerStyleJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramRouteServerStyleJson(rootPath);
}

export function lowerMiniprogramToolingDeployJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramToolingDeployJson(rootPath);
}

export function lowerMiniprogramWechatPackagingJson(rootPath) {
    const native = loadNative();
    materializeWechatPackaging(rootPath);
    return native.lowerMiniprogramWechatPackagingJson(rootPath);
}

export function lowerMiniprogramMultiAdapterJson(rootPath) {
    const native = loadNative();
    return native.lowerMiniprogramMultiAdapterJson(rootPath);
}

import { createMiniHost } from './mini-host.js';
export { createMiniHost };

export function queryProfileProtocolCatalog() {
    const native = loadNative();
    return native.queryProfileProtocolCatalog();
}

export function checkHostProfileProtocolJson(rootPath) {
    const native = loadNative();
    return native.checkHostProfileProtocolJson(rootPath);
}

export function checkProfileSolverJson(rootPath) {
    const native = loadNative();
    return native.checkProfileSolverJson(rootPath);
}

export function checkUnifiedExecutorJson(rootPath) {
    const native = loadNative();
    return native.checkUnifiedExecutorJson(rootPath);
}

export function checkLifecycleRecoveryJson(rootPath) {
    const native = loadNative();
    return native.checkLifecycleRecoveryJson(rootPath);
}

export function checkDeliveryProofJson(rootPath) {
    const native = loadNative();
    return native.checkDeliveryProofJson(rootPath);
}

export function checkCrossHostConformanceJson(rootPath) {
    const native = loadNative();
    return native.checkCrossHostConformanceJson(rootPath);
}

export function queryNativeHostProtocolCatalog() {
    const native = loadNative();
    return native.queryNativeHostProtocolCatalog();
}

export function checkNativeHostContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeHostContractJson(rootPath);
}

export function checkNativeShellContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeShellContractJson(rootPath);
}

export function checkNativeBridgeContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeBridgeContractJson(rootPath);
}

export function checkNativeLifecycleContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeLifecycleContractJson(rootPath);
}

export function checkNativeFullstackContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeFullstackContractJson(rootPath);
}

export function checkNativeSurfaceContractJson(rootPath) {
    const native = loadNative();
    return native.checkNativeSurfaceContractJson(rootPath);
}

export function checkMultiPlatformContractJson(rootPath) {
    const native = loadNative();
    return native.checkMultiPlatformContractJson(rootPath);
}

/**
 * prove independent `/` + non-root ApplicationBase; scan non-relocatable URLs.
 * @param {string} packageRoot
 * @param {string} [relocateBase]
 * @returns {string}
 */
export function checkApplicationRelocatableJson(packageRoot, relocateBase) {
    const native = loadNative();
    return native.checkApplicationRelocatableJson(packageRoot, relocateBase ?? null);
}

/**
 * apply ApplicationBase to a logical relocation manifest.
 * @param {string} manifestJson
 * @param {string} base
 * @returns {string}
 */
export function relocateApplicationManifestJson(manifestJson, base) {
    const native = loadNative();
    return native.relocateApplicationManifestJson(manifestJson, base);
}

/**
 * independent ApplicationArtifact + MountTable/Catalog boundary (refs only).
 * @param {string} hostRoot
 * @param {string[]} packageRoots
 * @returns {string}
 */
export function checkApplicationArtifactBoundaryJson(hostRoot, packageRoots) {
    const native = loadNative();
    return native.checkApplicationArtifactBoundaryJson(hostRoot, packageRoots);
}

/**
 * absolute isolation namespaces + failure containment.
 * @param {string} hostRoot
 * @param {string[]} packageRoots
 * @returns {string}
 */
export function checkApplicationIsolationJson(hostRoot, packageRoots) {
    const native = loadNative();
    return native.checkApplicationIsolationJson(hostRoot, packageRoots);
}

/**
 * host catalog consumption + cross-application Link resolution.
 * @param {string} hostRoot
 * @param {string[]} packageRoots
 * @returns {string}
 */
export function checkApplicationHostCompositionJson(hostRoot, packageRoots) {
    const native = loadNative();
    return native.checkApplicationHostCompositionJson(hostRoot, packageRoots);
}

/**
 * multi-session affected rebuild + MountTable proxy + mounted tests + deploy adapter.
 * @param {string} hostRoot
 * @param {string[]} packageRoots
 * @param {string[]} [dirtyPaths]
 * @returns {string}
 */
export function checkApplicationDevTestDeployJson(hostRoot, packageRoots, dirtyPaths = []) {
    const native = loadNative();
    return native.checkApplicationDevTestDeployJson(hostRoot, packageRoots, dirtyPaths);
}

export { createDevSession, listWatchedFiles, srcFingerprint } from './dev-session.js';
export {
    coalesceRootBurst,
    collectDevWatchRoots,
    mergeDirtySets,
    localLinkDependencyRoots,
    watchRootForSourceFile,
} from './dev-watch-roots.js';
export { findAvailablePort } from './port.js';
export { runCli, parseArgs, printHelp, printGlobalHelp, printProjectHelp } from './cli.js';
export { createCli, formatDiagnostic, formatDiagnostics, t } from './toolchain-dx.js';
export type { LocalizePlugin } from './toolchain-dx.js';
export {
    VMZ_CLI_CATALOG_EN_US,
    createVmzCliLocalize,
    translateCatalog,
    vmzCliLocalize,
} from './toolchain-dx.js';
export {
    findNearestProjectVmz,
    getInvocationContext,
    isGlobalAllowedCommand,
    isUnderNodeModules,
    resolveThisPackageRoot,
    resolveVmzBin,
    gateGlobalProjectCommand,
} from './invocation.js';
export { resolveWorkspaceDirs, findPackageJson, readPackageMeta } from './resolve.js';
export { resolvePackageRoot, resolveWorkspacePackages } from './packages.js';
export { log } from './log.js';
export { cmdApplication, runCheck as runApplicationCheck } from './application-cmd.js';
export { cmdArtifact } from './release-cmd.js';
export {
    ARTIFACT_DIFF_SCHEMA,
    DELIVERY_ARTIFACT_MANIFEST_SCHEMA,
    RELEASE_ENVELOPE_SCHEMA,
    ROUTE_REALIZATION_TABLE_SCHEMA,
    atomicWritePointer,
    canonicalJson,
    diffArtifacts,
    loadReleaseEnvelope,
    packRelease,
    publishRelease,
    readPointer,
    rollbackRelease,
    sha256File,
    sha256Hex,
} from './release-pack.js';
// APPLICATION_ARTIFACT_SCHEMA lives in @vmz/protocol (already re-exported above);
// release-pack keeps a local constant for envelope writes — do not dual-export the name.
export {
    STATIC_DELIVERY_MANIFEST_SCHEMA,
    emitWebStatic,
} from './static-emit.js';
export {
    CONTENT_ADDRESSED_ASSETS_SCHEMA,
    emitContentAddressedAssets,
    resolveAssetByDigest,
    assertSharedAssetPath,
    contentAddressedAssetsDigest,
    rewriteCssImports,
    rewriteJsEntryRelativeImports,
} from './content-addressed-assets.js';
export {
    SITE_FAVICON_SCHEMA,
    emitSiteFavicon,
    readSiteFaviconHeadHtml,
    packPngsIntoIco,
} from './site-favicon.js';
export {
    PUBLIC_STATIC_ASSETS_SCHEMA,
    emitPublicStaticAssets,
} from './public-static-assets.js';
export {
    CDN_POLICY_MANIFEST_SCHEMA,
    CDN_ADAPTER_PROJECTION_SCHEMA,
    CACHE_HTML,
    CACHE_ASSET_IMMUTABLE,
    CACHE_META,
    buildCdnPolicyManifest,
    emitCdnPolicy,
    projectCdnAdapter,
    createLocalStaticHandler,
    listenLocalStaticHost,
    matchGlob,
} from './cdn-policy.js';
export {
    SITE_DELIVERY_CONTRACT_SCHEMA,
    SITE_DELIVERY_RESOLUTION_SCHEMA,
    defineSite,
    normalizeSiteDelivery,
    normalizeSourceProbe,
    resolveSiteRelease,
    probeReleaseDirectory,
    emitSiteDelivery,
} from './site-delivery.js';
export {
    EMBEDDED_RESOURCE_INDEX_SCHEMA,
    emitEmbeddedPackaging,
} from './embedded-packaging.js';
export {
    SERVER_LANG_IDS,
    SERVER_LANG_ALIASES,
    SERVER_LANGUAGE_BACKENDS,
    resolveServerLanguage,
    assertLangRuntimePair,
} from './server-language-backend.js';
export {
    WECHAT_PACKAGING_SCHEMA,
    WECHAT_PACKAGING_REL,
    wechatPackagingFromDelivery,
    materializeWechatPackaging,
} from './wechat-packaging.js';
export {
    DELIVERY_PROFILE_AUTHORING_SCHEMA,
    BUILD_PROFILE_SELECTION_SCHEMA,
    ASSEMBLIES,
    SERVER_RUNTIMES,
    BUILTIN_PROFILES,
    pickSiteAuthoring,
    pickDeliveryPackaging,
    normalizeProfileArtifactName,
    resolveProfileArtifactDir,
    normalizeDeliveryAuthoring,
    selectBuildProfile,
    semanticIdsForAssembly,
} from './delivery-profile.js';
export { PACK_MANIFEST_SCHEMA, packFromDeploymentIr, ensureRuntimeCompanions } from './pack.js';
export {
    SERVER_ARTIFACT_SCHEMA,
    HTTP_CONTRACT_SCHEMA,
    SERVER_RUNTIME_ADAPTER_SCHEMA,
    emitServerArtifact,
    projectServerRuntimeAdapter,
} from './server-artifact.js';
export {
    BUILD_PROOF_SCHEMA,
    ASSEMBLE_MANIFEST_SCHEMA,
    assembleDelivery,
    emitBuildProof,
} from './build-assemble.js';
export {
    PRODUCTION_SCENARIO_PACK_SCHEMA,
    PRODUCTION_CI_PROFILE_SCHEMA,
    PRODUCTION_TEST_REPORT_SCHEMA,
    browserProductionScenarioPack,
    browserProductionCiProfile,
    normalizeScenarioPack,
    normalizeCiProfile,
    scenarioPackDigest,
    ciProfileDigest,
    buildProductionTestReport,
    productionTestReportDigest,
    emitProductionTestArtifacts,
    assertNoForbiddenRunners,
} from './production-test-pack.js';
export {
    PRODUCTION_OBSERVABILITY_SCHEMA,
    PRODUCTION_TRACE_SCHEMA,
    REQUIRED_TRACE_FACETS,
    browserProductionObservability,
    normalizeObservability,
    redactSensitive,
    validateProductionTrace,
    buildCoveringProductionTrace,
    checkProductionBudgets,
    checkCapabilityClosure,
    applySecurityHeadersToCdnPolicy,
    measureDistBudgets,
    emitProductionObservability,
    observabilityDigest,
} from './production-observability.js';
export {
    buildApplicationContext,
    buildFormatterContext,
    checkLocaleRuntime,
    checkSsrClientParity,
    createLocaleSession,
    formatMessageTemplate,
    formatterContextDigest,
    negotiateLocale,
    resolveMessageVariant,
    validateFormatterContext,
} from './locale-runtime.js';
export {
    absoluteUrl,
    assertLocaleCacheKey,
    buildLocalePageMeta,
    buildLocaleRouteRealizationTable,
    checkLocaleRouter,
    commitLocaleRouteMetaTransition,
    localeAwareCacheKey,
    localizeBodyLinks,
    localizeSameAppHref,
    parseLocaleFromPath,
    planLocalePathNavigation,
    realizeRoutePath,
    resolveLinkHref,
} from './locale-router.js';
export {
    LOCALE_ROUTE_REALIZATION_ARTIFACT_SCHEMA,
    emitLocaleRouteRealization,
} from './locale-route-emit.js';
export {
    assertHostMessageInvariant,
    assertServerErrorEnvelope,
    assertServerFormatContext,
    buildLocaleDeliveryResolution,
    checkLocaleDelivery,
    fallbackDigest,
    messageCatalogHash,
    proveMiniPackageMessages,
    validateNativeLocalePack,
} from './locale-delivery.js';
export {
    checkLocaleConformance,
    diffLocaleCatalogs,
    explainLocaleMessage,
    extractHardcodedText,
    pseudoLocalizeCatalog,
} from './locale-tooling.js';
export {
    applyPlugins,
    contentHash,
    defineConfig,
    definePlugin,
    loadVmzConfig,
} from './plugin-host.js';
export {
    createRolldownPluginVmzAdapter,
    createVitePluginVmzAdapter,
    loadDeploymentIr,
    planAffectedBundleInputs,
    planBundleInputs,
} from './bundler-adapter.js';

export default {
    HOST_PROTOCOL,
    COMPILER_PROTOCOL,
    PROGRAM_IR_SCHEMA,
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
    expectedProtocol,
    resolveNativePath,
    resolveCoreRuntimeDist,
    materializeServeHostRuntime,
    SERVE_HOST_RUNTIME_FILES,
    loadNative,
    getProtocolVersions,
    handshake,
    createWorkspace,
    queryApplicationProtocolCatalog,
    checkApplicationsJson,
    queryTargetProtocolCatalog,
    checkMiniprogramTargetContractJson,
    lowerMiniprogramStaticSliceJson,
    lowerMiniprogramBindingEventJson,
    lowerMiniprogramStructureJson,
    lowerMiniprogramRouteServerStyleJson,
    lowerMiniprogramToolingDeployJson,
    lowerMiniprogramWechatPackagingJson,
    lowerMiniprogramMultiAdapterJson,
    createMiniHost,
    queryProfileProtocolCatalog,
    checkHostProfileProtocolJson,
    checkProfileSolverJson,
    checkUnifiedExecutorJson,
    checkLifecycleRecoveryJson,
    checkDeliveryProofJson,
    checkCrossHostConformanceJson,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA,
    PROFILE_DELIVERY_PROOF_CHECK_SCHEMA,
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
    PROFILE_CONFORMANCE_FIXTURE_SCHEMA,
    PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA,
    PROFILE_CONFORMANCE_TRACE_SCHEMA,
    PROFILE_CONFORMANCE_HOST_RUN_SCHEMA,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    PROFILE_LIFECYCLE_SCENARIO_SCHEMA,
    PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA,
    PROFILE_LIFECYCLE_HOST_KINDS,
    PROFILE_PERSISTENCE_WINDOWS,
    PROFILE_DIAG_LIFECYCLE_UNPROVEN,
    PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
    PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
    PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
    PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
    PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA,
    PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA,
    PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA,
    PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA,
    PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA,
    PROFILE_DELIVERY_PROOF_CHECK_SCHEMA,
    PROFILE_DELIVERY_UPDATE_CHANNELS,
    PROFILE_DELIVERY_ASSET_STRATEGIES,
    PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
    PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
    PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE,
    PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
    PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
    PROFILE_DIAG_SECURITY_POLICY_INSECURE,
    PROFILE_CONFORMANCE_FIXTURE_SCHEMA,
    PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA,
    PROFILE_CONFORMANCE_TRACE_SCHEMA,
    PROFILE_CONFORMANCE_HOST_RUN_SCHEMA,
    PROFILE_CONFORMANCE_SCENARIO_SCHEMA,
    PROFILE_CONFORMANCE_CHECK_SCHEMA,
    PROFILE_CONFORMANCE_SURFACE_ROLES,
    PROFILE_DIAG_STABLE_ID_DIVERGENCE,
    PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
    PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
    PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
    PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
    PROFILE_SOLVER_CHECK_SCHEMA,
    PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA,
    PROFILE_EXECUTOR_CHECK_SCHEMA,
    PROFILE_EXECUTOR_SCENARIO_SCHEMA,
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
    PROFILE_PROTOCOL,
    PROFILE_HOST_SCHEMA,
    PROFILE_DELIVERY_SCHEMA,
    PROFILE_CHECK_SCHEMA,
    PROFILE_DIAG_HOST_PROFILE_INVALID,
    PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH,
    PROFILE_DIAG_CORE_ID_OVERRIDE,
    PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED,
    PROFILE_SURFACE_KINDS,
    PROFILE_UNIFIED_LIFECYCLE_EVENTS,
    PROFILE_CORE_ID_PREFIX,
    PROFILE_SOLVER_CHECK_SCHEMA,
    PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA,
    PROFILE_EXECUTOR_CHECK_SCHEMA,
    PROFILE_EXECUTOR_SCENARIO_SCHEMA,
    PROFILE_DIAG_SURFACE_NO_MATCH,
    PROFILE_DIAG_SURFACE_AMBIGUOUS,
    PROFILE_DIAG_CAPABILITY_UNRESOLVED,
    PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED,
    PROFILE_DIAG_ROUTE_UNREALIZABLE,
    PROFILE_DIAG_STALE_GENERATION,
    PROFILE_DIAG_MISSING_ENVELOPE_IDS,
    PROFILE_DIAG_SURFACE_OWNS_STATE,
    PROFILE_DIAG_PRIVATE_OBJECT_CROSSING,
    PROFILE_DIAG_SPLIT_TRANSACTION,
    PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE,
    PROFILE_DIAG_CANCEL_NOT_PROPAGATED,
    profileCatalog,
    localeCatalog,
    queryNativeHostProtocolCatalog,
    checkNativeHostContractJson,
    checkNativeShellContractJson,
    checkNativeBridgeContractJson,
    checkNativeLifecycleContractJson,
    checkNativeFullstackContractJson,
    checkNativeSurfaceContractJson,
    checkMultiPlatformContractJson,
    NATIVE_HOST_PROTOCOL,
    NATIVE_HOST_NATIVE_SURFACE_SCHEMA,
    NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY,
    NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE,
    NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS,
    NATIVE_HOST_MULTI_PLATFORM_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA,
    NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER,
    NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
    NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE,
    NATIVE_HOST_REQUIRED_MULTI_PLATFORMS,
    NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND,
    NATIVE_HOST_FULLSTACK_SCHEMA,
    NATIVE_HOST_FULLSTACK_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER,
    NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY,
    NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT,
    NATIVE_HOST_LIFECYCLE_SCHEMA,
    NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY,
    NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP,
    NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT,
    NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS,
    NATIVE_HOST_CAPABILITY_CALL_SCHEMA,
    NATIVE_HOST_BRIDGE_TRACE_SCHEMA,
    NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA,
    NATIVE_HOST_BRIDGE_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_NONCE,
    NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED,
    NATIVE_HOST_FIRST_BATCH_STUB_IDS,
    NATIVE_HOST_SHELL_SCHEMA,
    NATIVE_HOST_SHELL_CHECK_SCHEMA,
    NATIVE_HOST_DEEP_LINK_SCHEMA,
    NATIVE_HOST_LOCAL_BUNDLE_SCHEMA,
    NATIVE_HOST_DIAG_MISSING_SHELL_HOOK,
    NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
    NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT,
    NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT,
    NATIVE_HOST_REQUIRED_SHELL_HOOKS,
    NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA,
    NATIVE_HOST_CAPABILITY_SCHEMA,
    NATIVE_HOST_BRIDGE_SCHEMA,
    NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA,
    NATIVE_HOST_CHECK_SCHEMA,
    NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
    nativeHostCatalog,
    TARGET_PROTOCOL,
    TARGET_VIEW_OPS_SCHEMA,
    TARGET_PLATFORM_PROFILE_SCHEMA,
    TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA,
    TARGET_CHECK_SCHEMA,
    targetCatalog,
    checkApplicationRelocatableJson,
    relocateApplicationManifestJson,
    checkApplicationArtifactBoundaryJson,
    checkApplicationIsolationJson,
    checkApplicationHostCompositionJson,
    checkApplicationDevTestDeployJson,
};
