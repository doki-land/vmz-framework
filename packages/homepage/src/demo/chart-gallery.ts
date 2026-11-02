/**
 * 图表页的演示输入（构建期输入，纯函数，无 Node / RPC 依赖）。
 *
 * spec / rows 只在 `CHART_INPUTS` 与 `DIAGRAM_SPEC` 里写一份，页面展示的
 * `specText` / `dataText` 由同一份对象序列化得到，因此「展示的代码」与
 * 「实际渲染输入」必然同源，不需要另写字符串。
 *
 * 页面 `<script server>` 与 `static load` 都从这里取数：服务端能力仍由
 * `#server/pages/charts` 暴露，静态预渲染则直接读取同一条输入，避免对
 * 没有 RPC resolver 的预渲染进程发起 `#server` 调用。
 */
import type { ChartSpec } from '@doki-land/davinci/chart';
import type { DiagramSpec } from '@doki-land/davinci/diagram';

/** 一个图表示例：渲染输入与同源文本。 */
export interface ChartGalleryExample {
    id: string;
    title: string;
    note: string;
    spec: ChartSpec;
    rows: Record<string, unknown>[];
    specText: string;
    dataText: string;
}

/** 一个 diagram 示例：渲染输入与同源文本。 */
export interface ChartGalleryDiagram {
    title: string;
    note: string;
    spec: DiagramSpec;
    specText: string;
}

interface ChartInput {
    id: string;
    title: string;
    note: string;
    spec: ChartSpec;
    rows: Record<string, unknown>[];
}

