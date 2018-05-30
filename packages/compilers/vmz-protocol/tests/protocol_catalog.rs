use vmz_protocol::*;

#[test]
fn umbrella_catalog_lists_domains() {
    let c = ProtocolCatalog::v0();
    assert_eq!(c.schema, PROTOCOL_CATALOG_SCHEMA);
    assert_eq!(c.host, HOST_PROTOCOL);
    assert_eq!(c.program, PROGRAM_SCHEMA);
    assert_eq!(c.plan, PLAN_SCHEMA);
    assert_eq!(c.plugin, PLUGIN_PROTOCOL);
    assert!(c.domains.iter().any(|d| d.kind == "dx" && d.schema == DX_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "test" && d.schema == TEST_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "application" && d.schema == APPLICATION_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "target" && d.schema == TARGET_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "native_host" && d.schema == NATIVE_HOST_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "profile" && d.schema == PROFILE_PROTOCOL));
    assert!(c.domains.iter().any(|d| d.kind == "locale" && d.schema == LOCALE_PROTOCOL));
}

#[test]
fn locale_catalog_freezes_i0_schemas() {
    let c = LocaleProtocolCatalog::v0();
    assert_eq!(c.protocol, LOCALE_PROTOCOL);
    assert!(c.documents.iter().any(|d| d.kind == "manifest" && d.schema == LOCALE_MANIFEST_SCHEMA));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "message_catalog" && d.schema == MESSAGE_CATALOG_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "typed_module" && d.schema == LOCALE_TYPED_MODULE_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "application_context"
                && d.schema == LOCALE_APPLICATION_CONTEXT_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "formatter_context" && d.schema == LOCALE_FORMATTER_CONTEXT_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_FALLBACK_CYCLE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_MESSAGE_PARAMETER_MISMATCH));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_FORMATTER_CONTEXT_INCOMPLETE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_DIGEST_MISMATCH));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "route_realization" && d.schema == LOCALE_ROUTE_REALIZATION_SCHEMA)
    );
    assert!(
        c.documents.iter().any(|d| d.kind == "page_meta" && d.schema == LOCALE_PAGE_META_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_ROUTE_COLLISION));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_CACHE_KEY_STEALS_CONTENT));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "delivery_resolution"
                && d.schema == LOCALE_DELIVERY_RESOLUTION_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_DELIVERY_FULL_BUNDLE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_NATIVE_PACK_HAS_JS));
    assert!(c.documents.iter().any(|d| d.kind == "explain" && d.schema == LOCALE_EXPLAIN_SCHEMA));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "conformance" && d.schema == LOCALE_CONFORMANCE_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LOCALE_HARDCODED_TEXT));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_MESSAGE_DYNAMIC_ID_UNBOUNDED));
    assert_eq!(c.virtual_module_prefix, "#locales/");
    let m = LocaleManifestFile::example_three_locales();
    assert_eq!(m.default_locale, "zh-hans");
    assert_eq!(m.locales.len(), 3);
    let app = LocaleApplicationContext::example_zh_hans();
    let fmt = LocaleFormatterContext::from_application(&app, None);
    assert_eq!(fmt.formatter_data_version, FORMATTER_DATA_VERSION);
}

