/**
 * Publish preflight: registry facts must agree with the workspace package set
 * before `nifty publish` starts bumping and uploading packages one by one.
 *
 * A publish that dies half-way leaves npm with a partial release and a broken
 * `latest` set. Every package needs a `0.0.0` placeholder on the registry (that
 * is also the only public evidence that Trusted Publisher was configured for the
 * name), the target version must still be free, and the previous `latest` must be
 * exactly one patch behind so releases stay continuous.
 *
 * Usage: node scripts/ci/preflight-publish.mjs --version=X.Y.Z
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** npm placeholders are published as 0.0.0 and never become real releases. */
export const PLACEHOLDER_VERSION = '0.0.0';

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function fail(msg) {
    console.error(`preflight-publish: ${msg}`);
    process.exit(1);
}

function readWorkspacePatterns(root) {
    const file = path.join(root, 'pnpm-workspace.yaml');
    if (!fs.existsSync(file)) return [];
    const patterns = [];
    let inPackages = false;
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trimEnd();
        if (/^packages\s*:/.test(line)) {
            inPackages = true;
            continue;
        }
        if (inPackages && /^\s*-\s+/.test(line)) {
            patterns.push(line.replace(/^\s*-\s+/, '').replace(/^['"]|['"]$/g, '').trim());
            continue;
        }
        if (inPackages && line.trim() && !line.startsWith(' ')) inPackages = false;
    }
    return patterns;
}

/** Only `dir/*` workspace patterns are used here — no glob dependency. */
function expandPattern(root, pattern) {
    if (!pattern.endsWith('/*')) return [path.join(root, pattern)];
    const base = path.join(root, pattern.slice(0, -2));
    if (!fs.existsSync(base)) return [];
    return fs
        .readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(base, entry.name));
}

export function collectPublishablePackages(root) {
    const seen = new Set();
    const packages = [];
    for (const pattern of readWorkspacePatterns(root)) {
        for (const dir of expandPattern(root, pattern)) {
            const manifestPath = path.join(dir, 'package.json');
            if (!fs.existsSync(manifestPath)) continue;
            let manifest;
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch (error) {
                fail(`unreadable ${manifestPath}: ${error.message}`);
            }
            if (!manifest.name || manifest.private) continue;
            // npm packs under `publishConfig.name` when it differs from the workspace name.
            const publishName = manifest.publishConfig?.name ?? manifest.name;
            if (seen.has(publishName)) fail(`duplicate publishable package ${publishName}`);
            seen.add(publishName);
            packages.push({ name: publishName, version: manifest.version, dir, localName: manifest.name });
        }
    }
    return packages.sort((left, right) => (left.name < right.name ? -1 : 1));
}

/** Placeholder-only packages are not part of a real release. */
export function releasePackageSet(packages) {
    return packages.filter((pkg) => pkg.version !== PLACEHOLDER_VERSION);
}

function previousPatch(version) {
    const match = VERSION_RE.exec(version);
    if (!match) return null;
    const patch = Number(match[3]);
    if (patch === 0) return null;
    return `${match[1]}.${match[2]}.${patch - 1}`;
}

/**
 * Pure decision over already-fetched packuments so fixtures can assert it
 * without network access.
 */
export function evaluatePreflight({
    packages,
    version,
    packuments,
    registry = 'registry.npmjs.org',
    allowNonPatch = false,
}) {
    const errors = [];
    const releases = releasePackageSet(packages);
    const match = VERSION_RE.exec(version);
    if (!match) {
        errors.push(`release version ${version} must be X.Y.Z`);
        return { ok: false, errors, releases };
    }
    if (Number(match[3]) === 0 && !allowNonPatch) {
        errors.push(`release version ${version} is not a patch, pass \`--allow-non-patch\` for an explicit minor or major release`);
    }
    if (!releases.length) errors.push(`workspace declares no package set for ${registry}`);
    const want = previousPatch(version);
    for (const pkg of releases) {
        const packument = packuments[pkg.name];
        if (!packument) {
            errors.push(`${pkg.name}: not on ${registry} yet, no \`${PLACEHOLDER_VERSION}\` placeholder so Trusted Publisher is unverifiable`);
            continue;
        }
        if (!packument.versions?.[PLACEHOLDER_VERSION]) {
            errors.push(`${pkg.name}: no \`${PLACEHOLDER_VERSION}\` placeholder version on ${registry}, Trusted Publisher unverifiable`);
        }
        if (packument.versions?.[version]) {
            errors.push(`${pkg.name}: ${version} is already published on ${registry}`);
        }
        for (const [tag, tagged] of Object.entries(packument['dist-tags'] ?? {})) {
            if (tagged === version) errors.push(`${pkg.name}: dist-tag \`${tag}\` already points at ${version}`);
        }
        const latest = packument['dist-tags']?.latest;
        if (latest && latest !== PLACEHOLDER_VERSION && want && latest !== want) {
            errors.push(`${pkg.name}: latest is ${latest} but patch continuity for ${version} requires ${want}`);
        }
    }
    return { ok: errors.length === 0, errors, releases };
}

async function fetchPackument(name, registry) {
    const url = `https://${registry}/${name.replace('/', '%2f')}`;
    const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${url} → ${response.status}`);
    return response.json();
}

async function fetchAll(names, registry, concurrency = 6) {
    const packuments = {};
    const queue = [...names];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length) {
            const name = queue.shift();
            packuments[name] = await fetchPackument(name, registry);
        }
    });
    await Promise.all(workers);
    return packuments;
}

async function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const args = process.argv.slice(2);
    const version = args.find((arg) => arg.startsWith('--version='))?.slice('--version='.length);
    const registry = args.find((arg) => arg.startsWith('--registry='))?.slice('--registry='.length) ?? 'registry.npmjs.org';
    if (!version) fail('usage: node scripts/ci/preflight-publish.mjs --version=X.Y.Z');

    const packages = collectPublishablePackages(root);
    const releases = releasePackageSet(packages);
    if (!releases.length) fail(`no publishable package in ${root}`);

    console.log(`preflight-publish: ${releases.length} packages against ${registry} for ${version}`);
    const packuments = await fetchAll(
        releases.map((pkg) => pkg.name),
        registry,
    );
    // `latest` is needed even for packages whose local version is a placeholder.
    const { ok, errors } = evaluatePreflight({
        packages,
        version,
        packuments,
        registry,
        allowNonPatch: args.includes('--allow-non-patch'),
    });
    for (const pkg of releases) console.log(`  ${pkg.name}@${pkg.version}`);
    if (!ok) {
        for (const error of errors) console.error(`  ✗ ${error}`);
        console.error(`preflight-publish: ${errors.length} blocking problem(s), refusing to publish`);
        process.exit(1);
    }
    console.log('preflight-publish OK: registry facts match the package set');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await main();
}
