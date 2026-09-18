# 测试直接以 Contract 为 schema 来源，并做双向覆盖检查

- 状态：已接受
- 模块：`contract-tests`
- 日期：2026-09-16
- 来源：`notes/backend-sandbox/rfcs/2026-09-16-contract-first-backend-sandbox-scaffold-rfc.md`「验证」

_最后更新：2026-09-17_

## 背景

测试可以手写期望的响应结构，也可以从 Contract 读取。手写会让测试变成第二份 API 定义，与 Contract 各自演化。

另一个问题是覆盖：Contract 与实现之间的映射是显式的（`operationId -> handler`），显式映射就会漏登记或残留。

## 决策

- 测试直接读取 `api/openapi.yaml`，把 `components.schemas` 转成自包含的 Draft-07 definitions，用 Ajv 校验响应；不在测试中手写或复制响应结构。
- 增加 `contract coverage` 双向检查：Contract 声明的每个 operation 都已登记 handler，且没有登记 Contract 未声明的 handler。
- 测试创建真实 Fastify app（`createApp()` + `inject()`），不绑定端口，不读写开发数据库。

## 理由

- schema 只有一个来源：Contract 变了测试自动跟着变，不会出现「测试通过但 Contract 已经不是这样」。
- 双向覆盖是唯一能发现漏登记与残留 handler 的手段；两个方向的漂移形态与为什么既有断言抓不到它们，见 [knowledge/mock-server/operation-registration-gaps.md](../../knowledge/mock-server/operation-registration-gaps.md)。
- 用真实 app 而非单测 handler，使「路由注册 + schema 兼容性」也进入验证范围：schema 超出运行时校验器可接受范围时，测试会在注册阶段失败。

## 影响

- Contract 的写法受到测试解析能力的约束：path item 不能使用 `$ref`、每个 operation 必须有 `operationId`、schema 之间的 `$ref` 只能指向 `#/components/schemas/`。违反时会抛错或在转换后无法解析。
- 新增 schema 时必须显式增加一次编译与对应断言，否则它既不参与正向校验也不参与反向用例。
- 测试的 Ajv 以 `strict: false` 构造，未知关键字不会失败，因此这层不构成完整的 Draft-07 语义保证。

## 重新审视的条件

- 引入能覆盖同样断言的外部 Contract 校验工具或测试生成器时。
- Contract 拆分多文件、跨文件 `$ref` 成为常态时（需要替换当前的重写式转换）。

## 证据

- `tests/contract/health.test.ts` 的 `readContract()`、`listContractOperations()`、`toDraft07Definitions()`、`compileComponentSchema()` 与 `contract coverage` 两组用例。
- `.ai/knowledge/contract-tests/contract-parsing-constraints.md`。
