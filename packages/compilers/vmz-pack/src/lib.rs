//! VMZ Pack 自研打包链的 Rust 基础层。
//!
//! 设计合同见工作区 `规划设计/vmz/03-工具链与测试.md` §Pack：
//! 模块图 → 符号/副作用活跃 → 多入口分包 → chunk/资源 manifest。
//! 本 crate 只消费 Oak 正式语法事实，不新增任何正则模块语义识别；
//! `module` 负责「源码 → 模块事实」，`resolve` 负责「specifier + 上下文 →
//! 模块身份」，`graph` 把两者粘成从入口可达的模块图；
//! 链接（`link`）与分包（`chunk`）后续接入。
//!
//! 当前阶段：模块事实、解析身份与图组装已落地，链接/减枝/分包均未实现，
//! 不得据本 crate 现状宣称 tree-shaking 或 code splitting 已成立。

pub mod diag;
pub mod graph;
pub mod module;
pub mod resolve;

pub use diag::PackDiagnostic;
