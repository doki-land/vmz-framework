/**
 * Chart gallery demo — build-time sample inputs.
 *
 * Every example is a plain static object: the page serializes the same spec
 * it renders, so the shown code and the live chart never drift. No runtime
 * fetches, no mocked endpoints.
 */
import type { ChartSpec } from "@doki-land/davinci/chart";
import type { DiagramSpec } from "@doki-land/davinci/diagram";

export interface GalleryExample {
    readonly id: string;
    readonly title: string;
    readonly note: string;
    readonly spec: ChartSpec;
    readonly rows: ReadonlyArray<Record<string, unknown>>;
}

const WEEK_VISITORS: GalleryExample = {
    id: "line-weekly",
    title: "折线 · 双序列周访问",
    note: "两条产品线一周访客。图例固定在绘图区上方,网格线读数不遮数据线。",
    spec: {
        mark: "line",
        encoding: [
            { field: "day", channel: "x" },
            { field: "visitors", channel: "y" },
            { field: "product", channel: "color" },
        ],
    },
    rows: [
        { day: "Mon", visitors: 120, product: "Console" },
        { day: "Tue", visitors: 145, product: "Console" },
        { day: "Wed", visitors: 98, product: "Console" },
        { day: "Thu", visitors: 187, product: "Console" },
        { day: "Fri", visitors: 210, product: "Console" },
        { day: "Sat", visitors: 176, product: "Console" },
        { day: "Sun", visitors: 142, product: "Console" },
        { day: "Mon", visitors: 80, product: "Insight" },
        { day: "Tue", visitors: 110, product: "Insight" },
        { day: "Wed", visitors: 132, product: "Insight" },
        { day: "Thu", visitors: 121, product: "Insight" },
        { day: "Fri", visitors: 160, product: "Insight" },
        { day: "Sat", visitors: 148, product: "Insight" },
        { day: "Sun", visitors: 104, product: "Insight" },
    ],
};

const QUARTER_SALES: GalleryExample = {
    id: "bar-quarter",
    title: "柱状 · 季度销售按类着色",
    note: "每根类目柱按区域字段着色,图例在绘图区上方,零基线读数。",
    spec: {
        mark: "bar",
        encoding: [
            { field: "quarter", channel: "x" },
            { field: "sales", channel: "y" },
            { field: "region", channel: "color" },
        ],
    },
    rows: [
        { quarter: "Q1", sales: 42, region: "North" },
        { quarter: "Q2", sales: 68, region: "South" },
        { quarter: "Q3", sales: 55, region: "North" },
        { quarter: "Q4", sales: 81, region: "South" },
    ],
};

const DODGE_SALES: GalleryExample = {
    id: "bar-dodge",
    title: "柱状 · 分组并列(dodge)",
    note: "同一季度两区域并列不重叠,顺序与图例一致,共享零基线。",
    spec: {
        mark: "bar",
        encoding: [
            { field: "quarter", channel: "x" },
            { field: "sales", channel: "y" },
            { field: "region", channel: "color" },
        ],
    },
    rows: [
        { quarter: "Q1", sales: 42, region: "North" },
        { quarter: "Q2", sales: 68, region: "North" },
        { quarter: "Q3", sales: 55, region: "North" },
        { quarter: "Q4", sales: 81, region: "North" },
        { quarter: "Q1", sales: 36, region: "South" },
        { quarter: "Q2", sales: 52, region: "South" },
        { quarter: "Q3", sales: 61, region: "South" },
        { quarter: "Q4", sales: 74, region: "South" },
    ],
};

const STACK_SALES: GalleryExample = {
    id: "bar-stack",
    title: "柱状 · 堆叠总量(stack)",
    note: "区域沿零基线堆叠,y 域覆盖总量;每段 tooltip 仍是真实行值。",
    spec: {
        mark: "bar",
        seriesLayout: "stack",
        encoding: [
            { field: "quarter", channel: "x" },
            { field: "sales", channel: "y" },
            { field: "region", channel: "color" },
        ],
    },
    rows: [
        { quarter: "Q1", sales: 42, region: "North" },
        { quarter: "Q2", sales: 68, region: "North" },
        { quarter: "Q3", sales: 55, region: "North" },
        { quarter: "Q4", sales: 81, region: "North" },
        { quarter: "Q1", sales: 36, region: "South" },
        { quarter: "Q2", sales: 52, region: "South" },
        { quarter: "Q3", sales: 61, region: "South" },
        { quarter: "Q4", sales: 74, region: "South" },
    ],
};

