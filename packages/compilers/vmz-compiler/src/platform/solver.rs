//! deterministic HostProfile solver (architecture notes / ).
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
    HOST_RESOLUTION_MANIFEST_SCHEMA, HostProfile, HostResolutionManifest, NavigationStackModel,
    ProfileDiagnostic, ProfileProtocolCatalog, ProfileSolverCheckReport, ProfileSolverInput,
    RouteRealization, RouteRealizationTable, SOLVER_CHECK_SCHEMA, SurfaceAssignment,
    SurfaceAssignmentReason, SurfaceAssignmentTable, SurfaceBinding, SurfaceReject,
    SurfaceRejectReason, SurfaceRequirements,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> ProfileDiagnostic {
    ProfileDiagnostic::with_severity(path, severity, message).with_code(code)
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
) -> SurfaceAssignmentReason {
    if requires == Some(surface_id) {
        SurfaceAssignmentReason::RequiresSurface
    } else if prefers == Some(surface_id) {
        SurfaceAssignmentReason::PrefersSurface
    } else if score >= 50 {
        SurfaceAssignmentReason::DefaultSurface
    } else {
        SurfaceAssignmentReason::Unique
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
                reason: SurfaceRejectReason::RequirementsUnsatisfied,
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
                vmz_protocol::Severity::Error,
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
            vmz_protocol::Severity::Error,
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
            reason: SurfaceAssignmentReason::DeterministicTiebreak,
            rejected,
        });
    }

    let ids: Vec<&str> = top.iter().map(|c| c.surface_id.as_str()).collect();
    out.push(diag(
        &format!("regions.{region_id}"),
        vmz_protocol::Severity::Error,
        format!(
            "SURFACE_AMBIGUOUS: multiple non-equivalent candidates {ids:?}; require explicit surfacePolicies / prefersSurface / requiresSurface"
        ),
        DIAG_SURFACE_AMBIGUOUS,
    ));
    None
}

/// Resolve capability requirements against a host profile into a resolution table.
///
/// Emits `CAPABILITY_UNRESOLVED` diagnostics for requirements with no matching
/// host binding; successful rows carry execution domain and transport ids.
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
                vmz_protocol::Severity::Error,
                format!("CAPABILITY_UNRESOLVED: `{}`", req.capability_id),
                DIAG_CAPABILITY_UNRESOLVED,
            ));
            continue;
        };
        for perm in &req.permissions {
            if !binding.permissions.iter().any(|p| p == perm) {
                out.push(diag(
                    &format!("capabilities.{}.permissions", req.capability_id),
                    vmz_protocol::Severity::Error,
                    format!(
                        "CAPABILITY_PERMISSION_UNDECLARED: `{perm}` not declared on provider `{}`",
                        binding.provider_id
                    ),
                    DIAG_CAPABILITY_PERMISSION_UNDECLARED,
                ));
            }
        }
        if out.iter().any(|d| {
            d.is_error()
                && d.path().to_string_lossy().contains(&req.capability_id)
                && d.code_string().as_deref() == Some(DIAG_CAPABILITY_PERMISSION_UNDECLARED)
        }) {
            // still record nothing for failed permission — keep table clean
            continue;
        }
        resolutions.push(CapabilityResolution {
            capability_id: binding.capability_id.clone(),
            provider_id: binding.provider_id.clone(),
            execution_domain: binding.execution_domain,
            transport_id: binding.transport_id.clone(),
            region_id: req.region_id.clone(),
        });
    }
    CapabilityResolutionTable {
        schema: vmz_protocol::CAPABILITY_RESOLUTION_TABLE_SCHEMA.into(),
        resolutions,
    }
}

/// Realize routes from host navigation + delivery entry routes into a table.
///
/// Requires a `routeRealizerId` on the host navigation binding and a realization
/// for every delivery entry route; failures append `ROUTE_UNREALIZABLE` diagnostics.
pub fn solve_routes(
    host: &HostProfile,
    delivery: &DeliveryProfile,
    input: &ProfileSolverInput,
    assignments: &[SurfaceAssignment],
    out: &mut Vec<ProfileDiagnostic>,
) -> RouteRealizationTable {
    let mut realizations = Vec::new();
    let nav = &host.navigation;

    if nav.route_realizer_id.trim().is_empty() {
        out.push(diag(
            "navigation",
            vmz_protocol::Severity::Error,
            "ROUTE_UNREALIZABLE: NavigationBinding missing routeRealizerId",
            DIAG_ROUTE_UNREALIZABLE,
        ));
        return RouteRealizationTable {
            schema: vmz_protocol::ROUTE_REALIZATION_TABLE_SCHEMA.into(),
            realizations,
        };
    }
    // Closed [`NavigationStackModel`] validates at deserialize.
    if nav.stack_model == NavigationStackModel::None && !input.routes.is_empty() {
        out.push(diag(
            "navigation.stackModel",
            vmz_protocol::Severity::Error,
            "ROUTE_UNREALIZABLE: stackModel=none cannot realize routes",
            DIAG_ROUTE_UNREALIZABLE,
        ));
    }

    for route in &input.routes {
        if route.route_id.trim().is_empty() {
            out.push(diag(
                "routes",
                vmz_protocol::Severity::Error,
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
            stack_model: nav.stack_model,
            owning_lifetime_region: owning,
            surface_ids,
        });
    }

    for entry in &delivery.entry_routes {
        if !realizations.iter().any(|r| &r.route_id == entry) {
            out.push(diag(
                "delivery.entryRoutes",
                vmz_protocol::Severity::Error,
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

/// Solve surfaces, capabilities, and routes into a full [`HostResolutionManifest`].
///
/// Walks each solver-input region for surface assignment, then runs capability
/// and route solves, collecting all diagnostics into `out`.
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
                    vmz_protocol::Severity::Error,
                    format!("invalid JSON: {e}"),
                    DIAG_SURFACE_NO_MATCH,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                vmz_protocol::Severity::Error,
                format!("cannot read: {e}"),
                DIAG_SURFACE_NO_MATCH,
            ));
            None
        }
    }
}

/// Run the profile solver against optional host/delivery/solver-input JSON in a root.
///
/// Missing files fall back to built-in browser examples; returns a check report
/// with the solved manifest and accumulated diagnostics.
pub fn check_profile_solver(root: &Path) -> ProfileSolverCheckReport {
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

    let failed = diagnostics.iter().any(|d| d.is_error());
    ProfileSolverCheckReport {
        schema: SOLVER_CHECK_SCHEMA.into(),
        catalog,
        host_profile: host,
        delivery_profile: delivery,
        solver_input,
        manifest,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
