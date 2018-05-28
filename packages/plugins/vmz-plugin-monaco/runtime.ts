/**
 * Monaco mount helper (browser). First slice: imperative create/dispose.
 * Peer: monaco-editor.
 */

export type MountMonacoOptions = {
    value?: string;
    language?: string;
    theme?: string;
    readOnly?: boolean;
    onChange?: (v: string) => void;
};

export async function mountMonaco(el: HTMLElement, opts: MountMonacoOptions = {}) {
    const monaco = await import('monaco-editor');
    const editor = monaco.editor.create(el, {
        value: opts.value ?? '',
        language: opts.language ?? 'typescript',
        theme: opts.theme ?? 'vs-dark',
        readOnly: !!opts.readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
    });
    if (typeof opts.onChange === 'function') {
        editor.onDidChangeModelContent(() => {
            opts.onChange?.(editor.getValue());
        });
    }
    return {
        editor,
        getValue: () => editor.getValue(),
        setValue: (v: string) => editor.setValue(v ?? ''),
        dispose: () => editor.dispose(),
    };
}
