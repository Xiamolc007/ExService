# ExUI ExMessage 宿主的生命周期边界

_最后更新：2026-09-29_

`ExMessage` 与 `<ExMessageContext />` 都由 ExUI 导出。静态方法依赖已激活的宿主；ExUI 内置的 Sonner Toaster 在 React passive effect 中订阅消息，宿主随后激活静态入口。页面正常事件处理和后续 passive effect 可以发送提示。首次提交时更早执行的 layout effect 调用会收到明确的 `mounted ExMessageContext host` 错误，避免提示被悄悄丢弃。

ExUI 的 `visibleToasts` 只控制可见数量；`ExMessage` 自己管理按创建顺序的容量驱逐，以及 loading 的显式截止时间与完成句柄。直接调用 ExUI `toast` 会绕过这些管理规则。

卸载根宿主会关闭它创建的活动消息并清理 loading 计时器。页面刷新不会保留消息。应用只在 `apps/web/src/main.tsx` 的 `ThemeProvider` 内挂载一个宿主；开发期 React StrictMode 的 effect 重挂载由 ExUI 自身测试覆盖。

业务接入的强制规则与用法示例见 `.ai/rules/frontend-notifications.md`。

证据：`apps/web/src/main.tsx`、`apps/web/src/pages/JoinReviewPage/JoinReviewPage.test.tsx`；当前链接的 `@exre/exui` 公开 `ExMessage`、`ExMessageContext` 及其宿主实现。
