/**
 * CodeMirror 6 mount helper (browser).
 */

export type MountCodemirrorOptions = {
    value?: string;
    onChange?: (v: string) => void;
};

export async function mountCodemirror(el: HTMLElement, opts: MountCodemirrorOptions = {}) {
    const { EditorView, basicSetup } = await import('codemirror').catch(async () => {
        const view = await import('@codemirror/view');
        const state = await import('@codemirror/state');
        return {
            EditorView: view.EditorView,
            basicSetup: [] as unknown[],
            EditorState: state.EditorState,
        };
    });
    const { EditorState } = await import('@codemirror/state');
    const sync = EditorView.updateListener.of((u) => {
        if (u.docChanged && typeof opts.onChange === 'function') {
            opts.onChange(u.state.doc.toString());
        }
    });
    const state = EditorState.create({
        doc: opts.value ?? '',
        extensions: [basicSetup, sync].flat().filter(Boolean),
    });
    const view = new EditorView({ state, parent: el });
    return {
        view,
        getValue: () => view.state.doc.toString(),
        setValue: (v: string) =>
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: v ?? '' },
            }),
        dispose: () => view.destroy(),
    };
}
