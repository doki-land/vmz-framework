# @vmz/plugin-katex

## Fast mathematical typesetting for VMZ documents and products

`@vmz/plugin-katex` brings KaTeX into VMZ for applications that need clear, high-quality formulas without making
mathematics a heavy client-side feature. It is the default choice for most technical documentation, educational content,
dashboards, and product UI that renders common TeX notation.

## Why choose KaTeX

KaTeX prioritizes speed and compact output. That makes it well suited to VMZ's SSR-first and progressive-interaction
direction: formulas can be part of the readable page rather than a reason to delay content behind a large browser
dependency.

Choose this plugin when your content uses mainstream TeX and you value predictable, lightweight rendering. Choose
`@vmz/plugin-mathjax` instead when the breadth of TeX compatibility matters more than payload and execution cost.

| Choose KaTeX when...                                   | Choose MathJax when...                                 |
|--------------------------------------------------------|--------------------------------------------------------|
| Fast, common formula rendering is the priority         | Advanced TeX compatibility is the priority             |
| Documentation and product pages need a lighter default | The mathematical surface is central and more demanding |

## VMZ boundary

KaTeX supplies typesetting. VMZ still owns application compilation, document structure, server rendering, testing, and
deployment. Using formulas should not create a separate rendering or state model inside the application.

## Where it shines ✨

- API references that include mathematical notation.
- Educational products with many short formulas.
- Technical articles that must remain readable in SSR output.
- Dashboards and scientific tools where formulas support, rather than dominate, the interface.

KaTeX keeps the common path simple: polished mathematics without turning an otherwise lightweight page into a
mathematics runtime. Start here when you are unsure; move to MathJax when a real content requirement exceeds its
coverage.
