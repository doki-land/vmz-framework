# host class 精确刷新

解析 `this.<host> === item.<field> ? … : …`，发 `hostFields`；选中走精确调度。

## 相关文件

- [
  `row_kernel.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/src/pipeline/row_kernel.rs)
- [
  `dep_graph.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/src/pipeline/dep_graph.rs)
- [
  `row_kernel_unit.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/tests/row_kernel_unit.rs)

← [Zero-Cost](../zero-cost.md) · [优化](./index.md)
