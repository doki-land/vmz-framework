// @ts-nocheck
/**
 * Integrated DocumentMount — lower host SiteHeader/SiteFooter .vmz templates to
 * static HTML with locale-resolved copy (LocaleId is Host preference, not URL).
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} projectRoot
 * @returns {{ strategy?: string, defaultLocale?: string } | null}
 */
export function loadLocalesRouting(projectRoot) {
    const p = path.join(projectRoot, 'locales', 'locales.json5');
    if (!fs.existsSync(p)) return null;
    try {
        const raw = fs.readFileSync(p, 'utf8');
        let s = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        const m = s.match(/routing\s*:\s*\{([\s\S]*?)\}/);
        if (!m) return null;
        let block = `{${m[1]}}`;
        block = block.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
        block = block.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner));
        block = block.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(block);
    } catch {
        return null;
    }
}

/**
 * @param {string} projectRoot
 * @param {string} localeId
 */
export function loadLocaleCommonMessages(projectRoot, localeId) {
    const p = path.join(projectRoot, 'locales', localeId, 'common.json5');
    if (!fs.existsSync(p)) return {};
    try {
        let s = fs.readFileSync(p, 'utf8');
        s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        s = s.replace(/([,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":');
        s = s.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner) => JSON.stringify(inner));
        s = s.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(s);
    } catch {
        return {};
    }
}

/**
 * @param {string} projectRoot
 */
export function readSiteGithubUrl(projectRoot) {
    const p = path.join(projectRoot, 'src', 'lib', 'site.ts');
    if (!fs.existsSync(p)) return 'https://github.com/voml/iris-orm';
    const m = fs.readFileSync(p, 'utf8').match(/githubUrl\s*=\s*["']([^"']+)["']/);
    return m?.[1] || 'https://github.com/voml/iris-orm';
}

/**
 * @param {string} template
 * @param {string} localeId
 * @param {Record<string, string>} messages
 * @param {{ docsRootHref: string, guideHref: string, githubUrl: string, routing?: { strategy?: string } }} opts
 */
export function renderHostChromeTemplate(template, localeId, messages, opts) {
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const bindings = {
        brandLabel: messages.brand || 'Iris',
        navHomeLabel: messages.navHome || 'Home',
        navDocsLabel: messages.navDocs || 'Docs',
        navGithubLabel: messages.navGithub || 'GitHub',
        selectLanguageLabel: messages.selectLanguage || 'Language',
        langZhLabel: messages.langZh || '中文',
        langEnLabel: messages.langEn || 'English',
        footerTagLabel: messages.footerTag || messages.brand || 'Iris',
        footerCopyrightLabel: messages.footerCopyright || '',
        ctaInstallLabel: messages.ctaInstall || messages.ctaDocs || 'Docs',
        docsRootHref: opts.docsRootHref,
        guideHref: opts.guideHref,
        githubUrl: opts.githubUrl,
    };

    let html = template;
    html = html.replace(/data-home=\{home \? 'true' : 'false'\}/g, 'data-home="false"');
    html = html.replace(/href=\{docsRootHref\}/g, `href="${esc(bindings.docsRootHref)}"`);
    html = html.replace(/href=\{guideHref\}/g, `href="${esc(bindings.guideHref)}"`);
    html = html.replace(/href=\{githubUrl\}/g, `href="${esc(bindings.githubUrl)}"`);
    for (const [key, val] of Object.entries(bindings)) {
        html = html.replace(new RegExp(`\\{${key}\\}`, 'g'), esc(String(val)));
    }

    html = html.replace(/<Link(\s)/g, '<a class="vmz-ui-link"$1');
    html = html.replace(/<\/Link>/g, '</a>');
    html = html.replace(/<Icon[^>]*\/>/g, '');
    html = html.replace(
        /<Button[\s\S]*?onClick=\{\(\) => this\.switchLocale\('zh-hans'\)\}[\s\S]*?>\s*[\s\S]*?<\/Button>/g,
        `<button type="button" class="vmz-ui-button vmz-ui-button--ghost" data-vmz-locale-pick="zh-hans"${localeId === 'zh-hans' ? ' aria-current="true"' : ''}>${esc(bindings.langZhLabel)}</button>`,
    );
    html = html.replace(
        /<Button[\s\S]*?onClick=\{\(\) => this\.switchLocale\('en-us'\)\}[\s\S]*?>\s*[\s\S]*?<\/Button>/g,
        `<button type="button" class="vmz-ui-button vmz-ui-button--ghost" data-vmz-locale-pick="en-us"${localeId === 'en-us' ? ' aria-current="true"' : ''}>${esc(bindings.langEnLabel)}</button>`,
    );
    html = html.replace(/<Button[\s\S]*?<\/Button>/g, '');
    html = html.replace(/aria-current=\{localeId === '[^']+' \? 'true' : null\}/g, '');
    html = html.replace(/aria-label=\{selectLanguageLabel\}/g, `aria-label="${esc(bindings.selectLanguageLabel)}"`);
    html = html.replace(/label=\{[^}]+\}/g, '');
    return html;
}

/** Inline locale preference picker for strategy `none` (Host state, not URL). */
export function localeNonePickerScript() {
    return `<script>(function(){try{document.querySelectorAll("[data-vmz-locale-pick]").forEach(function(btn){btn.addEventListener("click",function(){var id=btn.getAttribute("data-vmz-locale-pick");if(!id)return;try{localStorage.setItem("vmz.locale",id);}catch(e){}try{document.cookie="vmz.locale="+encodeURIComponent(id)+"; path=/; max-age=31536000; SameSite=Lax";}catch(e){}location.reload();});});}catch(e){}})();</script>`;
}

/**
 * @param {string} routeBase
 * @param {string} pageKey
 */
export function docsRouteNone(routeBase, pageKey) {
    const base = String(routeBase || '/').replace(/\/$/, '') || '';
    const key = pageKey === 'index' ? '' : pageKey.replace(/\\/g, '/');
    const parts = [base.replace(/^\//, ''), key].filter((p) => p !== '');
    return '/' + (parts.length ? parts.join('/') : '');
}
