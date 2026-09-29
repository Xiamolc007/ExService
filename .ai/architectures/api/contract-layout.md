# API Contract 的结构与消费路径

`api/openapi.yaml` 是唯一 HTTP API Contract，定义 Server 与生成式 Client 共享的路径、操作、认证及 schema。选择理由见 `.ai/decisions/api/01-openapi-as-single-contract.md`。

_最后更新：2026-09-29_

## 单文件布局

Contract 仍聚合在一个文件中：

| 段落 | 作用 |
| --- | --- |
| `openapi` / `info` | 规范版本与 Contract 适用范围。 |
| `servers[].url: /api` | 描述客户端 API base URL；服务端路由前缀另由 Glue 注册。 |
| `tags` | operation 的归类。 |
| `paths` | HTTP 方法、`operationId`、请求、响应与逐操作 security。 |
| `components.securitySchemes` | 声明 HTTP Bearer `bearerAuth`；受保护操作显式引用它。 |
| `components.headers` | 复用 `Cache-Control` 与 `Retry-After` header 规则。 |
| `components.responses` | 复用普通安全错误与带重试延迟的错误响应。 |
| `components.schemas` | 健康、认证、资料、申请、邀请及错误 envelope 等共享 schema。 |

每个 operation 都以 `operationId` 绑定 Server handler；缺失或重复会破坏映射。部分公开操作显式写 `security: []`，受保护操作声明 `bearerAuth`。当前没有 API 版本策略或兼容层；破坏性 Contract 变更须单独评审。

## 错误响应

`components.responses.ErrorResponse` 和 `RetryableErrorResponse` 都引用同一份 `components.schemas.ErrorEnvelope`。后者额外要求 `Retry-After`，供需要告知等待时间的失败响应使用。operation 可显式声明 4xx/5xx，并以 `default` 覆盖其他失败；不能把早期“只有一份 response、没有显式 4xx”的描述当作当前 Contract。`ErrorEnvelope.error.code` 在 Contract 中仅约束为字符串，具体码值由 Server 实现维护。

## 消费路径

| 消费者 | 使用方式 |
| --- | --- |
| `pnpm api:lint` | 用 Redocly 检查解析、引用和项目规则。 |
| `pnpm api:generate` | 用 `openapi-typescript` 生成 `packages/api-client/src/generated/schema.d.ts`。 |
| `apps/server/src/app.ts` | 通过 `fastify-openapi-glue` 注册方法、路径、schema 与 Bearer security handler。 |
| `tests/contract/` | 从同一 Contract 提取 schema，检查路由、响应和双向 `operationId` 覆盖。 |

`redocly.yaml` 的规则开关属于仓库 lint 配置，不改变 Contract 中已存在的 Bearer scheme、显式错误响应或 schema。业务扩大到单文件难以维护时，可拆分源文件，但仍需聚合为唯一 Contract。
