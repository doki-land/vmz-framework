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
import { registerGeoMap } from '@doki-land/davinci/chart';
import { NE_110M_LITE } from '@doki-land/davinci-geo-assets';
import type { DiagramSpec } from '@doki-land/davinci/diagram';

// 底图注册：资产来自独立资源包 `@doki-land/davinci-geo-assets`(Natural
// Earth 公共域,坐标降精度),引擎主包不携带任何地理数据。
registerGeoMap('ne-110m-lite', NE_110M_LITE);

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
    {
        id: 'histogram-latency',
        title: '直方图 · 请求时延分布',
        note: '分箱宽度取 Freedman–Diaconis,柱间无缝,悬停读区间与计数。',
        spec: { mark: 'histogram', encoding: [{ field: 'latency', channel: 'x' }] },
        rows: (() => {
            const rows: Record<string, unknown>[] = [];
            let seed = 42;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            for (let i = 0; i < 220; i++) {
                const u = rand();
                const v = rand();
                rows.push({ latency: Math.round(50 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * 18 + (i % 17 === 0 ? 60 : 0)) });
            }
            return rows;
        })(),
    },
    {
        id: 'boxplot-teams',
        title: '箱线图 · 三组时延分布',
        note: '五数概括与 1.5 IQR 须在编译期计算,离群点是真实异常值。',
        spec: {
            mark: 'boxplot',
            encoding: [
                { field: 'team', channel: 'x' },
                { field: 'latency', channel: 'y' },
            ],
        },
        rows: (() => {
            const mk = (team: string, values: number[]) => values.map((latency) => ({ team, latency }));
            return [
                ...mk('api', [42, 45, 47, 48, 50, 51, 53, 55, 58, 60, 61, 63, 66, 70, 240]),
                ...mk('web', [60, 64, 66, 70, 72, 75, 77, 80, 83, 85, 88, 92, 95]),
                ...mk('batch', [120, 128, 131, 135, 139, 142, 148, 151, 157, 163, 170, 178, 186, 320, 345]),
            ];
        })(),
    },
    {
        id: 'ridgeline-services',
        title: '山脊图 · 服务时延密度',
        note: 'KDE 在编译期计算,共享采样网格,每条脊线归一化峰高。',
        spec: {
            mark: 'ridgeline',
            encoding: [
                { field: 'latency', channel: 'x' },
                { field: 'service', channel: 'y' },
            ],
        },
        rows: (() => {
            const rows: Record<string, unknown>[] = [];
            let seed = 7;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            const mk = (service: string, center: number, spread: number, n: number) => {
                for (let i = 0; i < n; i++) {
                    const u = rand();
                    const v = rand();
                    rows.push({ service, latency: Math.round(center + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * spread) });
                }
            };
            mk('api', 48, 12, 160);
            mk('web', 76, 18, 160);
            mk('batch', 132, 26, 160);
            mk('edge', 34, 9, 160);
            return rows;
        })(),
    },
    {
        id: 'bubble-products',
        title: '气泡图 · 价格 × 评分 × 销量',
        note: 'size 通道按平方根映射面积,重叠气泡仍可读。',
        spec: {
            mark: 'point',
            keyField: 'id',
            encoding: [
                { field: 'price', channel: 'x' },
                { field: 'rating', channel: 'y' },
                { field: 'sales', channel: 'size' },
            ],
        },
        rows: [
            { id: 'p1', price: 39, rating: 4.6, sales: 1800 },
            { id: 'p2', price: 59, rating: 4.2, sales: 950 },
            { id: 'p3', price: 79, rating: 4.8, sales: 2600 },
            { id: 'p4', price: 99, rating: 3.9, sales: 420 },
            { id: 'p5', price: 129, rating: 4.4, sales: 1300 },
            { id: 'p6', price: 149, rating: 4.1, sales: 680 },
            { id: 'p7', price: 199, rating: 4.7, sales: 340 },
            { id: 'p8', price: 249, rating: 3.8, sales: 210 },
            { id: 'p9', price: 69, rating: 4.9, sales: 3200 },
            { id: 'p10', price: 89, rating: 4.0, sales: 760 },
        ],
    },
    {
        id: 'error-groups',
        title: '误差线 · 实验组均值',
        note: 'yError 通道绘制工字梁,y 轴自动覆盖误差端点。',
        spec: {
            mark: 'bar',
            keyField: 'id',
            encoding: [
                { field: 'group', channel: 'x' },
                { field: 'mean', channel: 'y' },
                { field: 'err', channel: 'yError' },
            ],
        },
        rows: [
            { id: 'e1', group: '对照组', mean: 62, err: 9 },
            { id: 'e2', group: '实验 A', mean: 74, err: 12 },
            { id: 'e3', group: '实验 B', mean: 81, err: 7 },
            { id: 'e4', group: '实验 C', mean: 58, err: 14 },
        ],
    },
    {
        id: 'waterfall-profit',
        title: '瀑布图 · 季度利润桥',
        note: '每段增量浮在累计水平上,涨跌着色,虚线连接相邻水平。',
        spec: {
            mark: 'waterfall',
            keyField: 'id',
            encoding: [
                { field: 'stage', channel: 'x' },
                { field: 'delta', channel: 'y' },
            ],
        },
        rows: [
            { id: 'w0', stage: '期初现金', delta: 180 },
            { id: 'w1', stage: '销售收入', delta: 240 },
            { id: 'w2', stage: '退款折让', delta: -45 },
            { id: 'w3', stage: '云服务', delta: -90 },
            { id: 'w4', stage: '人力成本', delta: -120 },
            { id: 'w5', stage: '其他收益', delta: 35 },
        ],
    },
    {
        id: 'funnel-signup',
        title: '漏斗图 · 注册转化',
        note: '阶段按人数降序成梯形,标注占首层百分比。',
        spec: {
            mark: 'funnel',
            keyField: 'id',
            encoding: [
                { field: 'stage', channel: 'x' },
                { field: 'users', channel: 'y' },
            ],
        },
        rows: [
            { id: 'f1', stage: '落地页访问', users: 12800 },
            { id: 'f2', stage: '开始注册', users: 5400 },
            { id: 'f3', stage: '验证邮箱', users: 3600 },
            { id: 'f4', stage: '完善资料', users: 2100 },
            { id: 'f5', stage: '首次付费', users: 860 },
        ],
    },
    {
        id: 'sankey-flow',
        title: '桑基图 · 数据层流转',
        note: '节点按最长路径分层,流带厚度等于真实流量。',
        spec: {
            mark: 'sankey',
            encoding: [
                { field: 'src', channel: 'source' },
                { field: 'dst', channel: 'target' },
                { field: 'gb', channel: 'value' },
            ],
        },
        rows: [
            { src: '采集', dst: '热层', gb: 120 },
            { src: '采集', dst: '温层', gb: 80 },
            { src: '热层', dst: '实时计算', gb: 90 },
            { src: '热层', dst: '在线缓存', gb: 30 },
            { src: '温层', dst: '离线计算', gb: 60 },
            { src: '温层', dst: '归档', gb: 20 },
            { src: '实时计算', dst: '告警', gb: 25 },
            { src: '实时计算', dst: '看板', gb: 65 },
            { src: '离线计算', dst: '报表', gb: 45 },
            { src: '离线计算', dst: '归档', gb: 15 },
        ],
    },
    {
        id: 'treemap-disk',
        title: '矩形树图 · 存储占用',
        note: 'squarified 布局,父级面积是叶值求和,单根下按顶层分组着色。',
        spec: {
            mark: 'treemap',
            keyField: 'id',
            parentField: 'parent',
            encoding: [{ field: 'gb', channel: 'size' }],
        },
        rows: [
            { id: '根', parent: null, gb: 0 },
            { id: '媒体', parent: '根', gb: 0 },
            { id: '文档', parent: '根', gb: 0 },
            { id: '系统', parent: '根', gb: 0 },
            { id: '视频', parent: '媒体', gb: 420 },
            { id: '图片', parent: '媒体', gb: 260 },
            { id: '音频', parent: '媒体', gb: 90 },
            { id: '设计稿', parent: '文档', gb: 140 },
            { id: '合同', parent: '文档', gb: 60 },
            { id: '表格', parent: '文档', gb: 45 },
            { id: '运行时', parent: '系统', gb: 180 },
            { id: '缓存', parent: '系统', gb: 120 },
            { id: '日志', parent: '系统', gb: 75 },
        ],
    },
    {
        id: 'bump-apps',
        title: '排名图 · 应用周活名次',
        note: '秩次在编译期计算,并列取最小秩,第 1 名在顶部。',
        spec: {
            mark: 'bump',
            keyField: 'id',
            encoding: [
                { field: 'week', channel: 'x' },
                { field: 'active', channel: 'y' },
                { field: 'app', channel: 'color' },
            ],
        },
        rows: (() => {
            const scores: Record<string, number[]> = {
                Alpha: [52, 48, 61, 66, 70],
                Beta: [60, 55, 50, 58, 62],
                Core: [40, 58, 66, 49, 55],
                Delta: [45, 40, 44, 60, 48],
            };
            const rows: Record<string, unknown>[] = [];
            Object.entries(scores).forEach(([app, values]) => values.forEach((active, i) => rows.push({ id: `${app}-${i}`, week: `W${i + 1}`, active, app })));
            return rows;
        })(),
    },
    {
        id: 'slope-share',
        title: '坡度图 · 两年份额变化',
        note: '恰两个时点连线,端点值标签在外侧。',
        spec: {
            mark: 'slope',
            keyField: 'id',
            encoding: [
                { field: 'year', channel: 'x' },
                { field: 'share', channel: 'y' },
                { field: 'brand', channel: 'color' },
            ],
        },
        rows: [
            { id: 'a20', year: '2023', share: 32, brand: 'Alpha' },
            { id: 'a24', year: '2025', share: 41, brand: 'Alpha' },
            { id: 'b20', year: '2023', share: 44, brand: 'Beta' },
            { id: 'b24', year: '2025', share: 36, brand: 'Beta' },
            { id: 'c20', year: '2023', share: 24, brand: 'Core' },
            { id: 'c24', year: '2025', share: 23, brand: 'Core' },
        ],
    },
    {
        id: 'heatmap-week',
        title: '热力图 · 一周分时负载',
        note: '双类目网格,色阶是真实值域,渐变图例带 min/max。',
        spec: {
            mark: 'heatmap',
            keyField: 'id',
            encoding: [
                { field: 'day', channel: 'x' },
                { field: 'hour', channel: 'y' },
                { field: 'load', channel: 'color' },
            ],
        },
        rows: (() => {
            const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
            const hours = ['09', '12', '15', '18', '21'];
            const base = [42, 68, 55, 30, 12, 38, 74, 61, 33, 9, 45, 80, 66, 40, 15, 50, 72, 58, 36, 11, 47, 77, 63, 34, 10];
            const rows: Record<string, unknown>[] = [];
            days.forEach((day, di) =>
                hours.forEach((hour, hi) => rows.push({ id: `${day}-${hour}`, day, hour, load: base[di * hours.length + hi] + ((di * 7 + hi * 3) % 9) })),
            );
            return rows;
        })(),
    },
    {
        id: 'rose-kinds',
        title: '玫瑰图 · 工单类型分布',
        note: '等角花瓣半径随值,环刻度是真实数值域。',
        spec: {
            mark: 'rose',
            keyField: 'id',
            encoding: [
                { field: 'kind', channel: 'x' },
                { field: 'count', channel: 'y' },
            ],
        },
        rows: [
            { id: 'k1', kind: '缺陷', count: 46 },
            { id: 'k2', kind: '需求', count: 78 },
            { id: 'k3', kind: '咨询', count: 30 },
            { id: 'k4', kind: '优化', count: 55 },
            { id: 'k5', kind: '安全', count: 22 },
            { id: 'k6', kind: '文档', count: 18 },
        ],
    },
    {
        id: 'radial-goals',
        title: '径向条 · 目标完成度',
        note: '同心环扫掠按 值/域最大值,首类最外环。',
        spec: {
            mark: 'radial-bar',
            keyField: 'id',
            encoding: [
                { field: 'goal', channel: 'x' },
                { field: 'done', channel: 'y' },
            ],
        },
        rows: [
            { id: 'g1', goal: '注册', done: 82 },
            { id: 'g2', goal: '激活', done: 64 },
            { id: 'g3', goal: '留存', done: 47 },
            { id: 'g4', goal: '付费', done: 29 },
        ],
    },
    {
        id: 'gauge-load',
        title: '仪表盘 · 集群水位',
        note: '240° 扫掠,值域 0–100,中心读数与五档刻度。',
        spec: { mark: 'gauge', encoding: [{ field: 'load', channel: 'theta' }], valueDomain: [0, 100] },
        rows: [{ load: 72 }],
    },
    {
        id: 'candlestick-week',
        title: 'K 线 · 两周日线',
        note: '实体与影线按涨跌着色,悬停读完整 OHLC。',
        spec: {
            mark: 'candlestick',
            keyField: 'id',
            encoding: [
                { field: 'day', channel: 'x' },
                { field: 'open', channel: 'open' },
                { field: 'high', channel: 'high' },
                { field: 'low', channel: 'low' },
                { field: 'close', channel: 'close' },
            ],
        },
        rows: [
            { id: 'd01', day: '5/6', open: 102, high: 108, low: 99, close: 106 },
            { id: 'd02', day: '5/7', open: 106, high: 109, low: 100, close: 101 },
            { id: 'd03', day: '5/8', open: 101, high: 112, low: 100, close: 110 },
            { id: 'd04', day: '5/9', open: 110, high: 115, low: 107, close: 113 },
            { id: 'd05', day: '5/10', open: 113, high: 114, low: 104, close: 105 },
            { id: 'd06', day: '5/13', open: 105, high: 111, low: 103, close: 109 },
            { id: 'd07', day: '5/14', open: 109, high: 118, low: 108, close: 116 },
            { id: 'd08', day: '5/15', open: 116, high: 120, low: 112, close: 113 },
            { id: 'd09', day: '5/16', open: 113, high: 117, low: 110, close: 115 },
            { id: 'd10', day: '5/17', open: 115, high: 122, low: 114, close: 121 },
        ],
    },
    {
        id: 'bullet-kpis',
        title: '子弹图 · 三项 KPI',
        note: '定性带 60/85/100%,实测条与目标刻线同轴。',
        spec: {
            mark: 'bullet',
            keyField: 'id',
            encoding: [
                { field: 'kpi', channel: 'x' },
                { field: 'actual', channel: 'y' },
                { field: 'target', channel: 'target' },
                { field: 'cap', channel: 'range' },
            ],
        },
        rows: [
            { id: 'k1', kpi: '营收(万)', actual: 220, target: 250, cap: 300 },
            { id: 'k2', kpi: '续费率(%)', actual: 86, target: 90, cap: 100 },
            { id: 'k3', kpi: '新客(千)', actual: 41, target: 36, cap: 60 },
        ],
    },
    {
        id: 'sparkline-traffic',
        title: '迷你图 · 行内流量',
        note: 'spark 模式去轴去图例,只留数据线本体,命中与 tooltip 保留。',
        spec: {
            mark: 'area',
            spark: true,
            encoding: [
                { field: 'hour', channel: 'x' },
                { field: 'req', channel: 'y' },
            ],
        },
        rows: [
            { hour: 0, req: 22 }, { hour: 1, req: 18 }, { hour: 2, req: 15 }, { hour: 3, req: 12 },
            { hour: 4, req: 16 }, { hour: 5, req: 28 }, { hour: 6, req: 45 }, { hour: 7, req: 68 },
            { hour: 8, req: 92 }, { hour: 9, req: 120 }, { hour: 10, req: 108 }, { hour: 11, req: 96 },
        ],
    },
    {
        id: 'violin-teams',
        title: '小提琴 · 两组时延分布',
        note: 'KDE 对称密度含内嵌箱线,五数概括在编译期计算。',
        spec: {
            mark: 'violin',
            encoding: [
                { field: 'team', channel: 'x' },
                { field: 'latency', channel: 'y' },
            ],
        },
        rows: (() => {
            const mk = (team: string, center: number, spread: number, seed0: number) => {
                let seed = seed0;
                const rand = () => {
                    seed = (seed * 1103515245 + 12345) % 2147483648;
                    return seed / 2147483648;
                };
                return Array.from({ length: 120 }, () => {
                    const u = rand();
                    const v = rand();
                    return { team, latency: Math.round(center + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * spread) };
                });
            };
            return [...mk('api', 52, 14, 11), ...mk('web', 96, 22, 29)];
        })(),
    },
    {
        id: 'strip-groups',
        title: '抖动散点 · 三组原始样本',
        note: '抖动偏移由行键确定性哈希,SSR 与水合一致。',
        spec: {
            mark: 'strip',
            keyField: 'id',
            encoding: [
                { field: 'grp', channel: 'x' },
                { field: 'val', channel: 'y' },
            ],
        },
        rows: (() => {
            let seed = 5;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            return Array.from({ length: 60 }, (_, i) => ({
                id: `s${i}`,
                grp: ['A', 'B', 'C'][i % 3],
                val: Math.round(40 + rand() * 40 + (i % 3) * 8),
            }));
        })(),
    },
    {
        id: 'beeswarm-latency',
        title: '蜂群 · 请求时延样本',
        note: '点按值序贪心避碰,不重叠,值轴共享。',
        spec: {
            mark: 'beeswarm',
            keyField: 'id',
            encoding: [{ field: 'latency', channel: 'y' }],
        },
        rows: (() => {
            let seed = 13;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            return Array.from({ length: 90 }, (_, i) => ({ id: `w${i}`, latency: Math.round(35 + rand() * 60 + (i % 9 === 0 ? 40 : 0)) }));
        })(),
    },
    {
        id: 'band-temp',
        title: '置信带 · 日均温与区间',
        note: 'yLow/yHigh 通道绘制半透明带,y 域自动覆盖边界。',
        spec: {
            mark: 'line',
            keyField: 'id',
            encoding: [
                { field: 'day', channel: 'x' },
                { field: 'temp', channel: 'y' },
                { field: 'lo', channel: 'yLow' },
                { field: 'hi', channel: 'yHigh' },
            ],
        },
        rows: [
            { id: 'b1', day: 'Mon', temp: 22, lo: 18, hi: 26 },
            { id: 'b2', day: 'Tue', temp: 25, lo: 21, hi: 29 },
            { id: 'b3', day: 'Wed', temp: 23, lo: 19, hi: 27 },
            { id: 'b4', day: 'Thu', temp: 27, lo: 23, hi: 31 },
            { id: 'b5', day: 'Fri', temp: 26, lo: 22, hi: 30 },
            { id: 'b6', day: 'Sat', temp: 24, lo: 20, hi: 28 },
            { id: 'b7', day: 'Sun', temp: 21, lo: 17, hi: 25 },
        ],
    },
    {
        id: 'streamgraph-apps',
        title: '流图 · 应用时长构成',
        note: 'wiggle 偏移让每层围绕零轴流动,悬停读真实小时数。',
        spec: {
            mark: 'streamgraph',
            keyField: 'id',
            encoding: [
                { field: 'week', channel: 'x' },
                { field: 'hours', channel: 'y' },
                { field: 'app', channel: 'color' },
            ],
        },
        rows: (() => {
            const series: Record<string, number[]> = {
                社交: [22, 26, 31, 28, 35, 33],
                视频: [30, 34, 28, 40, 36, 42],
                工具: [12, 10, 16, 14, 18, 15],
                阅读: [8, 12, 10, 14, 11, 16],
            };
            const rows: Record<string, unknown>[] = [];
            Object.entries(series).forEach(([app, values]) =>
                values.forEach((hours, i) => rows.push({ id: `${app}-${i}`, week: `W${i + 1}`, hours, app })),
            );
            return rows;
        })(),
    },
    {
        id: 'percent-share',
        title: '百分比堆叠 · 渠道构成',
        note: 'seriesLayout percent 把每槽归一到 0–100,悬停读原始值。',
        spec: {
            mark: 'bar',
            seriesLayout: 'percent',
            keyField: 'id',
            encoding: [
                { field: 'q', channel: 'x' },
                { field: 'v', channel: 'y' },
                { field: 'seg', channel: 'color' },
            ],
        },
        rows: [
            { id: 'p1', q: 'Q1', v: 320, seg: '直营' },
            { id: 'p2', q: 'Q1', v: 180, seg: '代理' },
            { id: 'p3', q: 'Q1', v: 90, seg: '分销' },
            { id: 'p4', q: 'Q2', v: 280, seg: '直营' },
            { id: 'p5', q: 'Q2', v: 240, seg: '代理' },
            { id: 'p6', q: 'Q2', v: 60, seg: '分销' },
            { id: 'p7', q: 'Q3', v: 410, seg: '直营' },
            { id: 'p8', q: 'Q3', v: 150, seg: '代理' },
            { id: 'p9', q: 'Q3', v: 130, seg: '分销' },
        ],
    },
    {
        id: 'calendar-commits',
        title: '日历热力 · 一季度提交',
        note: 'ISO 周列 × 周日行,色阶是真实提交数,月标签对齐。',
        spec: {
            mark: 'calendar',
            encoding: [
                { field: 'date', channel: 'x' },
                { field: 'commits', channel: 'color' },
            ],
        },
        rows: (() => {
            const rows: Record<string, unknown>[] = [];
            let seed = 3;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            const start = Date.UTC(2026, 0, 5);
            for (let i = 0; i < 84; i++) {
                const d = new Date(start + i * 86400000);
                const iso = d.toISOString().slice(0, 10);
                const dow = d.getUTCDay();
                const base = dow === 0 || dow === 6 ? 1 : 5;
                rows.push({ date: iso, commits: Math.round(base + rand() * 9) });
            }
            return rows;
        })(),
    },
    {
        id: 'sunburst-disk',
        title: '旭日图 · 存储占用层级',
        note: '环层按子树和比例展开,单根下按顶层分组着色。',
        spec: {
            mark: 'sunburst',
            keyField: 'id',
            parentField: 'parent',
            encoding: [{ field: 'gb', channel: 'size' }],
        },
        rows: [
            { id: '根', parent: null, gb: 0 },
            { id: '媒体', parent: '根', gb: 0 },
            { id: '文档', parent: '根', gb: 0 },
            { id: '系统', parent: '根', gb: 0 },
            { id: '视频', parent: '媒体', gb: 420 },
            { id: '图片', parent: '媒体', gb: 260 },
            { id: '音频', parent: '媒体', gb: 90 },
            { id: '设计稿', parent: '文档', gb: 140 },
            { id: '合同', parent: '文档', gb: 60 },
            { id: '运行时', parent: '系统', gb: 180 },
            { id: '缓存', parent: '系统', gb: 120 },
        ],
    },
    {
        id: 'tree-org',
        title: '树图 · 组织结构',
        note: '确定性 tidy 布局,深度向右,父节点居中于子节点。',
        spec: {
            mark: 'tree',
            keyField: 'id',
            parentField: 'parent',
            encoding: [{ field: 'size', channel: 'size' }],
        },
        rows: [
            { id: '总裁办', parent: null, size: 0 },
            { id: '研发', parent: '总裁办', size: 0 },
            { id: '产品', parent: '总裁办', size: 0 },
            { id: '运营', parent: '总裁办', size: 0 },
            { id: '前端', parent: '研发', size: 0 },
            { id: '后端', parent: '研发', size: 0 },
            { id: '算法', parent: '研发', size: 0 },
            { id: '设计', parent: '产品', size: 0 },
            { id: '策划', parent: '产品', size: 0 },
            { id: '市场', parent: '运营', size: 0 },
        ],
    },
    {
        id: 'dumbbell-change',
        title: '哑铃 · 改版前后对比',
        note: '两端点为 y 与 yEnd,双色读方向。',
        spec: {
            mark: 'dumbbell',
            keyField: 'id',
            encoding: [
                { field: 'team', channel: 'x' },
                { field: 'before', channel: 'y' },
                { field: 'after', channel: 'yEnd' },
            ],
        },
        rows: [
            { id: 'd1', team: '首页', before: 42, after: 61 },
            { id: 'd2', team: '列表', before: 68, after: 55 },
            { id: 'd3', team: '详情', before: 35, after: 58 },
            { id: 'd4', team: '结算', before: 74, after: 66 },
            { id: 'd5', team: '我的', before: 48, after: 72 },
        ],
    },
    {
        id: 'lollipop-scores',
        title: '棒棒糖 · 品类评分',
        note: '杆对齐零基线,端点读精确值。',
        spec: {
            mark: 'lollipop',
            keyField: 'id',
            encoding: [
                { field: 'item', channel: 'x' },
                { field: 'score', channel: 'y' },
            ],
        },
        rows: [
            { id: 'l1', item: '稳定性', score: 82 },
            { id: 'l2', item: '性能', score: 68 },
            { id: 'l3', item: '易用性', score: 91 },
            { id: 'l4', item: '生态', score: 47 },
            { id: 'l5', item: '文档', score: 73 },
        ],
    },
    {
        id: 'mosaic-regions',
        title: '马赛克 · 区域×套餐占比',
        note: '列宽随区域总量,段高随列内占比,双向读构成。',
        spec: {
            mark: 'mosaic',
            keyField: 'id',
            encoding: [
                { field: 'region', channel: 'x' },
                { field: 'users', channel: 'y' },
                { field: 'plan', channel: 'color' },
            ],
        },
        rows: [
            { id: 'm1', region: '华东', users: 420, plan: '旗舰' },
            { id: 'm2', region: '华东', users: 260, plan: '标准' },
            { id: 'm3', region: '华东', users: 90, plan: '免费' },
            { id: 'm4', region: '华南', users: 180, plan: '旗舰' },
            { id: 'm5', region: '华南', users: 240, plan: '标准' },
            { id: 'm6', region: '华南', users: 120, plan: '免费' },
            { id: 'm7', region: '西部', users: 90, plan: '旗舰' },
            { id: 'm8', region: '西部', users: 110, plan: '标准' },
            { id: 'm9', region: '西部', users: 160, plan: '免费' },
        ],
    },
    {
        id: 'gantt-roadmap',
        title: '甘特 · 季度路线图',
        note: '区间条按真实起止日期,日期轴自动识别。',
        spec: {
            mark: 'gantt',
            keyField: 'id',
            encoding: [
                { field: 'task', channel: 'y' },
                { field: 'begin', channel: 'start' },
                { field: 'finish', channel: 'end' },
            ],
        },
        rows: [
            { id: 't1', task: '需求冻结', begin: '2026-03-02', finish: '2026-03-08' },
            { id: 't2', task: '交互设计', begin: '2026-03-06', finish: '2026-03-18' },
            { id: 't3', task: '内核开发', begin: '2026-03-12', finish: '2026-04-10' },
            { id: 't4', task: '联调验收', begin: '2026-04-06', finish: '2026-04-22' },
            { id: 't5', task: '灰度发布', begin: '2026-04-20', finish: '2026-04-30' },
        ],
    },
    {
        id: 'force-deps',
        title: '力导向 · 服务依赖',
        note: '确定性种子布局,固定迭代轮数,同输入同坐标。',
        spec: {
            mark: 'force',
            encoding: [
                { field: 'src', channel: 'source' },
                { field: 'dst', channel: 'target' },
            ],
        },
        rows: [
            { src: '网关', dst: '认证' },
            { src: '网关', dst: '订单' },
            { src: '网关', dst: '商品' },
            { src: '订单', dst: '支付' },
            { src: '订单', dst: '库存' },
            { src: '商品', dst: '库存' },
            { src: '商品', dst: '评价' },
            { src: '支付', dst: '账务' },
            { src: '支付', dst: '风控' },
            { src: '风控', dst: '认证' },
            { src: '评价', dst: '搜索' },
            { src: '商品', dst: '搜索' },
            { src: '账务', dst: '报表' },
            { src: '库存', dst: '报表' },
        ],
    },
    {
        id: 'parallel-cars',
        title: '平行坐标 · 车型指标',
        note: 'k 个独立数值轴,每行一条折线,键盘逐顶点可达。',
        spec: {
            mark: 'parallel',
            dimensions: ['power', 'weight', 'price', 'range'],
            encoding: [{ field: 'brand', channel: 'color' }],
        },
        rows: [
            { brand: 'Alpha', power: 150, weight: 1420, price: 24, range: 520 },
            { brand: 'Alpha', power: 180, weight: 1580, price: 31, range: 480 },
            { brand: 'Beta', power: 110, weight: 1180, price: 16, range: 610 },
            { brand: 'Beta', power: 130, weight: 1260, price: 19, range: 590 },
            { brand: 'Core', power: 220, weight: 1710, price: 42, range: 450 },
            { brand: 'Core', power: 260, weight: 1890, price: 55, range: 410 },
            { brand: 'Delta', power: 95, weight: 1050, price: 13, range: 660 },
        ],
    },
    {
        id: 'hexbin-density',
        title: '蜂巢 · 价量密度',
        note: '六边形聚合网格,色阶是真实计数。',
        spec: {
            mark: 'hexbin',
            encoding: [
                { field: 'price', channel: 'x' },
                { field: 'volume', channel: 'y' },
            ],
        },
        rows: (() => {
            let seed = 21;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            return Array.from({ length: 260 }, () => ({
                price: Math.round(30 + rand() * 120 + (rand() > 0.8 ? 60 : 0)),
                volume: Math.round(50 + rand() * 300),
            }));
        })(),
    },
    {
        id: 'contour-density',
        title: '等值线 · 价量密度',
        note: '2D KDE + marching squares,等级取自动 nice levels。',
        spec: {
            mark: 'contour',
            encoding: [
                { field: 'price', channel: 'x' },
                { field: 'volume', channel: 'y' },
            ],
        },
        rows: (() => {
            let seed = 33;
            const rand = () => {
                seed = (seed * 1103515245 + 12345) % 2147483648;
                return seed / 2147483648;
            };
            return Array.from({ length: 320 }, () => {
                const u = rand();
                const v = rand();
                return {
                    price: 90 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * 30,
                    volume: 200 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.sin(2 * Math.PI * v) * 90,
                };
            });
        })(),
    },
    {
        id: 'chord-regions',
        title: '和弦 · 区域互访流量',
        note: '组弧按流入加流出,二次曲线流带,自连诊断丢弃。',
        spec: {
            mark: 'chord',
            encoding: [
                { field: 'src', channel: 'source' },
                { field: 'dst', channel: 'target' },
                { field: 'gb', channel: 'value' },
            ],
        },
        rows: [
            { src: '华东', dst: '华南', gb: 120 },
            { src: '华南', dst: '华东', gb: 90 },
            { src: '华东', dst: '华北', gb: 80 },
            { src: '华北', dst: '华东', gb: 60 },
            { src: '华南', dst: '西部', gb: 45 },
            { src: '西部', dst: '华南', gb: 30 },
            { src: '华北', dst: '西部', gb: 25 },
            { src: '西部', dst: '华东', gb: 20 },
        ],
    },
    {
        id: 'tree-dendrogram',
        title: '树图 · 叶对齐(dendrogram)',
        note: 'treeLayout 变体,叶节点对齐到最深列。',
        spec: {
            mark: 'tree',
            keyField: 'id',
            parentField: 'parent',
            treeLayout: 'dendrogram',
            encoding: [{ field: 'size', channel: 'size' }],
        },
        rows: [
            { id: '总裁办', parent: null, size: 0 },
            { id: '研发', parent: '总裁办', size: 0 },
            { id: '产品', parent: '总裁办', size: 0 },
            { id: '前端', parent: '研发', size: 0 },
            { id: '后端', parent: '研发', size: 0 },
            { id: '算法', parent: '研发', size: 0 },
            { id: '设计', parent: '产品', size: 0 },
        ],
    },
    {
        id: 'tree-radial',
        title: '树图 · 径向(radial)',
        note: 'treeLayout 变体,深度映射半径,叶序映射角度。',
        spec: {
            mark: 'tree',
            keyField: 'id',
            parentField: 'parent',
            treeLayout: 'radial',
            encoding: [{ field: 'size', channel: 'size' }],
        },
        rows: [
            { id: '总裁办', parent: null, size: 0 },
            { id: '研发', parent: '总裁办', size: 0 },
            { id: '产品', parent: '总裁办', size: 0 },
            { id: '运营', parent: '总裁办', size: 0 },
            { id: '前端', parent: '研发', size: 0 },
            { id: '后端', parent: '研发', size: 0 },
            { id: '算法', parent: '研发', size: 0 },
            { id: '设计', parent: '产品', size: 0 },
            { id: '策划', parent: '产品', size: 0 },
            { id: '市场', parent: '运营', size: 0 },
        ],
    },
    {
        id: 'geo-world',
        title: '世界 choropleth · GDP 总量',
        note: 'Natural Earth 公共域底图(独立资源包),name/iso_a3 双匹配。',
        spec: {
            mark: 'geo',
            geo: { map: 'ne-110m-lite', projection: 'mercator' },
            encoding: [
                { field: 'region', channel: 'region' },
                { field: 'gdp', channel: 'color' },
            ],
        },
        rows: [
            { region: 'United States of America', gdp: 27360 },
            { region: 'China', gdp: 17795 },
            { region: 'Germany', gdp: 4526 },
            { region: 'Japan', gdp: 3970 },
            { region: 'India', gdp: 3890 },
            { region: 'United Kingdom', gdp: 3495 },
            { region: 'France', gdp: 3130 },
            { region: 'Italy', gdp: 2300 },
            { region: 'Brazil', gdp: 2180 },
            { region: 'Canada', gdp: 2170 },
            { region: 'RUS', gdp: 2020 },
            { region: 'South Korea', gdp: 1760 },
            { region: 'Australia', gdp: 1720 },
            { region: 'Mexico', gdp: 1790 },
            { region: 'Spain', gdp: 1620 },
        ],
    },
];