const AREA_TRAFFIC: GalleryExample = {
    id: "area-traffic",
    title: "面积 · 流量构成",
    note: "面积图共享零基线,填充半透明,描边保持全强度。",
    spec: {
        mark: "area",
        encoding: [
            { field: "hour", channel: "x" },
            { field: "requests", channel: "y" },
            { field: "service", channel: "color" },
        ],
    },
    rows: [
        { hour: 0, requests: 42, service: "api" },
        { hour: 4, requests: 30, service: "api" },
        { hour: 8, requests: 95, service: "api" },
        { hour: 12, requests: 140, service: "api" },
        { hour: 16, requests: 118, service: "api" },
        { hour: 20, requests: 76, service: "api" },
        { hour: 0, requests: 18, service: "web" },
        { hour: 4, requests: 12, service: "web" },
        { hour: 8, requests: 54, service: "web" },
        { hour: 12, requests: 88, service: "web" },
        { hour: 16, requests: 71, service: "web" },
        { hour: 20, requests: 40, service: "web" },
    ],
};

const SCATTER_LATENCY: GalleryExample = {
    id: "scatter-latency",
    title: "散点 · 延迟分布",
    note: "点自带分隔描边,重叠样本仍可分辨。",
    spec: {
        mark: "point",
        encoding: [
            { field: "size", channel: "x" },
            { field: "latency", channel: "y" },
        ],
    },
    rows: [
        { size: 12, latency: 45 }, { size: 18, latency: 38 }, { size: 24, latency: 52 },
        { size: 30, latency: 41 }, { size: 36, latency: 44 }, { size: 42, latency: 35 },
        { size: 48, latency: 55 }, { size: 54, latency: 32 }, { size: 60, latency: 48 },
        { size: 66, latency: 58 }, { size: 72, latency: 61 }, { size: 78, latency: 53 },
        { size: 84, latency: 66 }, { size: 90, latency: 70 }, { size: 96, latency: 64 },
    ],
};

const NEGATIVE_DELTAS: GalleryExample = {
    id: "bar-delta",
    title: "柱状 · 正负混合",
    note: "负值柱从零基线向下生长,高度保持正值。",
    spec: {
        mark: "bar",
        encoding: [
            { field: "name", channel: "x" },
            { field: "delta", channel: "y" },
        ],
    },
    rows: [
        { name: "alpha", delta: -4 },
        { name: "beta", delta: 7 },
        { name: "gamma", delta: -1.5 },
        { name: "delta", delta: 3 },
        { name: "epsilon", delta: -6 },
    ],
};

const CJK_LABELS: GalleryExample = {
    id: "bar-cjk",
    title: "柱状 · 中文长标签截断",
    note: "中文类目按宽度截断为省略号,不与邻柱标签相撞。",
    spec: {
        mark: "bar",
        encoding: [
            { field: "类别", channel: "x" },
            { field: "数值", channel: "y" },
        ],
    },
    rows: [
        { 类别: "第一季度销售额", 数值: 120 },
        { 类别: "第二季度销售额", 数值: 150 },
        { 类别: "第三季度销售额", 数值: 98 },
        { 类别: "第四季度销售额", 数值: 187 },
    ],
};

const BAD_SPEC: GalleryExample = {
    id: "diag-unknown-field",
    title: "诊断 · 未知字段",
    note: "编码引用不存在的字段时给出结构化诊断而不是空白图。",
    spec: {
        mark: "bar",
        encoding: [
            { field: "month", channel: "x" },
            { field: "not-a-field", channel: "y" },
        ],
    },
    rows: [
        { month: "Jan", sales: 42 },
        { month: "Feb", sales: 68 },
    ],
};

export const GALLERY_EXAMPLES: ReadonlyArray<GalleryExample> = [
    WEEK_VISITORS,
    QUARTER_SALES,
    DODGE_SALES,
    STACK_SALES,
    AREA_TRAFFIC,
    SCATTER_LATENCY,
    NEGATIVE_DELTAS,
    CJK_LABELS,
    BAD_SPEC,
];

export const FLOW_DIAGRAM: DiagramSpec = {
    kind: "flowchart",
    direction: "LR",
    nodes: [
        { id: "spec", label: "ChartSpec", nodeKind: "rect" },
        { id: "snapshot", label: "DataSnapshot", nodeKind: "rect" },
        { id: "plan", label: "Compile Plan", nodeKind: "rect" },
        { id: "scene", label: "Display Scene", nodeKind: "rect" },
    ],
    edges: [
        { id: "e1", fromNode: "spec", toNode: "snapshot", label: "bind", edgeKind: "arrow" },
        { id: "e2", fromNode: "snapshot", toNode: "plan", label: "compile", edgeKind: "arrow" },
        { id: "e3", fromNode: "plan", toNode: "scene", label: "render", edgeKind: "arrow" },
    ],
};

/** 10k 点折线与 2k 散点：性能实测输入,构建期生成一次。 */
export function perfLineRows(count: number): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < count; i++) {
        rows.push({ t: i, v: 50 + 30 * Math.sin(i / 97) + 12 * Math.sin(i / 11) + 6 * Math.sin(i / 3.1) });
    }
    return rows;
}

export function perfScatterRows(count: number): Array<Record<string, unknown>> {
    const rows: Array<Record<string, unknown>> = [];
    for (let i = 0; i < count; i++) {
        const band = i % 17;
        rows.push({ x: (i * 7919) % 1000 / 10, y: 30 + band * 3 + 8 * Math.sin(i / 23) });
    }
    return rows;
}
