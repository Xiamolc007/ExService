# Contract Test 与 PostgreSQL 测试层次

Contract Test 对真实 Fastify app 的 HTTP 行为、Glue 映射和原始 handler 输出分别断言；数据库行为测试使用独立 PostgreSQL 容器。单条断言的失败模式见 `.ai/knowledge/mock-server/serialization-masks-handler-regressions.md` 与 `.ai/knowledge/contract-tests/contract-parsing-constraints.md`。

_最后更新：2026-09-29_

## 隔离夹具

`tests/helpers/postgres.ts` 启动临时 PostgreSQL Testcontainers 容器，库名为 `exre`，每例创建独立 schema 和同 schema 的 migration journal。夹具不读取本机 `DATABASE_URL`，用例结束关闭连接并清理 schema，测试进程结束时停止容器。Docker 不可用时数据库测试失败，不回退到本机 `exre` 或 `outline`。

`tests/helpers/auth.ts` 异步创建业务服务和真实 `createApp()` 实例。常规 HTTP 用 `app.inject()`；生成 Client/multipart 与连接生命周期测试绑定随机本机端口。测试不把开发库已迁移当作夹具结果。

## HTTP 与 schema

| 层 | 覆盖目的 |
| --- | --- |
| Contract 双向覆盖 | `operationId` 与 `serviceHandlers` 两边都无缺漏或多余映射。 |
| HTTP 响应 | `/api` 前缀、状态、header、错误 envelope 和响应 schema；Bearer 异步验证在 handler 前完成。 |
| 原始 handler 输出 | 检查序列化前结果，发现 Fastify 静默丢弃字段或强制 `const` 掩盖的回归。 |
| schema 反例 | 证明缺字段、额外字段、错误类型和 `const` 冲突受到校验。 |
| 日志与传输 | 真实日志流不泄密；multipart 字节、摘要、容量与断开连接回收。 |

schema 直接来自 `api/openapi.yaml`，测试不复制 DTO。跨多步业务测试覆盖申请、审核、验证码、完善、登录、资料与头像；PostgreSQL 专项测试覆盖空库迁移、重复迁移、错误目标拒绝、半迁移、未知对象重置拒绝、约束、事务回滚及双连接竞争。自动测试证明隔离容器中的行为；本机迁移与真实服务冒烟另行验证。
