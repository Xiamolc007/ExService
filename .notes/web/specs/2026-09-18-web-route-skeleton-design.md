# Web 端路由骨架设计

- **日期：**2026-09-18
- **状态：**已批准；已实施
- **模块根目录：**`.notes/web/`
- **确认范围：**为 `apps/web` 引入最小的 React 路由骨架：一个根布局挂载 `/`（静态首页）与 `*`（静态兜底页）。不含业务页面、数据请求、导航 UI 或额外的路由能力。

## 1. 背景与范围修订

[`backend-sandbox-scaffold-design.md`](../../backend-sandbox/specs/2026-09-16-backend-sandbox-scaffold-design.md) §7.1 把首版前端限定为「只有一个最小 `App` 根组件和 `styles/index.scss` 全局样式入口」，并明确不包含业务实体、数据列表、按钮流程或交互式状态演示。

本设计**修订**其中「只有一个最小 `App` 根组件」这一条，其余限制一条都没有放宽：`apps/web` 现在有真正的路由骨架，但路由表里没有业务页面。

本设计不修订 §7.1 关于依赖的结论：`valtio` 与 `framer-motion` 仍只是「后续选项」，本次不为验证依赖制造 store 或演示动画。

## 2. 决策

| 项 | 选择 |
| --- | --- |
| 路由库 | `react-router` `^8.4.0`，**声明式** API（`<BrowserRouter>` + `<Routes>` / `<Route>` / `<Outlet>`） |
| 导入来源 | `react-router`（不是 `react-router-dom`） |
| 历史模式 | `BrowserRouter`（history），不是 `HashRouter` |
| 路由表 | `/` → 静态首页；`*` → 静态兜底页；两者都挂在唯一的根布局下 |
| 布局 | `src/routes/RootLayout.tsx`，只渲染 `<Outlet />` |
| 页面 | `src/pages/Home.tsx`、`src/pages/NotFound.tsx` |

`<BrowserRouter>` 只在 `src/main.tsx` 的挂载点出现一次；`src/App.tsx` 只声明路由树，不在其中创建 router。

### 2.1 为什么不是 v7

`react-router-dom` 的发版停在 `7.18.4`，v8 把 `react-router-dom`、`@remix-run/*` 合并进 `react-router` 主包，且官方声明 v7 → v8 为非破坏性升级。锁 v7 等于主动选择一条已停止发版的包名与分支。`react-router@8.4.0` 的 peer 要求为 `react >= 19.2.7`，本仓库的 `react ^19.3.0` 满足。

v8 是 ESM-only，`apps/web` 的 `moduleResolution: bundler` 可以正常解析它。

## 3. 刻意不包含

以下能力在本次改动中**不引入**，等有真实页面与真实数据需求时再单独设计：

- 懒加载 / 代码分割 / `Suspense` 边界。
- `errorElement` 或任何路由级错误边界。
- `loader` / `action` 与任何前端数据层（这会把「前端状态」提前引入，而 Contract 里目前只有 `GET /health`）。
- 导航 UI（页头、链接、菜单）。
- path 常量模块、路由生成类型、`basename` 配置。
- valtio store、framer-motion 动画。
- 前端测试基建：`pnpm test` 继续只跑 `tests/contract/`。

## 4. 验收

- `pnpm typecheck`：`apps/web` 通过。
- `pnpm build`：Vite 构建成功。
- `pnpm test`：现有 Contract Test 不受影响、继续全绿。
- 人工验证：`/` 渲染静态就绪内容；任意其他路径渲染兜底页。

本次改动不触及 `api/openapi.yaml`，因此 `pnpm api:lint` 与 `pnpm api:generate` 不在验收集内。

## 5. 已知风险与延后项

1. **未来 PHP 部署必须配置 SPA fallback。** 选了 history 路由，服务端必须把未知路径回落到 `index.html`，否则深链接会由服务端直接 404。若部署时 SPA 不在域名根路径，还需要配置 `basename`。当前没有部署上下文，不预先实现。
2. **本地 `pnpm dev` 当前起不来。** `vite.config.ts` 使用 `strictPort: true`，而 `5173` 在本机已被另一个进程占用，因此人工验证前需要先释放该端口。这是本机环境状态，不是本次改动引入的。
3. **路由骨架没有任何自动化覆盖。** 仓库没有前端测试基建，兜底页与根布局只有 typecheck、build 与人工验证能覆盖。

## 6. 证据

- `apps/web/src/App.tsx`、`apps/web/src/main.tsx`、`apps/web/src/routes/RootLayout.tsx`、`apps/web/src/pages/Home.tsx`、`apps/web/src/pages/NotFound.tsx`。
- `apps/web/package.json` 的 `react-router` 依赖。
- `notes/backend-sandbox/specs/2026-09-16-backend-sandbox-scaffold-design.md` §7.1（本设计修订其页面范围）。
