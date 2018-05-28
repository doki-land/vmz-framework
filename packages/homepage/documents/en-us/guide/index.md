# Getting started

VMZ is an oxc-based full-stack application compiler: Vue- *familiar* surface, oxc-native compile, **VMZ-native
semantics** (not a Vue/React compatibility layer).

```bash
pnpm add -D vmz
```

Prefer typed config:

```ts
import {defineConfig} from 'vmz';

export default defineConfig({
    plugins: [],
});
```

More guides and plugin docs live on this site under `/d/`.
