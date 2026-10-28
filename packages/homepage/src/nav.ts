/** Single source for public site navigation, shared by SiteHeader and SiteFooter. */



const DEFAULT_LOCALE = 'zh-hans';

const NAV_ORDER = ['product', 'docs', 'showcase', 'lab', 'icons', 'charts', 'about'];

const ACTIVE_PREFIXES = {
    product: ['/product'],
    docs: ['/d'],
    showcase: ['/commercial', '/console'],
    lab: ['/lab'],
    icons: ['/icons'],
    charts: ['/charts'],
    about: ['/welcome'],
};

export function localePrefix(localeId: string): string {
    return localeId === DEFAULT_LOCALE ? '' : `/${localeId}`;
}

export function siteHomeHref(localeId: string): string {
    const prefix = localePrefix(localeId);
    return prefix ? `${prefix}/` : '/';
}

export function navHref(id: string, localeId: string, docsRootHref: string): string {
    const prefix = localePrefix(localeId);
    if (id === 'docs') return docsRootHref;
    if (id === 'product') return `${prefix}/product`;
    if (id === 'showcase') return `${prefix}/commercial`;
    if (id === 'lab') return `${prefix}/lab`;
    if (id === 'icons') return `${prefix}/icons`;
    if (id === 'charts') return `${prefix}/charts`;
    return `${prefix}/welcome`;
}

export function siteNavItems(localeId, labels, docsRootHref) {
    return NAV_ORDER.map((id) => ({
        id: id,
        label: labels[id],
        href: navHref(id, localeId, docsRootHref),
    }));
}

/** AppShell/ConsoleShell take `{ id, title, href }`; adapt the shared items once. */
export function shellNav(items) {
    return items.map((item) => ({ id: item.id, title: item.label, href: item.href }));
}

/** Id of the nav entry that owns `pathname`, or '' for the home page. */
export function activeNavId(pathname: string, localeId: string): string {
    const prefix = localePrefix(localeId);
    let path = pathname || '/';
    if (prefix && (path === prefix || path.startsWith(`${prefix}/`))) {
        path = path.slice(prefix.length) || '/';
    }
    for (const id of NAV_ORDER) {
        const bases = ACTIVE_PREFIXES[id];
        for (const base of bases) {
            if (path === base || path.startsWith(`${base}/`)) return id;
        }
    }
    return '';
}
