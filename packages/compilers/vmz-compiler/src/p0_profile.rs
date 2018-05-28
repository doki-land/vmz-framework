//! P0: HostProfile / DeliveryProfile protocol freeze (doc 13 §4.5 / §4.14).
//!
//! Algebraic first version: schema + version + namespaced contribution +
//! resolution digest. No Surface/capability/route solver (P1). No real Host
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
    RESOLUTION_DIGEST_SCHEMA, SURFACE_KINDS, UNIFIED_LIFECYCLE_EVENTS, canonical_digest_value,
};

fn diag(path: &str, severity: &str, message: impl Into<String>, code: &str) -> ProfileDiagnostic {
    ProfileDiagnostic {
        path: path.into(),
        severity: severity.into(),
        message: message.into(),
        code: Some(code.into()),
    }
}

fn validate_host(host: &HostProfile, out: &mut Vec<ProfileDiagnostic>) {
    if host.schema != HOST_PROFILE_SCHEMA {
        out.push(diag(
            "host.schema",
            "error",
            format!("HostProfile schema must be `{HOST_PROFILE_SCHEMA}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if host.schema_version.trim().is_empty() {
        out.push(diag(
            "host.schemaVersion",
            "error",
            "HostProfile.schemaVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if host.host_id.trim().is_empty() || !host.host_id.starts_with(CORE_ID_PREFIX) {
        out.push(diag(
            "host.hostId",
            "error",
            format!("core HostProfile.hostId must start with `{CORE_ID_PREFIX}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if host.host_version.trim().is_empty() {
        out.push(diag(
            "host.hostVersion",
            "error",
            "HostProfile.hostVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if host.surfaces.is_empty() {
        out.push(diag(
            "host.surfaces",
            "error",
            "HostProfile must declare at least one SurfaceBinding",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    for (i, s) in host.surfaces.iter().enumerate() {
        if !SURFACE_KINDS.contains(&s.kind.as_str()) {
            out.push(diag(
                &format!("host.surfaces[{i}].kind"),
                "error",
                format!("unknown surface kind `{}`", s.kind),
                DIAG_HOST_PROFILE_INVALID,
            ));
        }
        if s.surface_id.trim().is_empty() || s.driver_id.trim().is_empty() {
            out.push(diag(
                &format!("host.surfaces[{i}]"),
                "error",
                "SurfaceBinding requires surfaceId + driverId",
                DIAG_HOST_PROFILE_INVALID,
            ));
        }
    }
    for ev in UNIFIED_LIFECYCLE_EVENTS {
        if !host.lifecycle.iter().any(|b| b.vmz_lifecycle == *ev) {
            out.push(diag(
                "host.lifecycle",
                "error",
                format!("missing LifecycleBinding for unified event `{ev}`"),
                DIAG_HOST_PROFILE_INVALID,
            ));
        }
    }
    if host.navigation.route_realizer_id.trim().is_empty()
        || host.navigation.stack_model.trim().is_empty()
    {
        out.push(diag(
            "host.navigation",
            "error",
            "NavigationBinding requires routeRealizerId + stackModel",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if host.constraints.allows_runtime_driver_select {
        out.push(diag(
            "host.constraints.allowsRuntimeDriverSelect",
            "error",
            "runtime driver select (isIOS/isWechat) is forbidden — assignment is compile-time only",
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    if !host.constraints.requires_resolution_digest {
        out.push(diag(
            "host.constraints.requiresResolutionDigest",
            "error",
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
            "error",
            format!("DeliveryProfile schema must be `{DELIVERY_PROFILE_SCHEMA}`"),
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if delivery.schema_version.trim().is_empty() {
        out.push(diag(
            "delivery.schemaVersion",
            "error",
            "DeliveryProfile.schemaVersion required",
            DIAG_PROFILE_VERSION_INVALID,
        ));
    }
    if delivery.delivery_id.trim().is_empty() {
        out.push(diag(
            "delivery.deliveryId",
            "error",
            "DeliveryProfile.deliveryId required",
            DIAG_DELIVERY_PROFILE_INVALID,
        ));
    }
    if delivery.host_profile_ref != host.host_id {
        out.push(diag(
            "delivery.hostProfileRef",
            "error",
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
            "error",
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
            "error",
            "resolution digest required on DeliveryProfile (host startup must verify)",
            DIAG_RESOLUTION_DIGEST_MISSING,
        )),
        Some(d) => {
            if d.schema != RESOLUTION_DIGEST_SCHEMA {
                out.push(diag(
                    "delivery.resolutionDigest.schema",
                    "error",
                    format!("digest schema must be `{RESOLUTION_DIGEST_SCHEMA}`"),
                    DIAG_RESOLUTION_DIGEST_MISSING,
                ));
            }
            if d.algorithm.trim().is_empty() || d.value.trim().is_empty() {
                out.push(diag(
                    "delivery.resolutionDigest",
                    "error",
                    "resolution digest algorithm + value required",
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
                    "error",
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
            "error",
            format!("contribution schema must be `{PROFILE_CONTRIBUTION_SCHEMA}`"),
            DIAG_HOST_PROFILE_INVALID,
        ));
    }
    let ns = c.plugin_namespace.trim();
    if ns.is_empty() || ns.starts_with(CORE_ID_PREFIX) {
        out.push(diag(
            "contribution.pluginNamespace",
            "error",
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
                    "error",
                    format!("contribution must not override core id `{id}`"),
                    DIAG_CORE_ID_OVERRIDE,
                ));
            } else if !id.starts_with(&prefix) {
                out.push(diag(
                    field,
                    "error",
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
                    "error",
                    format!("invalid JSON: {e}"),
                    DIAG_HOST_PROFILE_INVALID,
                ));
                None
            }
        },
        Err(e) => {
            diags.push(diag(
                label,
                "error",
                format!("cannot read: {e}"),
                DIAG_HOST_PROFILE_INVALID,
            ));
            None
        }
    }
}

/// P0 check for a workspace root (optional host/delivery/contribution JSON).
pub fn check_p0_profile_protocol(root: &Path) -> ProfileCheckReport {
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

    let failed = diagnostics.iter().any(|d| d.severity == "error");
    ProfileCheckReport {
        schema: PROFILE_CHECK_SCHEMA.into(),
        catalog,
        host_profile: host,
        delivery_profile: delivery,
        contribution,
        diagnostics,
        status: if failed { "failed".into() } else { "ready".into() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp(prefix: &str) -> std::path::PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("{prefix}{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn browser_host_delivery_ready() {
        let dir = tmp("vmz-p0-");
        let report = check_p0_profile_protocol(&dir);
        assert_eq!(report.status, "ready");
        assert_eq!(report.host_profile.host_id, "vmz.host.browser");
        assert!(report.delivery_profile.resolution_digest.is_some());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_runtime_driver_select() {
        let dir = tmp("vmz-p0-rt-");
        let mut host = HostProfile::browser_example();
        host.constraints.allows_runtime_driver_select = true;
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        let delivery = DeliveryProfile::browser_bundled_example(&host);
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        let report = check_p0_profile_protocol(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_HOST_PROFILE_INVALID))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_digest_mismatch() {
        let dir = tmp("vmz-p0-digest-");
        let host = HostProfile::browser_example();
        let mut delivery = DeliveryProfile::browser_bundled_example(&host);
        if let Some(d) = delivery.resolution_digest.as_mut() {
            d.value = "sha256:tampered".into();
        }
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        let report = check_p0_profile_protocol(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_RESOLUTION_DIGEST_MISMATCH))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_core_id_override() {
        let dir = tmp("vmz-p0-core-");
        let foul = ProfileContribution {
            schema: PROFILE_CONTRIBUTION_SCHEMA.into(),
            plugin_namespace: "com.example".into(),
            surface_ids: vec!["vmz.surface.web.main".into()],
            capability_ids: vec![],
            provider_ids: vec![],
        };
        fs::write(
            dir.join("profile-contribution.json"),
            serde_json::to_string_pretty(&foul).unwrap(),
        )
        .unwrap();
        let report = check_p0_profile_protocol(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report.diagnostics.iter().any(|d| d.code.as_deref() == Some(DIAG_CORE_ID_OVERRIDE))
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_unresolved_host_ref() {
        let dir = tmp("vmz-p0-ref-");
        let host = HostProfile::browser_example();
        let mut delivery = DeliveryProfile::browser_bundled_example(&host);
        delivery.host_profile_ref = "vmz.host.missing".into();
        fs::write(dir.join("host-profile.json"), serde_json::to_string_pretty(&host).unwrap())
            .unwrap();
        fs::write(
            dir.join("delivery-profile.json"),
            serde_json::to_string_pretty(&delivery).unwrap(),
        )
        .unwrap();
        let report = check_p0_profile_protocol(&dir);
        assert_eq!(report.status, "failed");
        assert!(
            report
                .diagnostics
                .iter()
                .any(|d| d.code.as_deref() == Some(DIAG_HOST_PROFILE_REF_UNRESOLVED))
        );
        let _ = fs::remove_dir_all(&dir);
    }
}
