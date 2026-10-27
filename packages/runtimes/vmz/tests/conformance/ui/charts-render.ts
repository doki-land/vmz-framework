/**
 * charts-render gate — @vmz/ui-charts real chart pipeline.
 *
 * Asserts:
 * - `compile` → `buildScene` maps plan scale ranges into the pixel viewport
 *   for bar / line / point marks (compile never guesses pixels)
 * - stable ids live on SemanticScene (rowIndex / series); DisplayScene strips
 *   domain semantics as designed, so markup carries geometry only
 * - `renderSvg` is deterministic, viewBox comes from the scene size, numbers
 *   stay at ≤3 decimals, text/attributes are escaped and empty data is safe
 */

import { buildScene, compile, fromRows } from '../../../../../davinci/davinci-chart/src/index.ts';
import { resolve } from '../../../../../davinci/davinci-scene/src/index.ts';
import { renderSvg } from '../../../../../ui/vmz-ui-charts/src/render/svg.ts';

const WIDTH = 640;
const HEIGHT = 360;

function fail(msg) {
    console.error(`charts-render GATE FAIL: ${msg}`);
    process.exit(1);
}

function count(haystack, needle) {
    let n = 0;
    let at = haystack.indexOf(needle);
    while (at >= 0) {
        n += 1;
        at = haystack.indexOf(needle, at + needle.length);
    }
    return n;
}

function pipeline(spec, rows) {
    const plan = compile(spec, fromRows(rows));
    const semantic = buildScene(plan, { width: WIDTH, height: HEIGHT });
    const display = resolve(semantic, { width: WIDTH, height: HEIGHT });
    return { plan, semantic, display, svg: renderSvg(display) };
}

const barSpec = {
    mark: 'bar',
    encoding: [
        { field: 'category', channel: 'x' },
        { field: 'value', channel: 'y' },
    ],
};
const barRows = [
    { category: 'alpha', value: 3 },
    { category: 'beta', value: 7 },
    { category: 'gamma', value: 5 },
];

console.log('charts-render: bar → rect marks…');
{
    const { semantic, display, svg } = pipeline(barSpec, barRows);
    const marks = semantic.root.children.filter((n) => n.kind === 'rect');
    if (marks.length !== barRows.length) fail(`want ${barRows.length} rect nodes, got ${marks.length}`);
    for (let i = 0; i < barRows.length; i++) {
        if (marks[i].id !== `bar:${i}`) fail(`stable id want bar:${i}, got ${marks[i].id}`);
        if (marks[i].role !== 'chart.mark') fail(`bar:${i} role want chart.mark, got ${marks[i].role}`);
    }
    if (!(marks[0].x < marks[1].x && marks[1].x < marks[2].x)) {
        fail('band categories must be evenly distributed on x');
    }
    if (!(marks[1].y < marks[2].y && marks[2].y < marks[0].y)) {
        // zero-based domain [0, 7]: 7 is tallest (smallest y), then 5, then 3
        fail('quantitative y must grow downward: y(7) < y(5) < y(3)');
    }
    if (marks.some((m) => !(m.h > 0))) fail('bar-like marks must be measured from a zero baseline');
    if (display.width !== WIDTH || display.height !== HEIGHT) {
        fail(`display size want ${WIDTH}x${HEIGHT}, got ${display.width}x${display.height}`);
    }
    if (count(svg, '<rect') !== barRows.length) fail(`svg want ${barRows.length} <rect>, got ${count(svg, '<rect')}`);
    if (count(svg, '<path') !== 0) fail('bar chart must not emit <path>');
    if (!svg.includes(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`)) fail(`viewBox must come from scene size: ${svg.slice(0, 200)}`);
}

console.log('charts-render: line → sorted single path…');
{
    const lineSpec = {
        mark: 'line',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    // Deliberately unordered rows: the path must follow x, not row order.
    const lineRows = [
        { step: 3, score: 1 },
        { step: 1, score: 2 },
        { step: 2, score: 3 },
    ];
    const { semantic, svg } = pipeline(lineSpec, lineRows);
    const paths = semantic.root.children.filter((n) => n.kind === 'path');
    if (paths.length !== 1) fail(`want exactly one line path, got ${paths.length}`);
    if (paths[0].id !== 'line:series') fail(`line id want line:series, got ${paths[0].id}`);
    const commands = paths[0].path.commands;
    if (commands.length !== lineRows.length) fail(`line commands want ${lineRows.length}, got ${commands.length}`);
    if (commands[0].kind !== 'move') fail('line path must start with move');
    const xs = commands.map((c) => c.to.x);
    for (let i = 1; i < xs.length; i++) {
        if (xs[i] < xs[i - 1]) fail(`line path must be sorted by x: ${JSON.stringify(xs)}`);
    }
    if (count(svg, '<path') !== 1) fail(`svg want 1 <path>, got ${count(svg, '<path')}`);
    if (!svg.includes('d="M ')) fail('path markup missing d attribute');
}

console.log('charts-render: point / circle → ellipse marks…');
{
    const pointSpec = {
        mark: 'circle',
        encoding: [
            { field: 'step', channel: 'x' },
            { field: 'score', channel: 'y' },
        ],
    };
    const { semantic, svg } = pipeline(pointSpec, [
        { step: 1, score: 2 },
        { step: 2, score: 4 },
        { step: 3, score: 3 },
    ]);
    const marks = semantic.root.children.filter((n) => n.kind === 'ellipse');
    if (marks.length !== 3) fail(`want 3 ellipse nodes, got ${marks.length}`);
    if (marks[0].id !== 'circle:0' || marks[2].id !== 'circle:2') fail('circle ids must come from rowIndex');
    if (count(svg, '<ellipse') !== 3) fail(`svg want 3 <ellipse>, got ${count(svg, '<ellipse')}`);
}

console.log('charts-render: empty data is not an error…');
{
    const { semantic, display, svg } = pipeline(barSpec, []);
    if (semantic.root.children.length !== 0) fail('empty data must produce no scene children');
    if (display.width !== WIDTH || display.height !== HEIGHT) fail('empty data must keep viewport');
    if (!svg.includes(`viewBox="0 0 ${WIDTH} ${HEIGHT}"`)) fail('empty data must still emit viewBox');
    if (count(svg, '<rect') !== 0) fail('empty data must emit no marks');
}

console.log('charts-render: rendering is deterministic and escaped…');
{
    const { svg } = pipeline(barSpec, barRows);
    const again = pipeline(barSpec, barRows).svg;
    if (svg !== again) fail('renderSvg must be deterministic for identical scenes');
    if (/\d+\.\d{4,}/.test(svg)) fail(`numbers must stay at ≤3 decimals: ${svg.match(/\d+\.\d{4,}/)[0]}`);

    const id = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const textScene = {
        width: 20,
        height: 10,
        root: {
            kind: 'group',
            worldTransform: id,
            bounds: { x: 0, y: 0, w: 20, h: 10 },
            children: [
                {
                    kind: 'text',
                    worldTransform: id,
                    bounds: { x: 0, y: 0, w: 0, h: 0 },
                    text: '<a & "b">',
                    fontCss: '',
                    anchor: { x: 1, y: 2 },
                    color: { r: 0, g: 0, b: 0, a: 1 },
                },
            ],
        },
    };
    const escaped = renderSvg(textScene);
    if (!escaped.includes('&lt;a &amp; &quot;b&quot;&gt;')) fail(`text must be escaped, got: ${escaped}`);
    if (!escaped.includes('viewBox="0 0 20 10"')) fail('manual scene viewBox wrong');
}

console.log('charts-render PASS: bar / line / point pipeline + deterministic SVG');
