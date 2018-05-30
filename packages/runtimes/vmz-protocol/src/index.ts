/** VMZ versioned wire protocols. */

/** Umbrella catalog schema. */
export const PROTOCOL_CATALOG_SCHEMA = 'vmz.protocol.v0';

export const HOST_PROTOCOL = '0.1.0';
export const COMPILER_PROTOCOL = '0.1.0';
export const PROGRAM_IR_SCHEMA = 'vmz.program.v0';
export const PLAN_SCHEMA = 'vmz.plan.v0';

export const TARGET_PROTOCOL = 'vmz.target.protocol.v0';

export const PROFILE_PROTOCOL = 'vmz.profile.protocol.v0';
export const PROFILE_HOST_SCHEMA = 'vmz.profile.host.v0';
export const PROFILE_DELIVERY_SCHEMA = 'vmz.profile.delivery.v0';
export const PROFILE_SURFACE_BINDING_SCHEMA = 'vmz.profile.surface_binding.v0';
export const PROFILE_CAPABILITY_BINDING_SCHEMA = 'vmz.profile.capability_binding.v0';
export const PROFILE_LIFECYCLE_BINDING_SCHEMA = 'vmz.profile.lifecycle_binding.v0';
export const PROFILE_NAVIGATION_BINDING_SCHEMA = 'vmz.profile.navigation_binding.v0';
export const PROFILE_TRANSPORT_BINDING_SCHEMA = 'vmz.profile.transport_binding.v0';
export const PROFILE_HOST_CONSTRAINTS_SCHEMA = 'vmz.profile.host_constraints.v0';
export const PROFILE_RESOLUTION_DIGEST_SCHEMA = 'vmz.profile.resolution_digest.v0';
export const PROFILE_CONTRIBUTION_SCHEMA = 'vmz.profile.contribution.v0';
export const PROFILE_CHECK_SCHEMA = 'vmz.profile.check.v0';
export const PROFILE_DIAG_HOST_PROFILE_INVALID = 'vmz::profile::host_profile_invalid';
export const PROFILE_DIAG_DELIVERY_PROFILE_INVALID = 'vmz::profile::delivery_profile_invalid';
export const PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED = 'vmz::profile::host_profile_ref_unresolved';
export const PROFILE_DIAG_RESOLUTION_DIGEST_MISSING = 'vmz::profile::resolution_digest_missing';
export const PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH = 'vmz::profile::resolution_digest_mismatch';
export const PROFILE_DIAG_CORE_ID_OVERRIDE = 'vmz::profile::core_id_override';
export const PROFILE_DIAG_CONTRIBUTION_NOT_NAMESPACED = 'vmz::profile::contribution_not_namespaced';
export const PROFILE_DIAG_PROFILE_VERSION_INVALID = 'vmz::profile::profile_version_invalid';
export const PROFILE_SURFACE_KINDS = ['web', 'template', 'native', 'headless'];
export const PROFILE_UNIFIED_LIFECYCLE_EVENTS = ['activate', 'visible', 'hidden', 'suspend', 'resume', 'recover', 'dispose'];
export const PROFILE_CORE_ID_PREFIX = 'vmz.';
export const PROFILE_SURFACE_REQUIREMENTS_SCHEMA = 'vmz.profile.surface_requirements.v0';
export const PROFILE_CAPABILITY_REQUIREMENT_SCHEMA = 'vmz.profile.capability_requirement.v0';
export const PROFILE_SURFACE_ASSIGNMENT_TABLE_SCHEMA = 'vmz.profile.surface_assignment_table.v0';
export const PROFILE_CAPABILITY_RESOLUTION_TABLE_SCHEMA = 'vmz.profile.capability_resolution_table.v0';
export const PROFILE_ROUTE_REALIZATION_TABLE_SCHEMA = 'vmz.profile.route_realization_table.v0';
export const PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA = 'vmz.profile.host_resolution_manifest.v0';
export const PROFILE_SOLVER_INPUT_SCHEMA = 'vmz.profile.solver_input.v0';
export const PROFILE_SOLVER_CHECK_SCHEMA = 'vmz.profile.solver_check.v0';
export const PROFILE_EXECUTOR_ENVELOPE_HEADER_SCHEMA = 'vmz.profile.executor_envelope_header.v0';
export const PROFILE_EVENT_ENVELOPE_SCHEMA = 'vmz.profile.event_envelope.v0';
export const PROFILE_EXECUTOR_TRANSACTION_SCHEMA = 'vmz.profile.executor_transaction.v0';
export const PROFILE_PATCH_BATCH_SCHEMA = 'vmz.profile.patch_batch.v0';
export const PROFILE_DISPOSE_REGION_SCHEMA = 'vmz.profile.dispose_region.v0';
export const PROFILE_CANCEL_REQUEST_SCHEMA = 'vmz.profile.cancel_request.v0';
export const PROFILE_EXECUTOR_SCENARIO_SCHEMA = 'vmz.profile.executor_scenario.v0';
export const PROFILE_EXECUTOR_CHECK_SCHEMA = 'vmz.profile.executor_check.v0';
export const PROFILE_DIAG_SURFACE_NO_MATCH = 'vmz::profile::surface_no_match';
export const PROFILE_DIAG_SURFACE_AMBIGUOUS = 'vmz::profile::surface_ambiguous';
export const PROFILE_DIAG_CAPABILITY_UNRESOLVED = 'vmz::profile::capability_unresolved';
export const PROFILE_DIAG_CAPABILITY_PERMISSION_UNDECLARED = 'vmz::profile::capability_permission_undeclared';
export const PROFILE_DIAG_ROUTE_UNREALIZABLE = 'vmz::profile::route_unrealizable';
export const PROFILE_DIAG_STALE_GENERATION = 'vmz::profile::stale_generation';
export const PROFILE_DIAG_MISSING_ENVELOPE_IDS = 'vmz::profile::missing_envelope_ids';
export const PROFILE_DIAG_SURFACE_OWNS_STATE = 'vmz::profile::surface_owns_state';
export const PROFILE_DIAG_PRIVATE_OBJECT_CROSSING = 'vmz::profile::private_object_crossing';
export const PROFILE_DIAG_SPLIT_TRANSACTION = 'vmz::profile::split_transaction';
export const PROFILE_DIAG_DISPOSE_NOT_AUTHORITATIVE = 'vmz::profile::dispose_not_authoritative';
export const PROFILE_DIAG_CANCEL_NOT_PROPAGATED = 'vmz::profile::cancel_not_propagated';
export const PROFILE_LIFECYCLE_MAPPING_ENTRY_SCHEMA = 'vmz.profile.lifecycle_mapping_entry.v0';
export const PROFILE_LIFECYCLE_MAPPING_TABLE_SCHEMA = 'vmz.profile.lifecycle_mapping_table.v0';
export const PROFILE_RECOVERY_POLICY_SCHEMA = 'vmz.profile.recovery_policy.v0';
export const PROFILE_LIFECYCLE_SCENARIO_SCHEMA = 'vmz.profile.lifecycle_scenario.v0';
export const PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA = 'vmz.profile.lifecycle_recovery_check.v0';
export const PROFILE_LIFECYCLE_HOST_KINDS = ['browser', 'mini', 'native'];
export const PROFILE_PERSISTENCE_WINDOWS = ['none', 'suspend', 'crash', 'owner'];
export const PROFILE_DIAG_LIFECYCLE_UNPROVEN = 'vmz::profile::lifecycle_unproven';
export const PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE = 'vmz::profile::lifecycle_mapping_incomplete';
export const PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER = 'vmz::profile::recovery_duplicates_owner';
export const PROFILE_DIAG_RECOVERY_ASSUMES_HEAP = 'vmz::profile::recovery_assumes_heap';
export const PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID = 'vmz::profile::persistence_window_invalid';
export const PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA = 'vmz.profile.delivery_package_constraints.v0';
export const PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA = 'vmz.profile.delivery_security_policy.v0';
export const PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA = 'vmz.profile.delivery_update_policy.v0';
export const PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA = 'vmz.profile.delivery_artifact_manifest.v0';
export const PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA = 'vmz.profile.delivery_proof_manifest.v0';
export const PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA = 'vmz.profile.delivery_proof_scenario.v0';
export const PROFILE_DELIVERY_PROOF_CHECK_SCHEMA = 'vmz.profile.delivery_proof_check.v0';
export const PROFILE_DELIVERY_UPDATE_CHANNELS = ['rebuild', 'store', 'hot', 'hybrid'];
export const PROFILE_DELIVERY_ASSET_STRATEGIES = ['bundled', 'remote', 'hybrid'];
export const PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED = 'vmz::profile::delivery_constraint_exceeded';
export const PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH = 'vmz::profile::host_plan_version_mismatch';
export const PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE = 'vmz::profile::proof_manifest_incomplete';
export const PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR = 'vmz::profile::proof_copies_semantic_ir';
export const PROFILE_DIAG_UPDATE_WITHOUT_REPROOF = 'vmz::profile::update_without_reproof';
export const PROFILE_DIAG_SECURITY_POLICY_INSECURE = 'vmz::profile::security_policy_insecure';
export const PROFILE_CONFORMANCE_FIXTURE_SCHEMA = 'vmz.profile.conformance_fixture.v0';
export const PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA = 'vmz.profile.conformance_state_snapshot.v0';
export const PROFILE_CONFORMANCE_TRACE_SCHEMA = 'vmz.profile.conformance_trace.v0';
export const PROFILE_CONFORMANCE_HOST_RUN_SCHEMA = 'vmz.profile.conformance_host_run.v0';
export const PROFILE_CONFORMANCE_SCENARIO_SCHEMA = 'vmz.profile.conformance_scenario.v0';
export const PROFILE_CONFORMANCE_CHECK_SCHEMA = 'vmz.profile.conformance_check.v0';
export const PROFILE_CONFORMANCE_SURFACE_ROLES = ['web', 'template', 'mixed'];
export const PROFILE_DIAG_STABLE_ID_DIVERGENCE = 'vmz::profile::stable_id_divergence';
export const PROFILE_DIAG_STATE_RESULT_DIVERGENCE = 'vmz::profile::state_result_divergence';
export const PROFILE_DIAG_TRACE_INVARIANT_BROKEN = 'vmz::profile::trace_invariant_broken';
export const PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE = 'vmz::profile::conformance_host_incomplete';
export const PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH = 'vmz::profile::conformance_surface_role_mismatch';

