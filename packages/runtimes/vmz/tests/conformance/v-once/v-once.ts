/**
 * v-once — 元素及整个后代子树只在首次创建时求值一次，之后响应式更新不得再更新该区域。
 *
 * 区域内的绑定在创建时写入一次（不注册 `trackPatch`，因此也不产生字段订阅），
 * 区域外的兄弟节点仍保持正常响应式。SSR / browser mount / hydrate 三条路径的
 * 区域内容必须一致，且数据变更后区域内容不变、兄弟内容更新。
 *
 * 说明：SSR 虚拟元素没有 `textContent` setter（元素级 v-text 只在浏览器生效），
 * 因此本门用文本节点承载插值，`v-html` 用 `innerHTML`，两者在 SSR 与 DOM 都成立。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { createDirectIfBlock } from '../_lib/direct-inline-if.ts';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'faces', 'dom.js')).href;

function fail(msg: string): never {
    console.error(`v-once GATE FAIL: ${msg}`);
    process.exit(1);
}

const { registerComponents, renderToString, hydrate, flushPending, mount } = await import(domHref);

/**
 * Fixture 根组件：`v-once` 冻结区域 + 正常响应式兄弟区域。
 *
 * `__vmzCreate` 手写，形状与 Direct emit 对 `v-once` 的产物一致：
 * 区域内只写 DOM（attr / 文本值 / innerHTML / 直接 if），不调用 `trackPatch`。
 */
class VOnceFixture {
    static __vmzDirect = true;
    static __vmzState = ['label', 'tone', 'condOnce', 'live', 'clicks'];
    label = 'first';
    tone = 'calm';
    condOnce = true;
    live = 'live';
    clicks = 0;

    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'once-root');

        // ---- v-once 区域：创建时求值一次，之后不再更新 ----
        const frozen = api.el('div');
        api.attr(frozen, 'data-fixture', 'once-region');
        // 属性绑定：创建时写入一次
        api.attr(frozen, 'title', this.tone);
        // 插值：文本节点创建时写入一次
        frozen.appendChild(api.text('label: '));
        const frozenText = api.text('');
        frozenText.textContent = String(this.label ?? '');
        frozen.appendChild(frozenText);
        // v-html：元素 innerHTML 创建时写入一次
        const frozenHtml = api.el('b');
        frozenHtml.innerHTML = this.label;
        frozen.appendChild(frozenHtml);
        // 后代子树（多层）同样冻结
        const nested = api.el('p');
        api.attr(nested, 'data-fixture', 'once-nested');
        const nestedText = api.text('');
        nestedText.textContent = String(this.label ?? '');
        nested.appendChild(nestedText);
        const deep = api.el('i');
        deep.appendChild(api.text('deep'));
        nested.appendChild(deep);
        frozen.appendChild(nested);
        // 区域内 v-if：只在创建时判定，不订阅条件
        if (this.condOnce) {
            const frozenIf = api.el('em');
            api.attr(frozenIf, 'data-fixture', 'once-if');
            frozenIf.appendChild(api.text('cond-once'));
            frozen.appendChild(frozenIf);
        }
        rootEl.appendChild(frozen);

        // ---- 兄弟区域：正常响应式（不受 v-once 影响） ----
        const liveBox = api.el('div');
        api.attr(liveBox, 'data-fixture', 'live-region');
        const liveText = api.text('');
        api.trackPatch(
            this,
            ['live'],
            function () {
                liveText.textContent = String(this.live ?? '');
            },
            null,
        );
        liveBox.appendChild(liveText);
        const liveBtn = api.el('button');
        api.attr(liveBtn, 'type', 'button');
        api.attr(liveBtn, 'data-fixture', 'live-btn');
        liveBtn.appendChild(api.text('count'));
        api.on(liveBtn, 'click', function () {
            this.clicks += 1;
        });
        liveBox.appendChild(liveBtn);
        const liveIf = createDirectIfBlock(api, this, ['condOnce'], [
            {
                cond: function () {
                    return this.condOnce;
                },
                create: (api) => {
                    const wrap = api.el('span');
                    api.attr(wrap, 'data-fixture', 'live-if-true');
                    wrap.appendChild(api.text('live-true'));
                    return wrap;
                },
            },
            {
                create: (api) => {
                    const wrap = api.el('span');
                    api.attr(wrap, 'data-fixture', 'live-if-false');
                    wrap.appendChild(api.text('live-false'));
                    return wrap;
                },
            },
        ]);
        liveBox.appendChild(liveIf);
        rootEl.appendChild(liveBox);

        return rootEl;
    }
}

