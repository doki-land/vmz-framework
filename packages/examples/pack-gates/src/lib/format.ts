// 导出级减枝探针：`usedFmt` 被 index 消费，`unusedFmt` 无人引用。
// 本模块不得包含模板插值——Oak AST 看不见 `${...}` 体内引用，带插值的
// 模块 scope 事实不完整，走保守隔离路径（见 pack-artifact-gates limitations）。
export function usedFmt(value: string): string {
    return "used:" + value;
}

export function unusedFmt(value: string): string {
    return "UNUSED_FMT_MARKER:" + value;
}