export const TARGET_VIEW_OPS_SCHEMA = 'vmz.target.view_ops.v0';
export const TARGET_PLATFORM_PROFILE_SCHEMA = 'vmz.target.platform_profile.v0';
export const TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA = 'vmz.target.mini_program_artifact.v0';
export const TARGET_CHECK_SCHEMA = 'vmz.target.check.v0';
export const TARGET_DIAG_DOM_LEAK_IN_PLAN = 'vmz::target::dom_leak_in_plan';
export const TARGET_DIAG_UNKNOWN_VIEW_OP = 'vmz::target::unknown_view_op';

export const LOCALE_PROTOCOL = 'vmz.locale.protocol.v0';
export const LOCALE_MANIFEST_SCHEMA = 'vmz.locale.manifest.v0';
export const LOCALE_MESSAGE_CATALOG_SCHEMA = 'vmz.locale.message_catalog.v0';
export const LOCALE_MESSAGE_NODE_SCHEMA = 'vmz.locale.message_node.v0';
export const LOCALE_CHECK_SCHEMA = 'vmz.locale.check.v0';
export const LOCALE_TYPED_MODULE_SCHEMA = 'vmz.locale.typed_module.v0';
export const LOCALE_RENAME_SCHEMA = 'vmz.locale.rename.v0';
export const LOCALE_APPLICATION_CONTEXT_SCHEMA = 'vmz.locale.application_context.v0';
export const LOCALE_FORMATTER_CONTEXT_SCHEMA = 'vmz.locale.formatter_context.v0';
export const LOCALE_TRANSITION_SCHEMA = 'vmz.locale.transition.v0';
export const LOCALE_RUNTIME_CHECK_SCHEMA = 'vmz.locale.runtime_check.v0';
export const LOCALE_FALLBACK_RESOLUTION_SCHEMA = 'vmz.locale.fallback_resolution.v0';
export const LOCALE_ROUTE_REALIZATION_SCHEMA = 'vmz.locale.route_realization.v0';
export const LOCALE_PAGE_META_SCHEMA = 'vmz.locale.page_meta.v0';
export const LOCALE_LINK_RESOLUTION_SCHEMA = 'vmz.locale.link_resolution.v0';
export const LOCALE_ROUTER_CHECK_SCHEMA = 'vmz.locale.router_check.v0';
export const LOCALE_DELIVERY_RESOLUTION_SCHEMA = 'vmz.locale.delivery_resolution.v0';
export const LOCALE_CHUNK_MANIFEST_SCHEMA = 'vmz.locale.chunk_manifest.v0';
export const LOCALE_NATIVE_PACK_SCHEMA = 'vmz.locale.native_pack.v0';
export const LOCALE_MINI_PACKAGE_PROOF_SCHEMA = 'vmz.locale.mini_package_proof.v0';
export const LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA = 'vmz.locale.server_error_envelope.v0';
export const LOCALE_DELIVERY_CHECK_SCHEMA = 'vmz.locale.delivery_check.v0';
export const LOCALE_EXPLAIN_SCHEMA = 'vmz.locale.explain.v0';
export const LOCALE_DIFF_SCHEMA = 'vmz.locale.diff.v0';
export const LOCALE_EXTRACT_SCHEMA = 'vmz.locale.extract.v0';
export const LOCALE_PSEUDO_SCHEMA = 'vmz.locale.pseudo.v0';
export const LOCALE_CONFORMANCE_SCHEMA = 'vmz.locale.conformance.v0';
export const FORMATTER_DATA_VERSION = 'vmz.formatter.cldr.v0';
export const LOCALE_DIAG_MANIFEST_MISSING = 'vmz::locale::manifest_missing';
export const LOCALE_DIAG_ID_INVALID = 'vmz::locale::id_invalid';
export const LOCALE_DIAG_ID_COLLISION = 'vmz::locale::id_collision';
export const LOCALE_DIAG_DEFAULT_MISSING = 'vmz::locale::default_missing';
export const LOCALE_DIAG_FALLBACK_CYCLE = 'vmz::locale::fallback_cycle';
export const LOCALE_DIAG_FALLBACK_UNKNOWN = 'vmz::locale::fallback_unknown';
export const LOCALE_DIAG_DIR_ORPHAN = 'vmz::locale::dir_orphan';
export const LOCALE_DIAG_DIR_MISSING = 'vmz::locale::dir_missing';
export const LOCALE_DIAG_LAYOUT_ILLEGAL = 'vmz::locale::layout_illegal';
export const LOCALE_DIAG_MESSAGE_MISSING_DEFAULT = 'vmz::locale::message_missing_default';
export const LOCALE_DIAG_MESSAGE_MISSING_VARIANT = 'vmz::locale::message_missing_variant';
export const LOCALE_DIAG_MESSAGE_PARAMETER_MISMATCH = 'vmz::locale::message_parameter_mismatch';
export const LOCALE_DIAG_MESSAGE_SYNTAX_INVALID = 'vmz::locale::message_syntax_invalid';
export const LOCALE_DIAG_MESSAGE_ARRAY_FORBIDDEN = 'vmz::locale::message_array_forbidden';
export const LOCALE_DIAG_MESSAGE_UNUSED = 'vmz::locale::message_unused';
export const LOCALE_DIAG_MESSAGE_HTML_FORBIDDEN = 'vmz::locale::message_html_forbidden';
export const LOCALE_DIAG_CATALOG_PARSE = 'vmz::locale::catalog_parse';
export const LOCALE_DIAG_CATALOG_CONFLICT = 'vmz::locale::catalog_conflict';
export const LOCALE_DIAG_FORMATTER_CONTEXT_INCOMPLETE = 'vmz::locale::formatter_context_incomplete';
export const LOCALE_DIAG_FORMATTER_VERSION_MISMATCH = 'vmz::locale::formatter_version_mismatch';
export const LOCALE_DIAG_DIGEST_MISMATCH = 'vmz::locale::digest_mismatch';
export const LOCALE_DIAG_TRANSITION_PARTIAL = 'vmz::locale::transition_partial';
export const LOCALE_DIAG_TRANSITION_UNSUPPORTED = 'vmz::locale::transition_unsupported';
export const LOCALE_DIAG_TRANSITION_LOAD_FAILED = 'vmz::locale::transition_load_failed';
export const LOCALE_DIAG_MACHINE_DEFAULT_FORBIDDEN = 'vmz::locale::machine_default_forbidden';
export const LOCALE_DIAG_MESSAGE_MIXED_LOCALE = 'vmz::locale::message_mixed_locale';
export const LOCALE_DIAG_STALE_GENERATION = 'vmz::locale::stale_generation';
export const LOCALE_DIAG_ROUTE_COLLISION = 'vmz::locale::route_collision';
export const LOCALE_DIAG_CANONICAL_MISSING = 'vmz::locale::canonical_missing';
export const LOCALE_DIAG_HREFLANG_INCOMPLETE = 'vmz::locale::hreflang_incomplete';
export const LOCALE_DIAG_META_LOCALE_MISMATCH = 'vmz::locale::meta_locale_mismatch';
export const LOCALE_DIAG_LINK_HARDCODED_PATH = 'vmz::locale::link_hardcoded_path';
export const LOCALE_DIAG_CACHE_KEY_STEALS_CONTENT = 'vmz::locale::cache_key_steals_content';
export const LOCALE_DIAG_PREFIX_OMIT_WITHOUT_REDIRECT = 'vmz::locale::prefix_omit_without_redirect';
export const LOCALE_DIAG_DELIVERY_FULL_BUNDLE = 'vmz::locale::delivery_full_bundle';
export const LOCALE_DIAG_CHUNK_HASH_MISMATCH = 'vmz::locale::chunk_hash_mismatch';
export const LOCALE_DIAG_NATIVE_PACK_UNSIGNED = 'vmz::locale::native_pack_unsigned';
export const LOCALE_DIAG_NATIVE_PACK_HAS_JS = 'vmz::locale::native_pack_has_js';
export const LOCALE_DIAG_NATIVE_PACK_APP_MISMATCH = 'vmz::locale::native_pack_app_mismatch';
export const LOCALE_DIAG_MINI_CROSS_PACKAGE_UNPROVEN = 'vmz::locale::mini_cross_package_unproven';
export const LOCALE_DIAG_SERVER_TRANSLATED_ERROR = 'vmz::locale::server_translated_error';
export const LOCALE_DIAG_SERVER_FORMAT_WITHOUT_CONTEXT = 'vmz::locale::server_format_without_context';
export const LOCALE_DIAG_HOST_MESSAGE_DIVERGENCE = 'vmz::locale::host_message_divergence';
export const LOCALE_DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED = 'vmz::locale::message_dynamic_id_unbounded';
export const LOCALE_DIAG_HARDCODED_TEXT = 'vmz::locale::hardcoded_text';
export const LOCALE_DIAG_PSEUDO_PRODUCTION_FORBIDDEN = 'vmz::locale::pseudo_production_forbidden';
export const LOCALE_DIAG_CONFORMANCE_DIVERGENCE = 'vmz::locale::conformance_divergence';
export const LOCALE_DIAG_EXPLAIN_UNKNOWN = 'vmz::locale::explain_unknown';
export const LOCALE_VIRTUAL_MODULE_PREFIX = '#locales/';

