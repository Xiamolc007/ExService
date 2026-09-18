# 跨模块架构总览

本文件说明 ExWebsite 的整体结构与请求流。单个模块的内部结构见各模块目录下的文档。

_最后更新：2026-09-18_

## 系统结构

Contract 是唯一的中心节点，所有其他部分都是它的消费者：

```text
                         api/openapi.yaml
                      （唯一 API Contract）
                               │
        ┌──────────────────────┼──────────────────────┐
        │                      │                      │
        ▼                      ▼                      ▼
 pnpm api:generate      fastify-openapi-glue    未来 PHP 实现
        │                      │                      │
        ▼                      ▼                      ▼
 packages/api-client     apps/mock-server        PHP + MySQL
        │                      │                （不在本仓库）
        ▼                      ▼
 apps/web ──/api 代理──▶ Fastify 路由 ──▶ handler ──▶ Drizzle ──▶ SQLite
```

依赖方向是单向的：Contract 不依赖任何实现；实现侧不反向定义 Contract。

## 模块边界

| 路径 | 责任 | 禁止事项 |
| --- | --- | --- |
| `api/` | 定义 HTTP 路径、operation、请求/响应/错误 schema。 | 存放前端或服务端实现。 |
| `packages/api-client/` | 导出生成的类型与 `createApiClient({ baseUrl })` 工厂。 | 引入 React、Valtio、Framer Motion、业务状态或 endpoint 定义。 |
| `packages/components/` | 应用级共享 UI 组件（站点顶栏等），基于 ExUI 组装。 | 直接使用 `fetch`、import `@workspace/api-client`、import `@exre/exui/style.css`、定义路由表。 |
| `apps/web/` | 配置 Vite、SCSS、环境变量，声明前端路由表与主题来源，并适配共享 Client。 | 直接调用浏览器 `fetch`、复制 DTO、臆造 endpoint。 |
| `apps/mock-server/` | 加载 Contract、映射 operation handler、执行受控的 SQLite 访问。 | 用 `app.get()` 绕过 Contract、把 schema 写成第二份 API 定义、连接生产数据库。 |
| `tests/contract/` | 从 Contract 读取 schema，对真实 Fastify app 的 HTTP 响应做验证。 | 只单测 handler 而跳过路由与 schema 注册。 |

## 依赖与构建边界

- `packages/api-client` 与 `packages/components` 都以**源码形式**导出（`exports` 直接指向 `src/index.ts`），由消费方的打包器编译，因此没有自己的构建步骤。
- 它们是**为打包器准备的包**，不是 Node 运行时包：内部使用无扩展名的相对 import，Node ESM 不接受这种说明符。若将来需要在 Node 侧复用，必须补充真正的构建产物与 `exports` 条件，或统一改为显式扩展名。
- `packages/components` 的 `react` / `react-dom` / `react-router` 同时声明为 peer 与 dev 依赖：peer 保证消费方单一实例与 context 共享，dev 供本包 `typecheck` 使用。`@exre/exui` 与 `lucide-react` 是普通依赖。
- 根 `package.json` 只承载跨工作区的命令与工具依赖，不含运行时依赖；运行时依赖按上表的边界声明在各自包内。

## 前端请求流（开发期）

1. `apps/web/src/api/client.ts` 解析 `VITE_API_BASE_URL`，缺省 `/api`，据此创建唯一的共享 Client 实例。
2. Vite 把 `/api/*` 转发到 `http://127.0.0.1:8080`，并且**不做 rewrite**：`/api` 前缀由 Mock Server 自己注册。
3. `apps/web/src/main.tsx` 在 `import.meta.env.DEV` 下经共享 Client 调用 `GET /health`，作为启动期连通性检查；失败只记录开发错误，不渲染任何面板或业务 UI。
4. 切换到生产实现时，只把 `VITE_API_BASE_URL` 指向 PHP 的 `/api` 前缀，业务调用点与共享 Client 都不改动。

## 前端页面结构

`apps/web` 的挂载点只有一个 router 实例，路由表与实际页面分离：

```text
main.tsx ──<BrowserRouter>──▶ App.tsx（路由表）
   │                              │
   │                              ▼
   │                   routes/RootLayout.tsx
   │                     ├── <SiteHeader />（packages/components）
   │                     └── <Outlet />
   │                              │
   │                 ┌────────────┴────────────┐
   │                 ▼                         ▼
   │         pages/Home.tsx  `/`      pages/NotFound.tsx  `*`
   │
   └── <ThemeProvider>（@exre/exui）包住整个路由树
       导入 `@exre/exui/style.css`，全应用仅此一处
```

- 只有这两条路由；`*` 只处理前端路由，不替代 Mock Server 的 404 envelope。
- 布局层提供嵌套路由的挂载点与站点顶栏。顶栏在这里而不是各页面里，因此所有路由共用、页面切换时不重新挂载。
- 主题来源是 ExUI 的 `ThemeProvider`，挂在路由之上，所以所有页面（含兜底页）都能用 `useTheme`。`@exre/exui/style.css` 必须排在 `styles/index.scss` 之前，应用样式才能覆盖库的默认值。
- 代价是 history 路由要求未来的 PHP 部署把未知路径回落到 `index.html`。理由见 [[web/02-react-route-skeleton]]；顶栏归属与 ExUI 引入见 [[web/03-exui-as-component-and-theme-source]] 与 [[components/01-app-level-shared-component-package]]。

## 扩展点：新增一个 operation

新增 API 的唯一入口是 Contract。落地顺序（与 `AGENTS.md` 一致）为：

1. 修改 `api/openapi.yaml`。
2. `pnpm api:lint`。
3. `pnpm api:generate`，重新生成 `packages/api-client/src/generated/schema.d.ts`。
4. 实现或更新 Mock Server 的 handler，并在 `apps/mock-server/src/app.ts` 的 `serviceHandlers` 中登记。
5. 在 `tests/contract/` 增加对应的 Contract Test。
6. 前端经 `@workspace/api-client` 调用。
7. `pnpm typecheck && pnpm test && pnpm build`。

第 4 步和第 5 步都不能省：漏登记 handler 只会让新路由在运行时返回 500，既有断言仍然全绿；只断言 HTTP 响应体也看不到 handler 的回归。原因见 [knowledge/mock-server](../knowledge/mock-server/serialization-masks-handler-regressions.md)。

## 数据库边界

本地 Mock 数据库固定在 `apps/mock-server/data/mock.sqlite`，只服务于本地 Mock 环境。它不连接、不共享 PHP/生产数据库，也不接受任意数据库路径或任意文件删除入口。其生命周期与命令语义见 [architectures/mock-server/request-lifecycle.md](mock-server/request-lifecycle.md) 与 [[mock-server/03-database-changes-only-by-explicit-command]]。
