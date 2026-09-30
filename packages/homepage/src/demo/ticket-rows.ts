export type TicketStatus = 'open' | 'in-progress' | 'resolved';

export type TicketRow = {
    id: string;
    status: TicketStatus;
    cells: string[];
};

export type TicketSummary = {
    total: number;
    running: number;
    failed: number;
};

export function formatPriority(priority: string, locale: string): string {
    if (locale === 'en-us') return priority;
    if (priority === 'high') return '高';
    if (priority === 'medium') return '中';
    return '低';
}

export function formatStatus(status: TicketStatus, locale: string): string {
    if (locale === 'en-us') return status;
    if (status === 'open') return '待处理';
    if (status === 'in-progress') return '处理中';
    return '已完成';
}

export function mapTicketRow(
    ticket: {
        id: string;
        subject: string;
        priority: string;
        status: string;
        owner: string;
        updated: string;
    },
    locale: string,
): TicketRow {
    const status = ticket.status as TicketStatus;
    return {
        id: ticket.id,
        status,
        cells: [ticket.subject, formatPriority(ticket.priority, locale), formatStatus(status, locale), ticket.owner, ticket.updated],
    };
}

export function summarizeTicketRows(rows: Pick<TicketRow, 'status'>[]): TicketSummary {
    return {
        total: rows.length,
        running: rows.filter((row) => row.status === 'in-progress').length,
        failed: rows.filter((row) => row.status === 'open').length,
    };
}

export function applyStatusToRow(row: TicketRow, status: TicketStatus, locale: string): TicketRow {
    const cells = row.cells.slice();
    cells[2] = formatStatus(status, locale);
    return { ...row, status, cells };
}

export function statusAfterHandlingNote(status: TicketStatus): TicketStatus {
    if (status === 'open') return 'in-progress';
    return status;
}