export const NATIVE_HOST_PROTOCOL = 'vmz.native_host.protocol.v0';
export const NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA = 'vmz.native_host.webview_deployment.v0';
export const NATIVE_HOST_CAPABILITY_SCHEMA = 'vmz.native_host.capability.v0';
export const NATIVE_HOST_BRIDGE_SCHEMA = 'vmz.native_host.bridge.v0';
export const NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA = 'vmz.native_host.application_identity.v0';
export const NATIVE_HOST_CHECK_SCHEMA = 'vmz.native_host.check.v0';
export const NATIVE_HOST_DIAG_ARBITRARY_BRIDGE = 'vmz::native_host::arbitrary_bridge';
export const NATIVE_HOST_DIAG_MISSING_IDENTITY = 'vmz::native_host::missing_identity';
export const NATIVE_HOST_DIAG_MISSING_ALLOWLIST = 'vmz::native_host::missing_allowlist';
export const NATIVE_HOST_DIAG_UNSUPPORTED_CAPABILITY = 'vmz::native_host::unsupported_capability';
export const NATIVE_HOST_DIAG_INVALID_PROFILE = 'vmz::native_host::invalid_profile';
export const NATIVE_HOST_DIAG_REMOTE_URL_DEFAULT = 'vmz::native_host::remote_url_default';
export const NATIVE_HOST_SHELL_SCHEMA = 'vmz.native_host.shell.v0';
export const NATIVE_HOST_SHELL_CHECK_SCHEMA = 'vmz.native_host.shell_check.v0';
export const NATIVE_HOST_DEEP_LINK_SCHEMA = 'vmz.native_host.deep_link.v0';
export const NATIVE_HOST_LOCAL_BUNDLE_SCHEMA = 'vmz.native_host.local_bundle.v0';
export const NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT = 'vmz::native_host::missing_entry_artifact';
export const NATIVE_HOST_DIAG_MISSING_SHELL_HOOK = 'vmz::native_host::missing_shell_hook';
export const NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK = 'vmz::native_host::platform_semantic_fork';
export const NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT = 'vmz::native_host::remote_entry_default';
export const NATIVE_HOST_DIAG_MISSING_DEEP_LINK = 'vmz::native_host::missing_deep_link';
export const NATIVE_HOST_DIAG_MISSING_LOG_POLICY = 'vmz::native_host::missing_log_policy';
export const NATIVE_HOST_REQUIRED_SHELL_HOOKS = ['load', 'error', 'exit', 'deepLink', 'log'];
export const NATIVE_HOST_CAPABILITY_CALL_SCHEMA = 'vmz.native_host.capability_call.v0';
export const NATIVE_HOST_BRIDGE_TRACE_SCHEMA = 'vmz.native_host.bridge_trace.v0';
export const NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA = 'vmz.native_host.bridge_stub_catalog.v0';
export const NATIVE_HOST_BRIDGE_CHECK_SCHEMA = 'vmz.native_host.bridge_check.v0';
export const NATIVE_HOST_DIAG_MISSING_NONCE = 'vmz::native_host::missing_nonce';
export const NATIVE_HOST_DIAG_MISSING_ORIGIN = 'vmz::native_host::missing_origin';
export const NATIVE_HOST_DIAG_MISSING_PERMISSION = 'vmz::native_host::missing_permission';
export const NATIVE_HOST_DIAG_MISSING_CANCEL = 'vmz::native_host::missing_cancel';
export const NATIVE_HOST_DIAG_MISSING_TRACE = 'vmz::native_host::missing_trace';
export const NATIVE_HOST_DIAG_MISSING_TIMEOUT = 'vmz::native_host::missing_timeout';
export const NATIVE_HOST_DIAG_UNKNOWN_STUB = 'vmz::native_host::unknown_stub';
export const NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED = 'vmz::native_host::call_not_allowlisted';
export const NATIVE_HOST_FIRST_BATCH_STUB_IDS = ['camera.capture', 'file.pick', 'share.send', 'storage.get', 'storage.set'];
export const NATIVE_HOST_LIFECYCLE_SCHEMA = 'vmz.native_host.lifecycle.v0';
export const NATIVE_HOST_PERSISTENCE_SCHEMA = 'vmz.native_host.persistence.v0';
export const NATIVE_HOST_UPDATE_POLICY_SCHEMA = 'vmz.native_host.update_policy.v0';
export const NATIVE_HOST_OFFLINE_POLICY_SCHEMA = 'vmz.native_host.offline_policy.v0';
export const NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA = 'vmz.native_host.lifecycle_check.v0';
export const NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT = 'vmz::native_host::missing_lifecycle_event';
export const NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY = 'vmz::native_host::background_is_destroy';
export const NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP = 'vmz::native_host::crash_assumes_js_heap';
export const NATIVE_HOST_DIAG_MISSING_PERSISTENCE = 'vmz::native_host::missing_persistence';
export const NATIVE_HOST_DIAG_MISSING_UPDATE_POLICY = 'vmz::native_host::missing_update_policy';
export const NATIVE_HOST_DIAG_MISSING_OFFLINE_POLICY = 'vmz::native_host::missing_offline_policy';
export const NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS = [
    'launch',
    'create',
    'load',
    'ready',
    'background',
    'foreground',
    'crash',
    'restore',
    'destroy',
];
export const NATIVE_HOST_FULLSTACK_SCHEMA = 'vmz.native_host.fullstack.v0';
export const NATIVE_HOST_SSR_FIRST_PAINT_SCHEMA = 'vmz.native_host.ssr_first_paint.v0';
export const NATIVE_HOST_SERVER_TRANSPORT_SCHEMA = 'vmz.native_host.server_transport.v0';
export const NATIVE_HOST_AUTH_SESSION_SCHEMA = 'vmz.native_host.auth_session.v0';
export const NATIVE_HOST_PUSH_POLICY_SCHEMA = 'vmz.native_host.push_policy.v0';
export const NATIVE_HOST_NETWORK_POLICY_SCHEMA = 'vmz.native_host.network_policy.v0';
export const NATIVE_HOST_FULLSTACK_CHECK_SCHEMA = 'vmz.native_host.fullstack_check.v0';
export const NATIVE_HOST_DIAG_MISSING_SSR_FIRST_PAINT = 'vmz::native_host::missing_ssr_first_paint';
export const NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT = 'vmz::native_host::missing_server_transport';
export const NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER = 'vmz::native_host::bridge_bypasses_server';
export const NATIVE_HOST_DIAG_MISSING_AUTH_SESSION = 'vmz::native_host::missing_auth_session';
export const NATIVE_HOST_DIAG_MISSING_NETWORK_POLICY = 'vmz::native_host::missing_network_policy';
export const NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY = 'vmz::native_host::remote_without_integrity';
export const NATIVE_HOST_DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS = 'vmz::native_host::mixed_ssr_cookie_assumptions';
export const NATIVE_HOST_NATIVE_SURFACE_SCHEMA = 'vmz.native_host.native_surface.v0';
export const NATIVE_HOST_NATIVE_SURFACE_ID_SCHEMA = 'vmz.native_host.native_surface_id.v0';
export const NATIVE_HOST_NATIVE_SURFACE_BOUNDARY_SCHEMA = 'vmz.native_host.native_surface_boundary.v0';
export const NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA = 'vmz.native_host.native_surface_check.v0';
export const NATIVE_HOST_DIAG_MISSING_SURFACE_ID = 'vmz::native_host::missing_surface_id';
export const NATIVE_HOST_DIAG_MISSING_OWNER_REGION = 'vmz::native_host::missing_owner_region';
export const NATIVE_HOST_DIAG_MISSING_SURFACE_LIFETIME = 'vmz::native_host::missing_surface_lifetime';
export const NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE = 'vmz::native_host::implicit_state_share';
export const NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY = 'vmz::native_host::surface_is_capability';
export const NATIVE_HOST_DIAG_SURFACE_IS_SEMANTIC_TRUTH = 'vmz::native_host::surface_is_semantic_truth';
export const NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS = ['camera', 'map', 'video'];
export const NATIVE_HOST_MULTI_PLATFORM_SCHEMA = 'vmz.native_host.multi_platform.v0';
export const NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA = 'vmz.native_host.multi_platform_shared.v0';
export const NATIVE_HOST_MULTI_PLATFORM_ADAPTER_SCHEMA = 'vmz.native_host.multi_platform_adapter.v0';
export const NATIVE_HOST_MULTI_PLATFORM_TEST_SCHEMA = 'vmz.native_host.multi_platform_test.v0';
export const NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA = 'vmz.native_host.multi_platform_check.v0';
export const NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER = 'vmz::native_host::missing_platform_adapter';
export const NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA = 'vmz::native_host::platform_private_schema';
export const NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE = 'vmz::native_host::adapter_is_semantic_core';
export const NATIVE_HOST_REQUIRED_MULTI_PLATFORMS = ['ios', 'android'];
export const NATIVE_HOST_MULTI_PLATFORM_ADAPTER_KIND = 'packaging_stub';

