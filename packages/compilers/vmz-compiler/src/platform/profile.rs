//! HostProfile / DeliveryProfile protocol freeze (architecture notes / ).
//!
//! Algebraic first version: schema + version + namespaced contribution +
//! resolution digest. No Surface/capability/route solver . No real Host
//! adapters.

use std::fs;
use std::path::Path;

use vmz_protocol::{
    CORE_ID_PREFIX, DELIVERY_PROFILE_SCHEMA, DIAG_CONTRIBUTION_NOT_NAMESPACED,
    DIAG_CORE_ID_OVERRIDE, DIAG_DELIVERY_PROFILE_INVALID, DIAG_HOST_PROFILE_INVALID,
    DIAG_HOST_PROFILE_REF_UNRESOLVED, DIAG_PROFILE_VERSION_INVALID,
    DIAG_RESOLUTION_DIGEST_MISMATCH, DIAG_RESOLUTION_DIGEST_MISSING, DeliveryProfile,
    HOST_PROFILE_SCHEMA, HostProfile, PROFILE_CHECK_SCHEMA, PROFILE_CONTRIBUTION_SCHEMA,
    ProfileCheckReport, ProfileContribution, ProfileDiagnostic, ProfileProtocolCatalog,
    RESOLUTION_DIGEST_SCHEMA, UnifiedLifecycleEvent, canonical_digest_value,
};

fn diag(
    path: &str,
    severity: vmz_protocol::Severity,
    message: impl Into<String>,
    code: &str,
) -> ProfileDiagnostic {
    ProfileDiagnostic::with_severity(path, severity, message).with_code(code)
}

