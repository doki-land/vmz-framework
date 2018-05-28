import http from 'node:http';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import { exampleDist, importDist, installDocument, installServerResolver, loadDom, loadRuntime, readJson } from '@vmz-examples/test-utils';

const dist = exampleDist('fullstack');

afterEach(() => {
    delete (globalThis as any).__VMZ_USE_HTTP_RPC;
    delete (globalThis as any).__VMZ_RPC_PATH;
});

describe('fullstack ssr / server', () => {
    it('SSR IndexPage includes UserCard data', async () => {
        const runtime = await loadRuntime(dist);
        const { registerComponents, renderToString } = await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);

        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');
        const { default: IndexPage } = await importDist<{ default: any }>(dist, 'pages/index.client.js');
        registerComponents({ UserCard });

        const html = await renderToString(IndexPage);
        expect(html).toContain('Ada');
        expect(html).toContain('profile-api');
    });

    it('callServer invokes UserCardServer.fetchUser', async () => {
        const { setServerModuleResolver, callServer } = await loadRuntime(dist);
        installServerResolver(setServerModuleResolver, dist);
        const user = await callServer('#server/components/UserCard', 'fetchUser', []);
        expect(user?.name).toBeTruthy();
    });

    it('HTTP RPC and REST return user payloads', async () => {
        const { setServerModuleResolver, setRoutes, handleNodeRequest } = await loadRuntime(dist);
        installServerResolver(setServerModuleResolver, dist);
        setRoutes(readJson(path.join(dist, 'vmz-routes.json')));

        const server = http.createServer((req, res) => {
            handleNodeRequest(req, res);
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const { port } = server.address() as { port: number };
        const base = `http://127.0.0.1:${port}`;

        try {
            const rpcRes = await fetch(`${base}/__vmz/rpc`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    moduleId: '#server/components/UserCard',
                    method: 'fetchUser',
                    args: [],
                }),
            });
            const rpcBody = await rpcRes.json();
            const restBody = await (await fetch(`${base}/api/users/me`)).json();
            expect(rpcBody?.name).toBeTruthy();
            expect(restBody?.name).toBeTruthy();
        } finally {
            server.close();
        }
    });

    it('e2e page + RPC + hydrate preserves SSR heading', async () => {
        const runtime = await loadRuntime(dist);
        const { registerComponents, hydrate, renderToString } = await loadDom(dist);
        installServerResolver(runtime.setServerModuleResolver, dist);
        runtime.setRoutes(readJson(path.join(dist, 'vmz-routes.json')));

        await writeFile(
            path.join(dist, 'entry-client.js'),
            `import { registerComponents, hydrate } from "./vmz-dom.js";
import IndexPage from "./pages/index.client.js";
import UserCard from "./components/UserCard.client.js";
registerComponents({ UserCard });
await hydrate(IndexPage, document.getElementById("app"));
`,
            'utf8',
        );

        const { default: UserCard } = await importDist<{ default: any }>(dist, 'components/UserCard.client.js');
        const { default: IndexPage } = await importDist<{ default: any }>(dist, 'pages/index.client.js');
        registerComponents({ UserCard });

        async function renderIndex() {
            const body = await renderToString(IndexPage);
            return `<!DOCTYPE html>
<html><body><div id="app">${body}</div>
<script type="module" src="/entry-client.js"></script>
</body></html>`;
        }

        const server = http.createServer((req, res) => {
            runtime.handleNodeRequest(req, res, { distDir: dist, renderIndex });
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
        const { port } = server.address() as { port: number };
        const base = `http://127.0.0.1:${port}`;

        try {
            const pageHtml = await (await fetch(`${base}/`)).text();
            expect(pageHtml).toContain('Ada');
            expect(pageHtml).toContain('entry-client.js');

            const entryJs = await (await fetch(`${base}/entry-client.js`)).text();
            expect(entryJs).toContain('hydrate');

            const rpcBody = await (
                await fetch(`${base}/__vmz/rpc`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        moduleId: '#server/components/UserCard',
                        method: 'fetchUser',
                        args: [],
                    }),
                })
            ).json();
            expect(rpcBody?.name).toBeTruthy();

            const restBody = await (await fetch(`${base}/api/users/me`)).json();
            expect(restBody?.name).toBeTruthy();

            (globalThis as any).__VMZ_USE_HTTP_RPC = true;
            (globalThis as any).__VMZ_RPC_PATH = `${base}/__vmz/rpc`;

            const { app } = installDocument(pageHtml);
            expect(app!.querySelector('h2')?.textContent).toBe('Ada');
            await hydrate(IndexPage, app!);
            expect(app!.querySelector('h2')?.textContent).toBe('Ada');
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
    });
});