export const PLUGIN_PROTOCOL = '0.1.0';

export const DX_PROTOCOL = 'vmz.dx.v0';
export const DX_SYMBOL_SCHEMA = 'vmz.dx.symbol.v0';
export const DX_REFERENCE_SCHEMA = 'vmz.dx.reference.v0';
export const DX_EXPLAIN_SCHEMA = 'vmz.dx.explain.v0';
export const DX_WORKSPACE_EDIT_SCHEMA = 'vmz.dx.workspace_edit.v0';
export const DX_CODE_ACTION_SCHEMA = 'vmz.dx.code_action.v0';
export const DX_AFFECTED_SCHEMA = 'vmz.dx.affected.v0';
export const DX_RENAME_SCHEMA = 'vmz.dx.rename.v0';
export const DX_TEST_SELECTION_SCHEMA = 'vmz.dx.test_selection.v0';
export const DX_SOURCE_MAP_SCHEMA = 'vmz.dx.source_map.v0';
export const DX_SYMBOL_INDEX_SCHEMA = 'vmz.dx.symbol_index.v0';
export const DX_CROSS_SFC_CHECK_SCHEMA = 'vmz.dx.cross_sfc_check.v0';
export const DX_SEMANTIC_TRANSACTION_SCHEMA = 'vmz.dx.semantic_transaction.v0';
export const DX_CANCEL_SCHEMA = 'vmz.dx.cancel.v0';
export const DX_AFFECTED_PREVIEW_SCHEMA = 'vmz.dx.affected_preview.v0';
export const DX_HMR_PLAN_SCHEMA = 'vmz.dx.hmr_plan.v0';
export const DX_BUDGET_SCHEMA = 'vmz.dx.budget.v0';
export const DX_TRANSACTION_CHECK_SCHEMA = 'vmz.dx.transaction_check.v0';
export const DX_BOUNDARY_VALIDATOR_SCHEMA = 'vmz.dx.boundary_validator.v0';
export const DX_LEAKAGE_SCHEMA = 'vmz.dx.leakage.v0';
export const DX_CAPABILITY_TARGET_SCHEMA = 'vmz.dx.capability_target.v0';
export const DX_DEAD_GRAPH_SCHEMA = 'vmz.dx.dead_graph.v0';
export const DX_DEPLOYMENT_PROOF_CHECK_SCHEMA = 'vmz.dx.deployment_proof_check.v0';
export const DX_TRACE_SCHEMA = 'vmz.dx.trace.v0';
export const DX_CAUSAL_REPLAY_SCHEMA = 'vmz.dx.causal_replay.v0';
export const DX_CAUSAL_REPLAY_CHECK_SCHEMA = 'vmz.dx.causal_replay_check.v0';

