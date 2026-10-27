// DataSnapshot — columnar data for chart domain.
// Follow design: `规划设计/davinci/00-概述与架构边界.md` §6.
//
// DataSnapshot is a materialized, column-oriented table with field semantics
// attached. It does NOT execute statistics — those live in the statistic
// module and produce new snapshots.

/** Semantic kind of a data field. */
export type FieldSemantic = "nominal" | "ordinal" | "quantitative" | "temporal" | "unknown";

/** A column in the snapshot — typed array with semantic hint. */
export interface DataColumn {
    readonly name: string;
    readonly semantic: FieldSemantic;
    readonly values: ReadonlyArray<number | string | boolean | null>;
}

/** Columnar snapshot. All columns share the same row count. */
export interface DataSnapshot {
    readonly columns: ReadonlyArray<DataColumn>;
    /** Row count (derived from first column). */
    readonly rowCount: number;
}

/** Build a DataSnapshot from rows of key-value objects. */
export function fromRows(rows: ReadonlyArray<Record<string, unknown>>): DataSnapshot {
    if (rows.length === 0) return snapshot([], 0);
    const colNames = Object.keys(rows[0]);
    const columns: DataColumn[] = colNames.map((name) => {
        const values = rows.map((r) => (r[name] ?? null) as number | string | boolean | null);
        const semantic = inferSemantic(values);
        return { name, semantic, values };
    });
    return snapshot(columns, rows.length);
}

function snapshot(columns: DataColumn[], rowCount: number): DataSnapshot {
    return { columns, rowCount };
}

/** Get a column by name. */
export function column(snap: DataSnapshot, name: string): DataColumn | undefined {
    return snap.columns.find((c) => c.name === name);
}

function inferSemantic(values: ReadonlyArray<unknown>): FieldSemantic {
    let numeric = 0;
    let string = 0;
    let boolean = 0;
    let nonNull = 0;
    for (const v of values) {
        if (v === null || v === undefined) continue;
        nonNull++;
        if (typeof v === "number") numeric++;
        else if (typeof v === "boolean") boolean++;
        else string++;
    }
    if (nonNull === 0) return "unknown";
    if (numeric / nonNull > 0.9) return "quantitative";
    if (boolean / nonNull > 0.9) return "nominal";
    return "nominal";
}
