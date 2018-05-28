# VMZ TextMate

## One language experience wherever VMZ is read 🎨

`vmz-textmate` provides the TextMate language definition for `.vmz` source and VMZ code fences. It gives templates,
TypeScript blocks, server boundaries, comments, strings, and embedded syntax a consistent visual structure in editors
and documentation.

## Why a shared grammar matters

For a new language surface, inconsistent presentation is more damaging than it first appears. If documentation
highlights a VMZ example one way while the editor recognizes a different structure, readers learn two incompatible
versions of the language before they have written their first application.

VMZ therefore keeps the editor and documentation experience aligned around one language definition. A reader should be
able to move from a guide to a `.vmz` file and retain the same visual understanding of what is template, what is
ordinary TypeScript, and what crosses a server boundary.

It is useful for:

- editor integrations that need native `.vmz` highlighting;
- documentation systems that render VMZ source examples;
- source viewers that need template and script structure to remain legible;
- teams that want the documentation experience to match the authoring experience.

## What the grammar recognizes

| Surface | Reading benefit |
|---|---|
| Template structure and expressions | Markup remains distinct from embedded program logic |
| TypeScript blocks | Standard language constructs look familiar |
| Client and server blocks | Execution boundaries are visually apparent |
| Style and metadata blocks | Supporting concerns remain easy to scan |
| Markdown VMZ fences | Documentation examples match editor source |

## A foundation, not the finish line

TextMate highlighting works in many editors and renderers, which makes it an excellent universal baseline. Semantic diagnostics, graph explanations, safe renames, route intelligence, and boundary proofs belong to richer VMZ language tooling layered above it.

That division gives readers immediate visual clarity today without pretending that colors alone understand the application. ✨

## Who should care

Use this package when you are building an editor integration, a documentation renderer, or a source viewer that needs
first-class VMZ highlighting. It is not a substitute for VMZ's semantic compiler or language service; syntax
highlighting makes the language approachable, while compiler analysis explains what the application actually means.