export const TEST_PROTOCOL = 'vmz.test.protocol.v0';
export const TEST_MANIFEST_SCHEMA = 'vmz.test.manifest.v0';
export const TEST_REPORT_SCHEMA = 'vmz.test.report.v0';
export const TEST_ACTION_SCHEMA = 'vmz.test.action.v0';
export const TEST_ASSERTION_SCHEMA = 'vmz.test.assertion.v0';
export const EXECUTION_PLAN_REF_SCHEMA = 'vmz.test.plan_ref.v0';

export const APPLICATION_PROTOCOL = 'vmz.application.protocol.v0';
export const APPLICATION_DESCRIPTOR_SCHEMA = 'vmz.application.v0';
export const APPLICATIONS_CONFIG_SCHEMA = 'vmz.applications.v0';
export const APPLICATION_CATALOG_SCHEMA = 'vmz.application.catalog.v0';
export const APPLICATION_CHECK_SCHEMA = 'vmz.application.check.v0';
export const APPLICATION_BASE_SCHEMA = 'vmz.application.base.v0';
export const APPLICATION_RELOCATION_SCHEMA = 'vmz.application.relocation.v0';
export const APPLICATION_RELOCATED_SCHEMA = 'vmz.application.relocated.v0';
export const APPLICATION_RELOCATABLE_CHECK_SCHEMA = 'vmz.application.relocatable.v0';
export const APPLICATION_ARTIFACT_SCHEMA = 'vmz.application.artifact.v0';
export const APPLICATION_MOUNT_TABLE_SCHEMA = 'vmz.application.mount_table.v0';
export const APPLICATION_ARTIFACT_BOUNDARY_SCHEMA = 'vmz.application.artifact_boundary.v0';
export const APPLICATION_ISOLATION_SCHEMA = 'vmz.application.isolation.v0';
export const APPLICATION_ISOLATION_CHECK_SCHEMA = 'vmz.application.isolation_check.v0';
export const APPLICATION_CROSS_LINK_SCHEMA = 'vmz.application.cross_link.v0';
export const APPLICATION_HOST_COMPOSITION_SCHEMA = 'vmz.application.host_composition.v0';
export const APPLICATION_DEV_SESSIONS_SCHEMA = 'vmz.application.dev_sessions.v0';
export const APPLICATION_AFFECTED_SCHEMA = 'vmz.application.affected.v0';
export const APPLICATION_PROXY_DISPATCH_SCHEMA = 'vmz.application.proxy_dispatch.v0';
export const APPLICATION_MOUNTED_TEST_SCHEMA = 'vmz.application.mounted_test.v0';
export const APPLICATION_DEPLOY_ADAPTER_SCHEMA = 'vmz.application.deploy_adapter.v0';
export const APPLICATION_DEV_CHECK_SCHEMA = 'vmz.application.dev_check.v0';

/**
 * @returns {{
 * schema: string,
 * host: string,
 * compiler: string,
 * plugin: string,
 * program: string,
 * plan: string,
 * domains: Array<{ kind: string, schema: string }>
 * }}
 */
export function protocolCatalog() {
    return {
        schema: PROTOCOL_CATALOG_SCHEMA,
        host: HOST_PROTOCOL,
        compiler: COMPILER_PROTOCOL,
        plugin: PLUGIN_PROTOCOL,
        program: PROGRAM_IR_SCHEMA,
        plan: PLAN_SCHEMA,
        domains: [
            { kind: 'dx', schema: DX_PROTOCOL },
            { kind: 'test', schema: TEST_PROTOCOL },
            { kind: 'application', schema: APPLICATION_PROTOCOL },
            { kind: 'target', schema: TARGET_PROTOCOL },
            { kind: 'profile', schema: PROFILE_PROTOCOL },
            { kind: 'native_host', schema: NATIVE_HOST_PROTOCOL },
            { kind: 'locale', schema: LOCALE_PROTOCOL },
        ],
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>
 * }}
 */
export function dxCatalog() {
    return {
        schema: DX_PROTOCOL,
        protocol: DX_PROTOCOL,
        documents: [
            { kind: 'symbol', schema: DX_SYMBOL_SCHEMA },
            { kind: 'reference', schema: DX_REFERENCE_SCHEMA },
            { kind: 'explain', schema: DX_EXPLAIN_SCHEMA },
            { kind: 'workspace_edit', schema: DX_WORKSPACE_EDIT_SCHEMA },
            { kind: 'code_action', schema: DX_CODE_ACTION_SCHEMA },
            { kind: 'affected', schema: DX_AFFECTED_SCHEMA },
            { kind: 'rename', schema: DX_RENAME_SCHEMA },
            { kind: 'test_selection', schema: DX_TEST_SELECTION_SCHEMA },
            { kind: 'source_map', schema: DX_SOURCE_MAP_SCHEMA },
            { kind: 'symbol_index', schema: DX_SYMBOL_INDEX_SCHEMA },
            { kind: 'cross_sfc_check', schema: DX_CROSS_SFC_CHECK_SCHEMA },
            { kind: 'semantic_transaction', schema: DX_SEMANTIC_TRANSACTION_SCHEMA },
            { kind: 'cancel', schema: DX_CANCEL_SCHEMA },
            { kind: 'affected_preview', schema: DX_AFFECTED_PREVIEW_SCHEMA },
            { kind: 'hmr_plan', schema: DX_HMR_PLAN_SCHEMA },
            { kind: 'budget', schema: DX_BUDGET_SCHEMA },
            { kind: 'transaction_check', schema: DX_TRANSACTION_CHECK_SCHEMA },
            { kind: 'boundary_validator', schema: DX_BOUNDARY_VALIDATOR_SCHEMA },
            { kind: 'leakage', schema: DX_LEAKAGE_SCHEMA },
            { kind: 'capability_target', schema: DX_CAPABILITY_TARGET_SCHEMA },
            { kind: 'dead_graph', schema: DX_DEAD_GRAPH_SCHEMA },
            { kind: 'deployment_proof_check', schema: DX_DEPLOYMENT_PROOF_CHECK_SCHEMA },
            { kind: 'trace', schema: DX_TRACE_SCHEMA },
            { kind: 'causal_replay', schema: DX_CAUSAL_REPLAY_SCHEMA },
            { kind: 'causal_replay_check', schema: DX_CAUSAL_REPLAY_CHECK_SCHEMA },
        ],
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>
 * }}
 */
export function testCatalog() {
    return {
        schema: TEST_PROTOCOL,
        protocol: TEST_PROTOCOL,
        documents: [
            { kind: 'manifest', schema: TEST_MANIFEST_SCHEMA },
            { kind: 'report', schema: TEST_REPORT_SCHEMA },
            { kind: 'action', schema: TEST_ACTION_SCHEMA },
            { kind: 'assertion', schema: TEST_ASSERTION_SCHEMA },
            { kind: 'plan_ref', schema: EXECUTION_PLAN_REF_SCHEMA },
        ],
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>
 * }}
 */
