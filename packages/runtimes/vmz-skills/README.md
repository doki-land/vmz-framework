# `@vmz/vmz-skills`

Agent Skills for building with VMZ. Install the skill in a project, then describe the application outcome you want: the agent can place components, choose client/server boundaries, run the right VMZ checks, and explain generated artifacts.

## Install

```bash
npx skills add @vmz/vmz-skills --skill vmz-application -y
```

Preview or install globally:

```bash
npx skills add @vmz/vmz-skills --list
npx skills add @vmz/vmz-skills --skill vmz-application -y -g
```

Requires Node.js 18+ for the installer. The skill is docs-only and does not pretend to replace the VMZ CLI or runtime.

## Start with a prompt

```text
Create a VMZ page for a searchable customer list. Keep data access server-only,
make the table interactive, and tell me which conformance checks prove the boundary.

Review this .vmz component for accidental client imports, oversized hydration,
and state updates wider than the affected regions.

Explain why this component became an Island and how to test its resume behavior.
```

## Scope

The `vmz-application` skill covers the VMZ author surface, `#server` capabilities, compiler-visible state, SSR, resumption, `vmz test`, and deployment evidence. It does not teach Vue compatibility or authorize inventing `useX`/`createX` APIs.
