/**
 * Monaco mount helper (browser). Peer: monaco-editor.
 *
 * Dynamic-imports monaco so Node/SSR route collection never evaluates the
 * browser bundle (`window is not defined`).
 *
 * Embedded VMZ hosts desync selection overlays unless we pin fonts, disable
 * EditContext, remasure fonts, and drive layout via ResizeObserver.
 */

export type JsonSchemaRegistration = {
    uri: string;
    fileMatch?: string[];
    schema: object;
};

export type MountMonacoOptions = {
    value?: string;
    language?: string;
    theme?: string;
    readOnly?: boolean;
    onChange?: (v: string) => void;
    jsonSchemaUrl?: string;
    jsonSchemas?: JsonSchemaRegistration[];
};

type MonacoEnv = {
    getWorkerUrl?: (moduleId: string, label: string) => string;
    getWorker?: (moduleId: string, label: string) => Worker;
};

let mountSeq = 0;

function ensureMonacoEnvironment(): void {
    const g = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnv };
    if (g.MonacoEnvironment?.getWorker || g.MonacoEnvironment?.getWorkerUrl) return;
    g.MonacoEnvironment = {
        getWorkerUrl(_moduleId: string, label: string) {
            if (label === 'json') return '/vendor/monaco-json.worker.js';
            return '/vendor/monaco-editor.worker.js';
        },
    };
}