export function applicationCatalog() {
    return {
        schema: APPLICATION_PROTOCOL,
        protocol: APPLICATION_PROTOCOL,
        documents: [
            { kind: 'descriptor', schema: APPLICATION_DESCRIPTOR_SCHEMA },
            { kind: 'config', schema: APPLICATIONS_CONFIG_SCHEMA },
            { kind: 'catalog', schema: APPLICATION_CATALOG_SCHEMA },
            { kind: 'check', schema: APPLICATION_CHECK_SCHEMA },
            { kind: 'base', schema: APPLICATION_BASE_SCHEMA },
            { kind: 'relocation', schema: APPLICATION_RELOCATION_SCHEMA },
            { kind: 'relocated', schema: APPLICATION_RELOCATED_SCHEMA },
            { kind: 'relocatable', schema: APPLICATION_RELOCATABLE_CHECK_SCHEMA },
            { kind: 'artifact', schema: APPLICATION_ARTIFACT_SCHEMA },
            { kind: 'mount_table', schema: APPLICATION_MOUNT_TABLE_SCHEMA },
            { kind: 'artifact_boundary', schema: APPLICATION_ARTIFACT_BOUNDARY_SCHEMA },
            { kind: 'isolation', schema: APPLICATION_ISOLATION_SCHEMA },
            { kind: 'isolation_check', schema: APPLICATION_ISOLATION_CHECK_SCHEMA },
            { kind: 'cross_link', schema: APPLICATION_CROSS_LINK_SCHEMA },
            { kind: 'host_composition', schema: APPLICATION_HOST_COMPOSITION_SCHEMA },
            { kind: 'dev_sessions', schema: APPLICATION_DEV_SESSIONS_SCHEMA },
            { kind: 'affected', schema: APPLICATION_AFFECTED_SCHEMA },
            { kind: 'proxy_dispatch', schema: APPLICATION_PROXY_DISPATCH_SCHEMA },
            { kind: 'mounted_test', schema: APPLICATION_MOUNTED_TEST_SCHEMA },
            { kind: 'deploy_adapter', schema: APPLICATION_DEPLOY_ADAPTER_SCHEMA },
            { kind: 'dev_check', schema: APPLICATION_DEV_CHECK_SCHEMA },
        ],
    };
}

export interface ProtocolDomain {
    kind: string;
    schema: string;
}

export interface ProtocolCatalog {
    schema: string;
    host: string;
    compiler: string;
    plugin: string;
    program: string;
    plan: string;
    domains: ProtocolDomain[];
}

export interface DomainCatalog {
    schema: string;
    protocol: string;
    documents: ProtocolDomain[];
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>,
 * diagnostics: string[],
 * viewOperations: string[]
 * }}
 */
export function targetCatalog() {
    return {
        schema: TARGET_PROTOCOL,
        protocol: TARGET_PROTOCOL,
        documents: [
            { kind: 'view_ops', schema: TARGET_VIEW_OPS_SCHEMA },
            { kind: 'platform_profile', schema: TARGET_PLATFORM_PROFILE_SCHEMA },
            { kind: 'mini_program_artifact', schema: TARGET_MINI_PROGRAM_ARTIFACT_SCHEMA },
            { kind: 'check', schema: TARGET_CHECK_SCHEMA },
        ],
        diagnostics: [
            TARGET_DIAG_DOM_LEAK_IN_PLAN,
            TARGET_DIAG_UNKNOWN_VIEW_OP,
            'vmz::target::platform_unsupported',
            'vmz::target::profile_invalid',
            'vmz::target::artifact_invalid',
        ],
        viewOperations: [
            'CreateNode',
            'SetStaticProperty',
            'PatchProperty',
            'PatchText',
            'SelectBranch',
            'ReconcileKeyed',
            'AttachEvent',
            'MountComponent',
            'ProjectSlot',
            'DisposeRegion',
        ],
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>,
 * diagnostics: string[],
 * capabilityClasses: string[],
 * forbiddenBridgePatterns: string[],
 * requiredShellHooks: string[],
 * firstBatchStubIds: string[],
 * requiredLifecycleEvents: string[],
 * highValueSurfaceKinds: string[],
 * requiredMultiPlatforms: string[]
 * }}
 */
export function nativeHostCatalog() {
    return {
        schema: NATIVE_HOST_PROTOCOL,
        protocol: NATIVE_HOST_PROTOCOL,
        documents: [
            { kind: 'webview_deployment', schema: NATIVE_HOST_WEBVIEW_DEPLOYMENT_SCHEMA },
            { kind: 'capability', schema: NATIVE_HOST_CAPABILITY_SCHEMA },
            { kind: 'bridge', schema: NATIVE_HOST_BRIDGE_SCHEMA },
            { kind: 'application_identity', schema: NATIVE_HOST_APPLICATION_IDENTITY_SCHEMA },
            { kind: 'check', schema: NATIVE_HOST_CHECK_SCHEMA },
            { kind: 'shell', schema: NATIVE_HOST_SHELL_SCHEMA },
            { kind: 'deep_link', schema: NATIVE_HOST_DEEP_LINK_SCHEMA },
            { kind: 'local_bundle', schema: NATIVE_HOST_LOCAL_BUNDLE_SCHEMA },
            { kind: 'shell_check', schema: NATIVE_HOST_SHELL_CHECK_SCHEMA },
            { kind: 'capability_call', schema: NATIVE_HOST_CAPABILITY_CALL_SCHEMA },
            { kind: 'bridge_trace', schema: NATIVE_HOST_BRIDGE_TRACE_SCHEMA },
            { kind: 'bridge_stub_catalog', schema: NATIVE_HOST_BRIDGE_STUB_CATALOG_SCHEMA },
            { kind: 'bridge_check', schema: NATIVE_HOST_BRIDGE_CHECK_SCHEMA },
            { kind: 'lifecycle', schema: NATIVE_HOST_LIFECYCLE_SCHEMA },
            { kind: 'persistence', schema: NATIVE_HOST_PERSISTENCE_SCHEMA },
            { kind: 'update_policy', schema: NATIVE_HOST_UPDATE_POLICY_SCHEMA },
            { kind: 'offline_policy', schema: NATIVE_HOST_OFFLINE_POLICY_SCHEMA },
            { kind: 'lifecycle_check', schema: NATIVE_HOST_LIFECYCLE_CHECK_SCHEMA },
            { kind: 'fullstack', schema: NATIVE_HOST_FULLSTACK_SCHEMA },
            { kind: 'ssr_first_paint', schema: NATIVE_HOST_SSR_FIRST_PAINT_SCHEMA },
            { kind: 'server_transport', schema: NATIVE_HOST_SERVER_TRANSPORT_SCHEMA },
            { kind: 'auth_session', schema: NATIVE_HOST_AUTH_SESSION_SCHEMA },
            { kind: 'push_policy', schema: NATIVE_HOST_PUSH_POLICY_SCHEMA },
            { kind: 'network_policy', schema: NATIVE_HOST_NETWORK_POLICY_SCHEMA },
            { kind: 'fullstack_check', schema: NATIVE_HOST_FULLSTACK_CHECK_SCHEMA },
            { kind: 'native_surface', schema: NATIVE_HOST_NATIVE_SURFACE_SCHEMA },
            { kind: 'native_surface_id', schema: NATIVE_HOST_NATIVE_SURFACE_ID_SCHEMA },
            { kind: 'native_surface_boundary', schema: NATIVE_HOST_NATIVE_SURFACE_BOUNDARY_SCHEMA },
            { kind: 'native_surface_check', schema: NATIVE_HOST_NATIVE_SURFACE_CHECK_SCHEMA },
            { kind: 'multi_platform', schema: NATIVE_HOST_MULTI_PLATFORM_SCHEMA },
            { kind: 'multi_platform_shared', schema: NATIVE_HOST_MULTI_PLATFORM_SHARED_SCHEMA },
            { kind: 'multi_platform_adapter', schema: NATIVE_HOST_MULTI_PLATFORM_ADAPTER_SCHEMA },
            { kind: 'multi_platform_test', schema: NATIVE_HOST_MULTI_PLATFORM_TEST_SCHEMA },
            { kind: 'multi_platform_check', schema: NATIVE_HOST_MULTI_PLATFORM_CHECK_SCHEMA },
        ],
        diagnostics: [
            NATIVE_HOST_DIAG_ARBITRARY_BRIDGE,
            NATIVE_HOST_DIAG_MISSING_IDENTITY,
            NATIVE_HOST_DIAG_MISSING_ALLOWLIST,
            NATIVE_HOST_DIAG_UNSUPPORTED_CAPABILITY,
            NATIVE_HOST_DIAG_INVALID_PROFILE,
            NATIVE_HOST_DIAG_REMOTE_URL_DEFAULT,
            NATIVE_HOST_DIAG_MISSING_ENTRY_ARTIFACT,
            NATIVE_HOST_DIAG_MISSING_SHELL_HOOK,
            NATIVE_HOST_DIAG_PLATFORM_SEMANTIC_FORK,
            NATIVE_HOST_DIAG_REMOTE_ENTRY_DEFAULT,
            NATIVE_HOST_DIAG_MISSING_DEEP_LINK,
            NATIVE_HOST_DIAG_MISSING_LOG_POLICY,
            NATIVE_HOST_DIAG_MISSING_NONCE,
            NATIVE_HOST_DIAG_MISSING_ORIGIN,
            NATIVE_HOST_DIAG_MISSING_PERMISSION,
            NATIVE_HOST_DIAG_MISSING_CANCEL,
            NATIVE_HOST_DIAG_MISSING_TRACE,
            NATIVE_HOST_DIAG_MISSING_TIMEOUT,
            NATIVE_HOST_DIAG_UNKNOWN_STUB,
            NATIVE_HOST_DIAG_CALL_NOT_ALLOWLISTED,
            NATIVE_HOST_DIAG_MISSING_LIFECYCLE_EVENT,
            NATIVE_HOST_DIAG_BACKGROUND_IS_DESTROY,
            NATIVE_HOST_DIAG_CRASH_ASSUMES_JS_HEAP,
            NATIVE_HOST_DIAG_MISSING_PERSISTENCE,
            NATIVE_HOST_DIAG_MISSING_UPDATE_POLICY,
            NATIVE_HOST_DIAG_MISSING_OFFLINE_POLICY,
            NATIVE_HOST_DIAG_MISSING_SSR_FIRST_PAINT,
            NATIVE_HOST_DIAG_MISSING_SERVER_TRANSPORT,
            NATIVE_HOST_DIAG_BRIDGE_BYPASSES_SERVER,
            NATIVE_HOST_DIAG_MISSING_AUTH_SESSION,
            NATIVE_HOST_DIAG_MISSING_NETWORK_POLICY,
            NATIVE_HOST_DIAG_REMOTE_WITHOUT_INTEGRITY,
            NATIVE_HOST_DIAG_MIXED_SSR_COOKIE_ASSUMPTIONS,
            NATIVE_HOST_DIAG_MISSING_SURFACE_ID,
            NATIVE_HOST_DIAG_MISSING_OWNER_REGION,
            NATIVE_HOST_DIAG_MISSING_SURFACE_LIFETIME,
            NATIVE_HOST_DIAG_IMPLICIT_STATE_SHARE,
            NATIVE_HOST_DIAG_SURFACE_IS_CAPABILITY,
            NATIVE_HOST_DIAG_SURFACE_IS_SEMANTIC_TRUTH,
            NATIVE_HOST_DIAG_MISSING_PLATFORM_ADAPTER,
            NATIVE_HOST_DIAG_PLATFORM_PRIVATE_SCHEMA,
            NATIVE_HOST_DIAG_ADAPTER_IS_SEMANTIC_CORE,
        ],
        capabilityClasses: ['PureWeb', 'NativeBacked', 'NativeSurface', 'ServerBacked', 'Unsupported'],
        forbiddenBridgePatterns: ['window.native', 'window.webkit.messageHandlers', 'arbitraryObject', 'postMessage(rawValue)', 'eval('],
        requiredShellHooks: NATIVE_HOST_REQUIRED_SHELL_HOOKS,
        firstBatchStubIds: NATIVE_HOST_FIRST_BATCH_STUB_IDS,
        requiredLifecycleEvents: NATIVE_HOST_REQUIRED_LIFECYCLE_EVENTS,
        highValueSurfaceKinds: NATIVE_HOST_HIGH_VALUE_SURFACE_KINDS,
        requiredMultiPlatforms: NATIVE_HOST_REQUIRED_MULTI_PLATFORMS,
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>,
 * diagnostics: string[],
 * surfaceKinds: string[],
 * unifiedLifecycleEvents: string[],
 * coreIdPrefix: string
 * }}
 */
