# ExWebsite 的 AI 知识库

本目录是 ExWebsite 的持久知识库入口。仓库本身是一个 **Contract-first 的本地 Backend Sandbox**：`api/openapi.yaml` 是唯一的 HTTP API Contract，Fastify + SQLite 是本地开发实现，未来的 PHP + MySQL 是生产实现。

本站只记录**阅读代码无法直接得到**的知识：模块边界与依赖方向、已接受决策及其理由、以及源码中看不出的失败模式。Task 进行中的状态、版本控制状态与源码的直接复述都不在这里。

_最后更新：2026-09-17_

## 模块划分

模块取自仓库的真实边界：`pnpm-workspace.yaml` 声明的工作区包、顶层目录与部署单元。新增文档时请复用下表中的目录名，不要另创模块。

| 模块 | 仓库路径 | 责任 | 本站文档 |
| --- | --- | --- | --- |
| `api` | `api/` | 定义唯一的 HTTP API Contract：路径、operation、请求/响应/错误 schema。 | [architectures/api/contract-layout.md](architectures/api/contract-layout.md) · [decisions/api](decisions/README.md) |
| `api-client` | `packages/api-client/` | 导出 Contract 生成的类型与 `createApiClient({ baseUrl })` 工厂。 | [architectures/overview.md](architectures/overview.md) · [decisions/api-client](decisions/README.md) |
| `mock-server` | `apps/mock-server/` | 按 Contract 注册 Fastify 路由、实现 handler、执行受控的本地 SQLite 访问。 | [architectures/mock-server/request-lifecycle.md](architectures/mock-server/request-lifecycle.md) · [decisions/mock-server](decisions/README.md) · [knowledge/mock-server](knowledge/mock-server/database-lifecycle-traps.md) |
| `web` | `apps/web/` | Vite/React 前端外壳：决定 API base URL，并在开发期经代理访问 Mock Server。 | [architectures/overview.md](architectures/overview.md) · [decisions/web](decisions/README.md) · [knowledge/web](knowledge/web/api-base-url-and-proxy-traps.md) |
| `contract-tests` | `tests/contract/` | 以真实 Fastify app 的 `inject()` 验证 HTTP Contract，而不是单测 handler。 | [architectures/contract-tests/test-layers.md](architectures/contract-tests/test-layers.md) · [decisions/contract-tests](decisions/README.md) · [knowledge/contract-tests](knowledge/contract-tests/contract-parsing-constraints.md) |

`api-client`、`web` 目前没有独立的架构文档：它们的结构由 [architectures/overview.md](architectures/overview.md) 一并说明。只在该模块出现第一份文档时才创建模块子目录。

## 导航

- [CONTEXT.md](CONTEXT.md) — 领域语言（ubiquitous language）。
- [architectures/overview.md](architectures/overview.md) — 跨模块结构与请求流。
- [decisions/README.md](decisions/README.md) — 已接受决策的索引。
- `knowledge/<module>/` — 非显而易见的运行行为：失败模式、运行约束、集成陷阱。

## 每类知识的归属

| 位置 | 记录什么 | 不记录什么 |
| --- | --- | --- |
| `CONTEXT.md` | 领域词汇：每个规范术语的含义，以及应避免的说法。 | 实现选择、API 形状、字段列表、模块名。 |
| `architectures/<module>/` | 系统结构：组件边界、依赖方向、请求与控制流、扩展点。 | 选择背后的理由、失败模式。 |
| `decisions/<module>/` | 为什么这样选：背景、替代方案、理由、代价、重新审视的条件。 | 复述该选择产生的结构。 |
| `knowledge/<module>/` | 阅读代码无法得知的行为：失败模式、运行约束、集成陷阱。 | 源码可直接读到的内容，例如签名、字段列表、命令列表。 |

同一事实只写在上述其中一处，其他位置只做链接。

## 证据来源

写文档时应以下列来源为准，不要凭推测补充：

- `api/openapi.yaml` — Contract 的形状、operation 与 schema。
- `AGENTS.md` — 仓库对人类与 AI 协作者的强制约束（Contract-first 流程、目录边界、命令、数据库边界）。
- `.notes/backend-sandbox/specs/` 与 `.notes/backend-sandbox/rfcs/` — 已批准的设计说明与 RFC：决策的背景、替代方案与取舍。
- `package.json`、`pnpm-workspace.yaml` 与各包的 `package.json` — 工作区划分、命令与依赖归属。
- `apps/mock-server/src/**`、`packages/api-client/src/**`、`apps/web/src/**`、`tests/contract/**` — 实际行为，以及源码注释中记录的实测结论。

设计文档、RFC 与实施计划保留在 `.notes/<module>/` 原地，不复制进本目录；只有已经稳定的结论才提炼到 `.ai/`。

## 不写入本站的内容

- 版本控制与工作区状态：分支名、commit 数量、未提交文件，或上游文档是否仍标记为 Draft。
- 一次性的任务叙述、原始测试输出、未被采纳的猜测。
- 源码的直接复述。
