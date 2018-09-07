/**
 * Unit tests — deployment registry closure + tag conflict detection.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDependsOnClosure, componentEntriesFromDeployment, dedupeComponentEntriesByTag } from '@vmz/core/component-registry';
import { listClientComponents } from '@vmz/core/component-registry';

const deployment = {
    schema: 'vmz.deployment.v0',
    units: [
        {
            chunkId: 'components/SelectProbe',
            kind: 'component',
            dependsOn: ['components/Select'],
            clientEntry: 'components/SelectProbe.client.js',
        },
        { chunkId: 'components/Select', kind: 'component', dependsOn: [], clientEntry: 'components/Select.client.js' },
        {
            chunkId: 'components/ButtonA',
            kind: 'component',
            dependsOn: [],
            clientEntry: 'components/ButtonA.client.js',
            source: 'pkg-a/Button.vmz',
        },
        { chunkId: 'vendor/ButtonB', kind: 'component', dependsOn: [], clientEntry: 'vendor/ButtonB.client.js', source: 'pkg-b/Button.vmz' },
    ],
};

const closure = collectDependsOnClosure(deployment, ['components/SelectProbe']);
assert.ok(closure.has('components/SelectProbe'));
assert.ok(closure.has('components/Select'));
assert.equal(closure.size, 2);

const entries = componentEntriesFromDeployment(deployment);
assert.ok(entries.some((e) => e.name === 'Select'));

assert.throws(
    () =>
        dedupeComponentEntriesByTag(
            [
                { chunkId: 'components/ButtonA', name: 'Button', entry: 'components/ButtonA.client.js' },
                { chunkId: 'vendor/ButtonB', name: 'Button', entry: 'vendor/ButtonB.client.js' },
            ],
            { strict: true },
        ),
    /component tag <Button>/,
);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-strict-deploy-'));
try {
    await assert.rejects(() => listClientComponents(tmpDir, { strict: true }), /missing vmz-deployment\.json/);
} finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
}

console.log('deployment-registry unit: PASS');
