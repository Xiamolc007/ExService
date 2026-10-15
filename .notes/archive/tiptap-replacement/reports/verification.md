# 整篇替换协议验证

## 交付内容

双预设通过包内 `ContentSession`、`content-gate`、`content-events` 与两个内容 adapter 共用整篇替换及诊断协议。保留独立 schema、解析、粘贴和转换规则。删除旧 `useMarkdownEditor`、相关公开兼容类型、Markdown runtime 和 history 别名；DEV 示例及有效生命周期断言已迁移。稳定行为同步到 `.ai/knowledge/components/tiptap-content-boundaries.md`。

## 自动验证

- 开发前基线：Tiptap 20 文件、428 测试通过。
- 最终 `pnpm exec vitest run packages/components/src/tiptap --reporter=dot`：20 文件、469 测试通过。
- 最终 `pnpm typecheck`：exit 0，覆盖 SDK、Client、components、Server、Web 与额外类型用例。
- `pnpm --filter @workspace/web build`：exit 0。API 源码、锁文件与依赖声明无本轮改动。
- 范围内 `git diff --check`：通过。两个既有 API 生成文件在验证开始与结束的 SHA256 一致。

新增回归先在真实 Editor/Hook 上观察失败，再修复。覆盖回调异常不改变接纳结果、整批 FIFO、重入结果独立、旧诊断失效、原生 Editor 事件重入、初始化恢复与嵌套属性隔离。原有拒绝原子性、history、Emoji/Slash、上传、Mention、独立实例和独立 GFM gate 回归保留。

## 独立评审

独立只读审查与复核发现并验证了两处 P2：最新回执覆盖原生事件中外层替换；初始化恢复晚于原生重入读取，导致旧错误持续显示。修复为每操作独立回执及追加事务快照、dispatch 前预留通知批次、真实接纳阶段解除初始化锁存。两处缺陷均有双预设回归，复核通过。

另经实际属性变更探针确认，原生 Node.toJSON 的嵌套 attrs 会别名到实时文档；返回与普通 onChange 快照现均深拷贝。独立复核实际修改替换返回值、onChange 参数和 readJSON 返回值的 link.href，实时文档保持不变。最终独立复核未发现遗留 P2 及以上问题；评审未修改工作树。

## 真实浏览器

复用当前 worktree 已有的 `http://127.0.0.1:5173` DEV 服务，通过独立命名的 Chromium 会话执行：

- `assertTiptapMarkdown`，包含 `assertTiptapPresets`：GFM 导入/拒绝、替换隔离历史、后续编辑 Undo、双实例、Emoji、Slash H6/图片地址、真实系统 HTML 剪贴板、Chromium CDP 中文 IME、共享 Editor/Viewer、只读表格、深浅主题及窄屏。
- `assertTiptapPreview`：完整预设有效/无效导入、真实替换及 Undo、显式 Markdown 导出、只读恢复。
- `assertTiptapChromeInteractions`：Mention 身份与键盘、IME/失焦取消、链接表单、原生段落拖动。

最终三组通过，受监听流程无 pageerror。运行记录位于 `output/playwright/tiptap-replacement-browser.json`，构建和类型日志位于同目录 `tiptap-replacement-build.log`、`tiptap-replacement-typecheck.log`。本次浏览器会话已单独关闭，已有 DEV 服务保留。

## 边界

本轮没有执行根完整 `pnpm test`、Outline 测试或完整 Outline 构建，也未提交、推送或部署。根类型检查保留既有 OpenAPI schema 警告，Web 构建保留 Vite 配置与 chunk 大小警告。DEV 控制台仍有 `/api/health` 404/Server 连通性及 favicon 404；组件浏览器通过不代表后端健康。

拒绝原子性适用于正常 filterTransaction 门禁；不承诺任意第三方插件在 state.apply 中抛错后的通用回滚。其余三项架构候选不属于本轮。
