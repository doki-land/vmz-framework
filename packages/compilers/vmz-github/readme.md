# vmz-github

GitHub Actions monitoring over the GitHub REST API, used by `vmz github-actions`. It never spawns `gh` and never
depends on a locally installed CLI.

|             |                              |
|-------------|------------------------------|
| **Crate**   | `vmz-github`                 |
| **Kind**    | library                      |
| **Publish** | `false` (workspace-internal) |

## Features

- `status`: resolve a run and report its current state once
- `wait`: poll until the run reports a conclusion or the wait budget expires
- Run selection by run id, commit SHA, branch or workflow
- Typed errors for transport failures and unexpected REST shapes

## Non-goals

- Shelling out to `gh`
- Publishing, tagging or mutating repository state
- Deciding whether a run *should* pass: the caller supplies `requiredConclusion`

## Development

```bash
cargo test -p vmz-github
```

## License

MIT. See the workspace `license` field.
