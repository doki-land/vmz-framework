/**
 * v-pre — SSR 输出 HTML 与浏览器 mount / hydrate 后 DOM 一致。
 *
 * v-pre 区域内 {{ x }} / :class / v-if / @click 等 Vue 语法必须保留为字面量，
 * 不被求值或绑定。区域外的兄弟节点仍保持正常响应式。嵌套 HTML 结构
 * （tag nesting + textContent）必须完整保留。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { createDirectIfBlock } from '../_lib/direct-inline-if.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg: string): never {
    console.error(`v-pre GATE FAIL: ${msg}`);
    process.exit(1);
}

const { registerComponents, renderToString, hydrate, flushPending, mount } = await import(domHref);

/**
 * Fixture 根组件：包含 v-pre 静态区域 + v-pre 的兄弟节点（正常响应式）。
 */
class VPreFixture {
    static __vmzDirect = true;
    static __vmzState = ['y', 'z', 'clicked'];
    y = 'active';
    z = true;
    clicked = false;

    static __vmzCreate(api) {
        const root = api.el('div');
        api.attr(root, 'data-fixture', 'v-pre');

        // --- v-pre 区域：全部为静态字面量，不求值、不绑定 ---
        const preDiv = api.el('div');
        api.attr(preDiv, 'data-vmz-pre', '');

        // 字面量插值 —— 必须保留 {{ x }}
        preDiv.appendChild(api.text('Hello {{ x }} world'));

        // 字面量 :class 属性（原始属性名和值保留，不做动态绑定）
        const preSpan = api.el('span');
        api.attr(preSpan, ':class', 'y');
        preSpan.appendChild(api.text('static span'));
        preDiv.appendChild(preSpan);

        // 字面量 v-if 属性（原始属性保留，不做指令求值）
        const preVIf = api.el('span');
        api.attr(preVIf, 'v-if', 'z');
        preVIf.appendChild(api.text('v-if-literal'));
        preDiv.appendChild(preVIf);

        // 字面量 @click 属性（原始属性保留，不做事件绑定）
        const preClick = api.el('span');
        api.attr(preClick, '@click', 'foo');
        preClick.appendChild(api.text('click literal'));
        preDiv.appendChild(preClick);

        // 嵌套 HTML 结构保留（tag nesting + textContent）
        const nested = api.el('p');
        const em = api.el('em');
        em.appendChild(api.text('nested content'));
        nested.appendChild(em);
        preDiv.appendChild(nested);

        root.appendChild(preDiv);

        // --- v-pre 的兄弟节点：正常响应式（不受 v-pre 影响） ---
        const sibling = api.el('div');
        api.attr(sibling, 'data-fixture', 'v-pre-sibling');
        api.attr(sibling, 'class', api.mergeClass('sibling', this.y));
        sibling.appendChild(api.text('sibling text '));
        // 正常 v-if：由 this.z 控制（真正的指令）
        const block = createDirectIfBlock(
            api,
            this,
            ['z'],
            [
                {
                    cond: function () {
                        return this.z;
                    },
                    create: (api) => {
                        const wrap = api.el('span');
                        api.attr(wrap, 'data-fixture', 'sibling-if-true');
                        wrap.appendChild(api.text('visible'));
                        return wrap;
                    },
                },
                {
                    create: (api) => {
                        const wrap = api.el('span');
                        api.attr(wrap, 'data-fixture', 'sibling-if-false');
                        wrap.appendChild(api.text('hidden'));
                        return wrap;
                    },
                },
            ],
        );
        sibling.appendChild(block);
        // 正常响应式 click：由 this.clicked 标记
        const btn = api.el('button');
        api.attr(btn, 'type', 'button');
        api.attr(btn, 'data-fixture', 'sibling-btn');
        btn.appendChild(api.text('Toggle'));
        api.on(btn, 'click', function () {
            this.clicked = true;
        });
        sibling.appendChild(btn);
        root.appendChild(sibling);

        return root;
    }
}

registerComponents({ VPreFixture });

// ========= 路径 1：SSR renderToString =========
console.log('v-pre: SSR renderToString…');
const html = await renderToString(VPreFixture, { props: {} });
if (!html.includes('data-fixture="v-pre"')) fail(`SSR missing root fixture: ${html}`);

// v-pre 区域字面量保留断言（Vue 语法未被求值或绑定）
if (!html.includes('{{ x }}')) fail(`SSR lost {{ x }} literal: ${html}`);
if (!html.includes(':class="y"')) fail(`SSR lost :class="y" literal: ${html}`);
if (!html.includes('v-if="z"')) fail(`SSR lost v-if="z" literal: ${html}`);
if (!html.includes('@click="foo"')) fail(`SSR lost @click="foo" literal: ${html}`);

// v-pre 内部嵌套 HTML 结构完整
if (!html.includes('<p><em>nested content</em></p>')) {
    fail(`SSR v-pre nested HTML broken: ${html}`);
}
if (!html.includes('data-vmz-pre')) fail(`SSR missing v-pre marker: ${html}`);

