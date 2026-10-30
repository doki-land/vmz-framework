//! VMZ Pack 自研打包链的 Rust 基础层。
//!
//! 设计合同见工作区 `规划设计/vmz/03-工具链与测试.md` §Pack：
//! 模块图 → 符号/副作用活跃 → 多入口分包 → chunk/资源 manifest。
//! 本 crate 只消费 Oak 正式语法事实，不新增任何正则模块语义识别；
//! `module` 负责「源码 → 模块事实」，`resolve` 负责「specifier + 上下文 →
//! 模块身份」，`graph` 把两者粘成从入口可达的模块图；`link` 在其上做
//! 语句级活跃不动点；`chunk` 在其保留集合上做确定性多入口分包计划。
//!
//! 当前阶段：模块事实、解析身份、图组装、链接（`link`）与分包计划
//! （`chunk`）已落地；chunk 产物写出（文件名分配、内容指纹与资源
//! manifest）未实现。`link` 是保守语句级活跃不动点，Oak 事实缺口按
//! 保守保留处理，不得据本 crate 现状宣称 code splitting 已成立。

pub mod chunk;
pub mod diag;
pub mod graph;
pub mod link;
pub mod module;
pub mod resolve;

pub use diag::PackDiagnostic;
