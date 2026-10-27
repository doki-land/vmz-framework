// Diagnostics — warnings and errors produced during compile / layout / render.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §3.

export type DiagnosticSeverity = "info" | "warning" | "error";

/** A single diagnostic item. No reliance on VMZ protocol types. */
export interface Diagnostic {
    readonly severity: DiagnosticSeverity;
    /** Stable identifier like `davinci.diagram.unsupported`. */
    readonly code: string;
    /** Human-readable message in English. Localization is host-scope. */
    readonly message: string;
    /** Optional source reference (domain, node id, field path, etc.). */
    readonly source?: string;
}

/** Immutable diagnostic set — used as output of compile/layout. */
export interface DiagnosticSet {
    readonly items: ReadonlyArray<Diagnostic>;
}

/** Empty diagnostic set. */
export const EMPTY_DIAGNOSTICS: DiagnosticSet = { items: [] };

/** Convenience factory. */
export function diag(severity: DiagnosticSeverity, code: string, message: string, source?: string): Diagnostic {
    return { severity, code, message, source };
}
