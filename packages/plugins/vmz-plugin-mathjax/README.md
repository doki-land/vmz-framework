# @vmz/plugin-mathjax

## Broad TeX support when mathematics is the product

`@vmz/plugin-mathjax` connects MathJax to VMZ for applications whose mathematical content needs deeper TeX coverage,
richer notation, or compatibility with existing scholarly material.

Peer dependency: `@mathjax/src` **v4+** (replaces deprecated `mathjax-full`).

## The tradeoff

MathJax is the capability-first choice. It can handle cases that a lightweight typesetter may not, but it carries a
higher cost than KaTeX. For a documentation-heavy or formula-intensive product, that trade can be exactly right. For
common formulas on performance-sensitive pages, `@vmz/plugin-katex` is usually the better default.

VMZ keeps that choice explicit. The formula engine changes the presentation capability, not the application's state,
server, route, or deployment semantics. SSR and progressive interaction remain part of the VMZ application plan.

Think of MathJax as the right specialist tool when formula fidelity is worth a heavier delivery budget. 📐

## Where it earns its weight

- Scholarly material imported from established TeX sources.
- Products where advanced notation is central to the experience.
- Documentation that cannot accept a smaller supported syntax surface.
- Mathematical publishing that depends on the broader MathJax ecosystem.

| Product priority                               | Better starting point |
|------------------------------------------------|-----------------------|
| Fast common formulas and compact delivery      | KaTeX                 |
| Broad TeX compatibility and specialist content | MathJax               |

The choice remains local to mathematical presentation. It does not force a different VMZ routing, state, testing, or
deployment model.
