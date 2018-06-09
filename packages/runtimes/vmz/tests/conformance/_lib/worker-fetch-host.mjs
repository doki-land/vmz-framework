/**
 * Worker-shaped Fetch host (live thin): HTTP bridge → handleFetchRequest only.
 * No SSR/static path. Spawn with VMZ_DIST + VMZ_PORT (0 = ephemeral).
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dist = process.env.VMZ_DIST;
if (!dist) {
    console.error('worker-fetch-host: VMZ_DIST required');
    process.exit(1);
}
const port = Number(process.env.VMZ_PORT || 0);

const runtimeUrl = pathToFileURL(path.join(dist, 'vmz-runtime.js')).href;
const runtime = await import(runtimeUrl);
const { setServerModuleResolver, setRoutes, handleFetchRequest } = runtime;
if (typeof handleFetchRequest !== 'function') {
    console.error('worker-fetch-host: handleFetchRequest missing');
    process.exit(1);
}

setServerModuleResolver((moduleId) => {
    const rel = String(moduleId || '').replace(/^#server\//, '');
    const candidates = [path.join(dist, '#server', `${rel}.js`), path.join(dist, '_vmz_server', `${rel}.js`)];
    for (const c of candidates) {
        if (fs.existsSync(c)) return pathToFileURL(c).href;
    }
    throw new Error(`server module missing for ${moduleId}`);
});

const routes = JSON.parse(fs.readFileSync(path.join(dist, 'vmz-routes.json'), 'utf8'));
setRoutes(routes);

async function readRaw(req) {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    return Buffer.concat(parts);
}

const server = http.createServer(async (req, res) => {
    try {
        const host = req.headers.host || '127.0.0.1';
        const url = new URL(req.url || '/', `http://${host}`);
        const method = (req.method || 'GET').toUpperCase();
        /** @type {Record<string, string>} */
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
            if (v == null) continue;
            headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        let request;
        if (method === 'GET' || method === 'HEAD') {
            request = new Request(url, { method, headers });
        } else {
            const raw = await readRaw(req);
            request = new Request(url, { method, headers, body: raw, duplex: 'half' });
        }
        const response = await handleFetchRequest(request);
        /** @type {Record<string, string>} */
        const outHeaders = {};
        response.headers.forEach((value, key) => {
            outHeaders[key] = value;
        });
        const buf = Buffer.from(await response.arrayBuffer());
        if (!outHeaders['content-length']) outHeaders['content-length'] = String(buf.byteLength);
        res.writeHead(response.status, outHeaders);
        res.end(buf);
    } catch (err) {
        if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
    }
});

server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const p = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`vmz worker-fetch-host http://127.0.0.1:${p}`);
});
