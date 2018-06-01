# 与默认路径的关系

下列在 Vue / React / Solid 生态里很常见。VMZ 官方 **不提供**对应的 `@vmz/plugin-*`，也 **不把它们当作默认方案**。你仍可以私自
npm 安装；它们不会进入 VMZ 的语义主链。

## 与核心语义重叠

| 常见库 / 做法                                         | 与 VMZ 主路的关系                        |
|-------------------------------------------------------|------------------------------------------|
| Pinia / Zustand / Jotai / Redux / Solid stores / Vuex | 与 class 字段响应式 + Program Graph 重叠 |
| Vue Router / React Router / TanStack Router           | VMZ 路由是一等能力                       |
| `useX` / `createX` / hooks 状态工厂                   | 与当前语法与组件模型不同轨               |
| VDOM、整树 diff、默认全页 hydrate                     | VMZ 默认是依赖驱动的精确补丁             |

## 测试 / 文档框架

| 常见库 / 做法                                                 | 与 VMZ 主路的关系                                  |
|---------------------------------------------------------------|----------------------------------------------------|
| Vitest / Jest 作为测试主链                                    | 主链是 `vmz test`                                  |
| Playwright / Cypress 作为默认产品测试语义                     | 可选外挂，不进核心叙事                             |
| VitePress / Docusaurus / Astro / Next / Nuxt / MDX 当文档主链 | 文档主链是 `vmz document`；本站即 Integrated `/d/` |

## UI 全家桶

| 常见库 / 做法                                              | 与 VMZ 主路的关系                   |
|------------------------------------------------------------|-------------------------------------|
| Element Plus / Ant Design / MUI / Naive / Vuetify 全量移植 | 官方不做全量端口移植                |
| Tailwind utility 写进普通 `class`                          | 官方路径是 `style:tw` / `@tailwind` |

生产交互图优先官方 `<Echarts>`（`@vmz/plugin-echarts`）。DaVinci 与之平行、尚未稳定，暂不作为生产默认。Recharts / Chart.js
可直接作为依赖使用；官方暂不追第二套 chart 组件。

## 取数 / 表单

| 常见库 / 做法                                  | 与 VMZ 主路的关系                        |
|------------------------------------------------|------------------------------------------|
| TanStack Query / SWR 当默认取数                | 易与 `#server` / AsyncTask / Island 双轨 |
| React Hook Form / Formik / VeeValidate / Felte | 与字段响应式重叠                         |

## 可以直接依赖、不必做成官方插件

**Zod / Valibot / dayjs / date-fns** 等框架无关库可在 `<script>` 里直接 import。只有需要编译期贡献（materialize
组件、引擎注册）时才走 `@vmz/plugin` 协议。

社区包可发布；官方前缀 `@vmz/plugin-*` 用于官方维护的插件。
