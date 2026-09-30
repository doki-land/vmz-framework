import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('documentation/maintenance/releases');
fs.mkdirSync(dir, { recursive: true });

const tags = execSync('gh release list --limit 100 --json tagName', { encoding: 'utf8' });
for (const { tagName: tag } of JSON.parse(tags)) {
    const raw = execSync(`gh api repos/doki-land/vmz-framework/releases/tags/${tag}`, { encoding: 'utf8' });
    const body = JSON.parse(raw).body ?? '';
    const ver = tag.replace(/^v/, '');
    fs.writeFileSync(path.join(dir, `v${ver}.md`), body, 'utf8');
    console.log(`wrote v${ver}.md (${body.split('\n').length} lines)`);
}
