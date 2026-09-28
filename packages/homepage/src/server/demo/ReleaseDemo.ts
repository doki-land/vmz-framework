import { Get } from 'vmz:http';
import {
    demoConsoleRows,
    demoHeroPreview,
    demoReleaseRecords,
    demoReleaseSummary,
    type DemoConsoleRow,
    type DemoHeroPreview,
    type DemoReleaseRecord,
    type DemoReleaseSummary,
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

    getHeroPreview(): DemoHeroPreview {
        return demoHeroPreview();
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
