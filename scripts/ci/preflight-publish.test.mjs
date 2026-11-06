/**
 * Fixtures for the publish preflight. A partial publish must be blocked before
 * `nifty publish` starts, so registry facts are evaluated against the whole
 * workspace package set up front instead of failing package by package.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    PLACEHOLDER_VERSION,
    collectPublishablePackages,
    evaluatePreflight,
    releasePackageSet,
} from './preflight-publish.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const PACKAGES = [
    { name: 'vmz', version: '0.3.13' },
    { name: '@vmz/core', version: '0.3.13' },
    { name: '@vmz/ui-icons', version: PLACEHOLDER_VERSION },
];

function packument(latest, versions) {
    const all = versions ?? [PLACEHOLDER_VERSION, latest];
    return {
        versions: Object.fromEntries(all.map((version) => [version, { version }])),
        'dist-tags': { latest },
    };
}

function cleanPackuments() {
    return {
        vmz: packument('0.3.13'),
        '@vmz/core': packument('0.3.13'),
    };
}

test('registry agreeing with the package set passes', () => {
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments: cleanPackuments() });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(
        result.releases.map((pkg) => pkg.name),
        ['vmz', '@vmz/core'],
    );
});

test('placeholder-only packages are outside the release set', () => {
    const releases = releasePackageSet(PACKAGES);
    assert.equal(
        releases.some((pkg) => pkg.name === '@vmz/ui-icons'),
        false,
    );
});

test('a package missing from the registry blocks the publish', () => {
    const packuments = cleanPackuments();
    delete packuments.vmz;
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /vmz: not on registry\.npmjs\.org/);
    assert.match(result.errors.join('\n'), /Trusted Publisher/);
});

test('a missing 0.0.0 placeholder blocks the publish', () => {
    const packuments = cleanPackuments();
    packuments['@vmz/core'] = packument('0.3.13', ['0.3.12', '0.3.13']);
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /@vmz\/core: no `0\.0\.0` placeholder/);
});

test('an already published target version blocks the publish', () => {
    const packuments = cleanPackuments();
    packuments.vmz = packument('0.3.14', [PLACEHOLDER_VERSION, '0.3.13', '0.3.14']);
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /vmz: 0\.3\.14 is already published/);
});

test('a dist-tag pointing at the target version blocks the publish', () => {
    const packuments = cleanPackuments();
    packuments.vmz = { ...packument('0.3.13'), 'dist-tags': { latest: '0.3.13', next: '0.3.14' } };
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /vmz: dist-tag `next` already points at 0\.3\.14/);
});

test('a patch gap blocks the publish', () => {
    const packuments = cleanPackuments();
    packuments['@vmz/core'] = packument('0.3.12');
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.3.14', packuments });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /@vmz\/core: latest is 0\.3\.12/);
});

test('a non patch version blocks the publish unless explicitly allowed', () => {
    const result = evaluatePreflight({ packages: PACKAGES, version: '0.4.0', packuments: cleanPackuments() });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /0\.4\.0 is not a patch/);
    const allowed = evaluatePreflight({
        packages: PACKAGES,
        version: '0.4.0',
        packuments: cleanPackuments(),
        allowNonPatch: true,
    });
    assert.equal(allowed.ok, true);
});

test('a malformed version blocks the publish', () => {
    const result = evaluatePreflight({ packages: PACKAGES, version: 'latest', packuments: cleanPackuments() });
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /must be X\.Y\.Z/);
});

test('workspace collection matches the publishable package set', () => {
    const packages = collectPublishablePackages(ROOT);
    assert.ok(packages.length >= 20, `expected the full package set, got ${packages.length}`);
    const names = packages.map((pkg) => pkg.name);
    assert.equal(new Set(names).size, names.length, 'duplicate package names');
    assert.equal(
        names.includes('@vmz/homepage'),
        false,
        'private homepage must not be published',
    );
    // npm packs the CLI under `publishConfig.name`, so the registry identity wins.
    assert.ok(names.includes('@vmz/vmz'), 'CLI must be addressed as @vmz/vmz');
    assert.equal(names.includes('vmz'), false, 'bare vmz is not a registry package');
    for (const pkg of packages) {
        assert.ok(pkg.name.startsWith('@vmz/') || pkg.name === 'vmz', `unexpected package ${pkg.name}`);
        assert.ok(pkg.version, `${pkg.name} has no version`);
    }
});
