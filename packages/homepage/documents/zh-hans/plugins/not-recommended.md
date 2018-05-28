# 明确不建议

下列在 Vue / React / Solid 生态里很常见，但在 VMZ 中 **官方不提供 `@vmz/plugin-*` 绑定，并明确不建议当作默认方案**。你可以私自
npm 安装，不要期待第二套语义主链。

## 与核心语义竞争

| 常见库 / 做法                                         | 原因                                     |
|-------------------------------------------------------|------------------------------------------|
| Pinia / Zustand / Jotai / Redux / Solid stores / Vuex | 与 class 字段响应式 + Program Graph 竞争 |
| Vue Router / React Router / TanStack Router           | 路由是一等能力                           |
| `useX` / `createX` / hooks 状态工厂                   | 语法与组件模型禁止                       |
| VDOM、整树 diff、默认全页 hydrate                     | 更新必须是依赖驱动精确补丁               |

## 测试 / 文档框架

| 常见库 / 做法                                                 | 原因                                           |
|---------------------------------------------------------------|------------------------------------------------|
| Vitest / Jest 作为测试主链                                    | 主链是 `vmz test`                              |
| Playwright / Cypress 作为默认产品测试语义                     | 可选外挂，不进核心叙事                         |
| VitePress / Docusaurus / Astro / Next / Nuxt / MDX 当文档主链 | 文档是 `vmz document`；本站即 Integrated `/d/` |

## UI 全家桶

| 常见库 / 做法                                              | 原因                             |
|------------------------------------------------------------|----------------------------------|
| Element Plus / Ant Design / MUI / Naive / Vuetify 全量移植 | 第二套组件语义；官方不做全量端口 |
| Tailwind utility 塞进普通 `class`                          | 用 `style:tw` / `@tailwind`      |

生产交互图用官方 `<Echarts>`（`@vmz/plugin-echarts`）。DaVinci 与之平行、未稳，勿当生产默认。Recharts / Chart.js 可直接依赖，官方暂不跟进第二套 chart 组件。

## 取数 / 表单

| 常见库 / 做法                                  | 原因                                     |
|------------------------------------------------|------------------------------------------|
| TanStack Query / SWR 当默认取数                | 与 `#server` / AsyncTask / Island 易双轨 |
| React Hook Form / Formik / VeeValidate / Felte | 与字段响应式竞争                         |

## 可以直接依赖、不必做成官方插件

**Zod / Valibot / dayjs / date-fns** 等框架无关库可在 `<script>` 里直接 import。只有需要编译期贡献（materialize
组件、引擎注册）时才走 `@vmz/plugin` 协议。

社区包可发布，但勿占用 `@vmz/plugin-*` 官方前缀。
