# 存储并发与资源生命周期

存储介质的目录检查、读取释放和 SDK 请求异常都需要覆盖失败路径，顺序成功请求无法证明这些约束。

_最后更新：2026-10-19_

## 并发创建父目录

多个上传可能在 `lstat` 后同时创建同一父目录。`mkdir` 返回 `EEXIST` 不足以证明路径冲突，必须重新 `lstat`；只有非符号链接的真实目录可以复用，文件、符号链接和 Windows junction 仍应返回 `STORAGE_CONFLICT`。不能用忽略所有 `EEXIST` 的方式消除并发失败。

本地 uploads 根目录的可信前提仍是其他不受信任进程无法写入；这些检查不提供抵御本地并发路径替换攻击的保证。

## 迟到读取与文件句柄关闭

下载期限可能在 `openRead()` 返回前结束响应，客户端也可能先断开。读取返回后必须先检查响应和连接状态；已结束或销毁时立即释放读取，不再设置附件 header 或发送流。有效连接才注册 `close` 监听器，避免漏掉已发生的关闭事件。

读取流应由 `FileHandle.createReadStream()` 创建，使流销毁与句柄关闭共享状态。仅把裸 fd 传给 `createReadStream()`，然后同时 `stream.destroy()` 和 `FileHandle.close()`，可能重复关闭描述符并触发异步 `EBADF`，即使 `autoClose` 为 false。

## SDK 本站请求异常

`packages/sdk/src/storage/core.ts` 经同一 HTTP 管线执行 prepare、file upload 和 complete，三个阶段都捕获请求层 rejection，并复用 `packages/sdk/src/errors.ts` 的映射。网络异常归为 `NETWORK`，超时和取消归为 `TIMEOUT`；HTTP 错误保留服务端错误码映射、status 与 requestId。失败时不重试、不继续后续阶段。

上传开始时捕获配置和 token 版本，在字节读取、本站请求及 COS 阶段之间核对；API root 或有效凭据变化抛 `CONFIG_CHANGED`，不把后续阶段发送到新配置。已经完成的直传不会回滚。COS 传输只在 prepare 选中 COS 后懒加载，每次上传独立持有临时凭据，避免并发串用。单例配置与会话规则见 `.ai/architectures/sdk/client-boundaries.md`。

## 证据

- `apps/server/src/modules/storage/adapters/file.ts` 与 `tests/storage/file-adapter.test.ts`：并发写入、链接拒绝与提前释放读取。
- `apps/server/src/modules/storage/api/handlers.ts`、`apps/server/src/modules/storage/api/transport.ts` 与 `tests/contract/storage-sockets.test.ts`：真实 HTTP 下载期限和迟到读取释放。
- `packages/sdk/src/storage/core.ts`、`packages/sdk/src/errors.ts` 与 `tests/sdk/storage-sdk.test.ts`：三个本站请求阶段的网络、超时及中止异常。
