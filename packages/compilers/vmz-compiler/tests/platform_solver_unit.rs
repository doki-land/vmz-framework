//! Moved from `src/platform/solver.rs` (cargo-cry: tests next to Cargo.toml).

use std::fs;

use std::path::PathBuf;

use std::time::{SystemTime, UNIX_EPOCH};
use vmz_compiler::platform::solver::*;
use vmz_protocol::{
    CAPABILITY_BINDING_SCHEMA, CapabilityBinding, CapabilityRequirement,
    DIAG_CAPABILITY_PERMISSION_UNDECLARED, DIAG_CAPABILITY_UNRESOLVED, DIAG_SURFACE_AMBIGUOUS,
    DIAG_SURFACE_NO_MATCH, DeliveryProfile, ExecutionDomain, HostProfile, ProfileSolverInput,
    RegionSolveRequest, RouteSolveRequest, SOLVER_INPUT_SCHEMA, SURFACE_BINDING_SCHEMA,
    SURFACE_REQUIREMENTS_SCHEMA, SurfaceAssignmentReason, SurfaceBinding, SurfaceKind,
    SurfaceRequirements,
};

fn tmp(prefix: &str) -> std::path::PathBuf {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn browser_counter_ready() {
    let dir = tmp("vmz-p1-");
    let report = check_profile_solver(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Ready);
    assert_eq!(report.manifest.surface_assignments.assignments.len(), 1);
    assert_eq!(
        report.manifest.surface_assignments.assignments[0].surface_id,
        "vmz.surface.web.main"
    );
    assert_eq!(report.manifest.capability_resolutions.resolutions.len(), 1);
    assert_eq!(report.manifest.route_realizations.realizations.len(), 1);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_surface_no_match() {
    let dir = tmp("vmz-p1-nomatch-");
    let host = HostProfile::browser_example();
    let delivery = DeliveryProfile::browser_bundled_example(&host);
    let mut input = ProfileSolverInput::browser_counter_example();
    input.regions[0].requirements.required_operations = vec!["NativeTextureMount".into()];
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
        .unwrap();
    let report = check_profile_solver(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_SURFACE_NO_MATCH))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_surface_ambiguous() {
    let dir = tmp("vmz-p1-amb-");
    let mut host = HostProfile::browser_example();
    // Second surface with same ops but different kind/driver → ambiguous for form region.
    host.surfaces.push(SurfaceBinding {
        schema: SURFACE_BINDING_SCHEMA.into(),
        surface_id: "vmz.surface.native.alt".into(),
        kind: SurfaceKind::Native,
        driver_id: "vmz.driver.native-view".into(),
        supported_operations: host.surfaces[0].supported_operations.clone(),
        supported_element_kinds: host.surfaces[0].supported_element_kinds.clone(),
        supported_event_kinds: host.surfaces[0].supported_event_kinds.clone(),
        supported_style_features: host.surfaces[0].supported_style_features.clone(),
        supported_accessibility: host.surfaces[0].supported_accessibility.clone(),
    });
    // Clear default preference advantage by pointing default at neither uniquely...
    // Both score 0 if default is web.main — web gets +50. Force equal scores:
    let mut delivery = DeliveryProfile::browser_bundled_example(&host);
    delivery.default_surface = "vmz.surface.missing".into();
    // Recompute digest not needed for solver; hostProfileRef still ok.
    delivery.resolution_digest = None;
    let input = ProfileSolverInput::browser_counter_example();
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
        .unwrap();
    let report = check_profile_solver(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_SURFACE_AMBIGUOUS))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_capability_unresolved() {
    let dir = tmp("vmz-p1-cap-");
    let host = HostProfile::browser_example();
    let delivery = DeliveryProfile::browser_bundled_example(&host);
    let mut input = ProfileSolverInput::browser_counter_example();
    input.capabilities[0].capability_id = "vmz.capability.missing".into();
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
        .unwrap();
    let report = check_profile_solver(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_CAPABILITY_UNRESOLVED))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rejects_permission_undeclared() {
    let dir = tmp("vmz-p1-perm-");
    let mut host = HostProfile::browser_example();
    host.capabilities.push(CapabilityBinding {
        schema: CAPABILITY_BINDING_SCHEMA.into(),
        capability_id: "vmz.capability.camera.capture".into(),
        version_range: "^0".into(),
        execution_domain: ExecutionDomain::Native,
        provider_id: "vmz.provider.camera".into(),
        transport_id: None,
        permissions: vec![],
    });
    let delivery = DeliveryProfile::browser_bundled_example(&host);
    let mut input = ProfileSolverInput::browser_counter_example();
    input.capabilities.push(CapabilityRequirement {
        schema: vmz_protocol::CAPABILITY_REQUIREMENT_SCHEMA.into(),
        capability_id: "vmz.capability.camera.capture".into(),
        version_range: "^0".into(),
        permissions: vec!["camera".into()],
        region_id: None,
    });
    fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap()).unwrap();
    fs::write(dir.join("delivery-profile.json"), serde_json::to_string_pretty(&delivery).unwrap())
        .unwrap();
    fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
        .unwrap();
    let report = check_profile_solver(&dir);
    assert_eq!(report.status, vmz_protocol::CheckReportStatus::Failed);
    assert!(
        report
            .diagnostics
            .iter()
            .any(|d| d.code_string().as_deref() == Some(DIAG_CAPABILITY_PERMISSION_UNDECLARED))
    );
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn prefers_surface_breaks_ambiguity() {
    let mut host = HostProfile::browser_example();
    host.surfaces.push(SurfaceBinding {
        schema: SURFACE_BINDING_SCHEMA.into(),
        surface_id: "vmz.surface.native.alt".into(),
        kind: SurfaceKind::Native,
        driver_id: "vmz.driver.native-view".into(),
        supported_operations: host.surfaces[0].supported_operations.clone(),
        supported_element_kinds: host.surfaces[0].supported_element_kinds.clone(),
        supported_event_kinds: host.surfaces[0].supported_event_kinds.clone(),
        supported_style_features: host.surfaces[0].supported_style_features.clone(),
        supported_accessibility: host.surfaces[0].supported_accessibility.clone(),
    });
    let mut delivery = DeliveryProfile::browser_bundled_example(&host);
    delivery.default_surface = "vmz.surface.missing".into();
    let input = ProfileSolverInput {
        schema: SOLVER_INPUT_SCHEMA.into(),
        regions: vec![RegionSolveRequest {
            region_id: "region:x".into(),
            route_id: Some("pages/index".into()),
            requirements: SurfaceRequirements {
                schema: SURFACE_REQUIREMENTS_SCHEMA.into(),
                required_operations: vec!["CreateNode".into()],
                required_element_kinds: vec!["element".into()],
                required_events: vec![],
                required_style_features: vec![],
                required_accessibility: vec![],
                required_capabilities: vec![],
                co_location_constraints: vec![],
            },
            requires_surface: None,
            prefers_surface: Some("vmz.surface.native.alt".into()),
        }],
        capabilities: vec![],
        routes: vec![RouteSolveRequest { route_id: "pages/index".into(), is_entry: true }],
    };
    let mut diags = Vec::new();
    let manifest = solve_profile(&host, &delivery, &input, &mut diags);
    assert!(diags.iter().all(|d| d.is_error() == false));
    assert_eq!(manifest.surface_assignments.assignments[0].surface_id, "vmz.surface.native.alt");
    assert_eq!(
        manifest.surface_assignments.assignments[0].reason,
        SurfaceAssignmentReason::PrefersSurface
    );
    let _ = input;
}
