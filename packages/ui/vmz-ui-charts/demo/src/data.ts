/**
 * Chart gallery demo — build-time sample inputs.
 *
 * Every example is a plain static object: the page serializes the same spec
 * it renders, so the shown code and the live chart never drift. No runtime
 * fetches, no mocked endpoints.
 */
import type { ChartSpec } from "@doki-land/davinci/chart";
import { registerGeoMap } from "@doki-land/davinci/chart";
import type { DiagramSpec } from "@doki-land/davinci/diagram";
import type { GeoFeatureCollection } from "@doki-land/davinci-geo-assets";
import ne110mLite from "@doki-land/davinci-geo-assets/ne-110m-lite.json";

// geo 底图在宿主侧注册（引擎零地理数据）；模块在构建期与客户端都会求值。
registerGeoMap("ne-110m-lite", ne110mLite as GeoFeatureCollection);

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

const LEGEND_WRAP: GalleryExample = {
    id: "legend-wrap",
    title: "图例 · 多行换行",
    note: "八个长名系列在窄宽下换行成多行条带,图例行高计入上边距不遮数据。",
    spec: {
        mark: "bar",
        keyField: "id",
        encoding: [
            { field: "quarter", channel: "x" },
            { field: "sales", channel: "y" },
            { field: "region", channel: "color" },
        ],
    },
    rows: [
        { id: "q1-n", quarter: "Q1", sales: 42, region: "North America" },
        { id: "q1-s", quarter: "Q1", sales: 36, region: "South America" },
        { id: "q1-e", quarter: "Q1", sales: 51, region: "Western Europe" },
        { id: "q1-a", quarter: "Q1", sales: 44, region: "Southeast Asia" },
        { id: "q1-m", quarter: "Q1", sales: 29, region: "Middle East" },
        { id: "q1-f", quarter: "Q1", sales: 33, region: "North Africa" },
        { id: "q1-o", quarter: "Q1", sales: 25, region: "Oceania Pacific" },
        { id: "q1-c", quarter: "Q1", sales: 38, region: "Central Europe" },
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

const FORCE_DEPS: GalleryExample = {
    id: "force-deps",
    title: "力导向 · 服务依赖",
    note: "确定性种子布局,固定迭代轮数,同输入同坐标。",
    spec: {
        mark: "force",
        encoding: [
            { field: "src", channel: "source" },
            { field: "dst", channel: "target" },
        ],
    },
    rows: [
        { src: "网关", dst: "认证" },
        { src: "网关", dst: "订单" },
        { src: "网关", dst: "商品" },
        { src: "订单", dst: "支付" },
        { src: "订单", dst: "库存" },
        { src: "商品", dst: "库存" },
        { src: "商品", dst: "评价" },
        { src: "支付", dst: "账务" },
        { src: "支付", dst: "风控" },
        { src: "风控", dst: "认证" },
        { src: "评价", dst: "搜索" },
        { src: "商品", dst: "搜索" },
        { src: "账务", dst: "报表" },
        { src: "库存", dst: "报表" },
    ],
};

const PARALLEL_CARS: GalleryExample = {
    id: "parallel-cars",
    title: "平行坐标 · 车型指标",
    note: "k 个独立数值轴,每行一条折线,键盘逐顶点可达。",
    spec: {
        mark: "parallel",
        dimensions: ["power", "weight", "price", "range"],
        encoding: [{ field: "brand", channel: "color" }],
    },
    rows: [
        { brand: "Alpha", power: 150, weight: 1420, price: 24, range: 520 },
        { brand: "Alpha", power: 180, weight: 1580, price: 31, range: 480 },
        { brand: "Beta", power: 110, weight: 1180, price: 16, range: 610 },
        { brand: "Beta", power: 130, weight: 1260, price: 19, range: 590 },
        { brand: "Core", power: 220, weight: 1710, price: 42, range: 450 },
        { brand: "Core", power: 260, weight: 1890, price: 55, range: 410 },
        { brand: "Delta", power: 95, weight: 1050, price: 13, range: 660 },
    ],
};

const HEXBIN_DENSITY: GalleryExample = {
    id: "hexbin-density",
    title: "蜂巢 · 价量密度",
    note: "六边形聚合网格,色阶是真实计数。",
    spec: {
        mark: "hexbin",
        encoding: [
            { field: "price", channel: "x" },
            { field: "volume", channel: "y" },
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
};

const CONTOUR_DENSITY: GalleryExample = {
    id: "contour-density",
    title: "等值线 · 价量密度",
    note: "2D KDE + marching squares,等级取自动 nice levels。",
    spec: {
        mark: "contour",
        encoding: [
            { field: "price", channel: "x" },
            { field: "volume", channel: "y" },
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
};

const CHORD_REGIONS: GalleryExample = {
    id: "chord-regions",
    title: "和弦 · 区域互访流量",
    note: "组弧按流入加流出,二次曲线流带,自连诊断丢弃。",
    spec: {
        mark: "chord",
        encoding: [
            { field: "src", channel: "source" },
            { field: "dst", channel: "target" },
            { field: "gb", channel: "value" },
        ],
    },
    rows: [
        { src: "华东", dst: "华南", gb: 120 },
        { src: "华南", dst: "华东", gb: 90 },
        { src: "华东", dst: "华北", gb: 80 },
        { src: "华北", dst: "华东", gb: 60 },
        { src: "华南", dst: "西部", gb: 45 },
        { src: "西部", dst: "华南", gb: 30 },
        { src: "华北", dst: "西部", gb: 25 },
        { src: "西部", dst: "华东", gb: 20 },
    ],
};

const GEO_WORLD: GalleryExample = {
    id: "geo-world",
    title: "世界 choropleth · GDP 总量",
    note: "Natural Earth 公共域底图(独立资源包),name/iso_a3 双匹配。",
    spec: {
        mark: "geo",
        geo: { map: "ne-110m-lite", projection: "mercator" },
        encoding: [
            { field: "region", channel: "region" },
            { field: "gdp", channel: "color" },
        ],
    },
    rows: [
        { region: "United States of America", gdp: 27360 },
        { region: "China", gdp: 17795 },
        { region: "Germany", gdp: 4526 },
        { region: "Japan", gdp: 3970 },
        { region: "India", gdp: 3890 },
        { region: "United Kingdom", gdp: 3495 },
        { region: "France", gdp: 3130 },
        { region: "Italy", gdp: 2300 },
        { region: "Brazil", gdp: 2180 },
        { region: "Canada", gdp: 2170 },
        { region: "RUS", gdp: 2020 },
        { region: "South Korea", gdp: 1760 },
        { region: "Australia", gdp: 1720 },
        { region: "Mexico", gdp: 1790 },
        { region: "Spain", gdp: 1620 },
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

const HEATMAP_LOAD: GalleryExample = {
    id: "heatmap-week",
    title: "热力图 · 一周分时负载",
    note: "双类目网格,色阶是真实值域,渐变图例带 min/max。",
    spec: {
        mark: "heatmap",
        keyField: "id",
        encoding: [
            { field: "day", channel: "x" },
            { field: "hour", channel: "y" },
            { field: "load", channel: "color" },
        ],
    },
    rows: (() => {
        const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
        const hours = ["09", "12", "15", "18", "21"];
        const base = [42, 68, 55, 30, 12, 38, 74, 61, 33, 9, 45, 80, 66, 40, 15, 50, 72, 58, 36, 11, 47, 77, 63, 34, 10];
        const rows: Record<string, unknown>[] = [];
        days.forEach((day, di) =>
            hours.forEach((hour, hi) => rows.push({ id: `${day}-${hour}`, day, hour, load: base[di * hours.length + hi] + ((di * 7 + hi * 3) % 9) })),
        );
        return rows;
    })(),
};

const CANDLESTICK_WEEK: GalleryExample = {
    id: "candlestick-week",
    title: "K 线 · 两周日线",
    note: "实体与影线按涨跌着色,悬停读完整 OHLC。",
    spec: {
        mark: "candlestick",
        keyField: "id",
        encoding: [
            { field: "day", channel: "x" },
            { field: "open", channel: "open" },
            { field: "high", channel: "high" },
            { field: "low", channel: "low" },
            { field: "close", channel: "close" },
        ],
    },
    rows: [
        { id: "d01", day: "5/6", open: 102, high: 108, low: 99, close: 106 },
        { id: "d02", day: "5/7", open: 106, high: 109, low: 100, close: 101 },
        { id: "d03", day: "5/8", open: 101, high: 112, low: 100, close: 110 },
        { id: "d04", day: "5/9", open: 110, high: 115, low: 107, close: 113 },
        { id: "d05", day: "5/10", open: 113, high: 114, low: 104, close: 105 },
        { id: "d06", day: "5/13", open: 105, high: 111, low: 103, close: 109 },
        { id: "d07", day: "5/14", open: 109, high: 118, low: 108, close: 116 },
        { id: "d08", day: "5/15", open: 116, high: 120, low: 112, close: 113 },
        { id: "d09", day: "5/16", open: 113, high: 117, low: 110, close: 115 },
        { id: "d10", day: "5/17", open: 115, high: 122, low: 114, close: 121 },
    ],
};

const BOXPLOT_TEAMS: GalleryExample = {
    id: "boxplot-teams",
    title: "箱线 · 三组响应时延分布",
    note: "五数概括与 1.5 IQR 须在 compile 计算,异常值是真实离群点。",
    spec: {
        mark: "boxplot",
        encoding: [
            { field: "team", channel: "x" },
            { field: "latency", channel: "y" },
        ],
    },
    rows: (() => {
        const mk = (team: string, values: number[]) => values.map((latency) => ({ team, latency }));
        return [
            ...mk("api", [42, 45, 47, 48, 50, 51, 53, 55, 58, 60, 61, 63, 66, 70, 240]),
            ...mk("web", [60, 64, 66, 70, 72, 75, 77, 80, 83, 85, 88, 92, 95]),
            ...mk("batch", [120, 128, 131, 135, 139, 142, 148, 151, 157, 163, 170, 178, 186, 320, 345]),
        ];
    })(),
};

const HISTOGRAM_LATENCY: GalleryExample = {
    id: "histogram-latency",
    title: "直方图 · 请求时延分布",
    note: "分箱宽度取 Freedman–Diaconis,边界对齐整齐刻度,柱间无缝。",
    spec: { mark: "histogram", encoding: [{ field: "latency", channel: "x" }] },
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
            const latency = Math.round(50 + Math.sqrt(-2 * Math.log(Math.max(u, 1e-9))) * Math.cos(2 * Math.PI * v) * 18 + (i % 17 === 0 ? 60 : 0));
            rows.push({ latency });
        }
        return rows;
    })(),
};

const WATERFALL_PROFIT: GalleryExample = {
    id: "waterfall-profit",
    title: "瀑布 · 季度利润桥",
    note: "每段增量浮在累计水平上,涨跌着色,虚线连接相邻水平。",
    spec: {
        mark: "waterfall",
        keyField: "id",
        encoding: [
            { field: "stage", channel: "x" },
            { field: "delta", channel: "y" },
        ],
    },
    rows: [
        { id: "w0", stage: "期初现金", delta: 180 },
        { id: "w1", stage: "销售收入", delta: 240 },
        { id: "w2", stage: "退款折让", delta: -45 },
        { id: "w3", stage: "云服务", delta: -90 },
        { id: "w4", stage: "人力成本", delta: -120 },
        { id: "w5", stage: "其他收益", delta: 35 },
    ],
};

const BUMP_APPS: GalleryExample = {
    id: "bump-apps",
    title: "排名 · 应用周活名次",
    note: "秩次在 compile 计算,并列取最小秩,第 1 名在顶部。",
    spec: {
        mark: "bump",
        keyField: "id",
        encoding: [
            { field: "week", channel: "x" },
            { field: "active", channel: "y" },
            { field: "app", channel: "color" },
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
};

const SLOPE_SHARE: GalleryExample = {
    id: "slope-share",
    title: "坡度 · 两年份额变化",
    note: "恰两个时点连线,端点值标签在外侧。",
    spec: {
        mark: "slope",
        keyField: "id",
        encoding: [
            { field: "year", channel: "x" },
            { field: "share", channel: "y" },
            { field: "brand", channel: "color" },
        ],
    },
    rows: [
        { id: "a20", year: "2023", share: 32, brand: "Alpha" },
        { id: "a24", year: "2025", share: 41, brand: "Alpha" },
        { id: "b20", year: "2023", share: 44, brand: "Beta" },
        { id: "b24", year: "2025", share: 36, brand: "Beta" },
        { id: "c20", year: "2023", share: 24, brand: "Core" },
        { id: "c24", year: "2025", share: 23, brand: "Core" },
    ],
};

const GAUGE_LOAD: GalleryExample = {
    id: "gauge-load",
    title: "仪表盘 · 集群水位",
    note: "240° 扫掠,值域 0–100,中心读数与五档刻度。",
    spec: { mark: "gauge", encoding: [{ field: "load", channel: "theta" }], valueDomain: [0, 100] },
    rows: [{ load: 72 }],
};

const ROSE_KINDS: GalleryExample = {
    id: "rose-kinds",
    title: "玫瑰 · 工单类型分布",
    note: "等角花瓣半径随值,环刻度是真实数值域。",
    spec: {
        mark: "rose",
        keyField: "id",
        encoding: [
            { field: "kind", channel: "x" },
            { field: "count", channel: "y" },
        ],
    },
    rows: [
        { id: "k1", kind: "缺陷", count: 46 },
        { id: "k2", kind: "需求", count: 78 },
        { id: "k3", kind: "咨询", count: 30 },
        { id: "k4", kind: "优化", count: 55 },
        { id: "k5", kind: "安全", count: 22 },
        { id: "k6", kind: "文档", count: 18 },
    ],
};

const RADIAL_GOALS: GalleryExample = {
    id: "radial-goals",
    title: "径向条 · 目标完成度",
    note: "同心环扫掠按 值/域最大值,首类最外环。",
    spec: {
        mark: "radial-bar",
        keyField: "id",
        encoding: [
            { field: "goal", channel: "x" },
            { field: "done", channel: "y" },
        ],
    },
    rows: [
        { id: "g1", goal: "注册", done: 82 },
        { id: "g2", goal: "激活", done: 64 },
        { id: "g3", goal: "留存", done: 47 },
        { id: "g4", goal: "付费", done: 29 },
    ],
};

const BULLET_KPIS: GalleryExample = {
    id: "bullet-kpis",
    title: "子弹 · 三项 KPI",
    note: "定性带 60/85/100%,实测条与目标刻线同轴。",
    spec: {
        mark: "bullet",
        keyField: "id",
        encoding: [
            { field: "kpi", channel: "x" },
            { field: "actual", channel: "y" },
            { field: "target", channel: "target" },
            { field: "cap", channel: "range" },
        ],
    },
    rows: [
        { id: "k1", kpi: "营收(万)", actual: 220, target: 250, cap: 300 },
        { id: "k2", kpi: "续费率(%)", actual: 86, target: 90, cap: 100 },
        { id: "k3", kpi: "新客(千)", actual: 41, target: 36, cap: 60 },
    ],
};

const TREEMAP_DISK: GalleryExample = {
    id: "treemap-disk",
    title: "矩形树图 · 存储占用",
    note: "squarified 布局,父级面积=叶值求和,顶层着色。",
    spec: {
        mark: "treemap",
        keyField: "id",
        parentField: "parent",
        encoding: [{ field: "gb", channel: "size" }],
    },
    rows: [
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
    ],
};

const SANKEY_FLOW: GalleryExample = {
    id: "sankey-flow",
    title: "桑基 · 数据层流转",
    note: "节点按最长路径分层,流带厚度=真实流量,重心排序减少交叉。",
    spec: {
        mark: "sankey",
        encoding: [
            { field: "src", channel: "source" },
            { field: "dst", channel: "target" },
            { field: "gb", channel: "value" },
        ],
    },
    rows: [
        { src: "采集", dst: "热层", gb: 120 },
        { src: "采集", dst: "温层", gb: 80 },
        { src: "热层", dst: "实时计算", gb: 90 },
        { src: "热层", dst: "在线缓存", gb: 30 },
        { src: "温层", dst: "离线计算", gb: 60 },
        { src: "温层", dst: "归档", gb: 20 },
        { src: "实时计算", dst: "告警", gb: 25 },
        { src: "实时计算", dst: "看板", gb: 65 },
        { src: "离线计算", dst: "报表", gb: 45 },
        { src: "离线计算", dst: "归档", gb: 15 },
    ],
};

const RIDGELINE_SERVICES: GalleryExample = {
    id: "ridgeline-services",
    title: "山脊 · 服务时延密度",
    note: "KDE 在 compile 计算,共享网格,组内归一化峰高。",
    spec: {
        mark: "ridgeline",
        encoding: [
            { field: "latency", channel: "x" },
            { field: "service", channel: "y" },
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
        mk("api", 48, 12, 160);
        mk("web", 76, 18, 160);
        mk("batch", 132, 26, 160);
        mk("edge", 34, 9, 160);
        return rows;
    })(),
};

const FUNNEL_SIGNUP: GalleryExample = {
    id: "funnel-signup",
    title: "漏斗 · 注册转化",
    note: "阶段降序梯形,宽度随真实人数,标注占首层百分比。",
    spec: {
        mark: "funnel",
        keyField: "id",
        encoding: [
            { field: "stage", channel: "x" },
            { field: "users", channel: "y" },
        ],
    },
    rows: [
        { id: "f1", stage: "落地页访问", users: 12800 },
        { id: "f2", stage: "开始注册", users: 5400 },
        { id: "f3", stage: "验证邮箱", users: 3600 },
        { id: "f4", stage: "完善资料", users: 2100 },
        { id: "f5", stage: "首次付费", users: 860 },
    ],
};

const BUBBLE_PRODUCTS: GalleryExample = {
    id: "bubble-products",
    title: "气泡 · 价格×评分×销量",
    note: "面积随销量平方根映射,重叠仍可分辨。",
    spec: {
        mark: "point",
        keyField: "id",
        encoding: [
            { field: "price", channel: "x" },
            { field: "rating", channel: "y" },
            { field: "sales", channel: "size" },
        ],
    },
    rows: [
        { id: "p1", price: 39, rating: 4.6, sales: 1800 },
        { id: "p2", price: 59, rating: 4.2, sales: 950 },
        { id: "p3", price: 79, rating: 4.8, sales: 2600 },
        { id: "p4", price: 99, rating: 3.9, sales: 420 },
        { id: "p5", price: 129, rating: 4.4, sales: 1300 },
        { id: "p6", price: 149, rating: 4.1, sales: 680 },
        { id: "p7", price: 199, rating: 4.7, sales: 340 },
        { id: "p8", price: 249, rating: 3.8, sales: 210 },
        { id: "p9", price: 69, rating: 4.9, sales: 3200 },
        { id: "p10", price: 89, rating: 4.0, sales: 760 },
    ],
};

const ERROR_BAR_GROUPS: GalleryExample = {
    id: "error-groups",
    title: "误差线 · 实验组均值",
    note: "yError 通道工字梁,y 域自动含误差端点。",
    spec: {
        mark: "bar",
        keyField: "id",
        encoding: [
            { field: "group", channel: "x" },
            { field: "mean", channel: "y" },
            { field: "err", channel: "yError" },
        ],
    },
    rows: [
        { id: "e1", group: "对照组", mean: 62, err: 9 },
        { id: "e2", group: "实验 A", mean: 74, err: 12 },
        { id: "e3", group: "实验 B", mean: 81, err: 7 },
        { id: "e4", group: "实验 C", mean: 58, err: 14 },
    ],
};

const SPARKLINE_TRAFFIC: GalleryExample = {
    id: "sparkline-traffic",
    title: "迷你图 · 行内流量",
    note: "spark 模式去轴去图例,只留数据线本体,命中与 tooltip 保留。",
    spec: {
        mark: "area",
        spark: true,
        encoding: [
            { field: "hour", channel: "x" },
            { field: "req", channel: "y" },
        ],
    },
    rows: [
        { hour: 0, req: 22 }, { hour: 1, req: 18 }, { hour: 2, req: 15 }, { hour: 3, req: 12 },
        { hour: 4, req: 16 }, { hour: 5, req: 28 }, { hour: 6, req: 45 }, { hour: 7, req: 68 },
        { hour: 8, req: 92 }, { hour: 9, req: 120 }, { hour: 10, req: 108 }, { hour: 11, req: 96 },
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
    LEGEND_WRAP,
    AREA_TRAFFIC,
    SCATTER_LATENCY,
    NEGATIVE_DELTAS,
    CJK_LABELS,
    HEATMAP_LOAD,
    CANDLESTICK_WEEK,
    BOXPLOT_TEAMS,
    HISTOGRAM_LATENCY,
    WATERFALL_PROFIT,
    BUMP_APPS,
    SLOPE_SHARE,
    GAUGE_LOAD,
    ROSE_KINDS,
    RADIAL_GOALS,
    BULLET_KPIS,
    TREEMAP_DISK,
    SANKEY_FLOW,
    RIDGELINE_SERVICES,
    FUNNEL_SIGNUP,
    BUBBLE_PRODUCTS,
    ERROR_BAR_GROUPS,
    SPARKLINE_TRAFFIC,
    FORCE_DEPS,
    PARALLEL_CARS,
    HEXBIN_DENSITY,
    CONTOUR_DENSITY,
    CHORD_REGIONS,
    GEO_WORLD,
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
