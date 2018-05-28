/**
 * VMZ Homepage integrated documents — mount at /d/
 * Design: 规划设计/vmz/19 · Integrated DocumentMount
 *
 * D0: declaration object only (JSON-compatible; double quotes).
 */
export default {
    defaultLocale: 'zh-hans',
    locales: {
        'zh-hans': { label: '简体中文' },
        'en-us': { label: 'English' },
    },
    collections: {
        default: {
            source: '.',
            mount: '/d',
        },
    },
};
