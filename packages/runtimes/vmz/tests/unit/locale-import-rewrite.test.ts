/**
 * ensureLocaleImportsRewritten — bare `#locales/*` must not survive into Node import.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { expect } from '../../../../../scripts/test/expect.mjs';
import { ensureLocaleImportsRewritten } from '../../src/locale/locale-check.ts';

describe('ensureLocaleImportsRewritten', () => {
    it('rewrites bare #locales imports to relative locales/*.js', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-locale-rewrite-'));
        fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
        fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'locales', 'common.js'), 'export const brand = "VMZ";\n');
        fs.writeFileSync(
            path.join(dir, 'components', 'SiteFooter.client.js'),
            `import { brand } from '#locales/common';\nexport default class SiteFooter {}\n`,
        );
        const r = ensureLocaleImportsRewritten(dir);
        expect(r.ok).toBe(true);
        const text = fs.readFileSync(path.join(dir, 'components', 'SiteFooter.client.js'), 'utf8');
        expect(text.includes('#locales/')).toBe(false);
        expect(text.includes('../locales/common.js')).toBe(true);
    });

    it('fails when rewrite cannot clear bare imports', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-locale-bare-'));
        fs.mkdirSync(path.join(dir, 'components'), { recursive: true });
        // Dynamic form not covered by static rewrite — must surface as leftover.
        fs.writeFileSync(path.join(dir, 'components', 'Odd.client.js'), `const id = 'common'; import('#locales/' + id);\n`);
        const r = ensureLocaleImportsRewritten(dir);
        expect(r.ok).toBe(false);
        expect(String(r.error || '').includes('#locales')).toBe(true);
    });

    it('ignores #locales/ mentions inside comments', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vmz-locale-comment-'));
        fs.writeFileSync(path.join(dir, 'vmz-client-nav.js'), `// so #locales/* re-resolve\nexport {}\n`);
        const r = ensureLocaleImportsRewritten(dir);
        expect(r.ok).toBe(true);
    });
});
