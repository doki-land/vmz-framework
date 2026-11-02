import type { IconDef } from '../icon-types.ts';

/**
 * File glyphs (`file.*`) — documents, folders, attachments and file-type badges.
 * File types with no honest silhouette (PDF, ZIP, Markdown, CSV) use `text-badge`.
 */
export const FILE_ICONS: Record<string, IconDef> = {
    'file.document': {
        kind: 'stroke',
        paths: ['M5 3H14L19 8V21H5Z', 'M14 3V8H19', 'M8 12H16', 'M8 16H16'],
    },
    'file.folder': {
        kind: 'stroke',
        paths: ['M3 5H9.5L12 7.5H21V19H3V5Z'],
    },
    'file.folder-open': {
        kind: 'stroke',
        paths: ['M4 11V6H9.5L12 8.5H20V11', 'M3 11H21L19 19H5L3 11Z'],
    },
    'file.attachment': {
        kind: 'stroke',
        paths: [
            'M18.5 11.5L11 19C9.6 20.4 7.4 20.4 6 19C4.6 17.6 4.6 15.4 6 14L14.5 5.5C15.5 4.5 17 4.5 18 5.5C19 6.5 19 8 18 9L10.5 17.5C9.6 18.4 8.4 18.4 7.5 17.5C6.6 16.6 6.6 15.4 7.5 14.5L14 8',
        ],
    },
    'file.pdf': { kind: 'text-badge', label: 'PDF' },
    'file.archive': { kind: 'text-badge', label: 'ZIP' },
    'file.markdown': { kind: 'text-badge', label: 'MD' },
    'file.spreadsheet': { kind: 'text-badge', label: 'CSV' },
};
