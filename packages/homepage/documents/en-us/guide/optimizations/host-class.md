# Host class precision

Parse `this.<host> === item.<field> ? … : …`, emit `hostFields`; precise selection scheduling.

## Related files

- [
  `row_kernel.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/src/pipeline/row_kernel.rs)
- [
  `dep_graph.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/src/pipeline/dep_graph.rs)
- [
  `row_kernel_unit.rs`](https://github.com/doki-land/vmz-framework/blob/dev/packages/compilers/vmz-compiler/tests/row_kernel_unit.rs)

← [Zero-Cost](../zero-cost.md) · [Optimizations](./index.md)
