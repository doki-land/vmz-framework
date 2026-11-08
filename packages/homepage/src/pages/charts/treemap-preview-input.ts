/**
 * `/charts/treemap` 预览页的构建期输入（真实磁盘占用，单位 GB）。
 *
 * 只属于该预览页：不导出给页面模板之外的消费者，也不引用
 * `@vmz/ui-charts` demo 或引擎内部模块。页面通过 `static load`
 * 读取同一份 spec / rows / usage，SSR 与客户端看到的是同一组字节。
 */
import type { ChartSpec } from "@doki-land/davinci/chart";

export interface TreemapPreviewRow {
    id: string;
    parent: string | null;
    gb: number;
}

export const treemapPreviewSpec: ChartSpec = {
    mark: "treemap",
    keyField: "id",
    parentField: "parent",
    encoding: [{ field: "gb", channel: "size" }],
    treemapDepth: 3,
    treemapMinArea: 6,
};

/** 两级分组 + 长尾碎片；长尾低于 `treemapMinArea` 时被图表省略，不产生零面积格子。 */
export const treemapPreviewRows: TreemapPreviewRow[] = [
    { id: "根", parent: null, gb: 0 },
    { id: "媒体", parent: "根", gb: 0 },
    { id: "文档", parent: "根", gb: 0 },
    { id: "系统", parent: "根", gb: 0 },
    { id: "视频", parent: "媒体", gb: 420 },
    { id: "图片", parent: "媒体", gb: 260 },
    { id: "音频", parent: "媒体", gb: 90 },
    { id: "设计稿", parent: "文档", gb: 140 },
    { id: "合同", parent: "文档", gb: 60 },
    { id: "表格", parent: "文档", gb: 45 },
    { id: "运行时", parent: "系统", gb: 180 },
    { id: "缓存", parent: "系统", gb: 120 },
    { id: "日志", parent: "系统", gb: 75 },
    { id: "缩略图缓存", parent: "系统", gb: 0.4 },
    { id: "崩溃转储", parent: "系统", gb: 0.3 },
];

export const treemapPreviewUsage = [
    `<Chart`,
    `    :spec="spec"`,
    `    :data="rows"`,
    `    :height="420"`,
    `    :theme="dark ? 'dark' : 'light'"`,
    `    label="磁盘存储占用矩形树图"`,
    `    @vmz-chart-selection-change="onSelectionChange"`,
    `    @vmz-chart-drilldown-change="onDrilldownChange"`,
    `/>`,
].join("\n");
