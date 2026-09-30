/**
 * CLI diagnostic layout: `pretty` (snippets) vs `compact` (single-line, CI-friendly).
 */

export type CliLogStyle = 'pretty' | 'compact';

let currentStyle: CliLogStyle = 'pretty';

export function getCliLogStyle(): CliLogStyle {
    return currentStyle;
}

export function setCliLogStyle(style: CliLogStyle): void {
    currentStyle = style;
}

export function parseCliLogStyle(raw: unknown): CliLogStyle | null {
    if (raw == null || raw === '') return 'pretty';
    const s = String(raw).trim().toLowerCase();
    if (s === 'pretty') return 'pretty';
    if (s === 'compact') return 'compact';
    return null;
}
