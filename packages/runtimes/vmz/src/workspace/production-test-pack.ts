/**
 * A4: Production scenario pack + deterministic CI profile.
 * Assembles real user-path scenarios for `pnpm verify -- production-test`.
 * Does not invent Vitest/Jest/Playwright semantics.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { canonicalJson, sha256Hex } from './release-pack.js';
import { writePrettyJsonFile } from './pretty-json.js';

export const PRODUCTION_SCENARIO_PACK_SCHEMA = 'vmz.production.scenario_pack.v0';
export const PRODUCTION_CI_PROFILE_SCHEMA = 'vmz.production.ci_profile.v0';
export const PRODUCTION_TEST_REPORT_SCHEMA = 'vmz.production.test_report.v0';

/** Official Browser Production Profile v1 scenario pack (thin slice). */
export function browserProductionScenarioPack() {
    return {
        schema: PRODUCTION_SCENARIO_PACK_SCHEMA,
        id: 'browser-production.v1',
        title: 'Browser Production Profile — production user paths',
        scenarios: [
            {
                scenarioId: 'production.catalog.compile.list',
                category: 'compile',
                fixture: 'packages/examples/production-catalog',
                modes: ['compile'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'production.catalog.logic.list',
                category: 'logic',
                fixture: 'packages/examples/production-catalog',
                modes: ['logic'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'production.catalog.ssr.list',
                category: 'ssr',
                fixture: 'packages/examples/production-catalog',
                modes: ['ssr'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'production.catalog.resume.chip',
                category: 'resume',
                fixture: 'packages/examples/production-catalog',
                modes: ['resume'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'production.catalog.browser.select',
                category: 'browser',
                fixture: 'packages/examples/production-catalog',
                modes: ['browser'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'resume.resume.island',
                category: 'island-resume',
                fixture: 'packages/examples/island',
                modes: ['resume'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'resume.event.entry',
                category: 'island-resume',
                fixture: 'packages/examples/island',
                modes: ['resume'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 't3.deployment.island.resume',
                category: 'deployment',
                fixture: 'packages/examples/island',
                modes: ['deployment'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 't3.deployment.usercard.isolation',
                category: 'server-capability',
                fixture: 'packages/examples/fullstack',
                modes: ['deployment'],
                runner: 'vmz-test',
                required: true,
            },
            {
                scenarioId: 'production.router.access',
                category: 'auth-access',
                fixture: 'packages/examples/production-router',
                modes: ['ssr'],
                runner: 'serve-host',
                required: true,
                detail: 'Page.access allow/deny/not-found/redirect',
            },
            {
                scenarioId: 'production.router.action',
                category: 'loader-action',
                fixture: 'packages/examples/production-router',
                modes: ['ssr'],
                runner: 'serve-host',
                required: true,
                detail: 'Page.action POST + redirect',
            },
            {
                scenarioId: 'production.router.loader-cancel',
                category: 'loader-action',
                fixture: 'packages/examples/production-router',
                modes: ['logic'],
                runner: 'in-process',
                required: true,
                detail: 'AbortSignal cancel + stale generation supersede',
            },
            {
                scenarioId: 'production.release.rollback',
                category: 'artifact-rollback',
                fixture: 'packages/examples/production-router',
                modes: ['deployment'],
                runner: 'release-pack',
                required: true,
                detail: 'pack digest + CURRENT/PREVIOUS rollback',
            },
            // Previously quarantined — now required with real serve-host/browser runners.
            {
                scenarioId: 'production.ui.field.submit',
                category: 'field',
                fixture: 'packages/examples/production-inspector',
                modes: ['browser'],
                runner: 'serve-host-browser',
                required: true,
                detail: 'Field input + validation error on inspector',
            },
            {
                scenarioId: 'production.ui.dialog.focus',
                category: 'dialog',
                fixture: 'packages/examples/production-inspector',
                modes: ['browser'],
                runner: 'serve-host-browser',
                required: true,
                detail: 'Dialog open/focus/Escape dismiss on inspector',
            },
            {
                scenarioId: 'production.locale.switch-rtl',
                category: 'locale',
                fixture: 'packages/examples/production-router',
                modes: ['browser'],
                runner: 'serve-host-browser',
                required: true,
                detail: 'LocaleTransition commit + inspector RTL dir toggle',
            },
            {
                scenarioId: 'production.theme.missing-token',
                category: 'theme',
                fixture: 'temp:missing-token',
                modes: ['compile'],
                runner: 'vmz-build',
                required: true,
                detail: 'missing semantic token → build fails unknown_design_token',
            },
            {
                scenarioId: 'production.mount.child-failure',
                category: 'mount',
                fixture: 'temp:application-isolation',
                modes: ['deployment'],
                runner: 'application-isolation',
                required: true,
                detail: 'ApplicationMount child failure → 503 application_unavailable; siblings survive',
            },
        ],
    };
}

/** Deterministic CI profile for production-test (no flaky disguise). */
export function browserProductionCiProfile(overrides = {}) {
    return normalizeCiProfile({
        schema: PRODUCTION_CI_PROFILE_SCHEMA,
        id: 'browser-production.ci.v1',
        seed: 0x176bff,
        workers: 1,
        sort: 'scenarioId',
        retry: { enabled: false, maxAttempts: 1, promoteFlakyPass: false },
        quarantine: {
            policy: 'explicit',
            neverCountAsPassed: true,
        },
        artifacts: {
            onFailure: true,
            retain: ['report', 'trace', 'artifactManifest'],
            dir: 'dist/production-reports/production-test',
        },
        toolchain: {
            node: true,
            rust: true,
            chrome: true,
        },
        forbiddenRunners: ['vitest', 'jest', 'playwright', '@playwright/test'],
        ...overrides,
    });
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, pack: Record<string, any> } | { ok: false, diagnostics: Array<{ code: string, message: string }> }}
 */
export function normalizeScenarioPack(raw) {
    /** @type {Array<{ code: string, message: string }>} */
    const diagnostics = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, diagnostics: [{ code: 'pack.invalid', message: 'pack must be a plain object' }] };
    }
    const p = /** @type {Record<string, any>} */ (raw);
    if (p.schema !== PRODUCTION_SCENARIO_PACK_SCHEMA) {
        diagnostics.push({
            code: 'pack.schema',
            message: `schema want ${PRODUCTION_SCENARIO_PACK_SCHEMA}, got ${JSON.stringify(p.schema)}`,
        });
    }
    if (typeof p.id !== 'string' || !p.id.trim()) {
        diagnostics.push({ code: 'pack.id', message: 'pack.id required' });
    }
    if (!Array.isArray(p.scenarios) || p.scenarios.length < 1) {
        diagnostics.push({ code: 'pack.scenarios', message: 'scenarios must be a non-empty array' });
    }
    const scenarios = [];
    const seen = new Set();
    for (const [i, s] of (p.scenarios || []).entries()) {
        if (!s || typeof s !== 'object') {
            diagnostics.push({ code: 'pack.scenario', message: `scenarios[${i}] must be an object` });
            continue;
        }
        const scenarioId = String(s.scenarioId || '').trim();
        if (!scenarioId) {
            diagnostics.push({ code: 'pack.scenarioId', message: `scenarios[${i}].scenarioId required` });
            continue;
        }
        if (seen.has(scenarioId)) {
            diagnostics.push({ code: 'pack.scenarioId.dup', message: `duplicate scenarioId ${scenarioId}` });
            continue;
        }
        seen.add(scenarioId);
        const quarantine = s.quarantine === true;
        const required = s.required !== false && !quarantine;
        if (quarantine && s.status === 'passed') {
            diagnostics.push({
                code: 'pack.quarantine.passed',
                message: `${scenarioId}: quarantine must never be authored as passed`,
            });
        }
        scenarios.push({
            scenarioId,
            category: String(s.category || 'other'),
            fixture: s.fixture == null ? null : String(s.fixture),
            modes: Array.isArray(s.modes) ? s.modes.map(String) : [],
            runner: String(s.runner || 'vmz-test'),
            required,
            quarantine,
            reason: s.reason ? String(s.reason) : null,
            detail: s.detail ? String(s.detail) : null,
        });
    }
    // Deterministic order for CI.
    scenarios.sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0));
    if (diagnostics.length) return { ok: false, diagnostics };
    return {
        ok: true,
        pack: {
            schema: PRODUCTION_SCENARIO_PACK_SCHEMA,
            id: String(p.id).trim(),
            title: typeof p.title === 'string' ? p.title : p.id,
            scenarios,
        },
    };
}

/**
 * @param {unknown} raw
 */
export function normalizeCiProfile(raw) {
    const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? /** @type {Record<string, any>} */ (raw) : {};
    const retry = d.retry && typeof d.retry === 'object' ? d.retry : {};
    const quarantine = d.quarantine && typeof d.quarantine === 'object' ? d.quarantine : {};
    const artifacts = d.artifacts && typeof d.artifacts === 'object' ? d.artifacts : {};
    const seed = typeof d.seed === 'number' && Number.isFinite(d.seed) ? d.seed : 0x176bff;
    return {
        schema: PRODUCTION_CI_PROFILE_SCHEMA,
        id: typeof d.id === 'string' && d.id ? d.id : 'browser-production.ci.v1',
        seed,
        workers: d.workers === 1 ? 1 : 1, // production CI profile forces serial for determinism
        sort: d.sort === 'scenarioId' ? 'scenarioId' : 'scenarioId',
        retry: {
            enabled: retry.enabled === true,
            maxAttempts: Math.max(1, Number(retry.maxAttempts) || 1),
            promoteFlakyPass: false, // hard rule: never disguise flaky as passed
        },
        quarantine: {
            policy: quarantine.policy === 'implicit' ? 'implicit' : 'explicit',
            neverCountAsPassed: quarantine.neverCountAsPassed !== false,
        },
        artifacts: {
            onFailure: artifacts.onFailure !== false,
            retain: Array.isArray(artifacts.retain) ? artifacts.retain.map(String) : ['report', 'trace', 'artifactManifest'],
            dir: typeof artifacts.dir === 'string' ? artifacts.dir : 'dist/production-reports/production-test',
        },
        toolchain: {
            node: true,
            rust: d.toolchain?.rust !== false,
            chrome: d.toolchain?.chrome !== false,
        },
        forbiddenRunners: Array.isArray(d.forbiddenRunners)
            ? d.forbiddenRunners.map(String)
            : ['vitest', 'jest', 'playwright', '@playwright/test'],
    };
}

export function scenarioPackDigest(pack) {
    return sha256Hex(canonicalJson(pack));
}

export function ciProfileDigest(profile) {
    return sha256Hex(canonicalJson(profile));
}

type ProductionScenarioResult = {
    scenarioId: string;
    status?: string;
    reason?: string | null;
    detail?: string | null;
    artifacts?: unknown;
    attempts?: number;
    flaky?: boolean;
};

/**
 * Build a production test report from scenario results.
 * Quarantine entries must be status=`quarantined` (never `passed`).
 */
export function buildProductionTestReport(input: {
    pack: Record<string, any>;
    profile: Record<string, any>;
    results: ProductionScenarioResult[];
    artifactsDir?: string;
}) {
    const pack = input.pack;
    const profile = input.profile;
    const byId = new Map((input.results || []).map((r) => [r.scenarioId, r]));
    const tests = [];
    /** @type {string[]} */
    const errors: string[] = [];

    for (const s of pack.scenarios) {
        const r: ProductionScenarioResult | undefined = byId.get(s.scenarioId);
        if (s.quarantine) {
            const status = r?.status === 'passed' ? 'illegal-passed' : r?.status || 'quarantined';
            if (status === 'illegal-passed' || status === 'passed') {
                errors.push(`${s.scenarioId}: quarantine must not count as passed`);
            }
            tests.push({
                scenarioId: s.scenarioId,
                category: s.category,
                status: 'quarantined',
                required: false,
                quarantine: true,
                reason: s.reason || r?.reason || null,
                detail: r?.detail || null,
                artifacts: r?.artifacts || null,
                attempts: r?.attempts || 1,
                flaky: false,
            });
            continue;
        }
        if (!r) {
            if (s.required) errors.push(`${s.scenarioId}: missing result`);
            tests.push({
                scenarioId: s.scenarioId,
                category: s.category,
                status: 'missing',
                required: s.required,
                quarantine: false,
                reason: null,
                detail: null,
                artifacts: null,
                attempts: 0,
                flaky: false,
            });
            continue;
        }
        const attempts = Math.max(1, Number(r.attempts) || 1);
        const flaky = r.flaky === true || (attempts > 1 && r.status === 'passed');
        // Hard rule: retry success must not be reported as stable passed.
        let status = String(r.status || 'error');
        if (flaky && status === 'passed') {
            status = 'flaky';
            errors.push(`${s.scenarioId}: flaky pass must not be reported as passed`);
        }
        if (s.required && status !== 'passed') {
            errors.push(`${s.scenarioId}: required status=${status}`);
        }
        tests.push({
            scenarioId: s.scenarioId,
            category: s.category,
            status,
            required: s.required,
            quarantine: false,
            reason: r.reason || null,
            detail: r.detail || null,
            artifacts: r.artifacts || null,
            attempts,
            flaky,
        });
    }

    // Deterministic listing order.
    tests.sort((a, b) => (a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : 0));

    const failed = tests.some((t) => t.required && !['passed', 'quarantined'].includes(t.status));
    const report = {
        schema: PRODUCTION_TEST_REPORT_SCHEMA,
        status: errors.length || failed ? 'failed' : 'passed',
        packId: pack.id,
        packDigest: scenarioPackDigest(pack),
        ciProfileDigest: ciProfileDigest(profile),
        seed: profile.seed,
        workers: profile.workers,
        retry: profile.retry,
        quarantine: profile.quarantine,
        artifactsDir: input.artifactsDir || profile.artifacts.dir,
        generatedAt: null, // filled by emit for wall-clock; digests exclude this field
        tests,
        errors,
    };
    return report;
}

/** Stable digest of report (excludes generatedAt). */
export function productionTestReportDigest(report) {
    const { generatedAt: _g, ...rest } = report;
    return sha256Hex(canonicalJson(rest));
}

/**
 * Write report + pack/profile snapshots under artifactsDir.
 * @returns {{ reportPath: string, packPath: string, profilePath: string, report: Record<string, any> }}
 */
export function emitProductionTestArtifacts(root, report, pack, profile) {
    const dir = path.join(root, profile.artifacts.dir);
    fs.mkdirSync(dir, { recursive: true });
    const stamped = { ...report, generatedAt: new Date().toISOString() };
    const reportPath = path.join(dir, 'report.json');
    const packPath = path.join(dir, 'scenario-pack.json');
    const profilePath = path.join(dir, 'ci-profile.json');
    writePrettyJsonFile(reportPath, stamped);
    writePrettyJsonFile(packPath, pack);
    writePrettyJsonFile(profilePath, profile);
    return { reportPath, packPath, profilePath, report: stamped };
}

/** Assert CI profile forbids JS test-runner disguise. */
export function assertNoForbiddenRunners(profile, importedNames = []) {
    const forbidden = new Set((profile.forbiddenRunners || []).map((s) => s.toLowerCase()));
    const hits = importedNames.filter((n) => forbidden.has(String(n).toLowerCase()));
    return hits;
}

export function sha256Text(text) {
    return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex');
}
