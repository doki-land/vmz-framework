//! P1: deterministic HostProfile solver (doc 13 §4.6 / §4.12 / §4.14).
//!
//! Algebraic first version: resolve Surface / capability / route against
//! HostProfile + DeliveryProfile; emit assignment tables + HostResolutionManifest.
//! Diagnose SURFACE_NO_MATCH / SURFACE_AMBIGUOUS / CAPABILITY_* / ROUTE_UNREALIZABLE.
//! Does not run real VPG inference (fixtures supply requirements).

use std::fs;
use std::path::Path;

use vmz_protocol::{
    CapabilityRequirement, CapabilityResolution, CapabilityResolutionTable,
    DIAG_CAPABILITY_PERMISSION_UNDECLARED, DIAG_CAPABILITY_UNRESOLVED, DIAG_ROUTE_UNREALIZABLE,
    DIAG_SURFACE_AMBIGUOUS, DIAG_SURFACE_NO_MATCH, DeliveryProfile,
    HOST_RESOLUTION_MANIFEST_SCHEMA, HostProfile, HostResolutionManifest, ProfileDiagnostic,
    ProfileProtocolCatalog, ProfileSolverCheckReport, ProfileSolverInput, RouteRealization,
    RouteRealizationTable, SOLVER_CHECK_SCHEMA, SurfaceAssignment, SurfaceAssignmentTable,
    SurfaceBinding, SurfaceReject, SurfaceRequirements,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn missing_subset(required: &[String], supported: &[String]) -> Vec<String> {
    required.iter().filter(|r| !supported.iter().any(|s| s == *r)).cloned().collect()
}

fn surface_satisfies(
    binding: &SurfaceBinding,
    req: &SurfaceRequirements,
    host: &HostProfile,
) -> Result<(), Vec<String>> {
    let mut unsatisfied = Vec::new();
    unsatisfied.extend(
        missing_subset(&req.required_operations, &binding.supported_operations)
            .into_iter()
            .map(|x| format!("operation:{x}")),
    );
    unsatisfied.extend(
        missing_subset(&req.required_element_kinds, &binding.supported_element_kinds)
            .into_iter()
            .map(|x| format!("element:{x}")),
    );
    unsatisfied.extend(
        missing_subset(&req.required_events, &binding.supported_event_kinds)
            .into_iter()
            .map(|x| format!("event:{x}")),
    );
    unsatisfied.extend(
        missing_subset(&req.required_style_features, &binding.supported_style_features)
            .into_iter()
            .map(|x| format!("style:{x}")),
    );
    unsatisfied.extend(
        missing_subset(&req.required_accessibility, &binding.supported_accessibility)
            .into_iter()
            .map(|x| format!("a11y:{x}")),
    );
    for cap in &req.required_capabilities {
        if !host.capabilities.iter().any(|c| &c.capability_id == cap) {
            unsatisfied.push(format!("capability:{cap}"));
        }
    }
    if unsatisfied.is_empty() { Ok(()) } else { Err(unsatisfied) }
}

fn score_candidate(
    surface_id: &str,
    delivery_default: &str,
    prefers: Option<&str>,
    requires: Option<&str>,
) -> i32 {
    let mut score = 0;
    if requires == Some(surface_id) {
        score += 1000;
    }
    if prefers == Some(surface_id) {
        score += 100;
    }
    if surface_id == delivery_default {
        score += 50;
    }
    score
}

fn reason_for(
    score: i32,
    prefers: Option<&str>,
    requires: Option<&str>,
    surface_id: &str,
) -> String {
    if requires == Some(surface_id) {
        "requires_surface".into()
    } else if prefers == Some(surface_id) {
        "prefers_surface".into()
    } else if score >= 50 {
        "default_surface".into()
    } else {
        "unique".into()
    }
}

/// Deterministic surface solve for one region.
pub fn solve_surface_region(
    host: &HostProfile,
    delivery: &DeliveryProfile,
    region_id: &str,
    req: &SurfaceRequirements,
    requires_surface: Option<&str>,
    prefers_surface: Option<&str>,
    out: &mut Vec<ProfileDiagnostic>,
) -> Option<SurfaceAssignment> {
    let mut rejected = Vec::new();
    let mut candidates: Vec<&SurfaceBinding> = Vec::new();

    for binding in &host.surfaces {
        match surface_satisfies(binding, req, host) {
            Ok(()) => candidates.push(binding),
            Err(unsatisfied) => rejected.push(SurfaceReject {
                surface_id: binding.surface_id.clone(),
                reason: "requirements_unsatisfied".into(),
                unsatisfied,
            }),
        }
    }

    if let Some(req_id) = requires_surface {
        let before = candidates.len();
        candidates.retain(|c| c.surface_id == req_id);
        if before > 0 && candidates.is_empty() {
            out.push(diag(
                &format!("regions.{region_id}"),
                "error",
                format!("requiresSurface `{req_id}` is not among capability-matching candidates"),
                DIAG_SURFACE_NO_MATCH,
            ));
            return None;
        }
    }

    if candidates.is_empty() {
        let mut unsatisfied: Vec<String> =
            rejected.iter().flat_map(|r| r.unsatisfied.iter().cloned()).collect();
        unsatisfied.sort();
        unsatisfied.dedup();
        out.push(diag(
            &format!("regions.{region_id}"),
            "error",
            format!(
                "SURFACE_NO_MATCH: no SurfaceBinding satisfies region; unsatisfied={unsatisfied:?}"
            ),
            DIAG_SURFACE_NO_MATCH,
        ));
        return None;
    }

    let mut ranked: Vec<(&SurfaceBinding, i32)> = candidates
        .into_iter()
        .map(|c| {
            (
                c,
                score_candidate(
                    &c.surface_id,
                    &delivery.default_surface,
                    prefers_surface,
                    requires_surface,
                ),
            )
        })
        .collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.surface_id.cmp(&b.0.surface_id)));

    let top_score = ranked[0].1;
    let top: Vec<&SurfaceBinding> =
        ranked.iter().filter(|(_, s)| *s == top_score).map(|(c, _)| *c).collect();

    if top.len() == 1 {
        let chosen = top[0];
        return Some(SurfaceAssignment {
            region_id: region_id.into(),
            surface_id: chosen.surface_id.clone(),
            driver_id: chosen.driver_id.clone(),
            reason: reason_for(top_score, prefers_surface, requires_surface, &chosen.surface_id),
            rejected,
        });
    }

    // Multiple top-score candidates.
    let same_behavior = top.windows(2).all(|w| {
        w[0].kind == w[1].kind
            && w[0].driver_id == w[1].driver_id
            && w[0].supported_operations == w[1].supported_operations
    });
    if same_behavior {
        let chosen = top[0];
        return Some(SurfaceAssignment {
            region_id: region_id.into(),
            surface_id: chosen.surface_id.clone(),
            driver_id: chosen.driver_id.clone(),
            reason: "deterministic_tiebreak".into(),
            rejected,
        });
    }

    let ids: Vec<&str> = top.iter().map(|c| c.surface_id.as_str()).collect();
    out.push(diag(
        &format!("regions.{region_id}"),
        "error",
        format!(
            "SURFACE_AMBIGUOUS: multiple non-equivalent candidates {ids:?}; require explicit surfacePolicies / prefersSurface / requiresSurface"
        ),
        DIAG_SURFACE_AMBIGUOUS,
    ));
    None
}

