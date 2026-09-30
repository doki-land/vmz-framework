import http from 'node:http';
import { handleNodeRequest } from '../../faces/vmz-runtime.js';
import { SHUTDOWN_TIMEOUT_MS } from './constants.js';
import { normalizeDevError, notifySse, softReload } from './hmr-dev.js';
import { renderPage, renderPageStream } from './page-render.js';
import { serveState } from './state.js';

function readRequestBody(req: http.IncomingMessage) {
    return new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

async function gracefulShutdown(signal: string) {
    if (serveState.shuttingDown) return;
    serveState.shuttingDown = true;
    serveState.ready = false;
    console.log(`vmz serve: ${signal} — draining in-flight=${serveState.inFlight} timeout=${SHUTDOWN_TIMEOUT_MS}ms`);
    serveState.server?.close();
    const start = Date.now();
    while (serveState.inFlight > 0 && Date.now() - start < SHUTDOWN_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, 25));
    }
    for (const client of serveState.sseClients) {
        try {
            client.end();
        } catch {
            /* ignore */
        }
    }
    serveState.sseClients.clear();
    process.exit(serveState.inFlight > 0 ? 1 : 0);
}

export function startServeHttp() {
    serveState.server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://${serveState.host}:${serveState.port}`);

        if (url.pathname === '/__vmz/health' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ status: 'ok', shuttingDown: serveState.shuttingDown, inFlight: serveState.inFlight }));
            return;
        }
        if (url.pathname === '/__vmz/ready' && req.method === 'GET') {
            if (!serveState.ready || serveState.shuttingDown) {
                res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
                res.end(JSON.stringify({ status: 'not-ready', ready: serveState.ready, shuttingDown: serveState.shuttingDown }));
                return;
            }
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ status: 'ready', ready: true, inFlight: serveState.inFlight }));
            return;
        }

        if (serveState.shuttingDown) {
            res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
            res.end(JSON.stringify({ status: 'shutting-down' }));
            return;
        }

        serveState.inFlight += 1;
        let settled = false;
        const done = () => {
            if (settled) return;
            settled = true;
            serveState.inFlight = Math.max(0, serveState.inFlight - 1);
        };
        res.on('finish', done);
        res.on('close', done);

        if (url.pathname === '/__vmz/reload' && req.method === 'POST') {
            readRequestBody(req)
                .then((raw) => {
                    let payload: Record<string, unknown> = {};
                    try {
                        payload = raw ? (JSON.parse(String(raw)) as Record<string, unknown>) : {};
                    } catch {
                        payload = {};
                    }
                    return softReload({ payload });
                })
                .then((info) => {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, token: serveState.reloadToken, ...info }));
                })
                .catch((err) => {
                    console.error('vmz serve: soft reload failed', err);
                    serveState.lastDevError = normalizeDevError(err);
                    notifySse(
                        JSON.stringify({
                            type: 'error',
                            message: serveState.lastDevError.message,
                            stack: serveState.lastDevError.stack,
                            at: serveState.lastDevError.at,
                        }),
                    );
                    res.writeHead(500, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: false, error: serveState.lastDevError.message }));
                });
            return;
        }
        if (url.pathname === '/__vmz/events' && req.method === 'GET') {
            res.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
            });
            res.write(': connected\n\n');
            serveState.sseClients.add(res);
            req.on('close', () => {
                serveState.sseClients.delete(res);
            });
            return;
        }
        handleNodeRequest(req, res, { distDir: serveState.distDir, renderPage, renderPageStream });
    });

    serveState.server.listen(serveState.port, serveState.host, () => {
        console.log(`vmz serve http://${serveState.host}:${serveState.port} (dist=${serveState.distDir}${serveState.isDev ? ', dev' : ''})`);
    });

    process.on('SIGTERM', () => {
        void gracefulShutdown('SIGTERM');
    });
    process.on('SIGINT', () => {
        void gracefulShutdown('SIGINT');
    });
}
