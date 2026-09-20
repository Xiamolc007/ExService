# 首页与共享组件包设计

- **日期：**2026-09-18
- **状态：**已批准；已实施
- **模块根目录：**`.notes/web/`
- **确认范围：**把站点顶栏抽成可复用的通用组件，落地首页骨架，并为此新建工作区包 `packages/components` 与引入组件库 `@exre/exui`。不含业务页面、数据请求、真实认证与响应式设计。

## 1. 背景与范围

[`2026-09-18-web-route-skeleton-design.md`](2026-09-18-web-route-skeleton-design.md) 建立了路由骨架，并在其影响一节明确把「`RootLayout` 是否加入导航」列为**独立决策**。本次结掉这一条：`RootLayout` 现在渲染站点顶栏，因此所有路由（含 `*` 兜底页）共用同一个导航，且页面切换时顶栏不重新挂载。

本设计同时**修订**该文档 §3「刻意不包含」中的两条：

- **「导航 UI（页头、链接、菜单）」→ 本次引入。** 原判断是「有真实页面后再决定」，现在首页就是这个页面。
- **「布局层只渲染 `<Outlet />` 是刻意留白」→ 本次收紧。** 留白已经兑现，顶栏进 `RootLayout`。

以下几条**没有**被放宽，仍然刻意不引入：懒加载/代码分割/`Suspense`、`errorElement`、`loader`/`action`、valtio store、framer-motion。

新增的运行时依赖只有 `@exre/exui` 与 `lucide-react`。

## 2. 决策

| 项 | 选择 |
| --- | --- |
| 共享组件包 | 新建 `packages/components`，包名 `@workspace/components` |
| 包定位 | 应用级共享组件（承载站点语义），不是原子化设计系统 |
| 组件划分 | `SiteHeader` + `Logo` + `ThemeToggle` + `AuthArea` |
| 顶栏挂载点 | `apps/web/src/routes/RootLayout.tsx` |
| 导航项 | 5 项写死在 `SiteHeader` 内，组件不接收 props；用 `<Link>` 指向真实路径 |
| 目标路由 | 本次**不建**，点击落 `*` → `NotFound` |
| 组件样式 | CSS Modules（`.module.scss`） |
| 顶栏外壳 | sticky、内容容器居中且有最大宽度、三区网格布局 |
| 主题 | ExUI `ThemeProvider` 挂 `main.tsx`；`ThemeToggle` 三态 `DropdownMenu` |
| 登录态 | `AuthArea` 内 `useState` 假登录；未登录渲染 `登录`+`注册`，已登录渲染 `Avatar`+用户菜单 |
| 首页主体 | 中间一块矩形占位 + 底部两个按钮占位，均无行为 |
| ExUI 依赖声明 | `apps/web` 与 `packages/components` **各自声明** |
| 样式表导入点 | `@exre/exui/style.css` 只在 `apps/web/src/main.tsx` 导入一次 |
| 设计 token | 不新建本地 token 层；颜色/边框/圆角一律取 ExUI 的 `var(--exui-*)` |

顶栏与首页的**具体几何值**（容器最大宽度、顶栏高度、占位矩形尺寸等）不在此处复述，它们只写在 `SiteHeader.module.scss` 与 `Home.module.scss` 里，本文件只记录「为什么这样选」。

### 2.1 为什么新建工作区包，而不是放进 `apps/web`

顶栏的使用者是「所有页面」，但 `apps/web` 内部的 `components/` 目录不构成强制边界——任何页面代码都能绕开它。放进 `packages/` 后，`AGENTS.md` 的目录边界表才有可以写禁止项的位置（见 §2.4）。`pnpm-workspace.yaml` 已经是 `packages/*`，新包自动纳入，不需要改工作区配置。

选择**应用级共享组件**而不是原子化设计系统，是因为目前只有一个消费者，先做 `Button`/`Stack` 这类原语会产出一批没有第二个使用者的抽象；而 ExUI 本身已经提供了这一层。

### 2.2 为什么用 CSS Modules

顶栏是共享包的一部分，若沿用全局类名（`apps/web` 现有 `.app-shell` 那种写法），一旦与消费方的选择器撞名就会静默互相覆盖；CSS Modules 由 Vite 内建支持，零新增依赖。代价是包内需要一个 `.module.scss` 的类型声明文件（`src/scss.d.ts`），因为本包不是应用、没有 `vite/client` 的类型。

### 2.3 ExUI 集成的三条硬约束

这三条来自 `@exre/exui` 自身的契约，写错不会报错，只会静默失效：

