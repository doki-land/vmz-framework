/**
 * VMZ native test protocol (T0) — validators + report builders.
 * Schema ids live in `@vmz/protocol` (mirrors Rust `vmz-protocol`).
 * Design: 规划设计/vmz/16 — not a Test IR; references Program Graph + Execution Plan.
 */

import { EXECUTION_PLAN_REF_SCHEMA, PLAN_SCHEMA, TEST_MANIFEST_SCHEMA, TEST_REPORT_SCHEMA } from '@vmz/protocol';

export {
    EXECUTION_PLAN_REF_SCHEMA,
    PLAN_SCHEMA,
    TEST_ACTION_SCHEMA,
    TEST_ASSERTION_SCHEMA,
    TEST_MANIFEST_SCHEMA,
    TEST_PROTOCOL,
    TEST_REPORT_SCHEMA,
    testCatalog,
} from '@vmz/protocol';

export type TestMode = 'compile' | 'logic' | 'browser' | 'ssr' | 'resume' | 'deployment' | 'all';

export const TEST_MODES: readonly TestMode[] = Object.freeze(['compile', 'logic', 'browser', 'ssr', 'resume', 'deployment', 'all']);

export function isTestMode(v: unknown): v is TestMode {
    return typeof v === 'string' && (TEST_MODES as readonly string[]).includes(v);
}

/** Normalize `--mode` flag: `compile,logic` or `all`. */
export function parseModes(raw: string | boolean | undefined | null): TestMode[] {
    if (raw == null || raw === true || raw === '') return ['all'];
    const parts = String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    if (parts.length === 0) return ['all'];
    for (const p of parts) {
        if (!isTestMode(p)) {
            throw new Error(`unknown test mode \`${p}\` (want ${TEST_MODES.join('|')})`);
        }
    }
    return parts as TestMode[];
}

export type ManifestValidation = { ok: true; manifest: Record<string, unknown> } | { ok: false; error: string };

/** Validate a discovered manifest object (narrow T0 checks). */
export function validateManifest(raw: unknown, file: string): ManifestValidation {
    if (!raw || typeof raw !== 'object') {
        return { ok: false, error: `${file}: manifest must be an object` };
    }
    const m = raw as Record<string, unknown>;
    if (m.schema !== TEST_MANIFEST_SCHEMA) {
        return {
            ok: false,
            error: `${file}: schema want ${TEST_MANIFEST_SCHEMA}, got ${JSON.stringify(m.schema)}`,
        };
    }
    if (typeof m.id !== 'string' || !m.id) {
        return { ok: false, error: `${file}: missing string id` };
    }
    if (!Array.isArray(m.modes) || m.modes.length === 0) {
        return { ok: false, error: `${file}: modes must be a non-empty array` };
    }
    for (const mode of m.modes) {
        if (!isTestMode(mode) || mode === 'all') {
            return { ok: false, error: `${file}: invalid mode ${JSON.stringify(mode)}` };
        }
    }
    if (!m.program || typeof m.program !== 'object') {
        return { ok: false, error: `${file}: missing program ref object` };
    }
    const program = m.program as Record<string, unknown>;
    if (typeof program.chunkId !== 'string' || !program.chunkId) {
        return { ok: false, error: `${file}: program.chunkId required` };
    }
    if (m.plan != null) {
        if (typeof m.plan !== 'object') {
            return { ok: false, error: `${file}: plan must be an object when present` };
        }
        const plan = m.plan as Record<string, unknown>;
        if (plan.schema != null && plan.schema !== PLAN_SCHEMA && plan.schema !== EXECUTION_PLAN_REF_SCHEMA) {
            return { ok: false, error: `${file}: plan.schema unexpected ${JSON.stringify(plan.schema)}` };
        }
    }
    if (m.actions != null && !Array.isArray(m.actions)) {
        return { ok: false, error: `${file}: actions must be an array` };
    }
    if (m.assertions != null && !Array.isArray(m.assertions)) {
        return { ok: false, error: `${file}: assertions must be an array` };
    }
    return { ok: true, manifest: m };
}

export type TestReportEntryInput = {
    testId: string;
    file: string;
    modes: string[];
    programId?: string | null;
    planId?: string | null;
    status: string;
    diagnostics?: unknown[];
};

export function buildTestReport(input: { project: string; modes: TestMode[]; tests: TestReportEntryInput[]; status?: string }) {
    const tests = input.tests.map((t) => ({
        testId: t.testId,
        file: t.file,
        modes: t.modes,
        programId: t.programId ?? null,
        planId: t.planId ?? null,
        status: t.status,
        diagnostics: t.diagnostics ?? [],
        trace: null,
        snapshots: null,
        coverage: null,
        unknownReasons: [] as string[],
    }));
    const failed = tests.some((t) => t.status === 'failed' || t.status === 'error');
    const status = input.status ?? (failed ? 'failed' : tests.length === 0 ? 'empty' : 'listed');
    return {
        schema: TEST_REPORT_SCHEMA,
        status,
        project: input.project,
        modes: input.modes,
        generatedAt: new Date().toISOString(),
        tests,
    };
}
