//! 模块事实层：源码 → [`record::ModuleRecord`]，只经 Oak TypeScript AST 建立
//! import/export/re-export/动态 import/副作用/资源引用等事实，禁止正则识别。

mod collect;
mod record;

pub use collect::parse_module;
pub use record::{
    AssetFact, ExportFact, ImportBinding, ImportFact, ImportKind, ImportedName, ModuleFlags,
    ModuleRecord, StatementEffect, StatementFact,
};
