/**
 * Minimal Vitest-like expect for `node:test` migrations .
 * Not a product test framework — package-local only.
 */
import assert from 'node:assert/strict';

function isAsymmetric(value) {
    return value != null && typeof value === 'object' && typeof value.asymmetricMatch === 'function';
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
function deepEqualAsymmetric(actual, expected, message) {
    if (isAsymmetric(expected)) {
        assert.ok(expected.asymmetricMatch(actual), message || String(expected));
        return;
    }
    if (Array.isArray(expected)) {
        assert.ok(Array.isArray(actual), message || 'expected array');
        assert.equal(actual.length, expected.length, message);
        for (let i = 0; i < expected.length; i++) {
            deepEqualAsymmetric(actual[i], expected[i], message);
        }
        return;
    }
    if (expected != null && typeof expected === 'object' && actual != null && typeof actual === 'object') {
        const expKeys = Object.keys(expected);
        const actKeys = Object.keys(/** @type {object} */ (actual));
        assert.equal(actKeys.length, expKeys.length, message);
        for (const key of expKeys) {
            deepEqualAsymmetric(
                /** @type {Record<string, unknown>} */ (actual)[key],
                /** @type {Record<string, unknown>} */ (expected)[key],
                message,
            );
        }
        return;
    }
    assert.deepEqual(actual, expected, message);
}

/**
 * @param {unknown} actual
 * @param {string} [message]
 */
export function expect(actual, message) {
    const msg = (detail) => (message ? `${message}: ${detail}` : detail);

    const api = {
        toBe(expected) {
            assert.equal(actual, expected, message);
        },
        toEqual(expected) {
            deepEqualAsymmetric(actual, expected, message);
        },
        toBeTruthy() {
            assert.ok(actual, msg('expected truthy'));
        },
        toBeFalsy() {
            assert.ok(!actual, msg('expected falsy'));
        },
        toHaveLength(n) {
            const len = actual == null ? undefined : /** @type {{ length?: number }} */ (actual).length;
            assert.equal(len, n, msg(`expected length ${n}, got ${len}`));
        },
        toBeGreaterThanOrEqual(n) {
            assert.ok(Number(actual) >= n, msg(`expected >= ${n}, got ${actual}`));
        },
        toBeGreaterThan(n) {
            assert.ok(Number(actual) > n, msg(`expected > ${n}, got ${actual}`));
        },
        toContain(part) {
            if (Array.isArray(actual)) {
                assert.ok(actual.includes(part), msg(`array missing ${JSON.stringify(part)}`));
            } else {
                assert.ok(String(actual).includes(String(part)), msg(`string missing ${JSON.stringify(part)}`));
            }
        },
        toMatch(re) {
            assert.match(String(actual), re instanceof RegExp ? re : new RegExp(re), message);
        },
        toThrow() {
            assert.throws(/** @type {() => unknown} */ (actual), undefined, message);
        },
        get not() {
            return {
                toBe(expected) {
                    assert.notEqual(actual, expected, message);
                },
                toEqual(expected) {
                    assert.notDeepEqual(actual, expected, message);
                },
                toContain(part) {
                    if (Array.isArray(actual)) {
                        assert.ok(!actual.includes(part), msg(`array unexpectedly has ${JSON.stringify(part)}`));
                    } else {
                        assert.ok(!String(actual).includes(String(part)), msg(`string unexpectedly has ${JSON.stringify(part)}`));
                    }
                },
                toThrow() {
                    assert.doesNotThrow(/** @type {() => unknown} */ (actual), undefined, message);
                },
            };
        },
    };
    return api;
}

expect.arrayContaining = function arrayContaining(subset) {
    return {
        asymmetricMatch(actual) {
            if (!Array.isArray(actual)) return false;
            return subset.every((item) => actual.includes(item));
        },
        toString() {
            return `arrayContaining(${JSON.stringify(subset)})`;
        },
    };
};

expect.any = function any(ctor) {
    return {
        asymmetricMatch(actual) {
            if (ctor === Number) return typeof actual === 'number' && !Number.isNaN(actual);
            if (ctor === String) return typeof actual === 'string';
            if (ctor === Boolean) return typeof actual === 'boolean';
            if (ctor === Object) return actual != null && typeof actual === 'object';
            if (ctor === Array) return Array.isArray(actual);
            if (typeof ctor === 'function') return actual instanceof ctor;
            return false;
        },
        toString() {
            return `any(${ctor?.name ?? ctor})`;
        },
    };
};
