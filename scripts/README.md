# scripts/

Root automation for **build**, **CI publish**, and **dev sync** only.

**Not** for conformance / product test logic. Those live next to the code:

| Kind                       | Where                                                   | How to run                              |
|----------------------------|---------------------------------------------------------|-----------------------------------------|
| Node / CLI / N-API drivers | `packages/runtimes/vmz/tests/` (+ `tests/conformance/`) | `pnpm --filter vmz test`, `pnpm verify` |
| Example / graph tests      | `packages/examples/*/tests`, `*.vmz.test.json`          | `vmz test`, `pnpm test:examples`        |
| Rust crate tests           | `packages/compilers/*/tests` or `#[cfg(test)]`          | `cargo test -p <crate>`                 |

## Layout

```text
scripts/
  build/   napi + post-tsc asset copy
  ci/      npm release / placeholder publish
  dev/     editor TextMate sync + tidy (deps/git/tags)
  test/    tiny shared helpers only (expect, TS-from-JS resolve hook)
```

`pnpm tidy` → `dev/tidy.mjs` (deps / git gc / tag sync). Not the same as bare `pnpm prune`.

Do not add new “gate” / “verify suite” bodies under `scripts/`.
