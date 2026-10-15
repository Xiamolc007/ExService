# 跨模块架构总览

本文件说明 ExWebsite 当前开发拓扑。HTTP 形状以 `api/openapi.yaml` 为准；Server 请求与数据库生命周期见 `.ai/architectures/server/request-lifecycle.md`，数据规则见 `.ai/databases/data-model.md`。

_最后更新：2026-10-15_

## 系统结构

```text
api/openapi.yaml + api/paths/ + api/schemas/
       │
       └──api:generate──▶ api/generated/openapi.json ──▶ apps/server
                                  │                            │
                                  └──Client 类型──▶ apps/web ──/api 代理──┘
                                                               │
                                                               ├──业务服务──▶ PostgreSQL exre
                                                               └──头像文件──▶ apps/server/data/avatars/
```

上图是 Website 业务请求链；`apps/server/` 是唯一 Website Fastify Server。Contract 不依赖实现；Fastify 只注册带 `operationId` 的 operation，Website 前端只经共享 Client 发请求。当前仍是本地开发拓扑，公网部署能力需后续设计。

普通开发入口保留 Website 与 Hydra 身份服务，`/api` 仍归 Fastify。`/docs`、`/docs/` 由 Website 的 `apps/web/src/pages/DocsPage/` 在 RootLayout 内公开显示“文档建设中”；其他 `/docs/*` 使用既有 404，Document 导航使用内部路由。文档数据、编辑、协作与代理已退役，不借此接入新的文档系统。身份协议边界见 `.ai/architectures/identity/integration-boundaries.md`。

## 模块边界

| 路径 | 责任 |
| --- | --- |
| `api/` | 唯一 HTTP Contract 的源文件与统一生成的 JSON。 |
| `packages/api-client/` | 生成的类型和 `createApiClient({ baseUrl })`。 |
| `packages/components/` | 基于 ExUI 的应用级共享 UI。 |
| `apps/web/` | Vite/React 前端、路由、主题和 Client 接入。 |
| `apps/server/` | `modules/` 公共能力、`domains/` 具体流程、统一 HTTP/Glue 入口与受控 PostgreSQL 访问。 |
| `packages/common/` | runtime 与 Server 经 `@workspace/common/node/identity-config` 共用纯客户端配置验证与部署绑定投影；消费规则见 `.agents/rules/package-common.md`。 |
| `tests/contract/` | 对真实 Fastify app 的 HTTP 行为与原始 handler 输出做验证。 |

## 依赖与构建

- `packages/api-client` 和 `packages/components` 以源码导出，供消费方打包器编译。
- TypeScript 别名由 `tsconfig.base.json` 声明；Vite 与 Vitest 分别配置解析。Server 构建由 `scripts/rewrite-server-imports.mjs` 把别名改写为产物内相对引用。
- 根命令位于 `package.json`；Server 运行时依赖属于 `apps/server/package.json`。

## 开发进程

根目录 `pnpm dev` 经 `scripts/runtime/entry.mjs` 和 `applications.mjs` 监督应用；依赖由独立服务入口管理，普通运行只读核对准备状态。运行配置、资源归属与维护边界见 `.ai/architectures/runtime/runtime-boundaries.md`；身份客户端与请求边界见 `.ai/architectures/identity/integration-boundaries.md`。首次使用步骤见 `README.md`。正常运行与构建证明不替代真实浏览器或公网部署验收。

## 前端请求流

1. `apps/web/src/api/client.ts` 读取 `VITE_API_BASE_URL`，缺省 `/api`，创建共享 Client。
2. 开发期 Vite 将 `/api/*` 代理至本机 Website Server，保留 `/api` 前缀；Server 的 Glue 注册该前缀。根命令注入代理目标，单独启动 Web 时使用配置的缺省目标。
3. `apps/web/src/main.tsx` 在开发模式调用健康 operation 检查连通性；失败仅记录开发错误。

前端页面由单个 React router 管理。`apps/web/src/main.tsx` 的 ExUI `ThemeProvider` 包住整个路由树，并且只在该入口导入一次 `@exre/exui/style.css`。深链接部署时仍需 SPA fallback，见 `.ai/decisions/web/02-react-route-skeleton.md`。

## 新增 operation

先修改 `api/openapi.yaml` 及相关 `api/paths/`、`api/schemas/` 源文件，运行 `pnpm api:lint`、`pnpm api:generate` 与 `pnpm api:check`；再更新所属模块的 `api/operations.ts` 和 handler，`apps/server/src/http/service-handlers.ts` 显式汇总映射。同步增加 `tests/contract/` 的 HTTP 与原始输出断言。前端经 `@workspace/api-client` 调用，最后运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。覆盖原因见 `.ai/knowledge/server/operation-registration-gaps.md` 和 `.ai/knowledge/server/serialization-masks-handler-regressions.md`。

## 数据库边界

`DATABASE_URL` 必须指向独立的 PostgreSQL `exre`。启动只验证目标身份、migration journal 和必需结构；显式 `pnpm db:migrate` 才应用迁移。开发专用 `db:reset` 要求 `--confirm exre`，校验回环地址和对象归属。自动测试使用独立 PostgreSQL 容器及逐用例 schema，不连接开发库。详见 `.ai/architectures/server/request-lifecycle.md` 与 `.ai/databases/knowledge/database-lifecycle-traps.md`。