pub fn solve_capabilities(
    host: &HostProfile,
    reqs: &[CapabilityRequirement],
    out: &mut Vec<ProfileDiagnostic>,
) -> CapabilityResolutionTable {
    let mut resolutions = Vec::new();
    for req in reqs {
        let Some(binding) = host.capabilities.iter().find(|c| c.capability_id == req.capability_id)
        else {
            out.push(diag(
                &format!("capabilities.{}", req.capability_id),
                "error",
                format!("CAPABILITY_UNRESOLVED: `{}`", req.capability_id),
                DIAG_CAPABILITY_UNRESOLVED,
            ));
            continue;
        };
        for perm in &req.permissions {
            if !binding.permissions.iter().any(|p| p == perm) {
                out.push(diag(
                    &format!("capabilities.{}.permissions", req.capability_id),
                    "error",
                    format!(
                        "CAPABILITY_PERMISSION_UNDECLARED: `{perm}` not declared on provider `{}`",
                        binding.provider_id
                    ),
                    DIAG_CAPABILITY_PERMISSION_UNDECLARED,
                ));
            }
        }
        if out.iter().any(|d| {
            d.severity == "error"
                && d.path.contains(&req.capability_id)
                && d.code.as_deref() == Some(DIAG_CAPABILITY_PERMISSION_UNDECLARED)
        }) {
            // still record nothing for failed permission — keep table clean
            continue;
        }
        resolutions.push(CapabilityResolution {
            capability_id: binding.capability_id.clone(),
            provider_id: binding.provider_id.clone(),
            execution_domain: binding.execution_domain.clone(),
            transport_id: binding.transport_id.clone(),
            region_id: req.region_id.clone(),
        });
    }
    CapabilityResolutionTable {
        schema: vmz_protocol::CAPABILITY_RESOLUTION_TABLE_SCHEMA.into(),
        resolutions,
    }
}

