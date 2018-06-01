//! Umbrella protocol catalog: `vmz.protocol.v0`.
//!
//! CLI, N-API, and conformance gates load this document to learn which domain
//! protocol ids the native side speaks. Nested `dx()` / `test()` / ... helpers
//! return the frozen per-domain catalogs without a second handshake round-trip.

use serde::{Deserialize, Serialize};

use crate::application::{APPLICATION_PROTOCOL, ApplicationProtocolCatalog};
use crate::dx::{DX_PROTOCOL, DxCatalog};
use crate::host::{COMPILER_PROTOCOL, HOST_PROTOCOL};
use crate::locale::{LOCALE_PROTOCOL, LocaleProtocolCatalog};
use crate::native_host::{NATIVE_HOST_PROTOCOL, NativeHostProtocolCatalog};
use crate::plugin::PLUGIN_PROTOCOL;
use crate::profile::{PROFILE_PROTOCOL, ProfileProtocolCatalog};
use crate::program::{PLAN_SCHEMA, PROGRAM_SCHEMA};
use crate::server::{SERVER_PROTOCOL, ServerProtocolCatalog};
use crate::target::{TARGET_PROTOCOL, TargetProtocolCatalog};
use crate::test::{TEST_PROTOCOL, TestCatalog};

/// Top-level protocol catalog schema id used in handshake / verify.
pub const PROTOCOL_CATALOG_SCHEMA: &str = "vmz.protocol.v0";

/// One named domain entry inside [`ProtocolCatalog::domains`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolDomain {
    /// Domain key (`dx`, `test`, `application`, `locale`, ...).
    pub kind: String,
    /// Protocol / schema id that domain currently freezes.
    pub schema: String,
}

/// Root handshake document: core schema pins plus the domain table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProtocolCatalog {
    /// Always [`PROTOCOL_CATALOG_SCHEMA`].
    pub schema: String,
    /// Node / CLI host protocol version ([`HOST_PROTOCOL`](crate::HOST_PROTOCOL)).
    pub host: String,
    /// Native compiler session protocol ([`COMPILER_PROTOCOL`](crate::COMPILER_PROTOCOL)).
    pub compiler: String,
    /// Plugin contribution protocol ([`PLUGIN_PROTOCOL`](crate::PLUGIN_PROTOCOL)).
    pub plugin: String,
    /// Program Graph JSON schema ([`PROGRAM_SCHEMA`](crate::PROGRAM_SCHEMA)).
    pub program: String,
    /// Execution Plan JSON schema ([`PLAN_SCHEMA`](crate::PLAN_SCHEMA)).
    pub plan: String,
    /// Domain catalogs advertised by this native build.
    pub domains: Vec<ProtocolDomain>,
}

impl ProtocolCatalog {
    /// Frozen catalog for the current protocol generation.
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
                ProtocolDomain { kind: "server".into(), schema: SERVER_PROTOCOL.into() },
            ],
        }
    }

    /// Pretty-printed JSON for N-API / CLI dump.
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    /// Nested DX (rename / explain / symbols / ...) catalog.
    pub fn dx(&self) -> DxCatalog {
        let _ = self;
        DxCatalog::v0()
    }

    /// Nested `vmz test` protocol catalog.
    pub fn test(&self) -> TestCatalog {
        let _ = self;
        TestCatalog::v0()
    }

    /// Nested multi-application mount / isolation catalog.
    pub fn application(&self) -> ApplicationProtocolCatalog {
        let _ = self;
        ApplicationProtocolCatalog::v0()
    }

    /// Nested target / mini-program view-ops catalog.
    pub fn target(&self) -> TargetProtocolCatalog {
        let _ = self;
        TargetProtocolCatalog::v0()
    }

    /// Nested HostProfile / delivery profile catalog.
    pub fn profile(&self) -> ProfileProtocolCatalog {
        let _ = self;
        ProfileProtocolCatalog::v0()
    }

    /// Nested NativeAppHost bridge catalog.
    pub fn native_host(&self) -> NativeHostProtocolCatalog {
        let _ = self;
        NativeHostProtocolCatalog::v0()
    }

    /// Nested locale / i18n catalog.
    pub fn locale(&self) -> LocaleProtocolCatalog {
        let _ = self;
        LocaleProtocolCatalog::v0()
    }

    /// Nested server-boundary (secrets / slice proof) catalog.
    pub fn server(&self) -> ServerProtocolCatalog {
        let _ = self;
        ServerProtocolCatalog::v0()
    }
}
