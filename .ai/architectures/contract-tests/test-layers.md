# `contract-tests` 模块：测试层次

本文件说明 `tests/contract/health.test.ts` 的组织方式，以及每一层断言各自覆盖什么。单条断言背后的失败模式见 [knowledge/mock-server](../../knowledge/mock-server/serialization-masks-handler-regressions.md) 与 [knowledge/contract-tests](../../knowledge/contract-tests/contract-parsing-constraints.md)。

_最后更新：2026-09-17_

## 为什么分层

Contract Test 的断言不能只停留在 HTTP 响应上，因为响应在到达测试之前已被 Contract schema 序列化过。文件因此把断言分成互相不可替代的几层；任何一层被删掉，都会出现一类完全不可见的漂移。

## 测试夹具

- 每个用例通过 `createTestApp()` 调用 `createApp({ logger: false })` 创建真实 Fastify 应用，并在 `afterEach` 中统一 `close()`。
- 请求使用 `app.inject()`，不绑定端口，也不读写开发数据库。
- 当前只有一个测试文件服务于 `health.test.ts` 对应的 operation；新增 operation 时在同一目录增加对应文件。

## 层次划分

| describe | 覆盖内容 | 不可被其他层替代的原因 |
| --- | --- | --- |
| `contract coverage` | `serviceHandlers` 与 Contract 的**双向**一致：Contract 声明的每个 `operationId` 都已登记，且没有登记 Contract 未声明的 handler。 | 漏登记不会让既有断言失败，只会让新路由在运行时返回 500。 |
| `GET /api/health over HTTP` | 状态码 200、JSON content type、响应体满足 `HealthResponse`、字段集合精确等于 Contract 声明、以及未加前缀的 `/health` 返回 404。 | 最后一条把「`prefix` 必须显式传入」钉在测试里；`servers[].url` 不能替代它。 |
| `registered handler output` | 直接调用 `serviceHandlers.getHealth()`，校验**序列化之前**的原始返回值。 | 序列化会丢弃未声明字段并强制写入 `const`，HTTP 层完全看不到 handler 回归。 |
| `contract schema enforcement` | 反向用例：多字段、缺必填、违反 `const`、类型错误都必须被 schema 判为不合法。 | 证明校验确实在生效，而不是恰好没有反例。 |
| `undeclared routes` | 未声明路径返回 Contract 的 `ErrorEnvelope`，且 `message` 不泄漏仓库路径、数据库文件名、`node_modules` 或堆栈形状。 | 错误 envelope 与信息泄漏需要正向与负向断言共同固定。 |

## Contract 的读取方式

测试把 `api/openapi.yaml` 当作 schema 的唯一来源，不手写、不复制响应结构：

1. 用 `yaml` 解析文件内容。
2. 逐步校验 `paths` 与 `components.schemas` 的结构；缺失时抛出明确错误，而不是让后续断言静默变成 `undefined`。
3. 枚举 Contract 中的全部 operation，缺少 `operationId` 或使用 `$ref` path item 时直接抛错（宁可失败，也不静默跳过导致覆盖检查失效）。
4. 把 `components.schemas` 整体序列化后把 `#/components/schemas/` 重写为 `#/definitions/`，拼成自包含的 Draft-07 definitions，再用 `new Ajv({ allErrors: true, strict: false })` 编译出 `HealthResponse` 与 `ErrorEnvelope` 的校验函数。

第 4 步是这套测试能同时充当「Contract 兼容性检查」的原因：每次调用 `createApp()` 都会让 Fastify 用同一份 schema 注册路由，schema 超出运行时校验器可接受范围时，测试会在注册阶段失败。
