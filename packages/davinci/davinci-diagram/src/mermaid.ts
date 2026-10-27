// Diagram importer stubs — Mermaid / other DSLs → DiagramSpec.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §5.
//
// Full Mermaid parsing lives upstream (oak-mermaid / host). This module
// is intentionally thin — host produces structured input, we accept it.

import { EMPTY_DIAGNOSTICS, type DiagnosticSet } from "@doki-land/davinci-types";
import type { DiagramSpec } from "./spec.js";

/** Raw Mermaid source block — host provides fence contents. */
export interface MermaidBlock {
    readonly language: "mermaid";
    /** The fence body as raw text. */
    readonly source: string;
    /** Optional id from `%%{init: { ... }}%%` or front-matter. */
    readonly id?: string;
}

/** Parse a Mermaid block into a DiagramSpec.
 *  Returns `undefined` + diagnostics if parsing fails.
 *
 *  Currently accepts only manually-constructed specs. Full Mermaid
 *  parsing is host-scope. */
export function parseMermaid(_block: MermaidBlock): { spec?: DiagramSpec; diagnostics: DiagnosticSet } {
    // TODO: integrate oak-mermaid parser output.
    return { diagnostics: EMPTY_DIAGNOSTICS };
}

/** Convenience wrapper for manually built specs (for tests / future importers). */
export function fromSpec(spec: DiagramSpec): DiagramSpec {
    return spec;
}
