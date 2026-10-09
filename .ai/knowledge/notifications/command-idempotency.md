# 命令幂等键是「同一用户下的意图命名空间」，主键不含 kind

**结论：`notification_mutations` 的主键是 `(user_id, request_id)`，`kind` 只是行上的一个字段。查重放必须按主键查，再用 `kind` 与摘要判定 —— 反过来按 `(user_id, request_id, kind)` 查会让跨 kind 复用的命令重复执行，并静默丢掉去重记录。**

_最后更新：2026-10-09_

## 失败模式

`insertMutation` 是 `ON CONFLICT (user_id, request_id) DO NOTHING`。若 `findMutation` 按
`(user_id, request_id, kind)` 查：

1. requestId `R` 先用于 `clear` → 写入一行 `(u, R, 'clear', digestClear)`；
2. `R` 再用于 `restore` → 按 kind 查**查不到**（那行的 kind 是 clear）→ 命令执行一次；
3. 随后的 `insertMutation` 撞 `(u, R)` 主键 → `DO NOTHING` → **这次执行的去重记录根本没写进去**；
4. 同一个 `R` 再来一次 restore → 仍然查不到 → 再执行一次。

对 `clear` 还有 batch status 兜底，但 `restore` 的重复执行会返回一个 `affected=0` 的错误终态。

## 如何应用

- `findMutation` 只按 `(user_id, request_id)` 取回记录（含 `kind`）；`claimMutation` 先判 `kind`
  再判摘要，两者任一不符都抛 `NOTIFICATION_REQUEST_CONFLICT`（409）。跨 kind 同 key 因此有
  **确定的冲突结果**：既不重复执行，也不静默丢记录。
- 摘要里已经含 `kind`，所以多数跨 kind 复用靠摘要比对就会被挡住；`kind` 判定是兜底，
  防止将来摘要不再包含 kind。两条都在，不是冗余。
- **查重放必须在持有 user 行锁之后。** 否则同一 requestId 并发提交时，两条命令都会先查到
  「没有记录」而重复执行。`readThrough` / `clear` / `restore` 三条路径都是
  `lockUser` → `claimMutation` → `lockStream` → receipts，锁顺序一致，没有环。
- 主键不含 kind 是有意的：`requestId` 是**同一用户下的意图命名空间**，同 key 换 kind 提交
  本身就是调用方用错。当前写法已经拿到确定的 409，不需要为此改主键
  （`0002` 已推送，改主键要一次新迁移）。若将来有别的原因做迁移，可以顺手把 kind 纳入主键。

## 证据

- `tests/notifications/service.test.ts` 的 `refuses to reuse one request id across kinds instead of re-running the command`
  （用户可见行为：旧代码会重复执行，现在 409）
- `tests/notifications/service.test.ts` 的 `refuses a stored idempotency record that belongs to another kind`
  （直接盯 `kind` 判定：手工放一条同 key 同摘要但 kind 不同的记录，只比摘要会放行并 replay 掉 clear 的结果）
- `tests/notifications/service.test.ts` 的 `serialises concurrent submissions of the same request id`
  （`Promise.all` 提交同一 requestId，第二条必须是重放；没锁的话会重复执行并拿到 `affected=0`）