const CHART_INPUTS: ChartInput[] = [
    {
        id: 'bar-quarter',
        title: '柱状图 · Bar',
        note: '类目柱按区域着色，图例固定在绘图区上方，零基线读数。',
        spec: {
            mark: 'bar',
            encoding: [
                { field: 'quarter', channel: 'x' },
                { field: 'sales', channel: 'y' },
                { field: 'region', channel: 'color' },
            ],
        },
        rows: [
            { quarter: 'Q1', sales: 42, region: 'North' },
            { quarter: 'Q2', sales: 68, region: 'South' },
            { quarter: 'Q3', sales: 55, region: 'North' },
            { quarter: 'Q4', sales: 81, region: 'South' },
        ],
    },
    {
        id: 'bar-dodge',
        title: '柱状图 · 分组并列（dodge）',
        note: '同一季度两区域并列不重叠，顺序与图例一致，共享零基线。',
        spec: {
            mark: 'bar',
            encoding: [
                { field: 'quarter', channel: 'x' },
                { field: 'sales', channel: 'y' },
                { field: 'region', channel: 'color' },
            ],
        },
        rows: [
            { quarter: 'Q1', sales: 42, region: 'North' },
            { quarter: 'Q2', sales: 68, region: 'North' },
            { quarter: 'Q3', sales: 55, region: 'North' },
            { quarter: 'Q4', sales: 81, region: 'North' },
            { quarter: 'Q1', sales: 36, region: 'South' },
            { quarter: 'Q2', sales: 52, region: 'South' },
            { quarter: 'Q3', sales: 61, region: 'South' },
            { quarter: 'Q4', sales: 74, region: 'South' },
        ],
    },
    {
        id: 'bar-stack',
        title: '柱状图 · 堆叠（stack）',
        note: '区域沿零基线堆叠，y 域覆盖总量；每段 tooltip 仍是真实行值。',
        spec: {
            mark: 'bar',
            seriesLayout: 'stack',
            encoding: [
                { field: 'quarter', channel: 'x' },
                { field: 'sales', channel: 'y' },
                { field: 'region', channel: 'color' },
            ],
        },
        rows: [
            { quarter: 'Q1', sales: 42, region: 'North' },
            { quarter: 'Q2', sales: 68, region: 'North' },
            { quarter: 'Q3', sales: 55, region: 'North' },
            { quarter: 'Q4', sales: 81, region: 'North' },
            { quarter: 'Q1', sales: 36, region: 'South' },
            { quarter: 'Q2', sales: 52, region: 'South' },
            { quarter: 'Q3', sales: 61, region: 'South' },
            { quarter: 'Q4', sales: 74, region: 'South' },
        ],
    },
    {
        id: 'line-weekly',
        title: '折线图 · Line',
        note: '两条产品线一周访客。悬停出十字线与顶点标记，方向键在标记间移动。',
        spec: {
            mark: 'line',
            encoding: [
                { field: 'day', channel: 'x' },
                { field: 'visitors', channel: 'y' },
                { field: 'product', channel: 'color' },
            ],
        },
        rows: [
            { day: 'Mon', visitors: 120, product: 'Console' },
            { day: 'Tue', visitors: 145, product: 'Console' },
            { day: 'Wed', visitors: 98, product: 'Console' },
            { day: 'Thu', visitors: 187, product: 'Console' },
            { day: 'Fri', visitors: 210, product: 'Console' },
            { day: 'Sat', visitors: 176, product: 'Console' },
            { day: 'Sun', visitors: 142, product: 'Console' },
            { day: 'Mon', visitors: 80, product: 'Insight' },
            { day: 'Tue', visitors: 110, product: 'Insight' },
            { day: 'Wed', visitors: 132, product: 'Insight' },
            { day: 'Thu', visitors: 121, product: 'Insight' },
            { day: 'Fri', visitors: 160, product: 'Insight' },
            { day: 'Sat', visitors: 148, product: 'Insight' },
            { day: 'Sun', visitors: 104, product: 'Insight' },
        ],
    },
    {
        id: 'area-traffic',
        title: '面积图 · Area',
        note: '面积图共享零基线，填充半透明，描边保持全强度。',
        spec: {
            mark: 'area',
            encoding: [
                { field: 'hour', channel: 'x' },
                { field: 'requests', channel: 'y' },
                { field: 'service', channel: 'color' },
            ],
        },
        rows: [
            { hour: 0, requests: 42, service: 'api' },
            { hour: 4, requests: 30, service: 'api' },
            { hour: 8, requests: 95, service: 'api' },
            { hour: 12, requests: 140, service: 'api' },
            { hour: 16, requests: 118, service: 'api' },
            { hour: 20, requests: 76, service: 'api' },
            { hour: 0, requests: 18, service: 'web' },
            { hour: 4, requests: 12, service: 'web' },
            { hour: 8, requests: 54, service: 'web' },
            { hour: 12, requests: 88, service: 'web' },
            { hour: 16, requests: 71, service: 'web' },
            { hour: 20, requests: 40, service: 'web' },
        ],
    },
    {
        id: 'scatter-latency',
        title: '散点图 · Point',
        note: '点自带分隔描边，重叠样本仍可分辨；数值 x 轴支持滚轮缩放与框选。',
        spec: {
            mark: 'point',
            encoding: [
                { field: 'size', channel: 'x' },
                { field: 'latency', channel: 'y' },
            ],
        },
        rows: [
            { size: 12, latency: 45 },
            { size: 18, latency: 38 },
            { size: 24, latency: 52 },
            { size: 30, latency: 41 },
            { size: 36, latency: 44 },
            { size: 42, latency: 35 },
            { size: 48, latency: 55 },
            { size: 54, latency: 32 },
            { size: 60, latency: 48 },
            { size: 66, latency: 58 },
            { size: 72, latency: 61 },
            { size: 78, latency: 53 },
            { size: 84, latency: 66 },
            { size: 90, latency: 70 },
            { size: 96, latency: 64 },
        ],
    },
    {
        id: 'pie-share',
        title: '饼图 · Pie',
        note: '切片从十二点顺时针排列，宽切片带对比色百分比标签，悬停读真实值与占比。',
        spec: {
            mark: 'pie',
            keyField: 'source',
            encoding: [
                { field: 'visits', channel: 'theta' },
                { field: 'source', channel: 'color' },
            ],
        },
        rows: [
            { source: '直接访问', visits: 335 },
            { source: '搜索引擎', visits: 310 },
            { source: '外链引荐', visits: 234 },
            { source: '社交媒体', visits: 135 },
            { source: '邮件订阅', visits: 86 },
        ],
    },
    {
        id: 'donut-share',
        title: '环形图 · Donut',
        note: 'innerRadiusRatio 0.62 的环段，命中区与几何都是真实扇环。',
        spec: {
            mark: 'pie',
            innerRadiusRatio: 0.62,
            keyField: 'tier',
            encoding: [
                { field: 'gb', channel: 'theta' },
                { field: 'tier', channel: 'color' },
            ],
        },
        rows: [
            { tier: '热数据', gb: 420 },
            { tier: '温数据', gb: 260 },
            { tier: '冷数据', gb: 180 },
            { tier: '归档', gb: 90 },
        ],
    },
    {
        id: 'radar-score',
        title: '雷达图 · Radar',
        note: '极坐标网按维度展开，环刻度是真实数值域；悬停顶点读单元格原值。',
        spec: {
            mark: 'radar',
            keyField: 'id',
            encoding: [
                { field: 'dim', channel: 'x' },
                { field: 'score', channel: 'y' },
                { field: 'product', channel: 'color' },
            ],
        },
        rows: [
            { id: 'a-0', dim: '性能', score: 82, product: 'Console' },
            { id: 'a-1', dim: '稳定', score: 68, product: 'Console' },
            { id: 'a-2', dim: '功能', score: 91, product: 'Console' },
            { id: 'a-3', dim: '生态', score: 47, product: 'Console' },
            { id: 'a-4', dim: '文档', score: 73, product: 'Console' },
            { id: 'b-0', dim: '性能', score: 58, product: 'Insight' },
            { id: 'b-1', dim: '稳定', score: 86, product: 'Insight' },
            { id: 'b-2', dim: '功能', score: 62, product: 'Insight' },
            { id: 'b-3', dim: '生态', score: 77, product: 'Insight' },
            { id: 'b-4', dim: '文档', score: 52, product: 'Insight' },
        ],
    },
    {
        id: 'facet-platform',
        title: '小倍数 · Facet',
        note: 'facetField 把同一份数据拆成 2×2 小倍数面板，共享刻度可直接比较。',
        spec: {
            mark: 'bar',
            keyField: 'id',
            facetField: 'platform',
            encoding: [
                { field: 'month', channel: 'x' },
                { field: 'active', channel: 'y' },
            ],
        },
        rows: [
            { id: 'ios-1', platform: 'iOS', month: '7月', active: 42 },
            { id: 'i-2', platform: 'iOS', month: '8月', active: 55 },
            { id: 'i-3', platform: 'iOS', month: '9月', active: 61 },
            { id: 'a-1', platform: 'Android', month: '7月', active: 68 },
            { id: 'a-2', platform: 'Android', month: '8月', active: 72 },
            { id: 'a-3', platform: 'Android', month: '9月', active: 66 },
            { id: 'w-1', platform: 'Web', month: '7月', active: 30 },
            { id: 'w-2', platform: 'Web', month: '8月', active: 28 },
            { id: 'w-3', platform: 'Web', month: '9月', active: 35 },
            { id: 'd-1', platform: 'Desktop', month: '7月', active: 18 },
            { id: 'd-2', platform: 'Desktop', month: '8月', active: 24 },
            { id: 'd-3', platform: 'Desktop', month: '9月', active: 29 },
        ],
    },
    {
        id: 'bar-delta',
        title: '柱状图 · 正负混合',
        note: '负值柱从零基线向下生长，高度保持正值。',
        spec: {
            mark: 'bar',
            encoding: [
                { field: 'name', channel: 'x' },
                { field: 'delta', channel: 'y' },
            ],
        },
        rows: [
            { name: 'alpha', delta: -4 },
            { name: 'beta', delta: 7 },
            { name: 'gamma', delta: -1.5 },
            { name: 'delta', delta: 3 },
            { name: 'epsilon', delta: -6 },
        ],
    },
    {
        id: 'bar-cjk',
        title: '柱状图 · 中文长标签截断',
        note: '中文类目按宽度截断为省略号，不与邻柱标签相撞。',
        spec: {
            mark: 'bar',
            encoding: [
                { field: '类别', channel: 'x' },
                { field: '数值', channel: 'y' },
            ],
        },
        rows: [
            { 类别: '第一季度销售额', 数值: 120 },
            { 类别: '第二季度销售额', 数值: 150 },
            { 类别: '第三季度销售额', 数值: 98 },
            { 类别: '第四季度销售额', 数值: 187 },
        ],
    },
];

