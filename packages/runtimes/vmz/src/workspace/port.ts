import net from 'node:net';

/** Probe for a free TCP port starting at `start` (inclusive). Used by `vmz dev` when `--port` is omitted. */
export function findAvailablePort(host: string, start = 5173, maxTries = 50): Promise<number> {
    const first = Number(start);
    if (!Number.isFinite(first) || first <= 0) {
        return Promise.reject(new Error(`invalid start port: ${start}`));
    }
    return new Promise((resolve, reject) => {
        let port = first;
        const attempt = () => {
            if (port > first + maxTries) {
                reject(new Error(`no free port in ${first}..${first + maxTries} on ${host}`));
                return;
            }
            const server = net.createServer();
            server.unref();
            server.once('error', (err: NodeJS.ErrnoException) => {
                if (err?.code === 'EADDRINUSE') {
                    port += 1;
                    attempt();
                    return;
                }
                reject(err);
            });
            server.once('listening', () => {
                server.close((closeErr) => {
                    if (closeErr) reject(closeErr);
                    else resolve(port);
                });
            });
            server.listen(port, host);
        };
        attempt();
    });
}