1. **`style.css` 每个应用只导入一次**，且它已内含 Token CSS 与字体 CSS。因此导入点必须在 `apps/web/src/main.tsx`，**不能**放进 `packages/components`——否则包一旦被第二个入口引用就会出现第二个导入点。
2. **`useTheme` 在 `ThemeProvider` 之外调用会抛错。** 这是 ExUI 的公开契约，所以 provider 必须高于任何使用它的组件；本设计把它挂在 `main.tsx`，高于路由。
3. **`ThemeProvider` 只增删 `light`/`dark` 两个类，不声明 `color-scheme`；ExUI 的样式表也不声明它。** 因此应用必须按同一组类选择器自己补 `color-scheme`，否则深色主题下原生滚动条与表单控件仍是浅色。

`packages/components` 在两个包里都声明 `@exre/exui`，原因是 pnpm 的 node_modules 严格隔离：`apps/web` 要写 `import '@exre/exui/style.css'` 就必须自己能解析到该包，而组件包要 import 组件同理。

### 2.4 `packages/components` 的边界

- **允许：** React、ExUI 组件、react-router 的 `<Link>`、组件内的局部 UI 状态。
- **禁止：** 直接 `fetch`、import `@workspace/api-client`、import `@exre/exui/style.css`、定义路由表。

`react`/`react-dom`/`react-router` 在本包内同时是 `peerDependencies` 与 `devDependencies`：peer 是给消费者的（保证单一实例与 context 共享），dev 是本包 `typecheck` 需要的。`@exre/exui` 与 `lucide-react` 是普通 `dependencies`。

公开面只导出 `SiteHeader`；`Logo`/`ThemeToggle`/`AuthArea` 是包的内部模块，等真有第二个使用点再导出。

## 3. 刻意不包含

- **5 条导航目标路由。** 顶栏的 `<Link>` 指向最终形态的真实路径，但页面本身不建，点击落到 `*` 兜底页。
- **真实认证。** Contract 里没有任何认证 operation，`AuthArea` 的登录态是纯前端占位。
- **响应式与移动端导航。** 参考布局是桌面版；窄视口下顶栏中间列会因两侧最小内容宽度而偏移，这是已知且未处理的。
- **页脚、真实首页内容。** 首页主体刻意留白。
- **代码分割。** ExUI 发布成单个 `dist/exui.js`，无法有效 tree-shake，首屏 JS 明显变大；按 §2 的路线图这不是本次要解决的问题。
- **前端测试基建。** `pnpm test` 继续只跑 Contract Test。

## 4. 验收

- `pnpm typecheck`：4 个有 `typecheck` 脚本的包全绿。
- `pnpm build`：Vite 构建成功。
- `pnpm test`：Contract Test 不受影响。
- 人工验证：`pnpm --filter @workspace/web dev` 后在 `localhost:8081` 检查顶栏三区、主题三态切换、登录/退出切换、首页占位矩形与两个按钮。

本次改动不触及 `api/openapi.yaml`，因此 `pnpm api:lint` 与 `pnpm api:generate` 不在验收集内。

## 5. 已知风险与延后项

1. **5 条导航目标路由不存在**，点击落 `NotFound`；页面做好后需在 `App.tsx` 增加路由。
2. **假登录态会被真实认证整体替换。** 它不接 Contract、不发请求，不要在其上继续叠功能。
3. **窄视口下顶栏中间列会偏移。** 三区用 `1fr auto 1fr` 网格，两侧列受各自最小内容宽度约束；视口小于内容容器宽度时中间列不再严格居中。
4. **`packages/components` 无自动化覆盖。** 仓库没有前端测试基建，只有 typecheck、build 与人工验证能兜住。
5. **ExUI 使首屏体积显著增大**，Vite 会对 >500 kB 的 chunk 报警告。这是引入该库的既有代价，处理它（按需拆分、路由级懒加载）属于独立决策。
6. **`@exre/exui` 的版本漂移。** skill 明确提醒：若文档中的导出或 prop 在已安装版本的公开类型里不存在，应先检查已安装版本，不得用私有导入或自造 API 兜底。
7. **`color-scheme` 目前由应用补。** 若 ExUI 未来自带该声明，`index.scss` 里那两条规则需要重新评估（重复声明不报错，但会变成第二处事实来源）。

## 6. 证据

- `packages/components/src/{SiteHeader,Logo,ThemeToggle,AuthArea}.tsx` 与各自的 `.module.scss`、`src/scss.d.ts`、`src/index.ts`、`package.json`、`tsconfig.json`。
- `apps/web/src/{main.tsx,routes/RootLayout.tsx,pages/Home.tsx,pages/Home.module.scss,styles/index.scss,package.json}`、`apps/web/index.html`。
- `@exre/exui@0.5.0` 的公开类型与样式表（`dist/index.css`、`dist/tokens/style.css`、`types/components/ui/*.d.ts`），以及其 `src/components/theme-provider.tsx`。
- `.agents/skills/exui-usage/`：ExUI 官方的消费方用法说明，其中 `references/react-setup.md`、`references/theme-usage.md`、`references/component-usage` 与 `guides/EXUI_SCALING_RULES.md` 是 §2.3 三条约束的直接来源。
