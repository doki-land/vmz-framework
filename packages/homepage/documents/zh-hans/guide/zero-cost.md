# Zero-Cost

**Zero-Cost**：能静态证明的在编译期完成；证明不了的走诊断或保守路径——不静默整树重渲，也不靠再堆一层 runtime API。

作者书写普通字段与模板即可；依赖分析与 Direct 调度由编译器完成。热路径优化落在约定内、可分析的形状上。

口号： **约定大于配置** · Vue-Familiar · Multi-Platform · Zero-Cost

## 相关优化

- [依赖路径进图](./optimizations/dep-graph.md)
- [Direct 调度发射](./optimizations/direct-schedule.md)
- [行内核](./optimizations/row-kernel.md)
- [keyed 列表调和](./optimizations/keyed-list.md)
- [事件委托合同](./optimizations/event-delegate.md)
- [host class 精确刷新](./optimizations/host-class.md)
- [client 去 Plan](./optimizations/client-plan.md)

## 常见写法

- 列表： **`each` + 稳定 `key`**，项模板结构静态
- 选中 / 高亮： **`this.<host> === item.<field> ? … : …`**
- 状态：普通字段；厚逻辑：`.ts` / `server/`
- mock / 假数据：`<script server>` / `#server`

## 延伸阅读

- [入门](./index.md)
- [优化](./optimizations/index.md)
- [官方插件](../plugins/index.md)
