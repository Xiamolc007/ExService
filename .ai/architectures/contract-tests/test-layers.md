# `contract-tests` 模块：测试层次

本文件说明 `tests/contract/health.test.ts` 的组织方式，以及每一层断言各自覆盖什么。单条断言背后的失败模式见 `.ai/knowledge/mock-server/serialization-masks-handler-regressions.md` 与 `.ai/knowledge/contract-tests/contract-parsing-constraints.md`。

_最后更新：2026-09-27_

## 为什么分层

Contract Test 的断言不能只停留在 HTTP 响应上，因为响应在到达测试之前已被 Contract schema 序列化过。文件因此把断言分成互相不可替代的几层；任何一层被删掉，都会出现一类完全不可见的漂移。

## 测试夹具

- 夹具从 `tests/helpers/auth.ts` 构造内存 SQLite 与所需服务，应用经 `createApp()` 创建真实 Fastify 实例并在用例结束时关闭。
- 常规 HTTP schema 测试使用 `app.inject()`；生成 Client/multipart 互通与连接生命周期测试另绑定本机随机端口。所有夹具均不读写开发数据库。
- 健康、认证、本人资料及加入流程在 `tests/contract/` 各自覆盖；新增 operation 时同步增加 HTTP 与注册 handler 原始值断言。

加入流程夹具应用完整 migration journal，业务测试经过申请、审核、验证与完善。登录/资料回归可直接用仅测试模块的用户夹具初始化账号，避免把旧注册方法保留为测试后门；历史迁移测试明确选择旧 journal 阶段，不据此重新提供退役 API。

HTTP 日志安全由 `tests/contract/join-logging.test.ts` 捕获真实日志流验证，不能由响应不泄漏的断言替代。`tests/auth/shared-password-budget.test.ts` 使用生产组装与真实密码队列，只替换底层计算以控制完成时机，覆盖跨服务饱和、恢复和唤醒时新请求交错。`tests/auth/cli-bootstrap.test.ts` 隔离固定数据库打开边界，验证 SSO CLI 在仅有认证结构且没有验证码密钥时仍可用；这些测试都不打开开发库。

## 层次划分

完整申请另分传输、业务和历史迁移：`tests/contract/join-upload.test.ts` 验证实际生成 Client 发送 FormData 后的字节、MIME 与摘要；`tests/contract/join-upload-sockets.test.ts` 验证真实连接容量与回收；`tests/join/` 覆盖唯一竞争、原子回滚、历史读兼容与只读状态计算。传输陷阱见 `.ai/knowledge/mock-server/multipart-lifecycle-traps.md`。隔离迁移夹具不代表固定开发库已经升级。

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
