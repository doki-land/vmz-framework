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

const PIE_SHARE: GalleryExample = {
    id: "pie-share",
    title: "饼图 · 流量来源占比",
    note: "切片从十二点顺时针排列,宽切片带对比色百分比标签,悬停读真实值与占比。",
    spec: {
        mark: "pie",
        keyField: "source",
        encoding: [
            { field: "visits", channel: "theta" },
            { field: "source", channel: "color" },
        ],
    },
    rows: [
        { source: "直接访问", visits: 335 },
        { source: "搜索引擎", visits: 310 },
        { source: "外链引荐", visits: 234 },
        { source: "社交媒体", visits: 135 },
        { source: "邮件订阅", visits: 86 },
    ],
};

const DONUT_SHARE: GalleryExample = {
    id: "donut-share",
    title: "环形 · 存储占用",
    note: "innerRadiusRatio 0.62 的环段,命中区与几何都是真实扇环。",
    spec: {
        mark: "pie",
        innerRadiusRatio: 0.62,
        keyField: "tier",
        encoding: [
            { field: "gb", channel: "theta" },
            { field: "tier", channel: "color" },
        ],
    },
    rows: [
        { tier: "热数据", gb: 420 },
        { tier: "温数据", gb: 260 },
        { tier: "冷数据", gb: 180 },
        { tier: "归档", gb: 90 },
    ],
};

const RADAR_SCORE: GalleryExample = {
    id: "radar-score",
    title: "雷达 · 两款产品五维评分",
    note: "极坐标网按维度展开,环刻度是真实数值域;悬停顶点读单元格原值。",
    spec: {
        mark: "radar",
        keyField: "id",
        encoding: [
            { field: "dim", channel: "x" },
            { field: "score", channel: "y" },
            { field: "product", channel: "color" },
        ],
    },
    rows: [
        { id: "a-0", dim: "性能", score: 82, product: "Console" },
        { id: "a-1", dim: "稳定", score: 68, product: "Console" },
        { id: "a-2", dim: "功能", score: 91, product: "Console" },
        { id: "a-3", dim: "生态", score: 47, product: "Console" },
        { id: "a-4", dim: "文档", score: 73, product: "Console" },
        { id: "b-0", dim: "性能", score: 58, product: "Insight" },
        { id: "b-1", dim: "稳定", score: 86, product: "Insight" },
        { id: "b-2", dim: "功能", score: 62, product: "Insight" },
        { id: "b-3", dim: "生态", score: 77, product: "Insight" },
        { id: "b-4", dim: "文档", score: 52, product: "Insight" },
    ],
};

const FACET_PLATFORM: GalleryExample = {
    id: "facet-platform",
    title: "分面 · 四平台月度活跃",
    note: "facetField 把同一份数据拆成 2×2 小倍数面板,共享刻度可直接比较。",
    spec: {
        mark: "bar",
        keyField: "id",
        facetField: "platform",
        encoding: [
            { field: "month", channel: "x" },
            { field: "active", channel: "y" },
        ],
    },
    rows: [
        { id: "ios-1", platform: "iOS", month: "7月", active: 42 },
        { id: "i-2", platform: "iOS", month: "8月", active: 55 },
        { id: "i-3", platform: "iOS", month: "9月", active: 61 },
        { id: "a-1", platform: "Android", month: "7月", active: 68 },
        { id: "a-2", platform: "Android", month: "8月", active: 72 },
        { id: "a-3", platform: "Android", month: "9月", active: 66 },
        { id: "w-1", platform: "Web", month: "7月", active: 30 },
        { id: "w-2", platform: "Web", month: "8月", active: 28 },
        { id: "w-3", platform: "Web", month: "9月", active: 35 },
        { id: "d-1", platform: "Desktop", month: "7月", active: 18 },
        { id: "d-2", platform: "Desktop", month: "8月", active: 24 },
        { id: "d-3", platform: "Desktop", month: "9月", active: 29 },
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
    PIE_SHARE,
    DONUT_SHARE,
    RADAR_SCORE,
    FACET_PLATFORM,
    AREA_TRAFFIC,
    SCATTER_LATENCY,
    NEGATIVE_DELTAS,
    CJK_LABELS,
    BAD_SPEC,
];

/** Look up a gallery example by id — pages must never index the array
 *  positionally, inserting a new card must not rewire existing references. */
export function galleryExample(id: string): GalleryExample {
    const hit = GALLERY_EXAMPLES.find((e) => e.id === id);
    if (!hit) throw new Error(`unknown gallery example: ${id}`);
    return hit;
}

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
