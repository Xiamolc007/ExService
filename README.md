# ExWebsite

ExWebsite 使用单份 OpenAPI Contract 连接 Web、生成式 API Client 与唯一 Fastify Server。Server 将业务数据保存在独立的 PostgreSQL `exre` 数据库。当前项目仍处开发阶段；本地运行成功不代表已具备公网部署条件。

## 本地启动

需要 Node.js 22.12+、pnpm 11.9.0、PostgreSQL，以及运行数据库测试时可用的 Docker。

1. 在 PostgreSQL 中创建独立的空数据库 `exre`；不要使用 `outline`。应用不会自动创建数据库。
2. 复制 `apps/server/.env.example` 为未跟踪的 `apps/server/.env.local`，填写本机 `DATABASE_URL`、`AUTH_CODE_HMAC_KEY` 和公开 URL 配置。连接串必须明确指向 `exre`，不要提交凭据。
3. 在仓库根目录运行：

   ```bash
   pnpm install
   pnpm api:lint
   pnpm api:generate
   pnpm db:migrate
   pnpm dev
   ```

`pnpm dev` 启动本机 `127.0.0.1:8080` 的 Server 与 `8081` 的 Web。Web 缺省经 `/api` 代理调用 Server；启动不运行 migration 或 reset。数据库缺迁移时先显式运行 `pnpm db:migrate`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm api:lint` | 校验 `api/openapi.yaml`。 |
| `pnpm api:generate` | 从 Contract 生成 Client 类型；不要手改生成文件。 |
| `pnpm typecheck` | 检查工作区 TypeScript。 |
| `pnpm test` | 运行 Vitest；数据库用例使用独立 PostgreSQL Testcontainers 容器与逐用例 schema。 |
| `pnpm build` | 构建 Web 和 Server。 |
| `pnpm db:migrate` | 对已存在的 `exre` 显式应用 PostgreSQL migration。 |
| `pnpm db:reset -- --confirm exre` | 开发专用，核验目标和对象后重建应用结构；不删除头像文件。 |

数据库测试在 Docker 不可用时应明确失败，不会回退到本机 `exre` 或 `outline`。`db:reset` 会清除 `exre` 内本应用数据，运行前核对目标。

## 代码与契约

- `api/openapi.yaml` 是唯一 HTTP Contract；Server 只注册带 `operationId` 的 operation。
- `apps/server/` 实现认证、资料、加入申请、邀请和本机头像文件；PostgreSQL 结构位于 `apps/server/src/db/schema.ts` 与 `apps/server/drizzle/`。
- `packages/api-client/` 提供生成的类型与共享 Client；`apps/web/` 只经它访问 API。
- `tests/contract/` 验证真实 Fastify 路由、错误 envelope 与 handler 的原始返回值。

开发约束见 `AGENTS.md`；系统边界、数据规则和历史决策见 `.ai/README.md`。Server 正式化设计与技术细节见 `.notes/server-promotion/specs/2026-09-29-server-promotion-design.md` 和 `.notes/server-promotion/rfcs/server-postgresql-migration-rfc.md`。
