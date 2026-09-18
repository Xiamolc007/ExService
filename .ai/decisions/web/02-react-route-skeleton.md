# 前端使用 react-router 的声明式路由

- 状态：已接受
- 模块：`web`
- 日期：2026-09-18
- 来源：`notes/web/specs/2026-09-18-web-route-skeleton-design.md`

_最后更新：2026-09-18_

## 背景

`apps/web` 原先只有单一 `App` 根组件，没有页面结构。业务页面落地时需要有一个稳定的挂载点，否则每加一个页面都要改动挂载代码。Contract 里目前只有 `GET /health`，因此这次只建立路由结构，不建立页面内容。

## 决策

- 前端路由使用 `react-router` 的**声明式** API（`<BrowserRouter>` + `<Routes>` / `<Route>` / `<Outlet>`），导入来源是 `react-router`，**不是** `react-router-dom`。
- `<BrowserRouter>` 只在 `apps/web/src/main.tsx` 出现一次；`apps/web/src/App.tsx` 只声明路由树。
- 使用 history 模式（`BrowserRouter`），不是 hash 模式。
- 唯一的布局层是 `apps/web/src/routes/RootLayout.tsx`，它只渲染 `<Outlet />`，不含导航或其他 UI。
- 首版路由表只有 `/`（静态首页）与 `*`（静态兜底页）；`*` 只处理前端路由，不替代 Mock Server 的 404 envelope。

## 理由

- 声明式 API 不引入 `loader` / `action`，因此不会在 Contract 还没有业务 operation 时就催生前端数据层。
- 同一个包内从声明式升级到 data router 的代价很低，现在不需要为未来预建结构。
- `react-router-dom` 的发版停在 `7.18.4`，v8 已把它合并进 `react-router`，且官方声明 v7 → v8 为非破坏性升级。使用 `react-router` 可以避免绑定一个停止发版的包名。
- 布局层只渲染 `<Outlet />` 是刻意留白：它给出了嵌套路由的挂载点，又不产出 `web` 首版范围明确排除的交互式 UI。

## 影响

- **未来 PHP 部署必须把未知路径回落到 `index.html`。** history 路由下，缺少 SPA fallback 会让深链接由服务端直接 404；SPA 若不在域名根路径，还需要 `basename`。
- 路由骨架没有自动化覆盖：仓库没有前端测试基建，`pnpm test` 仍只跑 Contract Test，因此这部分只有 typecheck、build 与人工验证能兜住。
- 新增前端页面时，`App.tsx` 的路由表是唯一入口；`RootLayout` 是否加入导航属于独立决策。

## 重新审视的条件

- 需要路由级数据加载（`loader` / `action`）或路由级错误边界时。
- 需要按路由做代码分割时。
- 部署形态确定后，需要配置 `basename` 或改选 hash 模式时。
- 引入前端测试基建时，本决策的覆盖缺口需要重新评估。

## 证据

- `apps/web/src/App.tsx`、`apps/web/src/main.tsx`、`apps/web/src/routes/RootLayout.tsx`、`apps/web/src/pages/Home.tsx`、`apps/web/src/pages/NotFound.tsx`。
- `apps/web/package.json` 的 `react-router ^8.4.0`。
- `notes/web/specs/2026-09-18-web-route-skeleton-design.md`；该设计修订了 `notes/backend-sandbox/specs/2026-09-16-backend-sandbox-scaffold-design.md` §7.1 的页面范围。