#[test]
fn profile_catalog_freezes_p0_schemas() {
    let c = ProfileProtocolCatalog::v0();
    assert_eq!(c.protocol, PROFILE_PROTOCOL);
    assert!(
        c.documents.iter().any(|d| d.kind == "host_profile" && d.schema == HOST_PROFILE_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "delivery_profile" && d.schema == DELIVERY_PROFILE_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "resolution_digest" && d.schema == RESOLUTION_DIGEST_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_HOST_PROFILE_INVALID));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_RESOLUTION_DIGEST_MISMATCH));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_CORE_ID_OVERRIDE));
    assert!(c.surface_kinds.iter().any(|k| k == "web"));
    assert!(c.unified_lifecycle_events.iter().any(|e| e == "dispose"));
    let host = HostProfile::browser_example();
    assert_eq!(host.schema, HOST_PROFILE_SCHEMA);
    assert!(!host.constraints.allows_runtime_driver_select);
    let delivery = DeliveryProfile::browser_bundled_example(&host);
    assert_eq!(delivery.schema, DELIVERY_PROFILE_SCHEMA);
    assert_eq!(delivery.host_profile_ref, host.host_id);
    assert!(delivery.resolution_digest.is_some());
    let contrib = ProfileContribution::example_ok();
    assert!(contrib.surface_ids[0].starts_with("com.example."));
    assert!(
        c.documents.iter().any(|d| d.kind == "solver_check" && d.schema == SOLVER_CHECK_SCHEMA)
    );
    assert!(c.documents.iter().any(
        |d| d.kind == "host_resolution_manifest" && d.schema == HOST_RESOLUTION_MANIFEST_SCHEMA
    ));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "executor_scenario" && d.schema == EXECUTOR_SCENARIO_SCHEMA)
    );
    assert!(
        c.documents.iter().any(|d| d.kind == "executor_check" && d.schema == EXECUTOR_CHECK_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_SURFACE_NO_MATCH));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_SURFACE_AMBIGUOUS));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_CAPABILITY_UNRESOLVED));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_ROUTE_UNREALIZABLE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_STALE_GENERATION));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_SPLIT_TRANSACTION));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_DISPOSE_NOT_AUTHORITATIVE));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "lifecycle_scenario" && d.schema == LIFECYCLE_SCENARIO_SCHEMA)
    );
    assert!(c.documents.iter().any(
        |d| d.kind == "lifecycle_recovery_check" && d.schema == LIFECYCLE_RECOVERY_CHECK_SCHEMA
    ));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "recovery_policy" && d.schema == RECOVERY_POLICY_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_LIFECYCLE_MAPPING_INCOMPLETE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_RECOVERY_DUPLICATES_OWNER));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_RECOVERY_ASSUMES_HEAP));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_PERSISTENCE_WINDOW_INVALID));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "delivery_proof_check" && d.schema == DELIVERY_PROOF_CHECK_SCHEMA)
    );
    assert!(
        c.documents.iter().any(|d| d.kind == "delivery_artifact_manifest"
            && d.schema == DELIVERY_ARTIFACT_MANIFEST_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_DELIVERY_CONSTRAINT_EXCEEDED));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_HOST_PLAN_VERSION_MISMATCH));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_PROOF_COPIES_SEMANTIC_IR));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_UPDATE_WITHOUT_REPROOF));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_SECURITY_POLICY_INSECURE));
    let input = ProfileSolverInput::browser_counter_example();
    assert_eq!(input.schema, SOLVER_INPUT_SCHEMA);
    assert_eq!(input.regions.len(), 1);
    let exec = ExecutorScenario::mixed_camera_t42_example();
    assert_eq!(exec.schema, EXECUTOR_SCENARIO_SCHEMA);
    assert_eq!(exec.patch_batches.len(), 3);
    let life = LifecycleScenario::cross_host_recovery_example();
    assert_eq!(life.schema, LIFECYCLE_SCENARIO_SCHEMA);
    assert_eq!(life.hosts.len(), 3);
    assert!(!life.recovery.creates_new_owner_on_recover);
    assert!(!life.recovery.assumes_js_heap_survived);
    let proof = DeliveryProofScenario::cross_delivery_proof_example();
    assert_eq!(proof.schema, DELIVERY_PROOF_SCENARIO_SCHEMA);
    assert_eq!(proof.units.len(), 3);
    assert!(proof.units.iter().all(|u| !u.proof.artifact.copies_semantic_ir));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "conformance_check" && d.schema == CONFORMANCE_CHECK_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "conformance_scenario" && d.schema == CONFORMANCE_SCENARIO_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_STABLE_ID_DIVERGENCE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_STATE_RESULT_DIVERGENCE));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_TRACE_INVARIANT_BROKEN));
    let conf = ConformanceScenario::counter_cross_host_example();
    assert_eq!(conf.schema, CONFORMANCE_SCENARIO_SCHEMA);
    assert_eq!(conf.runs.len(), 3);
}

#[test]
fn dx_catalog_lists_x0_plus_x1_documents() {
    let c = DxCatalog::v0();
    assert_eq!(c.protocol, DX_PROTOCOL);
    assert!(c.documents.len() >= 17);
    let json = c.to_json();
    assert!(json.contains(SYMBOL_SCHEMA));
    assert!(json.contains(AFFECTED_SCHEMA));
    assert!(json.contains(EXPLAIN_SCHEMA));
    assert!(json.contains(RENAME_SCHEMA));
    assert!(json.contains(TEST_SELECTION_SCHEMA));
    assert!(json.contains(CROSS_SFC_CHECK_SCHEMA));
    assert!(json.contains(SEMANTIC_TRANSACTION_SCHEMA));
    assert!(json.contains(TRANSACTION_CHECK_SCHEMA));
    assert!(json.contains(BOUNDARY_VALIDATOR_SCHEMA));
    assert!(json.contains(LEAKAGE_SCHEMA));
    assert!(json.contains(CAPABILITY_TARGET_SCHEMA));
    assert!(json.contains(DEAD_GRAPH_SCHEMA));
    assert!(json.contains(DEPLOYMENT_PROOF_CHECK_SCHEMA));
    assert!(json.contains(TRACE_SCHEMA));
    assert!(json.contains(CAUSAL_REPLAY_SCHEMA));
    assert!(json.contains(CAUSAL_REPLAY_CHECK_SCHEMA));
}

