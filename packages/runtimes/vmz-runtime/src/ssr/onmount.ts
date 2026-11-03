/**
 * SSR `onMount` execution budget.
 *
 * Contract: every per-instance `onMount` await during SSR is bounded (default
 * 5000ms, hosts may override via `opts.onMountBudgetMs`). Budget exhaustion and
 * `signal` abort are the same event: the render terminates and fails — no
 * half-baked HTML, no silent empty-string downgrade, no retry. An `onMount`
 * that throws propagates its original error unchanged.
 */

export const DEFAULT_SSR_ONMOUNT_BUDGET_MS = 5000;

/** `onMount` exceeded the SSR budget. Carries component, budget and elapsed. */
export class SsrOnMountTimeoutError extends Error {
    readonly component: string;
    readonly budgetMs: number;
    readonly elapsedMs: number;

    constructor(component: string, budgetMs: number, elapsedMs: number) {
        super(`vmz:ssr onMount budget exceeded: component=${component} budget=${budgetMs}ms elapsed=${elapsedMs}ms`);
        this.name = 'SsrOnMountTimeoutError';
        this.component = component;
        this.budgetMs = budgetMs;
        this.elapsedMs = elapsedMs;
    }
}

/** The host signal aborted a bounded `onMount` await. */
export class SsrRenderAbortError extends Error {
    readonly component: string;

    constructor(component: string) {
        super(`vmz:ssr onMount aborted by host signal: component=${component}`);
        this.name = 'SsrRenderAbortError';
        this.component = component;
    }
}

export type SsrOnMountContext = {
    budgetMs: number;
    signal: AbortSignal | null;
};

/** Read the host options into a budget context (`opts.onMountBudgetMs`, `opts.signal`). */
export function ssrOnMountContext(opts: any): SsrOnMountContext {
    const raw = opts && opts.onMountBudgetMs;
    const budgetMs = Number.isFinite(raw) && Number(raw) > 0 ? Number(raw) : DEFAULT_SSR_ONMOUNT_BUDGET_MS;
    const signal = opts && opts.signal ? opts.signal : null;
    return { budgetMs, signal };
}

/** Best-effort component label for diagnostics. */
export function ssrComponentName(Component: any, inst: any): string {
    return (
        (Component && (Component.__vmzTag || Component.name)) ||
        (inst && inst.constructor && inst.constructor.name) ||
        'AnonymousComponent'
    );
}

/**
 * Await one instance's `onMount` under the budget. The race is settled exactly
 * once; a late-resolving author promise after timeout/abort is dropped. The
 * budget timer itself bounds the wait, so a hung `onMount` can never stall the
 * host past `budgetMs`.
 */
export async function awaitSsrOnMount(inst: any, component: string, ctx: SsrOnMountContext): Promise<void> {
    const onMount = inst && inst.onMount;
    if (typeof onMount !== 'function') return;
    if (ctx.signal && ctx.signal.aborted) throw new SsrRenderAbortError(component);
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let onAbort: (() => void) | null = null;
    try {
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                fn();
            };
            timer = setTimeout(() => {
                settle(() => reject(new SsrOnMountTimeoutError(component, ctx.budgetMs, Date.now() - startedAt)));
            }, ctx.budgetMs);
            if (ctx.signal) {
                onAbort = () => settle(() => reject(new SsrRenderAbortError(component)));
                ctx.signal.addEventListener('abort', onAbort, { once: true });
            }
            let result: unknown;
            try {
                result = onMount.call(inst);
            } catch (err) {
                settle(() => reject(err));
                return;
            }
            Promise.resolve(result).then(
                () => settle(resolve),
                (err) => settle(() => reject(err)),
            );
        });
    } finally {
        if (timer) clearTimeout(timer);
        if (ctx.signal && onAbort) ctx.signal.removeEventListener('abort', onAbort);
    }
}