export function profileCatalog() {
    return {
        schema: PROFILE_PROTOCOL,
        protocol: PROFILE_PROTOCOL,
        documents: [
            { kind: 'host_profile', schema: PROFILE_HOST_SCHEMA },
            { kind: 'delivery_profile', schema: PROFILE_DELIVERY_SCHEMA },
            { kind: 'surface_binding', schema: PROFILE_SURFACE_BINDING_SCHEMA },
            { kind: 'capability_binding', schema: PROFILE_CAPABILITY_BINDING_SCHEMA },
            { kind: 'lifecycle_binding', schema: PROFILE_LIFECYCLE_BINDING_SCHEMA },
            { kind: 'navigation_binding', schema: PROFILE_NAVIGATION_BINDING_SCHEMA },
            { kind: 'transport_binding', schema: PROFILE_TRANSPORT_BINDING_SCHEMA },
            { kind: 'host_constraints', schema: PROFILE_HOST_CONSTRAINTS_SCHEMA },
            { kind: 'resolution_digest', schema: PROFILE_RESOLUTION_DIGEST_SCHEMA },
            { kind: 'contribution', schema: PROFILE_CONTRIBUTION_SCHEMA },
            { kind: 'check', schema: PROFILE_CHECK_SCHEMA },
            { kind: 'surface_requirements', schema: PROFILE_SURFACE_REQUIREMENTS_SCHEMA },
            { kind: 'capability_requirement', schema: PROFILE_CAPABILITY_REQUIREMENT_SCHEMA },
            { kind: 'surface_assignment_table', schema: PROFILE_SURFACE_ASSIGNMENT_TABLE_SCHEMA },
            { kind: 'capability_resolution_table', schema: PROFILE_CAPABILITY_RESOLUTION_TABLE_SCHEMA },
            { kind: 'route_realization_table', schema: PROFILE_ROUTE_REALIZATION_TABLE_SCHEMA },
            { kind: 'host_resolution_manifest', schema: PROFILE_HOST_RESOLUTION_MANIFEST_SCHEMA },
            { kind: 'solver_input', schema: PROFILE_SOLVER_INPUT_SCHEMA },
            { kind: 'solver_check', schema: PROFILE_SOLVER_CHECK_SCHEMA },
            { kind: 'executor_envelope_header', schema: PROFILE_EXECUTOR_ENVELOPE_HEADER_SCHEMA },
            { kind: 'event_envelope', schema: PROFILE_EVENT_ENVELOPE_SCHEMA },
            { kind: 'executor_transaction', schema: PROFILE_EXECUTOR_TRANSACTION_SCHEMA },
            { kind: 'patch_batch', schema: PROFILE_PATCH_BATCH_SCHEMA },
            { kind: 'dispose_region', schema: PROFILE_DISPOSE_REGION_SCHEMA },
            { kind: 'cancel_request', schema: PROFILE_CANCEL_REQUEST_SCHEMA },
            { kind: 'executor_scenario', schema: PROFILE_EXECUTOR_SCENARIO_SCHEMA },
            { kind: 'executor_check', schema: PROFILE_EXECUTOR_CHECK_SCHEMA },
            { kind: 'lifecycle_mapping_entry', schema: PROFILE_LIFECYCLE_MAPPING_ENTRY_SCHEMA },
            { kind: 'lifecycle_mapping_table', schema: PROFILE_LIFECYCLE_MAPPING_TABLE_SCHEMA },
            { kind: 'recovery_policy', schema: PROFILE_RECOVERY_POLICY_SCHEMA },
            { kind: 'lifecycle_scenario', schema: PROFILE_LIFECYCLE_SCENARIO_SCHEMA },
            { kind: 'lifecycle_recovery_check', schema: PROFILE_LIFECYCLE_RECOVERY_CHECK_SCHEMA },
            { kind: 'delivery_package_constraints', schema: PROFILE_DELIVERY_PACKAGE_CONSTRAINTS_SCHEMA },
            { kind: 'delivery_security_policy', schema: PROFILE_DELIVERY_SECURITY_POLICY_SCHEMA },
            { kind: 'delivery_update_policy', schema: PROFILE_DELIVERY_UPDATE_POLICY_SCHEMA },
            { kind: 'delivery_artifact_manifest', schema: PROFILE_DELIVERY_ARTIFACT_MANIFEST_SCHEMA },
            { kind: 'delivery_proof_manifest', schema: PROFILE_DELIVERY_PROOF_MANIFEST_SCHEMA },
            { kind: 'delivery_proof_scenario', schema: PROFILE_DELIVERY_PROOF_SCENARIO_SCHEMA },
            { kind: 'delivery_proof_check', schema: PROFILE_DELIVERY_PROOF_CHECK_SCHEMA },
            { kind: 'conformance_fixture', schema: PROFILE_CONFORMANCE_FIXTURE_SCHEMA },
            { kind: 'conformance_state_snapshot', schema: PROFILE_CONFORMANCE_STATE_SNAPSHOT_SCHEMA },
            { kind: 'conformance_trace', schema: PROFILE_CONFORMANCE_TRACE_SCHEMA },
            { kind: 'conformance_host_run', schema: PROFILE_CONFORMANCE_HOST_RUN_SCHEMA },
            { kind: 'conformance_scenario', schema: PROFILE_CONFORMANCE_SCENARIO_SCHEMA },
            { kind: 'conformance_check', schema: PROFILE_CONFORMANCE_CHECK_SCHEMA },
        ],
        diagnostics: [
            PROFILE_DIAG_HOST_PROFILE_INVALID,
            PROFILE_DIAG_DELIVERY_PROFILE_INVALID,
            PROFILE_DIAG_HOST_PROFILE_REF_UNRESOLVED,
            PROFILE_DIAG_RESOLUTION_DIGEST_MISSING,
            PROFILE_DIAG_RESOLUTION_DIGEST_MISMATCH,
            PROFILE_DIAG_CORE_ID_OVERRIDE,
            PROFILE_DIAG_CONTRIBUTION_NOT_NAMESPACED,
            PROFILE_DIAG_PROFILE_VERSION_INVALID,
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
            PROFILE_DIAG_LIFECYCLE_UNPROVEN,
            PROFILE_DIAG_LIFECYCLE_MAPPING_INCOMPLETE,
            PROFILE_DIAG_RECOVERY_DUPLICATES_OWNER,
            PROFILE_DIAG_RECOVERY_ASSUMES_HEAP,
            PROFILE_DIAG_PERSISTENCE_WINDOW_INVALID,
            PROFILE_DIAG_DELIVERY_CONSTRAINT_EXCEEDED,
            PROFILE_DIAG_HOST_PLAN_VERSION_MISMATCH,
            PROFILE_DIAG_PROOF_MANIFEST_INCOMPLETE,
            PROFILE_DIAG_PROOF_COPIES_SEMANTIC_IR,
            PROFILE_DIAG_UPDATE_WITHOUT_REPROOF,
            PROFILE_DIAG_SECURITY_POLICY_INSECURE,
            PROFILE_DIAG_STABLE_ID_DIVERGENCE,
            PROFILE_DIAG_STATE_RESULT_DIVERGENCE,
            PROFILE_DIAG_TRACE_INVARIANT_BROKEN,
            PROFILE_DIAG_CONFORMANCE_HOST_INCOMPLETE,
            PROFILE_DIAG_CONFORMANCE_SURFACE_ROLE_MISMATCH,
        ],
        surfaceKinds: PROFILE_SURFACE_KINDS,
        unifiedLifecycleEvents: PROFILE_UNIFIED_LIFECYCLE_EVENTS,
        coreIdPrefix: PROFILE_CORE_ID_PREFIX,
    };
}

