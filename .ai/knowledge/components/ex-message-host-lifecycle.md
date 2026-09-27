# ExMessage 与 ExUI Toaster 的生命周期边界

_最后更新：2026-09-24_

`ExMessage` 的静态方法依赖已激活的全站宿主。ExUI 内置的 Sonner Toaster 在 React passive effect 中订阅消息，因此仅渲染了 `<Toaster />` 并不表示它已经能接收提示。宿主在自己的 passive effect 中激活静态入口；页面正常事件处理和后续 passive effect 可以发送提示。首次提交时更早执行的 layout effect 调用会收到明确的 `mounted host` 错误，避免提示被悄悄丢弃。

ExUI 的 `visibleToasts` 只控制可见数量，不会按创建顺序终止多余消息；其 loading 提示也不会因传入底层 `duration` 自动关闭。因此容量驱逐与 loading 截止时间由 `ExMessage` 控制，业务提示必须统一经 `@workspace/components` 的 `ExMessage` 发送。直接调用 ExUI `toast` 会绕过本站的活动数量和 loading 结束态规则。

卸载根宿主会关闭它创建的活动消息并清理 loading 计时器。页面刷新不会保留消息。开发期 React StrictMode 的 effect 重挂载已纳入测试；不要在路由页面内再次挂载宿主。

证据：`packages/components/src/ExMessage.tsx`、`packages/components/src/exMessageController.ts`、`packages/components/src/ExMessage.test.tsx`；已安装 ExUI 提供的 Toaster 及其 Sonner 运行时订阅行为。
