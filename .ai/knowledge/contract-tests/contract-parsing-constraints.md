# Contract 测试对 Contract 形状的隐含约束

**结论：Contract Test 直接解析 `api/openapi.yaml`，因此它对 Contract 的写法提出了源码里看不到的额外要求；违反时会以抛错或静默失效的形式出现。**

_最后更新：2026-09-17_

## 已知约束

### 1. path item 不能使用 `$ref`

`listContractOperations()` 通过遍历 `paths` 的每个 path item、再遍历其中的 HTTP 方法枚举 operation。path item 若写成 `$ref`，无法枚举，函数会**抛错**。

这是刻意的：静默跳过会让双向覆盖检查失效，从而放过漏登记的 handler。

### 2. 每个 operation 必须带非空 `operationId`

缺失或为空字符串时 `listContractOperations()` 抛错。没有 `operationId` 的 operation 无法映射到 handler，也无法参与覆盖检查。

### 3. Draft-07 转换只重写 `#/components/schemas/`

测试把 `components.schemas` 序列化后，把字符串 `#/components/schemas/` 替换为 `#/definitions/`，拼成自包含的 definitions 交给 Ajv。因此：

- schema 之间的 `$ref` 必须写成 `#/components/schemas/<Name>` 这一种形式。
- 指向其他位置（例如 `#/components/responses/...`）或外部文件的 `$ref` 不会被重写，Ajv 也就无法解析。
- 把 Contract 拆成多个文件后，跨文件的 `$ref` 会让这套转换失效。

### 4. 只有被显式编译的 schema 会参与校验

测试在模块顶层按名字编译 `HealthResponse` 与 `ErrorEnvelope`。新增 schema 时，如果不为它增加一次编译与对应断言，它既不参与正向校验，也不参与反向用例 —— 看起来「测试通过」，实际没有覆盖。

### 5. Ajv 以 `strict: false` 构造

未知关键字不会让测试失败。因此反向用例只证明「被断言的这几条语义生效」，不构成「schema 完全符合运行时校验器语义」的证明；后者由每次 `createApp()` 触发 Fastify 路由注册来兜底。

## 证据

- `tests/contract/health.test.ts`：`readContract()`、`listContractOperations()`、`toDraft07Definitions()`、`compileComponentSchema()` 及其注释。
- `api/openapi.yaml` 中 schema 之间的 `$ref` 写法。