#[test]
fn rename_intent_and_test_selection_roundtrip() {
    let intent = RenameIntent::new("route_id", "home", "landing");
    let back: RenameIntent = serde_json::from_str(&intent.to_json()).unwrap();
    assert_eq!(back.schema, RENAME_SCHEMA);
    assert_eq!(back.kind, "route_id");
    assert_eq!(normalize_rename_kind("route"), Some("route_id"));
    let sel = TestSelectionDocument::empty("no dirty units");
    let sel_back: TestSelectionDocument = serde_json::from_str(&sel.to_json()).unwrap();
    assert_eq!(sel_back.schema, TEST_SELECTION_SCHEMA);
    assert_eq!(sel_back.status, "empty");
}

#[test]
fn workspace_edit_roundtrip() {
    let plan = WorkspaceEditPlan::empty_preview();
    let json = plan.to_json();
    let back: WorkspaceEditPlan = serde_json::from_str(&json).unwrap();
    assert_eq!(back.schema, WORKSPACE_EDIT_SCHEMA);
    assert_eq!(back.status, "preview");
}

#[test]
fn explain_document_uses_dx_schema() {
    let doc = ExplainDocument {
        schema: EXPLAIN_SCHEMA.into(),
        target: "components/Card".into(),
        kind: "chunk".into(),
        chunk_id: Some("components/Card".into()),
        deployment_unit: None,
        program: None,
        edge: None,
        session_generation: 1,
        contributions: vec![],
        chain: vec![],
        notes: Some("x0".into()),
    };
    let json = doc.to_json();
    assert!(json.contains(EXPLAIN_SCHEMA));
    assert!(!json.contains(EXPLAIN_SCHEMA_LEGACY));
}

#[test]
fn test_catalog_freezes_t0_schemas() {
    let c = TestCatalog::v0();
    assert_eq!(c.protocol, TEST_PROTOCOL);
    assert!(c.documents.iter().any(|d| d.schema == TEST_MANIFEST_SCHEMA));
    assert!(c.documents.iter().any(|d| d.schema == TEST_REPORT_SCHEMA));
}

#[test]
fn application_catalog_freezes_m0_schemas() {
    let cat = ApplicationProtocolCatalog::v0();
    assert_eq!(cat.protocol, APPLICATION_PROTOCOL);
    assert!(cat.documents.iter().any(|d| d.schema == APPLICATION_DESCRIPTOR_SCHEMA));
    assert!(cat.documents.iter().any(|d| d.schema == APPLICATIONS_CONFIG_SCHEMA));
    assert!(cat.documents.iter().any(|d| d.schema == APPLICATION_BASE_SCHEMA));
    assert!(cat.documents.iter().any(|d| d.schema == APPLICATION_RELOCATABLE_CHECK_SCHEMA));
    assert!(cat.diagnostics.contains(&DIAG_MOUNT_COLLISION.to_string()));
    assert!(cat.diagnostics.contains(&DIAG_NON_RELOCATABLE_URL.to_string()));
}

#[test]
fn target_catalog_freezes_miniprogram_schemas() {
    let c = TargetProtocolCatalog::v0();
    assert_eq!(c.protocol, TARGET_PROTOCOL);
    assert!(c.documents.iter().any(|d| d.kind == "view_ops" && d.schema == VIEW_OPS_SCHEMA));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "platform_profile" && d.schema == PLATFORM_PROFILE_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "mini_program_artifact" && d.schema == MINI_PROGRAM_ARTIFACT_SCHEMA)
    );
    assert!(c.view_operations.iter().any(|k| k == "CreateNode"));
    assert!(c.view_operations.iter().any(|k| k == "DisposeRegion"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_DOM_LEAK_IN_PLAN));
    let art = MiniProgramArtifact::empty_skeleton("mini-program");
    assert_eq!(art.schema, MINI_PROGRAM_ARTIFACT_SCHEMA);
    assert_eq!(art.plan_schema, PLAN_SCHEMA);
}

