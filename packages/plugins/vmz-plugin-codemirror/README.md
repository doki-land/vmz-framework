# @vmz/plugin-codemirror

## A capable editor without making every page an IDE

`@vmz/plugin-codemirror` brings CodeMirror 6 into VMZ applications. It is a strong choice for embedded editors,
documentation playgrounds, configuration surfaces, query builders, note-taking tools, and products that need serious
text editing while still respecting browser cost.

## Why choose CodeMirror

CodeMirror is generally the lighter editor option in the VMZ ecosystem. It offers a flexible modern editing foundation
without assuming that every application needs the full weight of a desktop-IDE experience. That makes it especially
suitable when an editor is one interaction region inside an otherwise content- or data-oriented page.

Choose CodeMirror when you want a balanced editor. Choose `@vmz/plugin-monaco` when rich IDE-like behavior and VS Code
familiarity outweigh the additional delivery cost.

| Good fit                                              | Less suitable                                            |
|-------------------------------------------------------|----------------------------------------------------------|
| Embedded editors, playgrounds, and configurable tools | A product that requires the deepest IDE-style experience |
| Pages where editor weight still matters               | A tiny input field that needs no code-editing behavior   |

## VMZ boundary

The editor is an interactive capability, not the page's architecture. VMZ remains responsible for deciding when the
editor code is delivered, how its region resumes, and how the rest of the page remains SSR-readable and independently
testable.

## Product scenarios 📝

- A documentation playground that activates only when the reader starts editing.
- A query, rule, or configuration editor inside a larger operational UI.
- A focused coding exercise that does not need a full IDE workbench.
- A structured text tool whose extensions are chosen for the domain.

The surrounding page should load as a normal VMZ page. The editor region becomes interactive when needed and owns its state and lifetime without forcing unrelated content into an eager client shell. That is why CodeMirror is often an intentional choice, not merely “the smaller Monaco.”