pub fn solve_routes(
    host: &HostProfile,
    delivery: &DeliveryProfile,
    input: &ProfileSolverInput,
    assignments: &[SurfaceAssignment],
    out: &mut Vec<ProfileDiagnostic>,
) -> RouteRealizationTable {
    let mut realizations = Vec::new();
    let nav = &host.navigation;

    if nav.route_realizer_id.trim().is_empty() || nav.stack_model.trim().is_empty() {
        out.push(diag(
            "navigation",
            "error",
            "ROUTE_UNREALIZABLE: NavigationBinding missing routeRealizerId/stackModel",
            DIAG_ROUTE_UNREALIZABLE,
        ));
        return RouteRealizationTable {
            schema: vmz_protocol::ROUTE_REALIZATION_TABLE_SCHEMA.into(),
            realizations,
        };
    }
    if nav.stack_model == "none" && !input.routes.is_empty() {
        out.push(diag(
            "navigation.stackModel",
            "error",
            "ROUTE_UNREALIZABLE: stackModel=none cannot realize routes",
            DIAG_ROUTE_UNREALIZABLE,
        ));
    }

    for route in &input.routes {
        if route.route_id.trim().is_empty() {
            out.push(diag(
                "routes",
                "error",
                "ROUTE_UNREALIZABLE: empty routeId",
                DIAG_ROUTE_UNREALIZABLE,
            ));
            continue;
        }
        let owning = input
            .regions
            .iter()
            .find(|r| r.route_id.as_deref() == Some(route.route_id.as_str()))
            .map(|r| r.region_id.clone());
        let surface_ids: Vec<String> = assignments
            .iter()
            .filter(|a| {
                input.regions.iter().any(|r| {
                    r.region_id == a.region_id
                        && r.route_id.as_deref() == Some(route.route_id.as_str())
                })
            })
            .map(|a| a.surface_id.clone())
            .collect();
        realizations.push(RouteRealization {
            route_id: route.route_id.clone(),
            route_realizer_id: nav.route_realizer_id.clone(),
            stack_model: nav.stack_model.clone(),
            owning_lifetime_region: owning,
            surface_ids,
        });
    }

    for entry in &delivery.entry_routes {
        if !realizations.iter().any(|r| &r.route_id == entry) {
            out.push(diag(
                "delivery.entryRoutes",
                "error",
                format!("ROUTE_UNREALIZABLE: entry route `{entry}` has no RouteRealization"),
                DIAG_ROUTE_UNREALIZABLE,
            ));
        }
    }

    RouteRealizationTable {
        schema: vmz_protocol::ROUTE_REALIZATION_TABLE_SCHEMA.into(),
        realizations,
    }
}

