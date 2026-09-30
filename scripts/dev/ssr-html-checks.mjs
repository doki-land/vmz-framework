/**
 * Commercial visual spec R1/R2 checks on homepage SSR HTML.
 */

function iconSvgSlice(html) {
    const byFeature = html.match(/data-name=["']feature\.incremental["'][\s\S]{0,1600}/i);
    if (byFeature) return byFeature[0];
    const byClass = html.match(/vmz-ui-icon__svg[\s\S]{0,1600}/i);
    return byClass ? byClass[0] : '';
}

function hasFeatureIconGeometry(html) {
    const slice = iconSvgSlice(html);
    if (!slice.includes('vmz-ui-icon__svg')) return false;
    return /<(?:path|circle)\b/i.test(slice);
}

export function inspectSsrHtml(html) {
    const failures = [];

    const buttonSlotLeak = html.match(/<\/button>\s*[^<\s][^<]{0,80}/);
    if (buttonSlotLeak) {
        failures.push(`R1 button slot leak after </button>: ${buttonSlotLeak[0].slice(0, 96)}`);
    }

    const svgSpanRegion = html.match(/<svg[\s\S]{0,1200}?<span[^>]*data-vmz-region[\s\S]{0,200}/i);
    if (svgSpanRegion) {
        failures.push(`R2 SVG contains span[data-vmz-region]: ${svgSpanRegion[0].slice(0, 160)}`);
    }

    if (!hasFeatureIconGeometry(html)) {
        failures.push('R2 feature icon path missing from SSR HTML');
    }

    const emptyPrimaryButton = html.match(/<button[^>]*vmz-ui-btn[^>]*>\s*<\/button>/i);
    if (emptyPrimaryButton) {
        failures.push('R1 empty primary button detected in SSR HTML');
    }

    const highlightedCode = html.match(
        /class="shiki-host"[^>]*>\s*<pre\b[^>]*class="[^"]*shiki[^\"]*"[^>]*>[\s\S]*?<code>[\s\S]*?Counter[\s\S]*?<\/code>/i,
    );
    if (!highlightedCode) {
        failures.push('Homepage code example missing from the first SSR HTML response');
    }

    return { ok: failures.length === 0, failures };
}
