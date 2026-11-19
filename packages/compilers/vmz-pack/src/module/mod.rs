//! 模块事实层：源码 → [`ModuleRecord`]，只经 `data.text` TypeScript AST 建立
//! import/export/re-export/动态 import/副作用/资源引用等事实，禁止正则识别。
//!
//! 记录类型与 `ModuleFactSource` 合同归 `compiler-bundle`；本模块只保留
//! `data.text` 侧的收集器实现。

mod collect;

pub use collect::parse_module;
pub use compiler_bundle::module::*;
