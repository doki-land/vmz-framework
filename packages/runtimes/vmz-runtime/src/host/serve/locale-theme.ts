import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LOCALE_STORE_KEY, THEME_STORE_KEY } from './constants.js';
import { serveState } from './state.js';

export function resolveLocalePath(pathname: string, cookieHeader: string | undefined) {
    const raw = String(pathname || '/');
    const normalized = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw || '/';
    if (!serveState.localeArtifact) {
        return { localeId: 'en', dir: 'ltr', restPath: normalized, redirectTo: null };
    }
    const supported = (serveState.localeArtifact.locales || []).map((l: { id: string }) => l.id);
    const defaultLocale = serveState.localeArtifact.defaultLocale || supported[0] || 'en';
    const directions = Object.fromEntries(
        (serveState.localeArtifact.locales || []).map((l: { id: string; direction?: string }) => [l.id, l.direction || 'ltr']),
    );
    const routing = serveState.localeArtifact.routing || {};
    const strategy = routing.strategy || 'prefix';

    if (strategy === 'none') {
        const preferred = readCookie(cookieHeader, LOCALE_STORE_KEY);
        const localeId = preferred && supported.includes(preferred) ? preferred : defaultLocale;
        return {
            localeId,
            dir: directions[localeId] || 'ltr',
            restPath: normalized,
            redirectTo: null,
        };
    }

    const parts = normalized.split('/').filter(Boolean);
    let localeId: string | null = null;
    let restPath = normalized;
    if (parts.length && supported.includes(parts[0])) {
        localeId = parts[0];
        const rest = parts.slice(1);
        restPath = rest.length ? `/${rest.join('/')}` : '/';
    }
    if (routing.defaultPrefix === 'omit' && localeId === defaultLocale) {
        return {
            localeId: defaultLocale,
            dir: directions[defaultLocale] || 'ltr',
            restPath,
            redirectTo: restPath,
        };
    }
    const contentLocale = localeId || defaultLocale;
    return {
        localeId: contentLocale,
        dir: directions[contentLocale] || 'ltr',
        restPath,
        redirectTo: null,
    };
}

export function pageMetaAlternates(chunkId: string, localeId: string) {
    if (!serveState.localeArtifact?.pageMetas) return [];
    const meta =
        serveState.localeArtifact.pageMetas.find((m: { routeId: string; locale: string }) => m.routeId === chunkId && m.locale === localeId) ||
        serveState.localeArtifact.pageMetas.find(
            (m: { routeId: string; locale: string }) => m.routeId === chunkId && m.locale === serveState.localeArtifact.defaultLocale,
        );
    return Array.isArray(meta?.alternates) ? meta.alternates : [];
}

export function cssEntryWithBust(entry: string | null) {
    if (!entry) return undefined;
    const base = String(entry).replace(/^\/+/, '');
    const params = new URLSearchParams();
    params.set('t', String(serveState.reloadToken));
    if (serveState.styleBundleHash) params.set('h', serveState.styleBundleHash);
    return `${base}?${params.toString()}`;
}

export async function loadDeploymentStyle(dir: string) {
    try {
        const raw = await readFile(path.join(dir, 'vmz-deployment.json'), 'utf8');
        const dep = JSON.parse(raw);
        const entry = dep.cssEntry;
        const css = typeof entry === 'string' && entry.trim() ? entry.trim().replace(/^\/+/, '') : null;
        const st = dep.styleTheme;
        let theme = null;
        if (st && typeof st === 'object') {
            theme = {
                defaultThemeId: String(st.defaultThemeId || 'default'),
                themeIds: Array.isArray(st.themeIds) ? st.themeIds.map(String) : [],
                activationAttr: String(st.activationAttr || 'data-theme'),
                prefersColorScheme:
                    st.prefersColorScheme && typeof st.prefersColorScheme === 'object'
                        ? Object.fromEntries(Object.entries(st.prefersColorScheme).map(([k, v]) => [String(k), String(v)]))
                        : {},
                contentHash: st.contentHash ? String(st.contentHash) : null,
            };
        }
        const bundleHash = typeof dep.styleBundleHash === 'string' && dep.styleBundleHash.trim() ? dep.styleBundleHash.trim() : null;
        return { cssEntry: css, styleTheme: theme, styleBundleHash: bundleHash };
    } catch {
        return { cssEntry: null, styleTheme: null, styleBundleHash: null };
    }
}

export function resolveThemeId(searchParams: URLSearchParams | undefined, cookieHeader: string | undefined) {
    if (!serveState.styleTheme) return null;
    const ids = serveState.styleTheme.themeIds || [];
    const q = searchParams && typeof searchParams.get === 'function' ? searchParams.get('theme') : null;
    if (q && ids.includes(q)) return q;
    const fromCookie = readCookie(cookieHeader, THEME_STORE_KEY);
    if (fromCookie && ids.includes(fromCookie)) return fromCookie;
    return null;
}

export function htmlThemeAttrPair(themeId: string | null) {
    if (!serveState.styleTheme || !themeId) return [];
    const attr = serveState.styleTheme.activationAttr || 'data-theme';
    if (!(serveState.styleTheme.themeIds || []).includes(themeId)) return [];
    return [attr, themeId];
}

export function themeBootstrapScript() {
    if (!serveState.styleTheme) return '';
    const attr = JSON.stringify(serveState.styleTheme.activationAttr || 'data-theme');
    const ids = JSON.stringify(serveState.styleTheme.themeIds || []);
    const key = JSON.stringify(THEME_STORE_KEY);
    return `  <script>(function(){try{var k=${key},attr=${attr},ids=${ids};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute(attr,id);}catch(e){}})();</script>\n`;
}

export function localeBootstrapScript() {
    if (!serveState.localeArtifact) return '';
    const routing = serveState.localeArtifact.routing || {};
    if ((routing.strategy || 'prefix') !== 'none') return '';
    const ids = (serveState.localeArtifact.locales || []).map((l: { id: string }) => l.id).filter(Boolean);
    if (!ids.length) return '';
    const key = JSON.stringify(LOCALE_STORE_KEY);
    const idList = JSON.stringify(ids);
    return `  <script>(function(){try{var k=${key},ids=${idList};var id=localStorage.getItem(k);if(!id||ids.indexOf(id)<0)return;document.documentElement.setAttribute("data-locale",id);document.documentElement.setAttribute("lang",id);window.__vmzLocaleIdHint=id;document.cookie=k+"="+encodeURIComponent(id)+"; path=/; max-age=31536000; SameSite=Lax";}catch(e){}})();</script>\n`;
}

export function siteFaviconHeadHtml() {
    try {
        const p = path.join(serveState.distDir, '_vmz', 'site-favicon.json');
        if (!existsSync(p)) return '';
        const raw = readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        if (j?.status !== 'ready' || typeof j.headHtml !== 'string') return '';
        return j.headHtml;
    } catch {
        return '';
    }
}

export function readCookie(header: string | undefined, name: string) {
    if (!header) return null;
    const parts = String(header).split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        const k = part.slice(0, idx).trim();
        if (k !== name) continue;
        try {
            return decodeURIComponent(part.slice(idx + 1).trim());
        } catch {
            return part.slice(idx + 1).trim();
        }
    }
    return null;
}
