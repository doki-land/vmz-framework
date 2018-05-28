import fs from 'node:fs';
const p = 'e:/图表绘图/规划设计/vmz/05-工具链与仓库布局.md';
let t = fs.readFileSync(p, 'utf8');
t = t.replace(
    /runtimes\/\s*# npm[^\n]*conformance[^\n]*/u,
    'runtimes/    # npm：@vmz/protocol、@vmz/core、@vmz/test、vmz CLI、vmz-fixtures、textmate 等',
);
t = t.replace(
    '| **`@vmz/core`** | **包名已立** | 原 `vmz-runtime`；dist 为 `vmz-dom.js` / `vmz-runtime.js` |',
    '| **`@vmz/core`** | **包名已立** | 原 `vmz-runtime`；npm 从 `dist/` 发布；应用产物仍为 `vmz-dom.js` / `vmz-runtime.js` |',
);
t = t.replace(
    '| **`@vmz/core`** | `packages/runtimes/vmz-runtime`（兼容目录名） | 生产 runtime（DOM/SSR/HTTP） |',
    '| **`@vmz/core`** | `packages/runtimes/vmz-runtime` | 生产 runtime（DOM/SSR/HTTP）；`src/` → `dist/` |',
);
const section = `
## \`packages/runtimes/\`（npm JS 分发）

除 N-API 原生 \`.node\` 与平台 optional 包外，**所有 runtimes npm JS 包**统一：

- 源码：\`src/**/*.ts\`
- 构建：\`tsc\` → \`dist/\`
- \`package.json\` 的 \`main\` / \`types\` / \`exports\` **只指向 \`dist/\`**
- 私有夹具（如 \`vmz-fixtures\`）同样布局；**不是** \`vmz-plugin-*\` 插件包

**与应用产物的区分**：编译器仍把 runtime 复制进**应用** \`dist/\` 并命名为 \`vmz-dom.js\`、\`vmz-runtime.js\`、\`vmz-http.js\`、\`vmz-serve-host.mjs\`；那是部署产物名，与 \`@vmz/core\` 包内 \`dist/dom.js\` 等路径无关。

参考实现：\`@vmz/test\`（\`packages/runtimes/vmz-test\`）。

`;
if (!t.includes('npm JS 分发')) {
    t = t.replace('## `packages/compilers/`（Rust workspace）', section + '## `packages/compilers/`（Rust workspace）');
}
fs.writeFileSync(p, t, 'utf8');
console.log('doc ok');
