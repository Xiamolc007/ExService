# Server 请求生命周期与数据边界

本文件描述 `apps/server/` 从创建应用到返回响应，以及 PostgreSQL 的显式迁移边界。业务数据规则见 `.ai/databases/data-model.md`。

_最后更新：2026-10-08_

## 组装与请求

`apps/server/src/app.ts` 读取 `api/openapi.yaml`，注入认证、资料、申请和邀请服务，以及可选的集成身份服务，以 `fastify-openapi-glue` 注册 `/api` 前缀、`serviceHandlers` 与 Bearer/服务间密钥 security handler。`createApp()` 可供测试使用而不监听端口；`apps/server/src/server.ts` 拥有连接池、可选 outbox worker 和监听生命周期。Contract Test 直接读取导出的 `serviceHandlers`，校验序列化前的原始结果。Fastify 的 schema 序列化可能掩盖 handler 漂移，见 `.ai/knowledge/server/serialization-masks-handler-regressions.md`。

Glue 的 Bearer handler 等待异步会话验证后才把身份交给受保护 operation；服务间 operation 另用明确配置的调用方密钥。HTTP handler 等待服务结果后再设置响应状态与附件 header。错误统一由 `apps/server/src/errors.ts` 构造 envelope，未知数据库错误不回显 SQL、连接串或驱动消息。普通开发模式默认监听 `127.0.0.1:8080`；集成开发模式由 `SERVER_HOST` 和 `SERVER_PORT` 配置容器可达地址，公共 gateway 不暴露内部身份路径。

## 数据库连接与事务

`apps/server/src/db/client.ts` 从 `DATABASE_URL` 打开 `pg` 连接池。URL 的数据库名必须为 `exre`，连接后还验证 `current_database()` 与 schema。服务通过异步参数化 `query` 和 `transaction(callback)` 访问数据库；事务回调的查询共用一个 PostgreSQL 客户端，统一提交、回滚和释放。跨语句只读状态查询使用一致快照；毫秒 `bigint` 和计数在数据库边界安全转换为 JavaScript 整数，超出安全范围即失败。服务关闭时释放连接池。

## 启动与显式命令

`apps/server/src/server.ts` 在监听前校验数据库身份、migration journal、必需表和配置。缺失或不完整时失败，并提示显式运行 `pnpm db:migrate`；启动不创建数据库、建表、迁移或重置。

| 命令 | 行为 |
| --- | --- |
| `pnpm db:migrate` | 对已存在的 `exre` 应用 `apps/server/drizzle/` 的 PostgreSQL 基线或未执行迁移；完成后复核结构。 |
| `pnpm db:reset -- --confirm exre` | 开发专用：仅接受回环地址、`exre` 和显式确认；拒绝非本应用对象，清理应用表及 journal 后重跑基线；不删除头像。 |
| `pnpm --filter @workspace/server db:generate` | 从 `apps/server/src/db/schema.ts` 生成候选 migration；需审阅 SQL 与约束。 |

`apps/server/src/db/migrate.ts` 和 `apps/server/src/db/reset.ts` 是不可 import 的 CLI 入口。共享逻辑分别在 `apps/server/src/db/migration-runner.ts`、`apps/server/src/db/reset-plan.ts`；运行时不会导入带写入副作用的 CLI。`apps/server/drizzle.config.ts` 供 Drizzle Kit 生成使用，运行迁移由显式 CLI 触发。

## 测试隔离

`tests/helpers/postgres.ts` 启动独立 PostgreSQL Testcontainers 容器，容器库名也为 `exre`。数据库用例各自创建 schema，在其内隔离业务表与 migration journal，并在结束时关闭连接、删除 schema 和容器；夹具不读取本机 `DATABASE_URL`。Docker 不可用时，数据库测试明确失败，不回退到开发库。
