# VMZ for VS Code

TextMate highlighting for `.vmz` files and VMZ fenced blocks in Markdown. Grammar is shared with `vmz-textmate` (same surface as docs / Shiki).

## Product toolchain

This extension does **not** host an LSP. Check, build, format, lint, test, and plan all go through the product CLI:

```bash
pnpm add -D @vmz/vmz
pnpm exec vmz check
pnpm exec vmz build
pnpm exec vmz format --check .
```

`@vmz/vmz` talks to the compiler via N-API. A future editor language service would consume the same semantic surface — not a second product CLI.

## What you get today

- Syntax highlighting for `.vmz` (template / script / style boundaries)
- Markdown fenced `vmz` code blocks
- Shared TextMate grammar with the rest of the toolchain

## Install (dev)

From the monorepo: open `packages/editors/vmz-vscode` as an extension development host, or package after `pnpm sync` (copies grammar from `vmz-textmate`).
