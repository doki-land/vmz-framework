import { Get } from 'vmz:http';
import {
    demoConsoleRows,
    demoHeroPreview,
    demoReleaseDetail,
    demoReleaseRecords,
    demoReleaseSummary,
    demoShowcaseOverview,
    type DemoConsoleRow,
    type DemoHeroPreview,
    type DemoReleaseRecord,
    type DemoReleaseSummary,
    type DemoShowcaseOverview,
} from './releases.js';

/** Homepage release workflow demo — single source for Console, index preview, and Commercial. */
export default class ReleaseDemo {
    listReleases(): DemoReleaseRecord[] {
        return demoReleaseRecords();
    }

    getSummary(): DemoReleaseSummary {
        return demoReleaseSummary();
    }

    getConsoleRows(): DemoConsoleRow[] {
        return demoConsoleRows();
    }

    getReleaseDetail(id: string): DemoReleaseRecord | null {
        return demoReleaseDetail(id);
    }

    getHeroPreview(): DemoHeroPreview {
        return demoHeroPreview();
    }

    getShowcaseOverview(): DemoShowcaseOverview {
        return demoShowcaseOverview();
    }

    @Get('/api/demo/releases')
    listReleasesRoute(): DemoReleaseRecord[] {
        return this.listReleases();
    }

    @Get('/api/demo/releases/summary')
    summaryRoute(): DemoReleaseSummary {
        return this.getSummary();
    }
}
