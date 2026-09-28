/** Canonical homepage demo release records — consumed by `#server/demo/ReleaseDemo` only. */

export type ReleaseStatus = 'succeeded' | 'running' | 'failed' | 'queued';

export type DemoReleaseRecord = {
    id: string;
    project: string;
    branch: string;
    target: string;
    status: ReleaseStatus;
    statusLabel: string;
    actor: string;
    updatedAt: string;
    updatedSort: number;
};

export type DemoReleaseSummary = {
    total: number;
    running: number;
    failed: number;
};

export type DemoConsoleRow = {
    id: string;
    cells: string[];
};

export type DemoHeroTarget = {
    id: string;
    name: string;
    result: string;
    status: ReleaseStatus;
    statusLabel: string;
};

export type DemoHeroPreview = {
    workspace: string;
    project: string;
    branch: string;
    releaseId: string;
    statusLabel: string;
    summaryLine: string;
    targets: DemoHeroTarget[];
};

export type DemoShowcaseOverview = {
    workspace: string;
    project: string;
    pathLabel: string;
    summaryLine: string;
    summary: DemoReleaseSummary;
    surfaceRows: DemoConsoleRow[];
};

export const DEMO_WORKSPACE = 'vmz-docs';
export const DEMO_PROJECT = 'docs-site';
export const DEMO_BRANCH = 'main';
export const DEMO_FEATURED_RELEASE_ID = 'rel-docs-main-42';

const RECORDS: DemoReleaseRecord[] = [
    {
        id: 'r1',
        project: DEMO_PROJECT,
        branch: DEMO_BRANCH,
        target: 'Web + SSR',
        status: 'succeeded',
        statusLabel: 'Succeeded',
        actor: 'Chen Wei',
        updatedAt: '12m ago',
        updatedSort: 12,
    },
    {
        id: 'r2',
        project: DEMO_PROJECT,
        branch: DEMO_BRANCH,
        target: 'Edge',
        status: 'running',
        statusLabel: 'Running',
        actor: 'Chen Wei',
        updatedAt: '18m ago',
        updatedSort: 18,
    },
    {
        id: 'r3',
        project: 'vmz-homepage',
        branch: DEMO_BRANCH,
        target: 'Web',
        status: 'succeeded',
        statusLabel: 'Succeeded',
        actor: 'Lin Mei',
        updatedAt: '41m ago',
        updatedSort: 41,
    },
    {
        id: 'r4',
        project: 'component-gallery',
        branch: 'ui-lab',
        target: 'SSR',
        status: 'queued',
        statusLabel: 'Queued',
        actor: 'Ops bot',
        updatedAt: '1h ago',
        updatedSort: 60,
    },
    {
        id: 'r5',
        project: DEMO_PROJECT,
        branch: 'hotfix/locale',
        target: 'Native',
        status: 'failed',
        statusLabel: 'Failed',
        actor: 'Chen Wei',
        updatedAt: '3h ago',
        updatedSort: 180,
    },
    {
        id: 'r6',
        project: 'deploy-planner',
        branch: DEMO_BRANCH,
        target: 'Web',
        status: 'succeeded',
        statusLabel: 'Succeeded',
        actor: 'Lin Mei',
        updatedAt: '6h ago',
        updatedSort: 360,
    },
];

export function demoReleaseRecords(): DemoReleaseRecord[] {
    return RECORDS.map((row) => ({ ...row }));
}

export function demoReleaseSummary(): DemoReleaseSummary {
    const records = demoReleaseRecords();
    return {
        total: records.length,
        running: records.filter((row) => row.status === 'running' || row.status === 'queued').length,
        failed: records.filter((row) => row.status === 'failed').length,
    };
}

export function demoConsoleRows(): DemoConsoleRow[] {
    return demoReleaseRecords().map((row) => ({
        id: row.id,
        cells: [row.project, row.target, row.statusLabel, row.actor, row.updatedAt],
    }));
}

export function demoReleaseDetail(id: string): DemoReleaseRecord | null {
    const row = demoReleaseRecords().find((entry) => entry.id === id);
    return row ? { ...row } : null;
}

export function demoShowcaseOverview(): DemoShowcaseOverview {
    const hero = demoHeroPreview();
    return {
        workspace: hero.workspace,
        project: hero.project,
        pathLabel: `${hero.workspace} / ${hero.project}`,
        summaryLine: hero.summaryLine,
        summary: demoReleaseSummary(),
        surfaceRows: hero.targets.map((target) => ({
            id: target.id,
            cells: [target.name, target.result, target.statusLabel],
        })),
    };
}

export function demoHeroPreview(): DemoHeroPreview {
    const featured = demoReleaseRecords().find((row) => row.id === 'r1')!;
    return {
        workspace: DEMO_WORKSPACE,
        project: DEMO_PROJECT,
        branch: DEMO_BRANCH,
        releaseId: DEMO_FEATURED_RELEASE_ID,
        statusLabel: 'Build succeeded (demo)',
        summaryLine: `${DEMO_BRANCH} · Web + SSR + Edge · ${featured.updatedAt}`,
        targets: [
            {
                id: 'browser',
                name: 'Browser',
                result: 'Static shell',
                status: 'succeeded',
                statusLabel: 'Ready',
            },
            {
                id: 'ssr',
                name: 'SSR',
                result: 'Hydration bundle',
                status: 'succeeded',
                statusLabel: 'Ready',
            },
            {
                id: 'edge',
                name: 'Edge',
                result: 'Worker route',
                status: 'running',
                statusLabel: 'Running',
            },
        ],
    };
}
