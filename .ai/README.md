# ExWebsite 持久知识库

本目录记录源码难以直接表达的模块边界、已接受决策、数据规则与运行陷阱。仓库以 `api/openapi.yaml` 为唯一 HTTP Contract；`apps/server/` 是唯一 Fastify Server，使用独立 PostgreSQL `exre`。当前仍是单实例开发阶段，不代表已可公网部署。

_最后更新：2026-10-02_

## 模块与入口

| 模块 | 代码路径 | 知识入口 |
| --- | --- | --- |
| API Contract | `api/` | `.ai/architectures/api/contract-layout.md` |
| 生成式 Client | `packages/api-client/` | `.ai/decisions/api-client/01-generated-types-committed-and-read-only.md` |
| 共享组件 | `packages/components/` | `.ai/knowledge/components/ex-message-host-lifecycle.md` |
| Web | `apps/web/` | `.ai/architectures/web/authentication-flow.md` |
| Server | `apps/server/` | `.ai/architectures/mock-server/request-lifecycle.md`、`.ai/architectures/mock-server/authentication-lifecycle.md` |
| 存储与 SDK | `apps/server/src/modules/storage/`、`packages/sdk/` | `.ai/knowledge/storage/lifecycle-traps.md` |
| 文档集成 | `apps/outline/`、`infra/docs-integration/`、`scripts/docs-integration/` | `.ai/architectures/docs-integration/integration-boundaries.md` |
| Contract Test | `tests/contract/` | `.ai/architectures/contract-tests/test-layers.md` |

跨模块结构见 `.ai/architectures/overview.md`；业务术语见 `.ai/CONTEXT.md`；账号、申请与邀请数据规则见 `.ai/databases/data-model.md`；决策索引见 `.ai/decisions/README.md`。`mock-server` 文件夹名保留为早期文档位置，文内以当前 Server 为准。

## 知识归属

| 位置 | 内容 |
| --- | --- |
| `.ai/CONTEXT.md` | 领域语言与术语。 |
| `.ai/architectures/` | 结构、依赖方向、请求与控制流。 |
| `.ai/decisions/`、`.ai/databases/decisions/` | 已接受选择及原因；过时选择标明取代关系。 |
| `.ai/knowledge/`、`.ai/databases/knowledge/` | 非显而易见的运行约束与失败模式。 |
| `.ai/databases/data-model.md` | 表的业务职责与数据规则，不复制物理 schema。 |
| `.ai/rules/` | `AGENTS.md` 指定的专项开发规则。 |

同一长期事实只在一个知识位置维护，其他文件引用它。设计、RFC 与实施计划保留在 `.notes/`；历史档案记录其当时背景，不作为当前运行指南。

## 核对来源

当前行为以 `api/openapi.yaml`、`package.json`、`apps/server/src/`、`apps/server/drizzle/`、`apps/web/src/` 和 `tests/` 为准。数据库目标与显式命令见 `.notes/archive/server-promotion/specs/2026-09-29-server-promotion-design.md` 与 `.notes/archive/server-promotion/rfcs/server-postgresql-migration-rfc.md`。文档不记录一次性任务输出、工作树状态或未经验证的生产能力。
