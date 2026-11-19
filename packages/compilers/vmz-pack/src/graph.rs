//! 模块图组装：把 `data.text` 事实与本地文件系统接到 `compiler-bundle` 的图算法上。
//!
//! VMZ 侧保留 `build_graph(entries, target, root)` 形态的入口：事实来源固定
//! 为本 crate 的 `data.text` 收集器，源码读取固定为本地文件系统。需要注入其它事实
//! 来源或远程快照的调用方直接消费 `compiler-bundle` 的端口化入口，不经过
//! 本适配层。
//!
//! 图的结构语义（节点身份、类型-only 导入不进图、`.css`/`.json` 不透明节点、
//! 解析失败保留为诊断边）全部归 `compiler-bundle`，本文件不重复实现。

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use compiler_bundle::module::ModuleRecord;
use compiler_bundle::resolve::Target;
use compiler_bundle::{ModuleFactSource, PackDiagnostic, StdSourceReader};

pub use compiler_bundle::graph::*;

/// `data.text` TypeScript 事实来源：本 crate 唯一的 `ModuleFactSource` 实现。
struct ModuleFacts;

impl ModuleFactSource for ModuleFacts {
    fn parse_module(
        &self,
        label: Option<&str>,
        source: &str,
    ) -> Result<ModuleRecord, Vec<PackDiagnostic>> {
        crate::module::parse_module(label, source)
    }
}

/// 从入口文件集构建模块图。`root` 为项目根（node_modules 上溯兜底）。
pub fn build_graph(entries: &[(String, PathBuf)], target: Target, root: &Path) -> ModuleGraph {
    build_graph_with_roots(entries, target, root, None, &HashMap::new())
}

/// [`build_graph`] 的 provenance 变体（无输出树根）：`origins` 把 canonical
/// 产物路径映射回其源文件（编译投影关系，如 `dist/components/Icon.client.js` →
/// `node_modules/@vmz/ui/src/components/Icon.vmz`）。裸说明符与 `#imports`
/// 的包发现以来源位置为上溯起点，使产物图表现得像模块仍住在源包里。
pub fn build_graph_with_origins(
    entries: &[(String, PathBuf)],
    target: Target,
    root: &Path,
    origins: &HashMap<PathBuf, PathBuf>,
) -> ModuleGraph {
    build_graph_with_roots(entries, target, root, None, origins)
}

/// 带输出树根的完整变体：`out_root` 是本次产物的输出目录，落在其下的
/// 节点按输出根相对路径命名 chunk id。
pub fn build_graph_with_roots(
    entries: &[(String, PathBuf)],
    target: Target,
    root: &Path,
    out_root: Option<&Path>,
    origins: &HashMap<PathBuf, PathBuf>,
) -> ModuleGraph {
    compiler_bundle::graph::build_graph_with_roots(
        &ModuleFacts,
        &StdSourceReader,
        entries,
        target,
        root,
        out_root,
        origins,
    )
}