const DIAGRAM_TITLE = '流程图 · Diagram';
const DIAGRAM_NOTE = '边裁剪到节点边界，箭头真实绘制，边标签带底衬不被线段穿过。';

const DIAGRAM_SPEC: DiagramSpec = {
    kind: 'flowchart',
    direction: 'LR',
    nodes: [
        { id: 'spec', label: 'ChartSpec', nodeKind: 'rect' },
        { id: 'snapshot', label: 'DataSnapshot', nodeKind: 'rect' },
        { id: 'plan', label: 'Compile Plan', nodeKind: 'rect' },
        { id: 'scene', label: 'Display Scene', nodeKind: 'rect' },
    ],
    edges: [
        { id: 'spec-snapshot', fromNode: 'spec', toNode: 'snapshot', label: 'bind', edgeKind: 'arrow' },
        { id: 'snapshot-plan', fromNode: 'snapshot', toNode: 'plan', label: 'compile', edgeKind: 'arrow' },
        { id: 'plan-scene', fromNode: 'plan', toNode: 'scene', label: 'render', edgeKind: 'arrow' },
    ],
};

/** 图表示例输入（渲染输入与代码文本同源）。 */
export function chartGalleryExamples(): ChartGalleryExample[] {
    return CHART_INPUTS.map((input) => ({
        id: input.id,
        title: input.title,
        note: input.note,
        spec: input.spec,
        rows: input.rows,
        specText: JSON.stringify(input.spec, null, 2),
        dataText: JSON.stringify(input.rows, null, 2),
    }));
}

/** Diagram 示例输入（渲染输入与代码文本同源）。 */
export function chartGalleryDiagram(): ChartGalleryDiagram {
    return {
        title: DIAGRAM_TITLE,
        note: DIAGRAM_NOTE,
        spec: DIAGRAM_SPEC,
        specText: JSON.stringify(DIAGRAM_SPEC, null, 2),
    };
}