function ensureMonacoCss(): void {
    if (typeof document === 'undefined') return;
    if (document.querySelector('link[data-vmz-monaco-css]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vendor/plugin-monaco-runtime.css';
    link.setAttribute('data-vmz-monaco-css', '');
    document.head.appendChild(link);
}

async function loadJsonSchema(url: string): Promise<JsonSchemaRegistration | null> {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const schema = (await res.json()) as object;
        const id = typeof (schema as { $id?: unknown }).$id === 'string' ? String((schema as { $id: string }).$id) : url;
        return {
            uri: id,
            fileMatch: ['*'],
            schema,
        };
    } catch {
        return null;
    }
}

function disposeHostEditor(el: HTMLElement): void {
    const prior = (el as HTMLElement & { __vmzMonaco?: { dispose: () => void } }).__vmzMonaco;
    if (!prior) return;
    try {
        prior.dispose();
    } catch {
        /* ignore */
    }
    delete (el as HTMLElement & { __vmzMonaco?: unknown }).__vmzMonaco;
    el.replaceChildren();
}

function deadApi() {
    return {
        editor: null as unknown as never,
        monaco: null as unknown as never,
        getValue: () => '',
        setValue: (_v: string) => {},
        dispose: () => {},
    };
}

export async function mountMonaco(el: HTMLElement, opts: MountMonacoOptions = {}) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
        return deadApi();
    }

    const seq = ++mountSeq;
    ensureMonacoEnvironment();
    ensureMonacoCss();

    // Prefer vendor-injected monaco (single ESM chunk); otherwise dynamic-import.
    const injected = (globalThis as { __VMZ_MONACO__?: unknown }).__VMZ_MONACO__;
    let MonacoNS: unknown = injected;
    if (!MonacoNS) {
        MonacoNS = await import('monaco-editor');
        await import('monaco-editor/language/json/monaco.contribution.js');
    }
    const monaco = (MonacoNS as { languages?: unknown; default?: unknown }).languages
        ? MonacoNS
        : ((MonacoNS as { default: typeof MonacoNS }).default ?? MonacoNS);

    const language = opts.language ?? 'typescript';
    disposeHostEditor(el);

    if (language === 'json') {
        const jsonDefaults =
            (monaco as { json?: { jsonDefaults?: { setDiagnosticsOptions: (o: unknown) => void } } }).json?.jsonDefaults ??
            (
                monaco as {
                    languages?: {
                        json?: { jsonDefaults?: { setDiagnosticsOptions: (o: unknown) => void } };
                    };
                }
            ).languages?.json?.jsonDefaults;
        if (jsonDefaults) {
            const schemas: JsonSchemaRegistration[] = [...(opts.jsonSchemas ?? [])];
            if (opts.jsonSchemaUrl) {
                const loaded = await loadJsonSchema(opts.jsonSchemaUrl);
                if (loaded) schemas.push(loaded);
            }
            if (seq !== mountSeq) return deadApi();
            if (schemas.length) {
                jsonDefaults.setDiagnosticsOptions({
                    validate: true,
                    allowComments: true,
                    schemas: schemas.map((s) => ({
                        uri: s.uri,
                        fileMatch: s.fileMatch ?? ['*'],
                        schema: s.schema,
                    })),
                });
            }
        }
    }

    if (seq !== mountSeq) return deadApi();

    const uri = monaco.Uri.parse(`inmemory://vmz-monaco/${seq}/${language}.json`);
    const model = monaco.editor.createModel(opts.value ?? '', language, uri);

    const editor = monaco.editor.create(el, {
        model,
        theme: opts.theme ?? 'vs',
        readOnly: !!opts.readOnly,
        automaticLayout: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        editContext: false,
        fontFamily: 'Consolas, "Courier New", Menlo, Monaco, monospace',
        fontSize: 14,
        lineHeight: 21,
        letterSpacing: 0,
        fontLigatures: false,
        fixedOverflowWidgets: true,
        renderLineHighlight: 'none',
        renderValidationDecorations: 'on',
        occurrencesHighlight: 'off',
        selectionHighlight: false,
        matchBrackets: 'near',
        guides: { indentation: true, highlightActiveIndentation: false },
        padding: { top: 4, bottom: 4 },
        scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
            useShadows: false,
        },
    });

    const layout = () => {
        if (seq !== mountSeq) return;
        try {
            const rect = el.getBoundingClientRect();
            editor.layout({
                width: Math.max(0, Math.floor(rect.width)),
                height: Math.max(0, Math.floor(rect.height)),
            });
        } catch {
            /* ignore */
        }
    };

    try {
        monaco.editor.remeasureFonts();
    } catch {
        /* ignore */
    }
    layout();
    requestAnimationFrame(() => {
        try {
            monaco.editor.remeasureFonts();
        } catch {
            /* ignore */
        }
        layout();
    });
    if (document.fonts?.ready) {
        void document.fonts.ready.then(() => {
            if (seq !== mountSeq) return;
            try {
                monaco.editor.remeasureFonts();
            } catch {
                /* ignore */
            }
            layout();
        });
    }

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(() => layout());
        ro.observe(el);
    }

    if (typeof opts.onChange === 'function') {
        editor.onDidChangeModelContent(() => {
            opts.onChange?.(editor.getValue());
        });
    }

    const api = {
        editor,
        monaco,
        getValue: () => editor.getValue(),
        setValue: (v: string) => {
            const next = v ?? '';
            if (editor.getValue() === next) return;
            // Full replace must NOT restore the previous selection — stale ranges
            // paint ghost overlays (yellow bars / black bands) after content swaps.
            editor.pushUndoStop();
            editor.executeEdits(
                'vmz-setValue',
                [
                    {
                        range: model.getFullModelRange(),
                        text: next,
                        forceMoveMarkers: true,
                    },
                ],
                [new monaco.Selection(1, 1, 1, 1)],
            );
            editor.pushUndoStop();
            editor.revealPositionInCenterIfOutsideViewport({
                lineNumber: 1,
                column: 1,
            });
        },
        dispose: () => {
            try {
                ro?.disconnect();
            } catch {
                /* ignore */
            }
            ro = null;
            try {
                editor.dispose();
            } catch {
                /* ignore */
            }
            try {
                model.dispose();
            } catch {
                /* ignore */
            }
        },
    };
    (el as HTMLElement & { __vmzMonaco?: typeof api }).__vmzMonaco = api;
    return api;
}
