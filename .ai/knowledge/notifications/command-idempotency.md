# 命令幂等键是同一用户下的意图命名空间

`notification_mutations` 的主键是 `(user_id, request_id)`，`kind` 是行上的字段。查重放必须按主键查，再比较 kind 和输入摘要；按 `(user_id, request_id, kind)` 查会漏掉跨 kind 的已有命令，使新命令执行后无法保存去重事实。

_最后更新：2026-10-09_

## 当前入口与历史兼容

Contract 0.6.0 的新批量命令只接受 `read_through | clear`，没有恢复执行入口。数据库仍可能含历史 `restore` mutation，因此 `findMutation` 的读取类型保留历史 kind；不能把历史行过滤掉或断言为当前允许的写入 kind。

同一个用户使用已占用的 requestId 提交另一 kind，或同 kind 的不同摘要，均返回 `NOTIFICATION_REQUEST_CONFLICT`（409）。历史 restore 行占用同一键也按这个规则冲突，即使摘要被构造为相同，kind 检查仍拒绝。

## 锁序与结果

`readThrough` 和 `clearSnapshot` 都遵循 `lockUser → claimMutation → lockStream → receipts`。查重放发生在取得用户行锁之后，避免两个并发提交都先看到不存在的记录。命令终态与收件状态在同一事务内写入；同一意图的重试返回原结果，不重新执行。

原命令返回的计数描述原执行时刻。Web 重放后重新读取全局 summary，不将历史结果当成当前计数；固定提交 body 与客户端请求接受权见 `.ai/knowledge/notifications/request-lifecycle.md`。

## 证据

- `apps/server/src/modules/notifications/repository.ts`：`findMutation` 只按用户与 requestId 读取，`insertMutation` 只接受当前两种写入 kind。
- `apps/server/src/modules/notifications/service.ts`：`claimMutation` 先比较 kind 再比较摘要，用户锁先于查重放。
- `tests/notifications/service.test.ts`：双向跨 kind 复用、历史 restore mutation 冲突、同摘要不同 kind 拒绝，以及并发同 requestId 重放。
