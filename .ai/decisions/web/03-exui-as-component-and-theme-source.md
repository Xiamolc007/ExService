# 以 ExUI 作为组件库与主题来源

- 状态：已接受
- 模块：`web`
- 日期：2026-09-18
- 来源：`.notes/web/specs/2026-09-18-homepage-and-components-design.md`

_最后更新：2026-09-18_

## 背景

前端此前只有脚手架就绪提示，没有任何 UI 依赖（`framer-motion` 与 `valtio` 虽已声明但未被使用）。写首页需要组件、图标与主题切换能力。

## 决策

- 引入 `@exre/exui`（当前 `0.4.0`）作为组件库、设计 token 与主题的来源；图标另装 `lucide-react`（ExUI 不 re-export 它）。
- `@exre/exui` 在 `apps/web` 与 `packages/components` **各自声明**为依赖。
- `@exre/exui/style.css` 只在 `apps/web/src/main.tsx` 导入一次。
- `ThemeProvider` 挂在 `main.tsx`，包住 `<BrowserRouter>`；主题切换用 `useTheme` 的三态（`light` / `dark` / `system`）。
- 不新建本地设计 token 层：颜色、边框、圆角一律取 `var(--exui-*)`。
- 应用侧自己补 `color-scheme`（原因见 [knowledge/web/exui-integration-traps.md](../../knowledge/web/exui-integration-traps.md)）。

## 理由

- ExUI 已提供顶栏所需的 `NavigationMenu`、`DropdownMenu`、`Avatar`、`ButtonGroup` 与三态主题；自己重建这些会重复实现，也拿不到它的 token 一致性。
- 两个包各自声明依赖是 pnpm 严格 node_modules 的必然结果：`apps/web` 要写 `import '@exre/exui/style.css'` 就必须自己能解析到该包，`packages/components` 要 import 组件同理。这不是冗余声明。
- 不建本地 token 层，是因为 ExUI 已经提供了这一层；在只有一个使用点的阶段再叠一层只是把数字挪个地方。
- 主题三态而不是二态开关：`useTheme` 原生支持三态且 `defaultTheme` 默认就是 `system`，二态表达不了它。

## 影响

- **首屏体积显著增大。** ExUI 发布成单个 `dist/exui.js`，无法有效 tree-shake；实测构建产物 JS 约 1.0 MB（gzip 约 298 kB）、CSS 约 339 kB（gzip 约 84 kB），Vite 会对 >500 kB 的 chunk 报警告。处理它属于独立决策。
- **`color-scheme` 的维护责任落在应用侧**（见知识库文档），若 ExUI 未来自带该声明需要重新评估。
- ExUI 把 Sonner、Radix、Base UI 等实现库一并打包；单独安装这些库会让状态不共享（通知类组件静默失效），必须避免。
- ExUI 不提供通用布局工具类，其文档示例里的 Tailwind 类在消费方无效；布局必须自己写 CSS。
- ExUI 的可缩放尺寸按 16px 基准用 `rem` 发布，且**不会**自己设置根字号。当前应用未采纳其可选的根字号缩放策略，`:root` 不写 `font-size`。
- 主题、字体与页面底色由 ExUI 接管：其样式表带 `body { background-color: var(--background); color: var(--foreground) }` 与 `html { font-family: var(--exui-font-family) }`。`apps/web` 的 `index.scss` **不再**声明 `font-family`——写在 `:root` 上会因特异性高于 ExUI 的 `html` 而让库字体静默失效。

## 重新审视的条件

- 需要一个 ExUI 未覆盖的组件，或 ExUI 缺失既定 API 时（此时应先核对已安装版本，不得用私有导入或自造 API 兜底）。
- 首屏体积成为实际约束，需要按需引入或路由级懒加载时。
- 需要视觉上与 ExUI 的品牌观感脱钩时。
- 引入前端测试基建时——ExUI 组件在测试环境下的 provider 与 `localStorage` 依赖需要重新评估。

## 证据

- `apps/web/package.json`、`packages/components/package.json` 的 `@exre/exui` 与 `lucide-react` 声明。
- `apps/web/src/main.tsx`（导入点与 `ThemeProvider` 挂载点）、`apps/web/src/styles/index.scss`。
- `packages/components/src/ThemeToggle.tsx`（三态切换）。
- 已安装包的 `package.json`、`dist/index.css`、`dist/tokens/style.css`、`src/components/theme-provider.tsx`。
- `.agents/skills/exui-usage/`（ExUI 官方消费方说明）。