// 兄弟节点：响应式区域 SSR 正常渲染
if (!html.includes('class="sibling active"')) fail(`SSR sibling dynamic class wrong: ${html}`);
if (!html.includes('data-fixture="sibling-if-true"')) fail(`SSR sibling v-if true branch missing: ${html}`);
if (html.includes('data-fixture="sibling-if-false"')) fail(`SSR sibling v-if else leaked: ${html}`);
if (!html.includes('data-fixture="sibling-btn"')) fail(`SSR sibling button missing: ${html}`);

console.log(`v-pre: SSR HTML ok (len=${html.length})`);

// ========= 路径 2：浏览器 mount（全新 DOM，无 SSR pool） =========
console.log('v-pre: browser mount…');
{
    const { window } = parseHTML('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;

    const app = window.document.getElementById('app');
    if (!app) fail('mount: missing #app');
    await mount(VPreFixture, app, {});

    // mount 后 DOM 结构应与 SSR HTML 一致
    const mountHtml = app.innerHTML;
    if (!mountHtml.includes('{{ x }}')) fail(`mount lost {{ x }} literal: ${mountHtml}`);
    if (!mountHtml.includes(':class="y"')) fail(`mount lost :class="y": ${mountHtml}`);
    if (!mountHtml.includes('v-if="z"')) fail(`mount lost v-if="z": ${mountHtml}`);
    if (!mountHtml.includes('@click="foo"')) fail(`mount lost @click="foo": ${mountHtml}`);
    if (!mountHtml.includes('data-fixture="sibling-if-true"')) fail(`mount sibling v-if broken: ${mountHtml}`);
    if (!mountHtml.includes('data-fixture="sibling-btn"')) fail(`mount sibling button missing: ${mountHtml}`);
    if (!mountHtml.includes('<p><em>nested content</em></p>')) fail(`mount nested HTML broken: ${mountHtml}`);

    console.log('v-pre: browser mount DOM parity ok');
}

// ========= 路径 3：hydrate（SSR HTML → 浏览器 DOM 合并） =========
console.log('v-pre: hydrate…');
{
    const { window } = parseHTML(`<!DOCTYPE html><html><body><div id="app">${html}</div></body></html>`);
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.DocumentFragment = window.DocumentFragment;
    globalThis.Text = window.Text;
    globalThis.Comment = window.Comment;

    const app = window.document.getElementById('app');
    if (!app) fail('hydrate: missing #app');
    // hydrate 不应抛错（SSR 与浏览器 DOM 结构一致）
    const inst = await hydrate(VPreFixture, app);

    // hydrate 后 v-pre 区域字面量仍然完整
    const afterHydrate = app.innerHTML;
    if (!afterHydrate.includes('{{ x }}')) fail(`hydrate lost {{ x }} literal: ${afterHydrate}`);
    if (!afterHydrate.includes(':class="y"')) fail(`hydrate lost :class="y": ${afterHydrate}`);
    if (!afterHydrate.includes('v-if="z"')) fail(`hydrate lost v-if="z": ${afterHydrate}`);
    if (!afterHydrate.includes('@click="foo"')) fail(`hydrate lost @click="foo": ${afterHydrate}`);
    if (!afterHydrate.includes('data-vmz-pre')) fail(`hydrate lost v-pre marker: ${afterHydrate}`);
    if (!afterHydrate.includes('<p><em>nested content</em></p>')) fail(`hydrate nested HTML broken: ${afterHydrate}`);

    // hydrate 后兄弟节点响应式仍工作（v-if toggle）
    const ifTrue = app.querySelector('[data-fixture="sibling-if-true"]');
    if (!ifTrue) fail('hydrate: sibling v-if true branch missing');
    inst.z = false;
    await flushPending(inst);
    if (app.querySelector('[data-fixture="sibling-if-true"]')) fail('hydrate: sibling v-if did not switch');
    if (!app.querySelector('[data-fixture="sibling-if-false"]')) fail('hydrate: sibling v-if else missing after switch');

    // hydrate 后 v-pre 区域不受响应式影响（切 z 不应改变 pre 区内容）
    if (!app.querySelector('[data-vmz-pre]')) fail('hydrate toggle: v-pre marker disappeared');
    if (!app.innerHTML.includes('{{ x }}')) fail(`hydrate toggle: {{ x }} literal lost: ${app.innerHTML}`);
    if (!app.innerHTML.includes(':class="y"')) fail(`hydrate toggle: :class="y" lost: ${app.innerHTML}`);

    // hydrate 后兄弟 click 仍正常触发
    const btn = app.querySelector('[data-fixture="sibling-btn"]') as HTMLButtonElement | null;
    if (!btn) fail('hydrate toggle: sibling button lost');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!inst.clicked) fail('hydrate: sibling click did not fire handler');

    console.log('v-pre: hydrate parity + sibling reactivity ok');
}

console.log('v-pre GATE PASS: SSR ↔ mount ↔ hydrate parity');
