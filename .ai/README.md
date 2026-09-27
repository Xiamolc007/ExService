# ExWebsite 的 AI 知识库

本目录是 ExWebsite 的持久知识库入口。仓库本身是一个 **Contract-first 的本地 Backend Sandbox**：`api/openapi.yaml` 是唯一的 HTTP API Contract，Fastify + SQLite 是本地开发实现，未来的 PHP + MySQL 是生产实现。

本站的知识文档只记录**阅读代码无法直接得到**的内容：模块边界与依赖方向、已接受决策及其理由、以及源码中看不出的失败模式。`databases/` 另存跨实现的数据模型、数据库专属决策与运行知识；`rules/` 存放由 `AGENTS.md` 指向的专项开发规则。Task 进行中的状态、版本控制状态与源码的直接复述都不在这里。

_最后更新：2026-09-27_

## 模块划分

模块取自仓库的真实边界：`pnpm-workspace.yaml` 声明的工作区包、顶层目录与部署单元。新增模块文档时请复用下表中的目录名。数据库文档按数据边界集中在 `databases/`，不作为新的运行模块。

| 模块 | 仓库路径 | 责任 | 本站文档 |
| --- | --- | --- | --- |
| `api` | `api/` | 定义唯一的 HTTP API Contract：路径、operation、请求/响应/错误 schema。 | `.ai/architectures/api/contract-layout.md` · `.ai/decisions/README.md` |
| `api-client` | `packages/api-client/` | 导出 Contract 生成的类型与 `createApiClient({ baseUrl })` 工厂。 | `.ai/architectures/overview.md` · `.ai/decisions/README.md` |
| `components` | `packages/components/` | 应用级共享 UI 组件（站点顶栏等），基于 ExUI 组装；不定义路由表、不发请求。 | `.ai/architectures/overview.md` · `.ai/decisions/README.md` · `.ai/knowledge/components/ex-message-host-lifecycle.md`（ExMessage 宿主生命周期） |
| `mock-server` | `apps/mock-server/` | 按 Contract 注册 Fastify 路由、实现 handler、执行受控的本地 SQLite 访问。 | `.ai/architectures/mock-server/request-lifecycle.md` · `.ai/architectures/mock-server/authentication-lifecycle.md` · `.ai/decisions/README.md` · `.ai/databases/data-model.md` |
| `web` | `apps/web/` | Vite/React 前端外壳：声明前端路由表，决定 API base URL 与主题来源，并在开发期经代理访问 Mock Server。 | `.ai/architectures/overview.md` · `.ai/architectures/web/authentication-flow.md` · `.ai/decisions/README.md` · `.ai/knowledge/web/exui-integration-traps.md` |
| `contract-tests` | `tests/contract/` | 以真实 Fastify app 的 `inject()` 验证 HTTP Contract，而不是单测 handler。 | `.ai/architectures/contract-tests/test-layers.md` · `.ai/decisions/README.md` · `.ai/knowledge/contract-tests/contract-parsing-constraints.md` |

`api-client` 与 `components` 目前没有独立的架构文档：它们的结构由 `.ai/architectures/overview.md` 一并说明。只在该模块出现第一份文档时才创建模块子目录。

用户设置面板的两条已接受决策是 `.ai/decisions/web/04-settings-state-separate-from-auth-context.md`（设置状态与认证边界）和 `.ai/decisions/mock-server/05-normalize-new-avatars-to-512-square.md`（新头像尺寸）。实现结构见上表所列架构文档与源码；设计背景保留在 `.notes/archive/backend-sandbox/user-settings/rfcs/user-settings-panel-rfc.md`。

## 导航

完整加入申请的表单/查询边界见 `.ai/architectures/web/authentication-flow.md`，multipart 插件与容量回收陷阱见 `.ai/knowledge/mock-server/multipart-lifecycle-traps.md`。一次申请、历史登记和版本损坏判定只记录在 `.ai/databases/data-model.md`；编码技术修正保留于 `.notes/join-registration/rfcs/join-application-pages-implementation-notes.md`。

- `.ai/CONTEXT.md` — 领域语言（ubiquitous language）。
- `.ai/architectures/overview.md` — 跨模块结构与请求流。
- `.ai/decisions/README.md` — 已接受决策的索引。
- `.ai/databases/data-model.md` — 数据表的职责、关系和跨实现目标规则；数据库专属决策与运行知识在相邻子目录。
- `knowledge/<module>/` — 非显而易见的运行行为：失败模式、运行约束、集成陷阱。
- `.ai/rules/frontend-forms.md` — 开发或修改前端 Form 时必须遵守的规则。
- `.ai/rules/frontend-notifications.md` — 开发或修改全站临时通知时必须遵守的 ExMessage 接入规则。

## 每类知识的归属

| 位置 | 记录什么 | 不记录什么 |
| --- | --- | --- |
| `CONTEXT.md` | 领域词汇：每个规范术语的含义，以及应避免的说法。 | 实现选择、API 形状、字段列表、模块名。 |
| `architectures/<module>/` | 系统结构：组件边界、依赖方向、请求与控制流、扩展点。 | 选择背后的理由、失败模式。 |
| `decisions/<module>/` | 为什么这样选：背景、替代方案、理由、代价、重新审视的条件。 | 复述该选择产生的结构。 |
| `knowledge/<module>/` | 阅读代码无法得知的行为：失败模式、运行约束、集成陷阱。 | 源码可直接读到的内容，例如签名、字段列表、命令列表。 |
| `databases/` | 跨 SQLite/MySQL 的目标业务模型、数据库专属决策与运行知识。 | 完整物理 schema、尚未实现的 MySQL 结构、源码字段清单。 |
| `rules/` | 开发时必须遵守的专项规则，由 `AGENTS.md` 指定阅读条件。 | 架构解释、设计决策、运行经验。 |

同一事实只写在上述其中一处，其他位置只做链接。

## 证据来源

写文档时应以下列来源为准，不要凭推测补充：

- `api/openapi.yaml` — Contract 的形状、operation 与 schema。
- `AGENTS.md` — 仓库对人类与 AI 协作者的强制约束（Contract-first 流程、目录边界、命令、数据库边界）。
- `.notes/<module>/specs/` 与 `.notes/<module>/rfcs/` — 已批准的设计说明与 RFC：决策的背景、替代方案与取舍。
- `package.json`、`pnpm-workspace.yaml` 与各包的 `package.json` — 工作区划分、命令与依赖归属。
- `apps/mock-server/src/**`、`packages/api-client/src/**`、`apps/web/src/**`、`tests/contract/**` — 实际行为，以及源码注释中记录的实测结论。
- `apps/mock-server/drizzle/**` — 当前 SQLite 物理结构的迁移记录；与 `src/db/schema.ts` 一起核对模型现状。

设计文档、RFC 与实施计划保留在 `.notes/<module>/` 原地，不复制进本目录；只有已经稳定的结论才提炼到 `.ai/`。

## 不写入本站的内容

- 版本控制与工作区状态：分支名、commit 数量、未提交文件，或上游文档是否仍标记为 Draft。
- 一次性的任务叙述、原始测试输出、未被采纳的猜测。
- 源码的直接复述。
