//! VMZ Pack 自研打包链的 Rust 基础层。
//!
//! 合同：模块图 → 符号/副作用活跃 → 多入口分包 → chunk/资源 manifest。
//! 本 crate 只消费 Oak 正式语法事实，不新增任何正则模块语义识别；
//! `module` 负责「源码 → 模块事实」，`resolve` 负责「specifier + 上下文 →
//! 模块身份」，`graph` 把两者粘成从入口可达的模块图；`link` 在其上做
//! 语句级活跃不动点；`chunk` 在其保留集合上做确定性多入口分包计划；
//! `emit` 把 chunk 计划装配成最终 JS 产物文本、文件名/指纹与 manifest，
//! 并负责文件系统写出。
//!
//! 当前阶段：模块事实、解析身份、图组装、链接（`link`）、分包计划
//! （`chunk`）与产物写出（`emit`）已落地；chunk source map 为行级 v3
//! 合同（活跃语句切片逐行回指原模块，合成行无映射；token 级映射与
//! `names` 未实现）。`link` 是
//! 保守语句级活跃不动点，Oak 事实缺口按保守保留处理，`emit` 对无法
//! 用文本表达或事实不完整的语义一律显式诊断拒绝，不得据本 crate 现状
//! 宣称 code splitting 已成立。

pub mod chunk;
pub mod diag;
pub mod emit;
pub mod graph;
pub mod link;
pub mod module;
pub mod resolve;

pub use diag::PackDiagnostic;
