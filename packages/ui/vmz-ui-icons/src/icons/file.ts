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
            'M20 11.4L11.6 19.8A5.5 5.5 0 0 1 3.9 12.1L12.1 3.9A3.8 3.8 0 0 1 17.4 9.2L9.2 17.4A1.9 1.9 0 0 1 6.6 14.8L14.8 6.6',
        ],
    },
    'file.pdf': { kind: 'text-badge', label: 'PDF' },
    'file.archive': { kind: 'text-badge', label: 'ZIP' },
    'file.markdown': { kind: 'text-badge', label: 'MD' },
    'file.spreadsheet': { kind: 'text-badge', label: 'CSV' },
    'file.cloud': {
        kind: 'stroke',
        paths: ['M6.5 19A4.5 4.5 0 0 1 6.2 10.1A5.8 5.8 0 0 1 17.4 10.6A4.3 4.3 0 0 1 17.5 19H6.5Z'],
    },
    'file.cloud-off': {
        kind: 'stroke',
        paths: ['M6.5 19A4.5 4.5 0 0 1 6.2 10.1A5.8 5.8 0 0 1 17.4 10.6A4.3 4.3 0 0 1 17.5 19H6.5Z', 'M4 20L20 4'],
    },
};
