import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { expect } from '../../../../scripts/test-expect.mjs';
import { createVmzHighlighter, vmzGrammar, vmzLanguage, vmzLanguageId } from '../src/index.ts';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(pkgRoot, '../../..');
const fixture = fs.readFileSync(path.join(pkgRoot, 'fixtures/demo.vmz'), 'utf8');
const grammarJson = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'grammars/vmz.tmLanguage.json'), 'utf8'));

describe('vmz-textmate', () => {
    it('exports one shared grammar for vscode-vmz and shiki', () => {
        expect(vmzLanguageId).toBe('vmz');
        expect(vmzGrammar.scopeName).toBe('source.vmz');
        expect(grammarJson.scopeName).toBe('source.vmz');
        expect(vmzLanguage.name).toBe('vmz');
        expect(vmzLanguage.embeddedLangs).toEqual(['typescript', 'css', 'html']);
    });

    it('covers template / style / script client|server blocks', () => {
        const keys = Object.keys(vmzGrammar.repository ?? {});
        expect(keys).toEqual(
            expect.arrayContaining([
                'template-block',
                'style-block',
                'script-client-block',
                'script-server-block',
                'vmz-directive-attrs',
                'interpolation',
            ]),
        );
    });

    it('keeps editors/vmz-vscode copies byte-identical to vmz-textmate', () => {
        const dst = path.join(repoRoot, 'packages/editors/vmz-vscode');
        const pairs = [
            ['grammars/vmz.tmLanguage.json', 'syntaxes/vmz.tmLanguage.json'],
            ['grammars/vmz-markdown-injection.json', 'syntaxes/vmz-markdown-injection.json'],
            ['language-configuration.json', 'language-configuration.json'],
        ] as const;
        for (const [a, b] of pairs) {
            const left = fs.readFileSync(path.join(pkgRoot, a));
            const right = fs.readFileSync(path.join(dst, b));
            expect(right.equals(left), `${b} drifted ??run pnpm sync:vscode-textmate`).toBe(true);
        }
    });

    it('highlights .vmz via createVmzHighlighter', { timeout: 20_000 }, async () => {
        const highlighter = await createVmzHighlighter({ themes: ['vitesse-dark'] });
        const html = highlighter.codeToHtml(fixture, {
            lang: 'vmz',
            theme: 'vitesse-dark',
        });
        expect(html).toContain('shiki');
        expect(html).toContain('template');
        expect(html).toContain('script');
        highlighter.dispose();
    });
});
