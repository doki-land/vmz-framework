

export function parseLayoutChain(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function layoutChainsEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

export function canRetainLayouts(root, prevLayout, nextLayout) {
    if (!layoutChainsEqual(prevLayout, nextLayout)) return false;
    if (!root.__vmzPageHost) return false;
    if (nextLayout.length === 0) return true;
    const insts = root.__vmzLayoutInsts;
    return Array.isArray(insts) && insts.length === nextLayout.length;
}

export function applyAppAttrs(root, nextApp) {
    for (const name of ['data-vmz-page', 'data-vmz-props', 'data-vmz-layout', 'data-vmz-route', 'data-vmz-locale', 'data-vmz-dir']) {
        const v = nextApp.getAttribute(name);
        if (v == null) root.removeAttribute(name);
        else root.setAttribute(name, v);
    }
}
