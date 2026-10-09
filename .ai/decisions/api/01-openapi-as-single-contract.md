# 以单份 OpenAPI Contract 作为唯一的 API 事实来源

- 状态：已接受
- 模块：`api`
- 日期：2026-09-16
- 来源：`.notes/archive/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`、`.notes/archive/backend-sandbox/specs/2026-09-16-backend-sandbox-scaffold-design.md`

_最后更新：2026-09-29_

## 背景

本决策提出时，团队计划用本地 Node 后端替代固定 JSON Mock，并为未来 PHP 接管保留前端调用边界。现已由 `apps/server/` 成为唯一长期 Server；单份 Contract 的原则继续有效。

这带来一个约束：定义 API 的东西必须独立于任何一侧的实现，否则 Server 实现会成为事实上的 API 定义，Web 与生成式 Client 就得反向按它对齐。

## 决策

建立以单文件 `api/openapi.yaml`（OpenAPI 3.1.1）为唯一 HTTP API Contract 的 pnpm workspace。Client 与 Server 都从它派生：

- `openapi-typescript` 生成前端类型；
- `fastify-openapi-glue` 依据它注册唯一 Server 的路径、方法与校验 schema；

首版不拆分 `paths/` 与 `schemas/`。

## 理由

- 一个 Contract 同时驱动 Client 与 Server，避免双方各自定义不一致的 HTTP 语义。
- 被否定的方案：
  - **运行时优先，稍后接入 OpenAPI**：初始文件更少，但最重要的生成与契约校验链路不会被首版验证，后续更易偏离。
  - **由 Fastify schema 反向生成 OpenAPI**：后端写路由快，但会让 Fastify 实现变成 API 定义，破坏 Web 与 Server 共享 Contract 的目标。
  - **手写 fetch 与 DTO**：不需要生成工具，但类型、路径与 payload 容易漂移。

## 影响

- API 变更的顺序被固定为「Contract → lint → 生成类型 → 实现 handler → 前端调用 → typecheck/test/build」，不可颠倒。
- 首版的配置量高于单一前端工程。
- Contract 的写法受到下游解析能力的约束（例如测试对 `$ref` 与 `operationId` 的要求）。
- 破坏性变更当前没有版本策略或兼容层，必须单独评审。

## 重新审视的条件

- 单文件在真实业务规模下不再可维护时：拆分 `paths/` 与 `schemas/`，但仍聚合为同一个 Contract。
- 出现多个独立部署单元、需要多份 Contract 时。
- 引入正式版本策略或兼容层时。

## 证据

- `api/openapi.yaml` 的 `info.description`。
- `package.json` 中的 `api:lint` 与 `api:generate`。
- `.notes/archive/backend-sandbox/specs/2026-09-16-backend-sandbox-scaffold-design.md` §2、§4、§5。
- `.notes/archive/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`「决策摘要」与「替代方案与取舍」。
