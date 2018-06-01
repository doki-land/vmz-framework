import net from 'node:net';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { findAvailablePort } from 'vmz';

describe('findAvailablePort', () => {
    it('returns start when free', async () => {
        const port = await findAvailablePort('127.0.0.1', 45173, 5);
        expect(port).toBe(45173);
    });

    it('skips busy ports', async () => {
        const blocker = net.createServer();
        await new Promise((resolve, reject) => {
            blocker.once('error', reject);
            blocker.listen(45180, '127.0.0.1', resolve);
        });
        try {
            const port = await findAvailablePort('127.0.0.1', 45180, 5);
            expect(port).toBe(45181);
        } finally {
            await new Promise((resolve) => blocker.close(resolve));
        }
    });
});
