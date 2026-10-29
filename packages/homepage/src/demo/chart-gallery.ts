/**
 * 图表预览页的演示输入（构建期输入，纯函数，无 Node / RPC 依赖）。
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
    spec: ChartSpec;
    rows: Record<string, unknown>[];
    specText: string;
    dataText: string;
}

/** 一个 diagram 示例：渲染输入与同源文本。 */
export interface ChartGalleryDiagram {
    title: string;
    spec: DiagramSpec;
    specText: string;
}

interface ChartInput {
    id: string;
    title: string;
    spec: ChartSpec;
    rows: Record<string, unknown>[];
}

const CHART_INPUTS: ChartInput[] = [
    {
        id: 'bar',
        title: '柱状图 · Bar',
        spec: {
            mark: 'bar',
            encoding: [
                { field: 'month', channel: 'x' },
                { field: 'sales', channel: 'y' },
            ],
        },
        rows: [
            { month: 'Jan', sales: 42 },
            { month: 'Feb', sales: 68 },
            { month: 'Mar', sales: 55 },
            { month: 'Apr', sales: 81 },
            { month: 'May', sales: 93 },
            { month: 'Jun', sales: 74 },
        ],
    },
    {
        id: 'line',
        title: '折线图 · Line',
        spec: {
            mark: 'line',
            encoding: [
                { field: 'day', channel: 'x' },
                { field: 'visitors', channel: 'y' },
            ],
        },
        rows: [
            { day: 'Mon', visitors: 120 },
            { day: 'Tue', visitors: 145 },
            { day: 'Wed', visitors: 98 },
            { day: 'Thu', visitors: 187 },
            { day: 'Fri', visitors: 210 },
            { day: 'Sat', visitors: 176 },
            { day: 'Sun', visitors: 142 },
        ],
    },
    {
        id: 'scatter',
        title: '散点图 · Scatter',
        spec: {
            mark: 'point',
            encoding: [
                { field: 'score', channel: 'x' },
                { field: 'time', channel: 'y' },
            ],
        },
        rows: [
            { score: 82, time: 45 },
            { score: 75, time: 38 },
            { score: 91, time: 52 },
            { score: 68, time: 41 },
            { score: 84, time: 44 },
            { score: 73, time: 35 },
            { score: 95, time: 55 },
            { score: 61, time: 32 },
        ],
    },
];

const DIAGRAM_TITLE = '流程图 · Diagram';

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
        spec: DIAGRAM_SPEC,
        specText: JSON.stringify(DIAGRAM_SPEC, null, 2),
    };
}