/**
 * @returns {{
 * schema: string,
 * protocol: string,
 * documents: Array<{ kind: string, schema: string }>,
 * diagnostics: string[],
 * virtualModulePrefix: string
 * }}
 */
export function localeCatalog() {
    return {
        schema: LOCALE_PROTOCOL,
        protocol: LOCALE_PROTOCOL,
        documents: [
            { kind: 'manifest', schema: LOCALE_MANIFEST_SCHEMA },
            { kind: 'message_catalog', schema: LOCALE_MESSAGE_CATALOG_SCHEMA },
            { kind: 'message_node', schema: LOCALE_MESSAGE_NODE_SCHEMA },
            { kind: 'check', schema: LOCALE_CHECK_SCHEMA },
            { kind: 'typed_module', schema: LOCALE_TYPED_MODULE_SCHEMA },
            { kind: 'rename', schema: LOCALE_RENAME_SCHEMA },
            { kind: 'application_context', schema: LOCALE_APPLICATION_CONTEXT_SCHEMA },
            { kind: 'formatter_context', schema: LOCALE_FORMATTER_CONTEXT_SCHEMA },
            { kind: 'transition', schema: LOCALE_TRANSITION_SCHEMA },
            { kind: 'runtime_check', schema: LOCALE_RUNTIME_CHECK_SCHEMA },
            { kind: 'fallback_resolution', schema: LOCALE_FALLBACK_RESOLUTION_SCHEMA },
            { kind: 'route_realization', schema: LOCALE_ROUTE_REALIZATION_SCHEMA },
            { kind: 'page_meta', schema: LOCALE_PAGE_META_SCHEMA },
            { kind: 'link_resolution', schema: LOCALE_LINK_RESOLUTION_SCHEMA },
            { kind: 'router_check', schema: LOCALE_ROUTER_CHECK_SCHEMA },
            { kind: 'delivery_resolution', schema: LOCALE_DELIVERY_RESOLUTION_SCHEMA },
            { kind: 'chunk_manifest', schema: LOCALE_CHUNK_MANIFEST_SCHEMA },
            { kind: 'native_pack', schema: LOCALE_NATIVE_PACK_SCHEMA },
            { kind: 'mini_package_proof', schema: LOCALE_MINI_PACKAGE_PROOF_SCHEMA },
            { kind: 'server_error_envelope', schema: LOCALE_SERVER_ERROR_ENVELOPE_SCHEMA },
            { kind: 'delivery_check', schema: LOCALE_DELIVERY_CHECK_SCHEMA },
            { kind: 'explain', schema: LOCALE_EXPLAIN_SCHEMA },
            { kind: 'diff', schema: LOCALE_DIFF_SCHEMA },
            { kind: 'extract', schema: LOCALE_EXTRACT_SCHEMA },
            { kind: 'pseudo', schema: LOCALE_PSEUDO_SCHEMA },
            { kind: 'conformance', schema: LOCALE_CONFORMANCE_SCHEMA },
        ],
        diagnostics: [
            LOCALE_DIAG_MANIFEST_MISSING,
            LOCALE_DIAG_ID_INVALID,
            LOCALE_DIAG_ID_COLLISION,
            LOCALE_DIAG_DEFAULT_MISSING,
            LOCALE_DIAG_FALLBACK_CYCLE,
            LOCALE_DIAG_FALLBACK_UNKNOWN,
            LOCALE_DIAG_DIR_ORPHAN,
            LOCALE_DIAG_DIR_MISSING,
            LOCALE_DIAG_LAYOUT_ILLEGAL,
            LOCALE_DIAG_MESSAGE_MISSING_DEFAULT,
            LOCALE_DIAG_MESSAGE_MISSING_VARIANT,
            LOCALE_DIAG_MESSAGE_PARAMETER_MISMATCH,
            LOCALE_DIAG_MESSAGE_SYNTAX_INVALID,
            LOCALE_DIAG_MESSAGE_ARRAY_FORBIDDEN,
            LOCALE_DIAG_MESSAGE_UNUSED,
            LOCALE_DIAG_MESSAGE_HTML_FORBIDDEN,
            LOCALE_DIAG_CATALOG_PARSE,
            LOCALE_DIAG_CATALOG_CONFLICT,
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
        ],
        virtualModulePrefix: LOCALE_VIRTUAL_MODULE_PREFIX,
        formatterDataVersion: FORMATTER_DATA_VERSION,
    };
}