fn validate_host(host: &HostProfile, out: &mut Vec<ProfileDiagnostic>) {
    if host.schema != HOST_PROFILE_SCHEMA {
        out.push(diag(
            "host.schema",
            vmz_protocol::Severity::Error,
            format!("HostProfile schema must be `{HOST_PROFILE_SCHEMA}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if host.schema_version.trim().is_empty() {
        out.push(diag(
            "host.schemaVersion",
            vmz_protocol::Severity::Error,
            "HostProfile.schemaVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if host.host_id.trim().is_empty() || !host.host_id.starts_with(CORE_ID_PREFIX) {
        out.push(diag(
            "host.hostId",
            vmz_protocol::Severity::Error,
            format!("core HostProfile.hostId must start with `{CORE_ID_PREFIX}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if host.host_version.trim().is_empty() {
        out.push(diag(
            "host.hostVersion",
            vmz_protocol::Severity::Error,
            "HostProfile.hostVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if host.surfaces.is_empty() {
        out.push(diag(
            "host.surfaces",
            vmz_protocol::Severity::Error,
            "HostProfile must declare at least one SurfaceBinding",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    for (i, s) in host.surfaces.iter().enumerate() {
        if s.surface_id.trim().is_empty() || s.driver_id.trim().is_empty() {
            out.push(diag(
                &format!("host.surfaces[{i}]"),
                vmz_protocol::Severity::Error,
                "SurfaceBinding requires surfaceId + driverId",
                DIAG_HOST_PROFILE_INVALID,
            ));
        }
    }
    for ev in UnifiedLifecycleEvent::ALL {
        if !host.lifecycle.iter().any(|b| b.vmz_lifecycle == *ev) {
            out.push(diag(
                "host.lifecycle",
                vmz_protocol::Severity::Error,
                format!("missing LifecycleBinding for unified event `{}`", ev.as_str()),
                DIAG_HOST_PROFILE_INVALID,
            ));
        }
    }
    if host.navigation.route_realizer_id.trim().is_empty() {
        out.push(diag(
            "host.navigation",
            vmz_protocol::Severity::Error,
            "NavigationBinding requires routeRealizerId",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    // Closed [`NavigationStackModel`] validates at deserialize.
    if host.constraints.allows_runtime_driver_select {
        out.push(diag(
            "host.constraints.allowsRuntimeDriverSelect",
            vmz_protocol::Severity::Error,
            "runtime driver select (isIOS/isWechat) is forbidden — assignment is compile-time only",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if !host.constraints.requires_resolution_digest {
        out.push(diag(
            "host.constraints.requiresResolutionDigest",
            vmz_protocol::Severity::Error,
            "HostProfile must require resolution digest (P0)",
            DIAG_RESOLUTION_DIGEST_MISSING,
        ));
    }
}

fn validate_delivery(
    host: &HostProfile,
    delivery: &DeliveryProfile,
    out: &mut Vec<ProfileDiagnostic>,
) {
    if delivery.schema != DELIVERY_PROFILE_SCHEMA {
        out.push(diag(
            "delivery.schema",
            vmz_protocol::Severity::Error,
            format!("DeliveryProfile schema must be `{DELIVERY_PROFILE_SCHEMA}`"),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if delivery.schema_version.trim().is_empty() {
        out.push(diag(
            "delivery.schemaVersion",
            vmz_protocol::Severity::Error,
            "DeliveryProfile.schemaVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if delivery.delivery_id.trim().is_empty() {
        out.push(diag(
            "delivery.deliveryId",
            vmz_protocol::Severity::Error,
            "DeliveryProfile.deliveryId required",
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if delivery.host_profile_ref != host.host_id {
        out.push(diag(
            "delivery.hostProfileRef",
            vmz_protocol::Severity::Error,
            format!(
                "hostProfileRef `{}` does not resolve to hostId `{}`",
                delivery.host_profile_ref, host.host_id
            ),
            DIAG_HOST_PROFILE_REF_UNRESOLVED,
        ));
    }
    if delivery.default_surface.trim().is_empty()
        || !host.surfaces.iter().any(|s| s.surface_id == delivery.default_surface)
    {
        out.push(diag(
            "delivery.defaultSurface",
            vmz_protocol::Severity::Error,
            format!(
                "defaultSurface `{}` must reference a HostProfile SurfaceBinding",
                delivery.default_surface
            ),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    match &delivery.resolution_digest {
        None => out.push(diag(
            "delivery.resolutionDigest",
            vmz_protocol::Severity::Error,
            "resolution digest required on DeliveryProfile (host startup must verify)",
            DIAG_RESOLUTION_DIGEST_MISSING,
        )),
        Some(d) => {
            if d.schema != RESOLUTION_DIGEST_SCHEMA {
                out.push(diag(
                    "delivery.resolutionDigest.schema",
                    vmz_protocol::Severity::Error,
                    format!("digest schema must be `{RESOLUTION_DIGEST_SCHEMA}`"),
                    DIAG_RESOLUTION_DIGEST_MISSING,
                ));
            }
            if d.value.trim().is_empty() {
                out.push(diag(
                    "delivery.resolutionDigest",
                    vmz_protocol::Severity::Error,
                    "resolution digest value required",
                    DIAG_RESOLUTION_DIGEST_MISSING,
                ));
            }
            let expected = canonical_digest_value(host, &delivery.delivery_id);
            if d.value != expected
                || d.host_profile_id != host.host_id
                || d.delivery_id != delivery.delivery_id
            {
                out.push(diag(
                    "delivery.resolutionDigest.value",
                    vmz_protocol::Severity::Error,
                    format!("resolution digest mismatch (expected `{expected}`)"),
                    DIAG_RESOLUTION_DIGEST_MISMATCH,
                ));
            }
        }
    }
}

fn validate_contribution(c: &ProfileContribution, out: &mut Vec<ProfileDiagnostic>) {
    if c.schema != PROFILE_CONTRIBUTION_SCHEMA {
        out.push(diag(
            "contribution.schema",
            vmz_protocol::Severity::Error,
            format!("contribution schema must be `{PROFILE_CONTRIBUTION_SCHEMA}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    let ns = c.plugin_namespace.trim();
    if ns.is_empty() || ns.starts_with(CORE_ID_PREFIX) {
        out.push(diag(
            "contribution.pluginNamespace",
            vmz_protocol::Severity::Error,
            "pluginNamespace required and must not use reserved `vmz.` core prefix",
            DIAG_CONTRIBUTION_NOT_NAMESPACED,
        ));
        return;
    }
    let prefix = format!("{ns}.");
    let mut check_ids = |field: &str, ids: &[String]| {
        for id in ids {
            if id.starts_with(CORE_ID_PREFIX) {
                out.push(diag(
                    field,
                    vmz_protocol::Severity::Error,
                    format!("contribution must not override core id `{id}`"),
                    DIAG_CORE_ID_OVERRIDE,
                ));
            } else if !id.starts_with(&prefix) {
                out.push(diag(
                    field,
                    vmz_protocol::Severity::Error,
                    format!("contribution id `{id}` must be under namespace `{prefix}`"),
                    DIAG_CONTRIBUTION_NOT_NAMESPACED,
                ));
            }
        }
    };
    check_ids("contribution.surfaceIds", &c.surface_ids);
    check_ids("contribution.capabilityIds", &c.capability_ids);
    check_ids("contribution.providerIds", &c.provider_ids);
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
                    DIAG_HOST_PROFILE_INVALID,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                vmz_protocol::Severity::Error,
                format!("cannot read: {e}"),
                DIAG_HOST_PROFILE_INVALID,
            ));
            None
        }
    }
}

/// Check host/delivery/contribution profile JSON for a workspace root.
///
/// Loads optional `host-profile.json`, `delivery-profile.json`, and
/// `profile-contribution.json`, validating them against the profile protocol catalog.
pub fn check_host_profile_protocol(root: &Path) -> ProfileCheckReport {
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

    let contribution = load_json::<ProfileContribution>(
        &root.join("profile-contribution.json"),
        "profile-contribution.json",
        &mut diagnostics,
    );

    validate_host(&host, &mut diagnostics);
    validate_delivery(&host, &delivery, &mut diagnostics);
    if let Some(ref c) = contribution {
        validate_contribution(c, &mut diagnostics);
    }

    // Foul fixtures (optional) accumulate extra rejects for gate smoke.
    if let Some(bad) = load_json::<HostProfile>(
        &root.join("host-profile.foul.json"),
        "host-profile.foul.json",
        &mut diagnostics,
    ) {
        validate_host(&bad, &mut diagnostics);
    }
    if let Some(bad) = load_json::<DeliveryProfile>(
        &root.join("delivery-profile.foul.json"),
        "delivery-profile.foul.json",
        &mut diagnostics,
    ) {
        validate_delivery(&host, &bad, &mut diagnostics);
    }
    if let Some(bad) = load_json::<ProfileContribution>(
        &root.join("profile-contribution.foul.json"),
        "profile-contribution.foul.json",
        &mut diagnostics,
    ) {
        validate_contribution(&bad, &mut diagnostics);
    }

    let failed = diagnostics.iter().any(|d| d.is_error());
    ProfileCheckReport {
        schema: PROFILE_CHECK_SCHEMA.into(),
        catalog,
        host_profile: host,
        delivery_profile: delivery,
        contribution,
        diagnostics,
        status: vmz_protocol::CheckReportStatus::from_failed(failed),
    }
}
