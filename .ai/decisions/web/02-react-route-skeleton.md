# 前端使用 react-router 的声明式路由

- 状态：已接受
- 模块：`web`
- 日期：2026-09-18
- 来源：`apps/web/src/App.tsx`、`apps/web/src/main.tsx` 的路由实现

_最后更新：2026-09-29_

## 背景

`apps/web` 最初只有单一 `App` 根组件。业务页面需要稳定挂载点，以免每加一个页面都改动入口。当前路由表已承载首页、认证、社区加入、审核和资料页面。

## 决策

- 前端路由使用 `react-router` 的**声明式** API（`<BrowserRouter>` + `<Routes>` / `<Route>` / `<Outlet>`），导入来源是 `react-router`，**不是** `react-router-dom`。
- `<BrowserRouter>` 只在 `apps/web/src/main.tsx` 出现一次；`apps/web/src/App.tsx` 只声明路由树。
- 使用 history 模式（`BrowserRouter`），不是 hash 模式。
- 共享布局层是 `apps/web/src/routes/RootLayout.tsx`，提供站点顶栏、认证弹窗、设置面板与 `<Outlet />`；登录、注册和 SSO 页面使用独立布局。
- `apps/web/src/App.tsx` 是路由表入口；`*` 只处理前端路由，不替代 Server 的 404 envelope。

## 理由

- 声明式 API 不引入 `loader` / `action`，因此不会在 Contract 还没有业务 operation 时就催生前端数据层。
- 同一个包内从声明式升级到 data router 的代价很低，现在不需要为未来预建结构。
- `react-router-dom` 的发版停在 `7.18.4`，v8 已把它合并进 `react-router`，且官方声明 v7 → v8 为非破坏性升级。使用 `react-router` 可以避免绑定一个停止发版的包名。
- 共享布局提供嵌套路由挂载点，站点顶栏和弹窗在页面间保持一致。

## 影响

- **未来部署 Web 时必须把未知路径回落到 `index.html`。** history 路由下，缺少 SPA fallback 会让深链接由服务端直接 404；SPA 若不在域名根路径，还需要 `basename`。
- `pnpm test` 已包含 `packages/components/src/` 的前端组件测试，以及 Contract、业务和 PostgreSQL 集成测试。路由变化仍需按影响范围验证页面导航与深链接。
- 新增前端页面时，`apps/web/src/App.tsx` 的路由表是入口；共享布局在 `apps/web/src/routes/RootLayout.tsx`。

## 重新审视的条件

- 需要路由级数据加载（`loader` / `action`）或路由级错误边界时。
- 需要按路由做代码分割时。
- 部署形态确定后，需要配置 `basename` 或改选 hash 模式时。
- 路由级交互测试覆盖要求增加时，核对现有组件测试与真实浏览器验证的边界。

## 证据

- `apps/web/src/App.tsx`、`apps/web/src/main.tsx`、`apps/web/src/routes/RootLayout.tsx`、`apps/web/src/pages/Home.tsx`、`apps/web/src/pages/NotFound.tsx`。
- `apps/web/package.json` 的 `react-router ^8.4.0`。
- `packages/components/src/SiteHeader.test.tsx` 等前端组件测试与 `vitest.config.ts` 的测试配置。
