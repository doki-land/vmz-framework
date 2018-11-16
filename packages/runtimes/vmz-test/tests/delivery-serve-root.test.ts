/**
 * Unit tests for `resolveDeliveryServeRoot` (`profiles.*.name` nesting).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { isDeliveryServeRoot, resolveDeliveryServeRoot } from '../src/delivery-serve-root.ts';

function touch(file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
}

describe('resolveDeliveryServeRoot', () => {
    it('returns root when serve-host already lives there', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dsr-flat-'));
        touch(path.join(root, 'vmz-serve-host.mjs'));
        assert.equal(resolveDeliveryServeRoot(root), path.resolve(root));
        assert.equal(isDeliveryServeRoot(root), true);
    });

    it('descends into preferred name (cdn)', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dsr-cdn-'));
        const cdn = path.join(root, 'cdn');
        touch(path.join(cdn, 'vmz-serve-host.mjs'));
        touch(path.join(cdn, 'index.html'));
        assert.equal(resolveDeliveryServeRoot(root, 'cdn'), path.resolve(cdn));
    });

    it('finds sole nested delivery child without preferred name', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dsr-sole-'));
        const nested = path.join(root, 'static');
        touch(path.join(nested, 'index.html'));
        assert.equal(resolveDeliveryServeRoot(root), path.resolve(nested));
    });

    it('prefers cdn among multiple delivery children', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-dsr-multi-'));
        touch(path.join(root, 'static', 'index.html'));
        touch(path.join(root, 'cdn', 'vmz-serve-host.mjs'));
        touch(path.join(root, 'cdn', 'index.html'));
        assert.equal(resolveDeliveryServeRoot(root), path.resolve(root, 'cdn'));
    });
});
