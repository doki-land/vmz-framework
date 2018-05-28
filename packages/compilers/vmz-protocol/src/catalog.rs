//! Umbrella protocol catalog — `vmz.protocol.v0`.

use serde::{Deserialize, Serialize};

use crate::application::{APPLICATION_PROTOCOL, ApplicationProtocolCatalog};
use crate::dx::{DX_PROTOCOL, DxCatalog};
use crate::host::{COMPILER_PROTOCOL, HOST_PROTOCOL};
use crate::locale::{LOCALE_PROTOCOL, LocaleProtocolCatalog};
use crate::native_host::{NATIVE_HOST_PROTOCOL, NativeHostProtocolCatalog};
use crate::plugin::PLUGIN_PROTOCOL;
use crate::profile::{PROFILE_PROTOCOL, ProfileProtocolCatalog};
use crate::program::{PLAN_SCHEMA, PROGRAM_SCHEMA};
use crate::target::{TARGET_PROTOCOL, TargetProtocolCatalog};
use crate::test::{TEST_PROTOCOL, TestCatalog};

/// Top-level protocol catalog schema (handshake / gate).
pub const PROTOCOL_CATALOG_SCHEMA: &str = "vmz.protocol.v0";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolDomain {
    pub kind: String,
    pub schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolCatalog {
    pub schema: String,
    pub host: String,
    pub compiler: String,
    pub plugin: String,
    pub program: String,
    pub plan: String,
    pub domains: Vec<ProtocolDomain>,
}

impl ProtocolCatalog {
    pub fn v0() -> Self {
        Self {
            schema: PROTOCOL_CATALOG_SCHEMA.into(),
            host: HOST_PROTOCOL.into(),
            compiler: COMPILER_PROTOCOL.into(),
            plugin: PLUGIN_PROTOCOL.into(),
            program: PROGRAM_SCHEMA.into(),
            plan: PLAN_SCHEMA.into(),
            domains: vec![
                ProtocolDomain { kind: "dx".into(), schema: DX_PROTOCOL.into() },
                ProtocolDomain { kind: "test".into(), schema: TEST_PROTOCOL.into() },
                ProtocolDomain { kind: "application".into(), schema: APPLICATION_PROTOCOL.into() },
                ProtocolDomain { kind: "target".into(), schema: TARGET_PROTOCOL.into() },
                ProtocolDomain { kind: "profile".into(), schema: PROFILE_PROTOCOL.into() },
                ProtocolDomain { kind: "native_host".into(), schema: NATIVE_HOST_PROTOCOL.into() },
                ProtocolDomain { kind: "locale".into(), schema: LOCALE_PROTOCOL.into() },
            ],
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    /// Nested catalogs for detailed domain handshake.
    pub fn dx(&self) -> DxCatalog {
        let _ = self;
        DxCatalog::v0()
    }

    pub fn test(&self) -> TestCatalog {
        let _ = self;
        TestCatalog::v0()
    }

    pub fn application(&self) -> ApplicationProtocolCatalog {
        let _ = self;
        ApplicationProtocolCatalog::v0()
    }

    pub fn target(&self) -> TargetProtocolCatalog {
        let _ = self;
        TargetProtocolCatalog::v0()
    }

    pub fn profile(&self) -> ProfileProtocolCatalog {
        let _ = self;
        ProfileProtocolCatalog::v0()
    }

    pub fn native_host(&self) -> NativeHostProtocolCatalog {
        let _ = self;
        NativeHostProtocolCatalog::v0()
    }

    pub fn locale(&self) -> LocaleProtocolCatalog {
        let _ = self;
        LocaleProtocolCatalog::v0()
    }
}
