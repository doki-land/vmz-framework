//! 分包层：链接计划（保留模块 + 存活动态边）→ 多入口 chunk 计划。
//!
//! 语义模型：
//! - 只对 [`crate::link::LinkPlan`] 保留的模块分包；未保留节点不进入任何
//!   chunk，本层不重算活跃性，也不复制链接层的语句判定。
//! - [`crate::graph::NodeKind::Style`] 与 [`crate::graph::NodeKind::Json`]
//!   节点不是 chunk 成员：无 JS 文本可装配，也不参与可达签名分区；Style 的
//!   级联归属由 `emit` 层按 chunk 成员执行序聚合，Json 的值绑定文本由
//!   `emit` 层在导入者所属 chunk 内合成（Living §Pack「WASM、CSS 与静态资源」）。
//! - 静态 import / re-export 边在保留集合上求强连通收缩：循环内模块必落
//!   同一 chunk，否则 live binding 与初始化顺序无法在产物层保持。收缩单元
//!   是分包的图基元，不是按包名或组件形态的特判。
//! - 根 = 静态入口（[`crate::graph::GraphEntry`]）∪ 存活动态边目标（异步根；
//!   已是入口节点的目标不另立根，动态边界直接指向其所属 chunk）。每个单元
//!   记录「哪些根能沿静态边到达它」的可达签名；签名相同的单元合成一个
//!   chunk，公共模块在同一目标图内保持同一实例。
//! - 异步边界：动态边目标的子图只属于含该异步根的签名分区，绝不并入静态
//!   不可达它的入口 chunk；源节点 → 目标 chunk 的映射显式输出
//!   （[`ChunkPlan::dynamic_boundaries`]），供产物层生成 loader 映射。入口
//!   chunk 与异步 chunk 的划分只由可达性决定。
//! - 执行顺序：chunk 内单元按静态依赖的拓扑序排列（被依赖者先于导入者；
//!   循环单元内部按节点索引升序），跨 chunk 的同步依赖由
//!   [`Chunk::depends_on`] 与该列表在产物层重建顺序。
//! - 依赖边只取 link 的活跃结论：目标可观察求值（[`crate::link::effectful_modules`]，
//!   ESM 求值语义）或本模块传播了符号需求（[`crate::link::LinkedModule::used_targets`]
//!   与 `used_reexports` 目标）。未消费且不可观察求值的纯目标不产生依赖边，
//!   本层不重新判断绑定使用，也不按包名或组件形态特判。合并策略 v1 保守：
//!   共享分区即合并（多根共同可达的单元合成一个 shared chunk），不做体积/
//!   请求数启发式。
//! - 事实不完整（解析失败入图、或从未展开的保留节点）：显式
//!   `vmz::pack::chunk::incomplete_facts` 诊断，按可达签名保守放入所属入口/
//!   共享 chunk 并保持单一实例，不静默丢弃。
//! - 稳定身份：chunk id 由入口逻辑名、异步根模块路径与共享签名的规范化
//!   排序集合确定性派生（路径分隔符统一为 `/`），同输入必同输出；禁止
//!   随机或时间戳。
//!
//! 本层不做产物写出、文件名分配、内容指纹与请求开销合并；输入必须是
//! 同一目标图上的 [`crate::graph::ModuleGraph`] 与 [`crate::link::LinkPlan`]。

mod plan;

pub use plan::{Chunk, ChunkOrigin, ChunkPlan, plan_chunks};