/** 画廊分区：同一批示例按读者意图归类展示。 */
const SECTION_DEFS: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly note: string;
    readonly ids: ReadonlyArray<string>;
}> = [
    {
        id: 'basics',
        title: '基础图表',
        note: '柱状、折线、面积、散点、哑铃、棒棒糖与百分比堆叠,覆盖分组、堆叠、负值与长标签。',
        ids: ['bar-quarter', 'bar-dodge', 'bar-stack', 'line-weekly', 'area-traffic', 'scatter-latency', 'bar-delta', 'bar-cjk', 'dumbbell-change', 'lollipop-scores', 'percent-share'],
    },
    {
        id: 'distribution',
        title: '分布与统计',
        note: '分箱、五数概括、核密度、小提琴、抖动、蜂群、气泡、误差线、置信带、蜂巢、等值线与平行坐标,统计都在编译期完成。',
        ids: ['histogram-latency', 'boxplot-teams', 'violin-teams', 'ridgeline-services', 'strip-groups', 'beeswarm-latency', 'bubble-products', 'error-groups', 'band-temp', 'hexbin-density', 'contour-density', 'parallel-cars'],
    },
    {
        id: 'flow',
        title: '流程与计划',
        note: '累计瀑布、转化漏斗、分层流量、流图与甘特路线,每段几何都对应真实数值。',
        ids: ['waterfall-profit', 'funnel-signup', 'sankey-flow', 'streamgraph-apps', 'gantt-roadmap'],
    },
    {
        id: 'hierarchy',
        title: '层级结构',
        note: '矩形树图、旭日与三种树排布,共享同一套 keyField / parentField 层级输入。',
        ids: ['treemap-disk', 'sunburst-disk', 'tree-org', 'tree-dendrogram', 'tree-radial'],
    },
    {
        id: 'network',
        title: '关系与和弦',
        note: '确定性力导向与和弦流带,同一套 source / target 边表。',
        ids: ['force-deps', 'chord-regions'],
    },
    {
        id: 'geo',
        title: '地理',
        note: 'Natural Earth 公共域底图,投影与资产独立成包。',
        ids: ['geo-world'],
    },
    {
        id: 'ranking',
        title: '排名与变化',
        note: '秩次线与两时点坡度,读出相对位置而非绝对刻度。',
        ids: ['bump-apps', 'slope-share'],
    },
    {
        id: 'polar',
        title: '极坐标',
        note: '饼、环、雷达、玫瑰、径向条与仪表盘,角度与半径都有真实映射。',
        ids: ['pie-share', 'donut-share', 'radar-score', 'rose-kinds', 'radial-goals', 'gauge-load'],
    },
    {
        id: 'grid',
        title: '网格热力',
        note: '双类目网格与 ISO 周日历,顺序色阶读值域。',
        ids: ['heatmap-week', 'calendar-commits'],
    },
    {
        id: 'finance',
        title: '金融',
        note: 'OHLC 蜡烛,实体与影线按涨跌着色。',
        ids: ['candlestick-week'],
    },
    {
        id: 'compact',
        title: '占比与迷你',
        note: '马赛克双维构成、spark 迷你线与共享刻度的小倍数网格。',
        ids: ['mosaic-regions', 'sparkline-traffic', 'facet-platform'],
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

/** 一个分区：按读者意图归类的一组图表示例。 */
export interface ChartGallerySection {
    id: string;
    title: string;
    note: string;
    examples: ChartGalleryExample[];
}

function toExample(input: (typeof CHART_INPUTS)[number]): ChartGalleryExample {
    return {
        id: input.id,
        title: input.title,
        note: input.note,
        spec: input.spec,
        rows: input.rows,
        specText: JSON.stringify(input.spec, null, 2),
        dataText: JSON.stringify(input.rows, null, 2),
    };
}

/** 图表示例输入（渲染输入与代码文本同源）。 */
export function chartGalleryExamples(): ChartGalleryExample[] {
    return CHART_INPUTS.map(toExample);
}

/** 分区示例输入：与 `chartGalleryExamples` 同源，按 SECTION_DEFS 归类。 */
export function chartGallerySections(): ChartGallerySection[] {
    const byId = new Map(CHART_INPUTS.map((input) => [input.id, input]));
    return SECTION_DEFS.map((section) => ({
        id: section.id,
        title: section.title,
        note: section.note,
        examples: section.ids.map((id) => {
            const input = byId.get(id);
            if (!input) throw new Error(`chart-gallery: section ${section.id} references unknown example ${id}`);
            return toExample(input);
        }),
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