#[test]
fn native_host_catalog_freezes_native_host_schemas() {
    let c = NativeHostProtocolCatalog::v0();
    assert_eq!(c.protocol, NATIVE_HOST_PROTOCOL);
    assert!(c.documents.iter().any(|d| d.kind == "webview_deployment"));
    assert!(c.documents.iter().any(|d| d.kind == "capability"));
    assert!(c.documents.iter().any(|d| d.kind == "bridge"));
    assert!(c.capability_classes.iter().any(|k| k == "NativeBacked"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_ARBITRARY_BRIDGE));
    let cap = NativeCapability::camera_capture_example();
    assert_eq!(cap.schema, NATIVE_CAPABILITY_SCHEMA);
    assert!(cap.cancellation);
    let dep = WebViewDeploymentProfile::local_bundled_example(vec![cap]);
    assert!(dep.reuses_browser_lowering);
    assert_eq!(dep.plan_schema, PLAN_SCHEMA);
    assert_eq!(dep.asset_mode, "local");
    assert!(c.documents.iter().any(|d| d.kind == "shell" && d.schema == SHELL_SCHEMA));
    assert!(c.documents.iter().any(|d| d.kind == "shell_check" && d.schema == SHELL_CHECK_SCHEMA));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_MISSING_SHELL_HOOK));
    let shell = NativeWebViewShellManifest::local_bundled_example();
    assert_eq!(shell.schema, SHELL_SCHEMA);
    assert!(shell.reuses_browser_lowering);
    assert_eq!(shell.adapters.len(), 2);
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "capability_call" && d.schema == CAPABILITY_CALL_SCHEMA)
    );
    assert!(
        c.documents.iter().any(|d| d.kind == "bridge_check" && d.schema == BRIDGE_CHECK_SCHEMA)
    );
    assert!(c.first_batch_stub_ids.iter().any(|id| id == "camera.capture"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_MISSING_NONCE));
    let stubs = BridgeStubCatalog::first_batch();
    assert_eq!(stubs.allowlist.len(), 5);
    let call = NativeCapabilityCall::camera_capture_example();
    assert_eq!(call.schema, CAPABILITY_CALL_SCHEMA);
    assert!(call.cancellation);
    assert!(c.documents.iter().any(|d| d.kind == "lifecycle" && d.schema == LIFECYCLE_SCHEMA));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "lifecycle_check" && d.schema == LIFECYCLE_CHECK_SCHEMA)
    );
    assert!(c.required_lifecycle_events.iter().any(|e| e == "background"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_BACKGROUND_IS_DESTROY));
    let life = NativeAppLifecyclePolicy::example();
    assert_eq!(life.schema, LIFECYCLE_SCHEMA);
    assert!(!life.background_equals_destroy);
    assert!(c.documents.iter().any(|d| d.kind == "fullstack" && d.schema == FULLSTACK_SCHEMA));
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "fullstack_check" && d.schema == FULLSTACK_CHECK_SCHEMA)
    );
    assert!(c.diagnostics.iter().any(|d| d == DIAG_BRIDGE_BYPASSES_SERVER));
    let fs = NativeFullstackProfile::example();
    assert_eq!(fs.schema, FULLSTACK_SCHEMA);
    assert_eq!(fs.server_transport.scheme, "#server");
    assert!(!fs.server_transport.bridge_bypasses_server);
    assert!(
        c.documents.iter().any(|d| d.kind == "native_surface" && d.schema == NATIVE_SURFACE_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "native_surface_check" && d.schema == NATIVE_SURFACE_CHECK_SCHEMA)
    );
    assert!(c.high_value_surface_kinds.iter().any(|k| k == "camera"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_SURFACE_IS_CAPABILITY));
    let surf = NativeSurfaceManifest::camera_preview_example();
    assert_eq!(surf.schema, NATIVE_SURFACE_SCHEMA);
    assert_eq!(surf.kind, "camera");
    assert!(!surf.confused_with_capability);
    assert!(
        c.documents.iter().any(|d| d.kind == "multi_platform" && d.schema == MULTI_PLATFORM_SCHEMA)
    );
    assert!(
        c.documents
            .iter()
            .any(|d| d.kind == "multi_platform_check" && d.schema == MULTI_PLATFORM_CHECK_SCHEMA)
    );
    assert!(c.required_multi_platforms.iter().any(|p| p == "ios"));
    assert!(c.required_multi_platforms.iter().any(|p| p == "android"));
    assert!(c.diagnostics.iter().any(|d| d == DIAG_PLATFORM_PRIVATE_SCHEMA));
    let mp = NativeMultiPlatformManifest::ios_android_example();
    assert_eq!(mp.schema, MULTI_PLATFORM_SCHEMA);
    assert_eq!(mp.adapters.len(), 2);
    assert_eq!(mp.shared.bridge_schema, BRIDGE_PROTOCOL_SCHEMA);
    assert_eq!(mp.shared.surface_schema, NATIVE_SURFACE_SCHEMA);
    assert!(!mp.allows_platform_semantic_fork);
}
