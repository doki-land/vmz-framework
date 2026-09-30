

export function extractAppHtml(html, doc) {
    const parser = new (doc.defaultView?.DOMParser || globalThis.DOMParser)();
    const parsed = parser.parseFromString(html, 'text/html');
    return parsed.getElementById('app');
}
