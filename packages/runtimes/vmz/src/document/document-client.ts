/**
 * Framework-owned document client enhancement (`assets/vmz-document.js`).
 *
 * Progressive enhancement only: pages stay no-JS readable. The module wires
 * the static DocumentSearch shell to `document.search.json` (locale-scoped
 * substring filter, full keyboard loop) and injects copy buttons on article
 * code blocks. No framework runtime, no full-page hydration.
 *
 * Emitted verbatim by `buildDocuments`; keep it dependency-free plain JS —
 * this file is served as-authored, never bundled.
 */
export const DOCUMENT_CLIENT_HREF = 'assets/vmz-document.js';

export const DOCUMENT_CLIENT_JS = `/* vmz document layer — progressive enhancement (no framework runtime). */
(function () {
    'use strict';

    var doc = document.documentElement;
    var zh = String(doc.lang || '').toLowerCase().indexOf('zh') === 0;
    var copy = zh
        ? { search: '搜索文档', noResults: '没有匹配结果', hintJs: '输入关键词过滤文档', copyLabel: '复制', copied: '已复制', results: '搜索结果' }
        : { search: 'Search docs', noResults: 'No matching results', hintJs: 'Type to filter the docs', copyLabel: 'Copy', copied: 'Copied', results: 'Search results' };

    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    /* Search ------------------------------------------------------------ */

    function enhanceSearch(host) {
        var input = host.querySelector('.doc-search__input');
        var list = host.querySelector('.doc-search__results');
        var hint = host.querySelector('.doc-search__hint');
        if (!input || !list) return;
        var indexHref = host.getAttribute('data-vmz-search-index');
        if (!indexHref) return;

        var locale = String(doc.lang || '');
        var records = null;
        var loading = null;
        var active = -1;
        var current = [];

        function loadIndex() {
            if (records) return Promise.resolve(records);
            if (loading) return loading;
            loading = fetch(indexHref, { credentials: 'same-origin' })
                .then(function (res) {
                    if (!res.ok) throw new Error('search index ' + res.status);
                    return res.json();
                })
                .then(function (json) {
                    records = (json && json.records ? json.records : []).filter(function (r) {
                        return r && r.locale === locale && (r.kind === 'page' || r.kind === 'heading') && r.route;
                    });
                    return records;
                })
                .catch(function () {
                    records = [];
                    return records;
                });
            return loading;
        }

        function close() {
            list.hidden = true;
            input.setAttribute('aria-expanded', 'false');
            current = [];
            active = -1;
        }

        function open() {
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        }

        function render(query) {
            var q = String(query || '').trim().toLowerCase();
            current = [];
            active = -1;
            list.innerHTML = '';
            if (!q) {
                close();
                return;
            }
            loadIndex().then(function (all) {
                // Re-read the live query: a slow fetch must not paint stale hits.
                var live = String(input.value || '').trim().toLowerCase();
                if (live !== q) return;
                var seen = {};
                for (var i = 0; i < all.length && current.length < 8; i++) {
                    var r = all[i];
                    var hay = String(r.title || '') + ' ' + String(r.text || '');
                    if (hay.toLowerCase().indexOf(live) < 0) continue;
                    if (seen[r.route]) continue;
                    seen[r.route] = true;
                    current.push(r);
                }
                list.innerHTML = '';
                if (!current.length) {
                    var empty = document.createElement('li');
                    empty.className = 'doc-search__empty';
                    empty.setAttribute('role', 'option');
                    empty.setAttribute('aria-disabled', 'true');
                    empty.textContent = copy.noResults;
                    list.appendChild(empty);
                } else {
                    current.forEach(function (r, i) {
                        var li = document.createElement('li');
                        li.setAttribute('role', 'option');
                        li.id = 'vmz-doc-search-hit-' + i;
                        li.setAttribute('aria-selected', 'false');
                        var a = document.createElement('a');
                        a.href = r.route;
                        a.textContent = r.title || r.route;
                        if (r.kind === 'heading') {
                            var ctx = document.createElement('span');
                            ctx.className = 'doc-search__ctx';
                            ctx.textContent = ' · ' + (r.pageKey || '');
                            a.appendChild(ctx);
                        }
                        li.appendChild(a);
                        list.appendChild(li);
                    });
                }
                open();
            });
        }

        function move(delta) {
            if (!current.length) return;
            active = (active + delta + current.length) % current.length;
            var rows = list.querySelectorAll('li[role="option"]');
            rows.forEach(function (row, i) {
                row.setAttribute('aria-selected', i === active ? 'true' : 'false');
            });
            input.setAttribute('aria-activedescendant', 'vmz-doc-search-hit-' + active);
        }

        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-controls', list.id || 'vmz-doc-search-results');
        list.id = list.id || 'vmz-doc-search-results';
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('placeholder', copy.search);
        list.setAttribute('aria-label', copy.results);
        if (hint) hint.textContent = copy.hintJs;

        input.addEventListener('input', function () {
            render(input.value);
        });
        input.addEventListener('focus', function () {
            loadIndex();
        });
        input.addEventListener('keydown', function (ev) {
            if (ev.key === 'ArrowDown') {
                ev.preventDefault();
                move(1);
            } else if (ev.key === 'ArrowUp') {
                ev.preventDefault();
                move(-1);
            } else if (ev.key === 'Enter') {
                if (active >= 0 && current[active]) {
                    ev.preventDefault();
                    window.location.assign(current[active].route);
                }
            } else if (ev.key === 'Escape') {
                input.value = '';
                close();
            }
        });
        document.addEventListener('click', function (ev) {
            if (!host.contains(ev.target)) close();
        });
    }

    /* Code copy ----------------------------------------------------------- */

    function enhanceCopy() {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
        var blocks = document.querySelectorAll('.doc-content main pre');
        blocks.forEach(function (pre) {
            if (pre.querySelector('.doc-copy')) return;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'doc-copy';
            btn.textContent = copy.copyLabel;
            btn.setAttribute('aria-label', copy.copyLabel);
            btn.addEventListener('click', function () {
                var code = pre.querySelector('code');
                var text = code ? code.innerText : pre.innerText;
                navigator.clipboard.writeText(text).then(function () {
                    btn.textContent = copy.copied;
                    btn.classList.add('doc-copy--done');
                    setTimeout(function () {
                        btn.textContent = copy.copyLabel;
                        btn.classList.remove('doc-copy--done');
                    }, 1200);
                });
            });
            pre.appendChild(btn);
        });
    }

    ready(function () {
        try {
            var host = document.querySelector('[data-vmz-search-index]');
            if (host) enhanceSearch(host);
            enhanceCopy();
        } catch (err) {
            /* Enhancement must never take the readable page down. */
        }
    });
})();
`;
