/**
 * ECharts mount helper (browser). Peer: echarts.
 * Parallel to DaVinci (declarative track); prefer for production charts while DaVinci matures.
 */

export type MountEchartsOptions = {
    option?: Record<string, unknown> | null;
    theme?: string | object | null;
    renderer?: 'canvas' | 'svg';
};

export async function mountEcharts(el: HTMLElement, opts: MountEchartsOptions = {}) {
    const echarts = await import('echarts');
    const chart = echarts.init(el, opts.theme ?? undefined, {
        renderer: opts.renderer ?? 'canvas',
    });
    if (opts.option) {
        chart.setOption(opts.option);
    }
    const onResize = () => {
        chart.resize();
    };
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(onResize);
        ro.observe(el);
        return {
            chart,
            setOption: (option: Record<string, unknown>, notMerge?: boolean) => {
                chart.setOption(option, notMerge);
            },
            dispose: () => {
                ro.disconnect();
                chart.dispose();
            },
        };
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('resize', onResize);
    }
    return {
        chart,
        setOption: (option: Record<string, unknown>, notMerge?: boolean) => {
            chart.setOption(option, notMerge);
        },
        dispose: () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('resize', onResize);
            }
            chart.dispose();
        },
    };
}
