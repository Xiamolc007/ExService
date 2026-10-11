# Contract Test 与 PostgreSQL 测试层次

Contract Test 对真实 Fastify app 的 HTTP 行为、Glue 映射和原始 handler 输出分别断言；数据库行为测试使用独立 PostgreSQL 容器。单条断言的失败模式见 `.ai/knowledge/server/serialization-masks-handler-regressions.md` 与 `.ai/knowledge/contract-tests/contract-parsing-constraints.md`。

_最后更新：2026-10-11_

## 隔离夹具

`tests/helpers/postgres.ts` 使用 `infra/runtime/images.lock.json` 的 PG18 镜像启动临时 PostgreSQL Testcontainers 容器，库名为 `exre`，每例创建独立 schema 和同 schema 的 migration journal。夹具不读取本机 `DATABASE_URL`，用例结束关闭连接并清理 schema，测试进程结束时停止容器。Docker 不可用时数据库测试失败，不回退到本机 `exre` 或 `outline`。

`tests/helpers/auth.ts` 异步创建业务服务和真实 `createApp()` 实例。常规 HTTP 用 `app.inject()`；生成 Client/multipart 与连接生命周期测试绑定随机本机端口。测试不把开发库已迁移当作夹具结果。

## HTTP 与 schema

| 层 | 覆盖目的 |
| --- | --- |
| Contract 双向覆盖 | `operationId` 与各模块 `api/operations.ts`、`apps/server/src/http/system/operations.ts` 汇总的 `serviceHandlers` 两边都无缺漏或多余映射；应用启动前也检查覆盖。 |
| HTTP 响应 | `/api` 前缀、状态、header、错误 envelope 和响应 schema；Bearer 异步验证在 handler 前完成。 |
| 原始 handler 输出 | 检查序列化前结果，发现 Fastify 静默丢弃字段或强制 `const` 掩盖的回归。 |
| schema 反例 | 证明缺字段、额外字段、错误类型和 `const` 冲突受到校验。 |
| 日志与传输 | 真实日志流不泄密；multipart 字节、摘要、容量与断开连接回收。 |

schema 经 `tests/helpers/contract.ts` 从 `api/generated/openapi.json` 读取，测试不复制 DTO。读器的引用、路径和 operation 约束见 `.ai/knowledge/contract-tests/contract-parsing-constraints.md`。跨多步业务测试覆盖申请、审核、验证码、完善、登录、资料与头像；PostgreSQL 专项测试覆盖空库迁移、重复迁移、错误目标拒绝、半迁移、未知对象重置拒绝、约束、事务回滚及双连接竞争。自动测试证明隔离容器中的行为；本机迁移与真实服务冒烟另行验证。

## 文档集成的测试边界

根 `vitest.config.ts` 只包含 Website 自有测试路径，并显式排除 `apps/outline/`、`vendor/` 和 `output/`；Outline 使用自己的 Yarn 测试项目。`scripts/runtime/tests.mjs` 每轮先生成 Contract，再统一执行 Website、当前 runtime/共享 Docs 逻辑与 `scripts/runtime/test-manifest.mjs` 的定制 Outline 清单；`scripts/api/generate.test.mjs` 纳入默认脚本测试。旧模式专属文件和真实生命周期验收不加入默认测试。Website 分组限制为两个 worker，减少独立数据库容器和 CPU 争用，全部文件与断言仍执行。前端按 app、shared-node、shared-jsdom 分别选文件，DOM 用例只运行在 jsdom。

`scripts/docs-integration/test-outline.mjs` 仅接受一条 `server/` 或 `plugins/` 测试文件路径及一个以上原样例名。它为每个指定例分别创建临时 PG18、Redis 与附件目录，执行完整 Outline migration，使用仅保留操作系统和包缓存变量的环境白名单及隔离的身份配置；测试要求恰好一个指定用例通过，无匹配、重复匹配、未处理错误或准备失败均失败。注入标记禁止读取 Outline 子目录 dotenv，必需的 URL 也由测试夹具提供。不要用 Outline 默认测试环境或本机开发库替代该入口。自动测试与真实浏览器、socket、数据库恢复及服务器验收分开报告。
