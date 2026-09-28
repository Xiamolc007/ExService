# 前端通知开发规则

适用于 `apps/web/` 和 `packages/components/` 中新建或修改的全站临时通知，包括操作结果、警告、失败和异步操作进度。

## 统一入口

1. 全站临时通知统一使用 `ExMessage`。应用代码从 `@workspace/components` 导入；共享组件包内部从 `@components/src/ExMessage` 导入。
2. 业务代码不得直接调用 ExUI 的 `toast`，不得另建 Toaster、通知容器或通知状态系统，也不得另装 Sonner 等通知库。底层 `toast/Toaster` 仅由 ExMessage 实现及其测试使用。
3. 全站宿主只在 `apps/web/src/main.tsx` 的 `ThemeProvider` 内挂载一次。页面、布局和弹窗只调用静态方法；全局配置统一在根宿主调整。
4. 通知调用放在已挂载页面的事件处理或后续 passive effect 中；不要在模块初始化、React render 或首次 layout effect 中发送。宿主激活时机与底层行为见 `.ai/knowledge/components/ex-message-host-lifecycle.md`。

## 场景与方法

| 场景 | 使用方式 |
| --- | --- |
| 普通反馈或无需等待的操作结果 | `ExMessage.info(content, options?)` |
| 提醒用户注意或检查输入 | `ExMessage.warn(content, options?)` |
| 操作失败 | `ExMessage.error(content, options?)` |
| 需要进度和完成反馈的异步操作 | `ExMessage.loading(content, options?)`，通过返回句柄完成或关闭 |

字段校验错误继续在对应 Form 字段内显示，页面的持续错误和重试入口继续由页面状态承载；ExMessage 用于临时反馈。聊天消息和持久通知中心不属于本规则的临时通知范围。

当前没有 `ExMessage.success` 静态方法；普通成功反馈使用 `info`，loading 的成功结果使用句柄的 `onSuccess`。文案说明结果或下一步操作，不直接显示原始异常、堆栈或服务器内部信息。

## 异步操作与时长

- 使用 loading 时保留返回句柄，在操作成功或失败后分别调用 `onSuccess` 或 `onError`；取消操作或不需要完成反馈时调用 `dismiss()`。
- 同一任务的完成反馈使用原句柄，不再额外创建一条 `info/error`。不要在完成后立即用 `finally` 调用 `dismiss()`，这会关闭刚显示的完成反馈。
- 丢弃 loading 句柄时必须传入有限的 `duration`，避免留下无人结束的提示。该时长只控制提示显示，业务取消和请求超时仍由调用方处理。
- 普通消息及完成态优先沿用全站默认时长；确需覆盖时使用 `options.duration`，单位为毫秒，值必须为正有限数。

```ts
import { ExMessage } from '@workspace/components'

// 作为已挂载页面的事件处理函数调用。
function notifySaved(): void {
  ExMessage.info('资料已更新')
}

// 在页面事件处理函数中调用，task 由应用层提供。
async function runWithFeedback(task: () => Promise<void>): Promise<boolean> {
  const message = ExMessage.loading('正在保存')
  try {
    await task()
    message.onSuccess('保存成功')
    return true
  } catch {
    message.onError('保存失败，请重试')
    return false
  }
}
```

## 修改时检查

确认新增通知使用上述入口、应用仍只有一个根宿主、loading 的成功/失败/取消路径有对应的完成或关闭处理；涉及显示时检查当前主题下的文案和位置。组件本身的生命周期改动沿用 `packages/components/src/ExMessage.test.tsx` 的行为测试。