registerComponents({ VOnceFixture });

/**
 * once 区域的结构签名（标签 + 排序后的属性 + 文本，不含兄弟、不含 SSR 丢掉的注释）。
 *
 * 比较签名而不是 `outerHTML` 原串：SSR 与 DOM 的属性插入顺序可以不同
 * （例如 `title` 走属性反射），但结构与取值必须一致。
 */
function onceRegionSignature(html: string): string {
    const { window } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`);
    const el = window.document.querySelector('[data-fixture="once-region"]');
    const canonical = (node: any): string => {
        if (!node) return '';
        if (node.nodeType === 3) return `T${JSON.stringify(node.textContent)}`;
        if (node.nodeType !== 1) return '';
        const attrs: Array<[string, string]> = [];
        for (const a of node.attributes) attrs.push([a.name, a.value]);
        attrs.sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
        const kids = Array.from(node.childNodes as any[], canonical).filter(Boolean);
        return `E${node.tagName.toLowerCase()}${JSON.stringify(attrs)}[${kids.join(',')}]`;
    };
    return canonical(el);
}

/** SSR 与 mount/hydrate 都必须满足的区域内容断言。 */
function assertOnceRegion(html: string, stage: string): void {
    if (!html.includes('data-fixture="once-region"')) fail(`${stage}: once region missing: ${html}`);
    // 创建时写入的属性 / 插值 / v-html / 后代子树 / 区域内 v-if
    if (!html.includes('title="calm"')) fail(`${stage}: once attr not written at create: ${html}`);
    if (!html.includes('label: first')) fail(`${stage}: once interp missing: ${html}`);
    if (!html.includes('<b>first</b>')) fail(`${stage}: once v-html missing: ${html}`);
    if (!html.includes('data-fixture="once-nested"')) fail(`${stage}: once nested subtree missing: ${html}`);
    if (!html.includes('<i>deep</i>')) fail(`${stage}: once deep descendant missing: ${html}`);
    if (!html.includes('data-fixture="once-if"')) fail(`${stage}: once v-if branch missing: ${html}`);
    // marker 不能作为真实 DOM 属性泄漏
    if (html.includes(' v-once')) fail(`${stage}: v-once marker leaked into DOM: ${html}`);
}

/** 兄弟区域必须保持响应式（数据变更后更新）。 */
function assertLiveRegion(html: string, stage: string): void {
    if (!html.includes('data-fixture="live-region"')) fail(`${stage}: live region missing: ${html}`);
}

// ========= 路径 1：SSR renderToString =========
console.log('v-once: SSR renderToString…');
const html = await renderToString(VOnceFixture, { props: {} });
assertOnceRegion(html, 'SSR');
assertLiveRegion(html, 'SSR');
if (!html.includes('>live<')) fail(`SSR live text missing: ${html}`);
if (!html.includes('data-fixture="live-if-true"')) fail(`SSR live if true branch missing: ${html}`);
if (html.includes('data-fixture="live-if-false"')) fail(`SSR live if else leaked: ${html}`);
const ssrOnce = onceRegionSignature(html);
if (!ssrOnce.includes('calm')) fail(`SSR once region signature empty/wrong: ${ssrOnce}`);
console.log(`v-once: SSR HTML ok (len=${html.length})`);

// ========= 路径 2：浏览器 mount（全新 DOM，无 SSR pool） =========
console.log('v-once: browser mount…');
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
    const inst = (await mount(VOnceFixture, app, {})) as {
        label: string;
        tone: string;
        condOnce: boolean;
        live: string;
        __vmzBinders?: Record<string, unknown>;
    };

    assertOnceRegion(app.innerHTML, 'mount');
    assertLiveRegion(app.innerHTML, 'mount');
    if (onceRegionSignature(app.innerHTML) !== ssrOnce) {
        fail(
            `mount: once region drifted from SSR\n  ssr:   ${ssrOnce}\n  mount: ${onceRegionSignature(app.innerHTML)}`,
        );
    }

    // once 区域未注册任何字段订阅（兄弟区域已注册）
    const binders = inst.__vmzBinders || {};
    if (binders.tone || binders.label) fail('mount: v-once region registered field subscriptions');
    if (!binders.live) fail('mount: sibling region did not register its subscription');

    // 数据变更：once 区域不更新，兄弟区域更新
    inst.label = 'second';
    inst.tone = 'loud';
    inst.condOnce = false;
    inst.live = 'changed';
    await flushPending(inst);

    const after = app.innerHTML;
    assertOnceRegion(after, 'mount+update');
    if (after.includes('second')) fail(`mount+update: v-once region updated: ${after}`);
    if (after.includes('title="loud"')) fail(`mount+update: v-once attr updated: ${after}`);
    if (!after.includes('>changed<')) fail(`mount+update: sibling did not update: ${after}`);
    if (!after.includes('data-fixture="live-if-false"')) {
        fail(`mount+update: sibling v-if did not switch: ${after}`);
    }
    if (!app.querySelector('[data-fixture="once-if"]')) fail('mount+update: once v-if disappeared');

    console.log('v-once: browser mount DOM parity + frozen region ok');
}

// ========= 路径 3：hydrate（SSR HTML → 浏览器 DOM 合并） =========
console.log('v-once: hydrate…');
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
    const inst = (await hydrate(VOnceFixture, app)) as {
        label: string;
        tone: string;
        condOnce: boolean;
        live: string;
        clicks: number;
    };

    // hydrate 后区域内容仍与 SSR 一致
    assertOnceRegion(app.innerHTML, 'hydrate');
    assertLiveRegion(app.innerHTML, 'hydrate');
    const hydratedOnce = onceRegionSignature(app.innerHTML);
    if (hydratedOnce !== ssrOnce) {
        fail(`hydrate: once region drifted from SSR\n  ssr:      ${ssrOnce}\n  hydrate:  ${hydratedOnce}`);
    }

    // hydrate 后数据变更：once 区域保持，兄弟响应式更新
    inst.label = 'second';
    inst.tone = 'loud';
    inst.condOnce = false;
    inst.live = 'changed';
    await flushPending(inst);

    const afterUpdate = app.innerHTML;
    assertOnceRegion(afterUpdate, 'hydrate+update');
    if (afterUpdate.includes('second')) fail(`hydrate+update: v-once region updated: ${afterUpdate}`);
    if (afterUpdate.includes('title="loud"')) fail(`hydrate+update: v-once attr updated: ${afterUpdate}`);
    if (!afterUpdate.includes('>changed<')) fail(`hydrate+update: sibling did not update: ${afterUpdate}`);
    if (!afterUpdate.includes('data-fixture="live-if-false"')) {
        fail(`hydrate+update: sibling v-if did not switch: ${afterUpdate}`);
    }
    if (!app.querySelector('[data-fixture="once-if"]')) fail('hydrate+update: once v-if disappeared');

    // hydrate 后兄弟 click 仍正常触发（once 区域不吞事件/调度）
    const btn = app.querySelector('[data-fixture="live-btn"]') as HTMLButtonElement | null;
    if (!btn) fail('hydrate+update: sibling button lost');
    btn.dispatchEvent(new window.Event('click', { bubbles: true }));
    if (!inst.clicks) fail('hydrate: sibling click did not fire handler');

    console.log('v-once: hydrate parity + frozen region + sibling reactivity ok');
}

console.log('v-once GATE PASS: SSR ↔ mount ↔ hydrate parity, region frozen, siblings live');
