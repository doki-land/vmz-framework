import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HOMEPAGE = path.join(ROOT, 'packages', 'homepage');

const candidates = [
    path.join(HOMEPAGE, 'dist', 'web-ssr', 'static', 'index.html'),
    path.join(HOMEPAGE, 'dist', 'web-ssr', 'static', 'en-us', 'index.html'),
    path.join(HOMEPAGE, 'dist', 'static', 'index.html'),
    path.join(HOMEPAGE, 'dist', 'static', 'en-us', 'index.html'),
];

const htmlPath = candidates.find((p) => fs.existsSync(p));
if (!htmlPath) {
    console.error('inspect-ssr-html: no static homepage HTML found, run `pnpm --filter @vmz/homepage build` first');
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const failures = [];

function fail(msg) {
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
}

console.log(`inspect-ssr-html: reading ${path.relative(ROOT, htmlPath)}`);

const buttonSlotLeak = html.match(/<\/button>\s*[^<\s][^<]{0,80}/);
if (buttonSlotLeak) {
    fail(`R1 button slot leak after </button>: ${buttonSlotLeak[0].slice(0, 96)}`);
} else {
    console.log('PASS: R1 button slot stays inside <button>');
}

const svgSpanRegion = html.match(/<svg[\s\S]{0,1200}?<span[^>]*data-vmz-region[\s\S]{0,200}/i);
if (svgSpanRegion) {
    fail(`R2 SVG contains span[data-vmz-region]: ${svgSpanRegion[0].slice(0, 160)}`);
} else {
    console.log('PASS: R2 SVG region hosts avoid HTML span wrappers');
}

const iconPath = html.match(/<svg[^>]*class="[^"]*vmz-ui-icon__svg[^"]*"[^>]*>[\s\S]{0,500}?<path[\s\S]{0,200}/i);
if (!iconPath) {
    fail('R2 feature icon path missing from SSR HTML');
} else {
    console.log('PASS: feature icon path present in SSR HTML');
}

const emptyPrimaryButton = html.match(/<button[^>]*vmz-ui-btn[^>]*>\s*<\/button>/i);
if (emptyPrimaryButton) {
    fail('R1 empty primary button detected in SSR HTML');
}

if (failures.length) {
    console.error(`inspect-ssr-html: ${failures.length} failure(s)`);
    process.exit(1);
}

console.log('inspect-ssr-html: all SSR rendering checks passed');
