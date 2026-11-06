/**
 * Conformance registry reachability contract.
 *
 * Every registered driver must either be reachable from `CHECK_ALL`, declare
 * `aliasOf` a reachable driver, or declare an `excluded` reason. A gate that is
 * registered but never runs is treated as a contract bug, not documentation.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHECK_ALL, CHECKS, type CheckEntry } from '../conformance/registry.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const conformanceRoot = path.resolve(here, '../conformance');

const errors: string[] = [];

const duplicateAll = CHECK_ALL.filter((id, index) => CHECK_ALL.indexOf(id) !== index);
if (duplicateAll.length) errors.push(`CHECK_ALL has duplicate ids: ${duplicateAll.join(', ')}`);

for (const id of CHECK_ALL) {
    if (!CHECKS[id]) errors.push(`CHECK_ALL references unknown id: ${id}`);
}

for (const [id, entry] of Object.entries(CHECKS)) {
    if ('composite' in entry) {
        for (const child of entry.composite) {
            if (!CHECKS[child]) errors.push(`${id}: composite child is not registered: ${child}`);
        }
    } else {
        const file = path.join(conformanceRoot, entry.file);
        if (!existsSync(file)) errors.push(`${id}: driver file does not exist: ${entry.file}`);
    }
}

const reachable = new Set<string>();
const cycles: string[] = [];
function walk(id: string, stack: string[] = []) {
    if (stack.includes(id)) {
        cycles.push([...stack, id].join(' -> '));
        return;
    }
    if (reachable.has(id)) return;
    const entry: CheckEntry | undefined = CHECKS[id];
    if (!entry) return;
    reachable.add(id);
    if ('composite' in entry) {
        for (const child of entry.composite) walk(child, [...stack, id]);
    }
}
for (const id of CHECK_ALL) walk(id);
if (cycles.length) errors.push(`composite cycles: ${cycles.join(', ')}`);

for (const [id, entry] of Object.entries(CHECKS)) {
    const isReachable = reachable.has(id);
    if (entry.excluded && isReachable) {
        errors.push(`${id}: has an excluded reason but is reachable from CHECK_ALL`);
    }
    if (entry.excluded !== undefined && !entry.excluded.trim()) {
        errors.push(`${id}: excluded reason must not be empty`);
    }
    if (entry.aliasOf) {
        const target = CHECKS[entry.aliasOf];
        if (!target) {
            errors.push(`${id}: aliasOf target is not registered: ${entry.aliasOf}`);
        } else {
            if (!reachable.has(entry.aliasOf) && !target.excluded) {
                errors.push(`${id}: aliasOf target is neither reachable nor excluded: ${entry.aliasOf}`);
            }
            if ('file' in entry && 'file' in target && entry.file !== target.file) {
                errors.push(`${id}: aliasOf target uses a different driver: ${entry.aliasOf}`);
            }
        }
    }
    if (!isReachable && !entry.excluded && !entry.aliasOf) {
        errors.push(`${id}: registered but unreachable. Add it to CHECK_ALL, aliasOf a reachable id, or excluded with a reason`);
    }
}

test('conformance registry is reachable and complete', () => {
    assert.deepEqual(errors, []);
    assert.ok(CHECK_ALL.length > 0, 'CHECK_ALL must not be empty');
    assert.ok(reachable.size >= CHECK_ALL.length, 'reachable set must cover CHECK_ALL');
});
