# @vmz/plugin-iconify

## Use a broad icon vocabulary without owning every SVG

`@vmz/plugin-iconify` connects Iconify collections to VMZ applications. It is a practical choice for product interfaces,
navigation, documentation, internal tools, and design systems that need consistent access to established icon sets.

## What to consider

Icons improve scanning and recognition, but they are still product assets with delivery, licensing, and offline
implications. Iconify is attractive when breadth and familiar collections matter. A project that needs strict offline
builds, a locked visual language, or carefully audited assets may prefer to ship a selected local collection instead.

| Iconify is a good fit when...                   | Curated local assets are better when...                     |
|-------------------------------------------------|-------------------------------------------------------------|
| You need broad, familiar icon coverage          | Offline builds and audited assets are mandatory             |
| Product speed matters more than owning each SVG | Brand control and a narrow visual language are the priority |

VMZ keeps that decision at the asset boundary. Icons should not become an untracked runtime dependency that changes how
the rest of the application compiles, renders, or deploys.

## VMZ boundary

This plugin provides icon access. VMZ retains responsibility for page output, resource placement, SSR behavior, testing,
and explainable application delivery.

## A broad vocabulary, used deliberately ✨

- Product navigation can use familiar symbols instead of text-heavy controls.
- Documentation can distinguish notes, warnings, links, files, and actions at a glance.
- Operational tools can cover many domains without commissioning every utility icon.
- Design systems can prototype broadly before curating a final set.

The production question is not simply “does an icon exist?” It is how the application guarantees that icon in
development, CI, SSR, offline use, and long-term design consistency. Iconify solves discovery and breadth; a mature
product may then freeze the exact assets it depends on.
