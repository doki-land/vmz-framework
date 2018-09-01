# Deploy recipes

Minimal `vmz.config.ts` snippets. Full fields: [config reference](./config-reference.md).

## static

Marketing / docs / public content without secrets.

Source may include `<script server>`: this recipe only ships **statically proven** HTML/assets; live server / `secret()` dependencies do not run on the static host — see [static hosts](./static-hosts.md).

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'static',
    profiles: {
      'static': { host: 'browser', assembly: 'static-cdn' },
    },
  },
})
```

```bash
vmz build --profile static
vmz serve --profile static
```

## web-ssr (default)

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-ssr',
    profiles: {
      'web-ssr': {
        host: 'browser',
        assembly: 'server-host',
        serverRuntime: 'node',
      },
    },
  },
})
```

```bash
vmz build
vmz serve
```

## web-hybrid

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-hybrid',
    profiles: {
      'web-hybrid': {
        host: 'browser',
        assembly: 'cdn+server',
        serverRuntime: 'node',
      },
    },
  },
})
```

## web-client

```ts
import { defineConfig } from 'vmz'

export default defineConfig({
  delivery: {
    default: 'web-client',
    profiles: {
      'web-client': { host: 'browser', assembly: 'local-static' },
    },
  },
})
```

## rust-embedded

```ts
import { defineConfig, defineSite } from 'vmz'

export default defineConfig({
  application: { id: 'panel' },
  delivery: {
    default: 'panel-embedded',
    profiles: {
      'panel-embedded': {
        host: 'browser',
        assembly: 'rust-embedded',
        sources: defineSite({
          artifact: 'web-production',
          sources: [
            { id: 'installed', kind: 'filesystem', directory: './site', trust: 'signed-release' },
            { id: 'updates', kind: 'remote', baseUrl: 'https://updates.example.com/panel/', trust: 'signed-release' },
            { id: 'baseline', kind: 'embedded', artifact: 'baseline' },
          ],
          resolution: { mode: 'release', fallback: ['installed', 'updates', 'baseline'] },
          activation: 'atomic',
        }),
      },
    },
  },
})
```

Fallback is **whole-release** selection, never file-level mix.

## Switching profiles

```bash
vmz build --profile static
```

Pick platforms + ship mode and copy an **agent prompt**: see [planner](./planner.md) (site route ``/deploy-planner``).  
Publishing orchestration: [`vmz deploy`](./cli.md). Optional machine DeployPlan is written by the agent — do not hand-copy JSON.
