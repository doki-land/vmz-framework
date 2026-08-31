/**
 * ui-v-if-dom — false v-if must not leave empty layout `span[data-vmz-if]` in SSR HTML.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from '../_lib/repo-root.ts';

const root = repoRoot(import.meta.url);
const domHref = pathToFileURL(path.join(root, 'packages', 'runtimes', 'vmz-runtime', 'dist', 'dom.js')).href;

function fail(msg) {
    console.error(`ui-v-if-dom GATE FAIL: ${msg}`);
    process.exit(1);
}

console.log('ui-v-if-dom: SSR false branch omits if box…');
const { registerComponents, renderToString } = await import(domHref);

class IfFixture {
    static __vmzDirect = true;
    show = false;
    static __vmzCreate(api) {
        const rootEl = api.el('div');
        api.attr(rootEl, 'data-fixture', 'ui-v-if-dom');
        const block = api.ifBlock(
            this,
            null,
            ['show'],
            [
                {
                    cond: () => this.show,
                    create: (api) => {
                        const header = api.el('header');
                        header.appendChild(api.text('visible'));
                        return header;
                    },
                },
            ],
        );
        rootEl.appendChild(block);
        return rootEl;
    }
}

registerComponents({ IfFixture });
const html = await renderToString(IfFixture, { props: {} });
if (html.includes('data-vmz-if')) fail(`SSR leaked data-vmz-if: ${html}`);
if (html.includes('visible')) fail(`false branch rendered body: ${html}`);
if (!html.includes('data-fixture="ui-v-if-dom"')) fail('missing fixture root');

console.log('ui-v-if-dom: Card SSR without empty if shell…');
const cardJs = path.join(root, 'packages', 'homepage', 'dist', 'web-ssr', 'components', 'Card.client.js');
if (!fs.existsSync(cardJs)) {
    fail(`missing ${cardJs} — build packages/homepage first`);
}
const { default: Card } = await import(pathToFileURL(cardJs).href);
registerComponents({ Card });
const cardHtml = await renderToString(Card, { props: { title: '', description: '', bordered: true } });
if (cardHtml.includes('data-vmz-if')) fail(`Card SSR leaked data-vmz-if: ${cardHtml.slice(0, 400)}`);
if (cardHtml.includes('vmz-ui-card__header')) fail('Card header should be omitted when title empty');

console.log('ui-v-if-dom GATE PASS: no empty v-if DOM shell in SSR');
