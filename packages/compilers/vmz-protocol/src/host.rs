//! Host ↔ native session handshake versions.

/// Node / CLI host protocol (must match JS `HOST_PROTOCOL`).
pub const HOST_PROTOCOL: &str = "0.1.0";

/// Native compiler session protocol (must match JS `COMPILER_PROTOCOL`).
pub const COMPILER_PROTOCOL: &str = "0.1.0";
