# Contract 与 handler 登记之间的两种漂移

**结论：Contract 中新增 operation 却漏登记 handler 时，只有「双向覆盖检查」能发现；既有断言不会失败。**

_最后更新：2026-09-29_

## 失败模式

`serviceHandlers` 是 `operationId -> handler` 的显式映射表，`fastify-openapi-glue` 按 `operationId` 查找它。文件名、目录结构、导出名都不参与解析。

两个方向都会漂移，而且都不会被 HTTP 断言发现：

1. **Contract 已声明、`serviceHandlers` 未登记**：该路由在运行时返回 500。其他 operation 的断言、schema 校验、错误 envelope 断言全部照常通过，因此本地测试与 `typecheck` 都是绿的。
2. **`serviceHandlers` 已登记、Contract 未声明**：不会产生路由（路由来自 Contract），因此不会有任何报错，只是一段永远不会被执行的死代码掩盖了 Contract 变更后的清理遗漏。

## 如何应用

- 新增 operation 时必须同时改两处：`api/openapi.yaml` 与 `apps/server/src/app.ts` 的 `serviceHandlers`。
- 依赖 `contract coverage` 的两个反向断言来兜住这两个方向，不要用「人肉检查 `serviceHandlers`」替代。选择双向覆盖检查的理由见 [[contract-tests/02-contract-as-sole-schema-source]]。
- 重命名 `operationId` 等同于「删除旧 operation + 新增新 operation」，两个方向都要同步。

## 证据

- `tests/contract/health.test.ts` 的 `contract coverage` 两组用例（`registers a handler for every operation declared in the contract`、`registers no handler that the contract does not declare`）及其注释。
- `apps/server/src/app.ts` 中 `serviceHandlers` 的定义与注释。
- `AGENTS.md` 的「Server 实现约定」与「修改 API 的固定顺序」。
