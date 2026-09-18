# 只对外回显安全的错误消息

- 状态：已接受
- 模块：`mock-server`
- 日期：2026-09-16
- 来源：`notes/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`「安全与运行边界」

_最后更新：2026-09-17_

## 背景

未捕获异常的 `message` 可能包含 SQL 语句、SQLite 绝对路径、堆栈或原始异常内容。这个服务虽然是本地开发用的 Mock，但它的响应会被浏览器、日志和未来的调用方消费。

## 决策

对外错误消息只允许两种来源：

1. Fastify 依据 Contract schema 生成的校验错误（`error.validation`）—— 它由 Contract 产生，不携带内部实现细节；
2. 固定文案。

其他异常（包括应用代码主动抛出的 4xx）一律不回显 `error.message`。另外：

- `error.statusCode` 先被规范到 `[400, 600)`，超出范围一律按 500 处理，避免异常状态码原样透出；
- 错误码由状态码推导（404 → `NOT_FOUND`，≥500 → `INTERNAL_ERROR`，其余 → `BAD_REQUEST`）；
- Fastify request ID 同时用于响应中的 `requestId` 与日志关联；5xx 写 `error` 日志，4xx 写 `warn` 日志。

## 理由

- 本地 Mock 也应当保持与生产实现相同的「不泄漏内部状态」标准，否则前端会在开发期依赖上那些迟早会消失的信息。
- 把状态码规范到合理区间，避免上游库传入的异常值（如 0 或 6xx）被原样发回。
- 校验错误是唯一有价值的安全回显，因为它直接告诉调用方 Contract 要求什么。

## 影响

- 调试只能依赖服务端日志与 `requestId`，不能用响应体定位问题。
- 需要向调用方表达的业务错误必须有意义，就必须来自 Contract schema 的校验规则，而不是 handler 里抛出的 `Error`。
- 错误码取值集中在 `ErrorCode` 联合类型中；新增取值不需要改 Contract，但要保持 envelope 构造只在 `src/errors.ts` 一处。

## 重新审视的条件

- 需要向调用方返回结构化、可编程处理的业务错误细节时（应先在 Contract 中定义并评审）。
- 服务被部署到共享或非本地环境时。

## 证据

- `apps/mock-server/src/errors.ts` 全文，尤其是 `resolvePublicMessage()` 与 `codeForStatus()`。
- `tests/contract/health.test.ts` 的 `does not leak internal details`。
- `api/openapi.yaml` 中 `ErrorEnvelope.error.message` 的 description。
