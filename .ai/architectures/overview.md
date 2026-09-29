# 跨模块架构总览

本文件说明 ExWebsite 当前开发拓扑。HTTP 形状以 `api/openapi.yaml` 为准；Server 请求与数据库生命周期见 `.ai/architectures/mock-server/request-lifecycle.md`，数据规则见 `.ai/databases/data-model.md`。

_最后更新：2026-09-29_

## 系统结构

```text
api/openapi.yaml ──api:generate──▶ packages/api-client ──▶ apps/web
       │                                                    │
       └──fastify-openapi-glue──▶ apps/server ◀──/api 代理──┘
                                    │
                                    ├──业务服务──▶ PostgreSQL exre
                                    └──头像文件──▶ apps/server/data/avatars/
```

`apps/server/` 是本仓库唯一 Server。Contract 不依赖实现；Fastify 只注册带 `operationId` 的 operation，前端只经共享 Client 发请求。当前为单实例开发拓扑，公网部署能力仍需后续设计。

## 模块边界

| 路径 | 责任 |
| --- | --- |
| `api/` | 唯一 HTTP Contract：路径、operation、请求/响应/错误 schema。 |
| `packages/api-client/` | 生成的类型和 `createApiClient({ baseUrl })`。 |
| `packages/components/` | 基于 ExUI 的应用级共享 UI。 |
| `apps/web/` | Vite/React 前端、路由、主题和 Client 接入。 |
| `apps/server/` | Contract 路由、业务服务、受控 PostgreSQL 访问。 |
| `tests/contract/` | 对真实 Fastify app 的 HTTP 行为与原始 handler 输出做验证。 |

## 依赖与构建

- `packages/api-client` 和 `packages/components` 以源码导出，供消费方打包器编译。
- TypeScript 别名由 `tsconfig.base.json` 声明；Vite 与 Vitest 分别配置解析。Server 构建由 `scripts/rewrite-server-imports.mjs` 把别名改写为产物内相对引用。
- 根命令位于 `package.json`；Server 运行时依赖属于 `apps/server/package.json`。

## 前端请求流

1. `apps/web/src/api/client.ts` 读取 `VITE_API_BASE_URL`，缺省 `/api`，创建共享 Client。
2. 开发期 Vite 将 `/api/*` 代理至本机 `127.0.0.1:8080`，保留 `/api` 前缀；Server 的 Glue 注册该前缀。
3. `apps/web/src/main.tsx` 在开发模式调用健康 operation 检查连通性；失败仅记录开发错误。

前端页面由单个 React router 管理。`apps/web/src/main.tsx` 的 ExUI `ThemeProvider` 包住整个路由树，并且只在该入口导入一次 `@exre/exui/style.css`。深链接部署时仍需 SPA fallback，见 `.ai/decisions/web/02-react-route-skeleton.md`。

## 新增 operation

先修改 `api/openapi.yaml`，运行 `pnpm api:lint` 与 `pnpm api:generate`；再更新 `apps/server/src/app.ts` 的 `serviceHandlers`、对应 handler 和 `tests/contract/` 的 HTTP 与原始输出断言。前端经 `@workspace/api-client` 调用，最后运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。覆盖原因见 `.ai/knowledge/mock-server/operation-registration-gaps.md` 和 `.ai/knowledge/mock-server/serialization-masks-handler-regressions.md`。

## 数据库边界

`DATABASE_URL` 必须指向独立的 PostgreSQL `exre`。启动只验证目标身份、migration journal 和必需结构；显式 `pnpm db:migrate` 才应用迁移。开发专用 `db:reset` 要求 `--confirm exre`，校验回环地址和对象归属。自动测试使用独立 PostgreSQL 容器及逐用例 schema，不连接开发库。详见 `.ai/architectures/mock-server/request-lifecycle.md` 与 `.ai/databases/knowledge/database-lifecycle-traps.md`。
