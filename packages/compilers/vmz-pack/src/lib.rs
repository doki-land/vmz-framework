//! VMZ Pack：自研打包链的 VMZ 适配层。
//!
//! 与语言无关的打包算法（模块图、身份解析、语句级活跃、分包计划与产物
//! 发射）归 `compiler-bundle`；本 crate 只提供宿主侧的三件能力，并把它们
//! 注入算法入口：
//!
//! - [`module`]：`data.text` TypeScript AST → 模块事实（`ModuleFactSource` 实现）。
//! - [`graph`] / [`emit`]：把只读源码端口与产物写出端口接到本地文件系统。
//!
//! 合同：模块图 → 符号/副作用活跃 → 多入口分包 → chunk/资源 manifest。
//! 本 crate 不新增任何正则模块语义识别，不复制算法层，也不在 Boost 之上
//! 建立平行实现。

#![deny(missing_docs)]

pub mod chunk;
pub mod diag;
pub mod emit;
pub mod graph;
pub mod link;
pub mod module;
pub mod resolve;

pub use diag::PackDiagnostic;
