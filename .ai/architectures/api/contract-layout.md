# `api` 模块：Contract 的结构

本文件说明 `api/openapi.yaml` 自身的组织方式，以及它作为运行时来源被消费的路径。选择理由见 [decisions/api](../../decisions/README.md)。

_最后更新：2026-09-17_

## 单文件布局

首版把 Contract 聚合为一个文件，内部的顶层段落各司其职：

| 段落 | 作用 |
| --- | --- |
| `openapi` / `info` | 声明规范版本与这份 Contract 的适用范围。 |
| `servers[].url: /api` | **只**描述客户端 API base URL，不参与服务端路由前缀。 |
| `tags` | operation 的归类；`system` 表示与业务数据无关的 Mock Server 自身状态。 |
| `paths` | operation：HTTP 方法、`operationId`、summary、`tags`、responses。 |
| `components.responses` | 可复用的响应定义。当前只有 `ErrorResponse`。 |
| `components.schemas` | 可复用的 schema。当前只有 `HealthResponse` 与 `ErrorEnvelope`。 |

`paths` 中每个 operation 必须带 `operationId`：它是 Contract 与实现之间的绑定键，缺失或重复都会让实现侧无法映射。

业务资源增多、单文件不再可维护时，才拆分 `paths/` 与 `schemas/`，并且仍聚合为同一个 Contract。当前没有拆分。

## 错误结构

错误没有多条并列定义，而是集中在同一处：

- 每个 operation 用 `default` 响应指向 `components/responses/ErrorResponse`。
- `ErrorResponse` 引用 `components/schemas/ErrorEnvelope`。
- `ErrorEnvelope.error.code` 只被约束为 `string`：**具体取值属于实现侧约定**，新增取值不需要改 Contract。
- 因此额外声明一个 `4xx` response 会引入第二份错误定义，Redocly 的 `operation-4xx-response` 规则被显式关闭。

## 被消费的路径

同一个文件被三处独立消费，任何一处都不能成为「第二份 API 定义」：

| 消费者 | 使用方式 |
| --- | --- |
| `pnpm api:lint` | Redocly 校验可解析性、引用完整性与项目规则。 |
| `pnpm api:generate` | `openapi-typescript` 生成 `packages/api-client/src/generated/schema.d.ts`。 |
| `apps/mock-server/src/app.ts` | 把整个文件交给 `fastify-openapi-glue`，由它注册路径、方法与校验 schema。 |
| `tests/contract/health.test.ts` | 直接读取同一文件，把 `components.schemas` 转成 Ajv 可校验的 definitions。 |

`redocly.yaml` 中被关闭的规则都附有理由注释（`security-defined`、`operation-4xx-response`、`info-license`）；它们对应的是「首版范围不包含认证」「错误只有一份定义」「这不是对外发布的 API 描述」这三件事，不是遗漏。

## 认证与版本

首版 Contract 中不存在 security scheme，也没有版本策略或兼容层。这两者都必须先作为独立设计引入，不能只改 Contract。
