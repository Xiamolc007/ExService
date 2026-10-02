# 决策索引

本索引记录已接受决策及被取代的历史选择。数据库专属决策集中于 `.ai/databases/decisions/`；当前结构见 `.ai/architectures/overview.md`，文档集成结构见 `.ai/architectures/docs-integration/integration-boundaries.md`。本次集成没有另建决定条目，运行边界以源码和上述架构页为准。

_最后更新：2026-10-01_

| 决策 | 模块 | 状态 |
| --- | --- | --- |
| `.ai/decisions/api/01-openapi-as-single-contract.md` | API | Contract 原则继续适用；早期接管动机属于历史背景。 |
| `.ai/decisions/api/02-draft07-compatible-schema-subset.md` | API | 已接受。 |
| `.ai/decisions/api/03-unified-error-envelope.md` | API | 已接受。 |
| `.ai/decisions/api/04-separate-local-session-and-sso-completion.md` | API | 已接受。 |
| `.ai/decisions/api-client/01-generated-types-committed-and-read-only.md` | Client | 已接受。 |
| `.ai/decisions/components/01-app-level-shared-component-package.md` | UI | 已接受。 |
| `.ai/decisions/mock-server/01-contract-driven-route-registration.md` | Server | 已接受，原目录名保留。 |
| `.ai/databases/decisions/02-fixed-local-sqlite-database.md` | 数据库 | 已被 PostgreSQL 决策取代。 |
| `.ai/databases/decisions/03-database-changes-only-by-explicit-command.md` | 数据库 | 已接受，执行细节已更新。 |
| `.ai/decisions/mock-server/04-safe-error-messages.md` | Server | 已接受。 |
| `.ai/decisions/mock-server/05-normalize-new-avatars-to-512-square.md` | Server | 已实现。 |
| `.ai/databases/decisions/06-implicit-ordinary-explicit-admin-membership.md` | 数据库 | 已接受。 |
| `.ai/databases/decisions/07-independent-postgresql-exre-database.md` | 数据库 | 已接受并在开发环境实现。 |
| `.ai/decisions/web/01-shared-client-with-configurable-base-url.md` | Web | Client 配置原则继续适用。 |
| `.ai/decisions/web/02-react-route-skeleton.md` | Web | 已接受。 |
| `.ai/decisions/web/03-exui-as-component-and-theme-source.md` | Web | 已接受。 |
| `.ai/decisions/web/04-settings-state-separate-from-auth-context.md` | Web | 已实现。 |
| `.ai/decisions/contract-tests/01-assert-raw-handler-output.md` | 测试 | 已接受。 |
| `.ai/decisions/contract-tests/02-contract-as-sole-schema-source.md` | 测试 | 已接受。 |

过时决策保留当时理由，但其旧运行指令不适用于当前 Server。公网部署、共享头像和限流、真实邮件、人机验证、备份恢复与监控仍需后续独立设计。
