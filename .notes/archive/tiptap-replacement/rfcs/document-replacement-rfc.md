# RFC：共享内容会话与整篇替换

状态：按已确认设计实施。设计依据为 `.notes/tiptap-replacement/specs/2026-10-15-document-replacement-design.md`。

## 内部契约

`content-session.ts` 定义 `ContentAdapter`（parse、validate、serialize）与 `ContentSession`。会话提供 attach/detach、read/export/replace/focus、report/notice，以及 editing extension。共享 gate 保存操作回执与文档修订；捕获诊断所属的 Editor、绑定代次、文档与诊断序号，在 microtask 中核验后发送。独立 gate 使用同样的实现但无需 React 或 Hook。

替换流程为解析候选、构造并验证事务、标记 operation/contentReplace/交互取消、不加入 history、dispatch、核验独立回执、取本次操作最终快照、完成通知批次。ContentHistory 仅在已接受事务的 state.apply 中清空官方历史；绑定的内容会话同时解除初始化锁存并清空旧展示，不能推迟到原生事件之后。完整 runtime 在已接纳 replacement meta 上取消上传和 Mention；拒绝不得触发。官方 Suggestion 的退出在共享 extension 的 onTransaction 阶段完成，避免较旧操作在原生事件重入之后关闭新交互。

每个 operation 的接纳回执由真实 state.apply 保存，并随 appendedTransaction 的根操作更新独立文档快照；不依赖当前 latest operation 判断外层操作，以支持原生 Editor 事件同步重入。较旧操作结束时仅返回自己的快照，不覆盖较新操作的诊断与交互状态。

通知采用会话内 FIFO，在 dispatch 前预留操作批次并在操作完成时填入通知。每个监听器异常单独上报浏览器全局错误通道，既不触发 onError 递归，也不阻断下一条通知。快照在通知之前固定并为每个消费方隔离。replacement meta 抑制本次替换的重复 onUpdate；独立的原生重入编辑仍单独通知。

## 迁移

完整 `TiptapLifecycle` 与 Markdown runtime 组合会话；两个 adapter 自行绑定原有解析、校验、序列化函数。Markdown guard 的 HTML/plain-text 插入仍由 GFM 负责，回执和诊断交给共享 gate。删除 Markdown history 兼容别名并直接引用共享 history。删除旧 Hook、公开兼容类型和 DEV 兼容示例，迁移测试。

## 验证与恢复

先添加双预设行为回归并确认失败，再实现共享协议；保持既有 gate、上传和 Mention 测试。类型检查与构建顺序执行，避免共享 SDK 产物竞争。仓库现有无关修改不改写。仅本地交付，无数据库或部署步骤；若需回退，恢复本轮源码及调用迁移即可，JSON 持久格式不变。