pub fn solve_profile(
    host: &HostProfile,
    delivery: &DeliveryProfile,
    input: &ProfileSolverInput,
    out: &mut Vec<ProfileDiagnostic>,
) -> HostResolutionManifest {
    let mut assignments = Vec::new();
    for region in &input.regions {
        if let Some(a) = solve_surface_region(
            host,
            delivery,
            &region.region_id,
            &region.requirements,
            region.requires_surface.as_deref(),
            region.prefers_surface.as_deref(),
            out,
        ) {
            assignments.push(a);
        }
    }
    let caps = solve_capabilities(host, &input.capabilities, out);
    let routes = solve_routes(host, delivery, input, &assignments, out);
    HostResolutionManifest {
        schema: HOST_RESOLUTION_MANIFEST_SCHEMA.into(),
        host_profile_id: host.host_id.clone(),
        delivery_id: delivery.delivery_id.clone(),
        surface_assignments: SurfaceAssignmentTable {
            schema: vmz_protocol::SURFACE_ASSIGNMENT_TABLE_SCHEMA.into(),
            assignments,
        },
        capability_resolutions: caps,
        route_realizations: routes,
    }
}

fn load_json<T: serde::de::DeserializeOwned>(
    path: &Path,
    label: &str,
    diags: &mut Vec<ProfileDiagnostic>,
) -> Option<T> {
    if !path.is_file() {
        return None;
    }
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str::<T>(&text) {
            Ok(v) => Some(v),
            Err(e) => {
                diags.push(diag(
                    label,
                    "error",
                    format!("invalid JSON: {e}"),
                    DIAG_SURFACE_NO_MATCH,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(label, "error", format!("cannot read: {e}"), DIAG_SURFACE_NO_MATCH));
            None
        }
    }
}

/// P1 check for a workspace root (optional host/delivery/solver-input JSON).
pub fn check_p1_profile_solver(root: &Path) -> ProfileSolverCheckReport {
    let mut diagnostics = Vec::new();
    let catalog = ProfileProtocolCatalog::v0();
    let host = load_json::<HostProfile>(
        &root.join("host-profile.json"),
        "host-profile.json",
        &mut diagnostics,
    )
    .unwrap_or_else(HostProfile::browser_example);
    let delivery = load_json::<DeliveryProfile>(
        &root.join("delivery-profile.json"),
        "delivery-profile.json",
        &mut diagnostics,
    )
    .unwrap_or_else(|| DeliveryProfile::browser_bundled_example(&host));
    let solver_input = load_json::<ProfileSolverInput>(
        &root.join("solver-input.json"),
        "solver-input.json",
        &mut diagnostics,
    )
    .unwrap_or_else(ProfileSolverInput::browser_counter_example);

    let manifest = solve_profile(&host, &delivery, &solver_input, &mut diagnostics);

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    ProfileSolverCheckReport {
        schema: SOLVER_CHECK_SCHEMA.into(),
        catalog,
        host_profile: host,
        delivery_profile: delivery,
        solver_input,
        manifest,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use vmz_protocol::{
        CAPABILITY_BINDING_SCHEMA, CapabilityBinding, RegionSolveRequest, RouteSolveRequest,
        SOLVER_INPUT_SCHEMA, SURFACE_BINDING_SCHEMA, SURFACE_REQUIREMENTS_SCHEMA,
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
        let report = check_p1_profile_solver(&dir);
        assert_eq!(report.status, "ready");
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
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
            .unwrap();
        let report = check_p1_profile_solver(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_SURFACE_NO_MATCH))
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
            kind: "native".into(),
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
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
            .unwrap();
        let report = check_p1_profile_solver(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_SURFACE_AMBIGUOUS))
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
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
            .unwrap();
        let report = check_p1_profile_solver(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_CAPABILITY_UNRESOLVED))
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
            execution_domain: "native".into(),
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
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        fs::write(dir.join("solver-input.json"), serde_json::to_string_pretty(&input).unwrap())
            .unwrap();
        let report = check_p1_profile_solver(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_CAPABILITY_PERMISSION_UNDECLARED))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prefers_surface_breaks_ambiguity() {
        let mut host = HostProfile::browser_example();
        host.surfaces.push(SurfaceBinding {
            schema: SURFACE_BINDING_SCHEMA.into(),
            surface_id: "vmz.surface.native.alt".into(),
            kind: "native".into(),
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
        assert!(diags.iter().all(|d| d.severity != "error"));
        assert_eq!(
            manifest.surface_assignments.assignments[0].surface_id,
            "vmz.surface.native.alt"
        );
        assert_eq!(manifest.surface_assignments.assignments[0].reason, "prefers_surface");
        let _ = input;
    }
}
