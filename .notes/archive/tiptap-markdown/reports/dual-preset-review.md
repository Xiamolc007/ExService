# Tiptap 双 Preset 终审报告

未发现有证据支持的 P0–P3 问题。冻结候选的源码评审通过。

## 评审基准与范围

使用 `code-review` 的 `working-tree --paths` 模式，逐条覆盖以下 36 个路径的完整工作树状态，并读取 Spec、RFC 和必要的相邻调用上下文。基准为 HEAD `854146024a6d75f367a243efe7ec0c5950ff6daf` 及开发前保留的用户改动快照；范围内 22 个未暂存跟踪文件、14 个未跟踪文件、0 个已暂存文件。已有用户工作由用户授权续做，没有用分支 diff 代替工作树评审。

候选清单 SHA256：`C8496508E26C4FC8FF34AD2F129C54B53E06951C7BD7AC2E92D56104694ED7A7`。独立评审开始和结束均核对 36/36 文件哈希一致。该摘要锁定此次审查候选，不是部署证明。

- `.ai/knowledge/components/tiptap-content-boundaries.md`
- `apps/web/src/pages/Dev/TiptapPreview/FullDemoEditor.tsx`
- `apps/web/src/pages/Dev/TiptapPreview/MarkdownDemo.module.scss`
- `apps/web/src/pages/Dev/TiptapPreview/MarkdownDemo.tsx`
- `apps/web/src/pages/Dev/TiptapPreview/index.tsx`
- `packages/components/src/index.ts`
- `packages/components/src/tiptap/InsertBlockMenu.module.scss`
- `packages/components/src/tiptap/InsertBlockMenu.tsx`
- `packages/components/src/tiptap/TiptapEditor.tsx`
- `packages/components/src/tiptap/TiptapViewer.tsx`
- `packages/components/src/tiptap/components.test.tsx`
- `packages/components/src/tiptap/emoji.test.tsx`
- `packages/components/src/tiptap/extensions/index.ts`
- `packages/components/src/tiptap/history.ts`
- `packages/components/src/tiptap/insert-block.test.tsx`
- `packages/components/src/tiptap/insert-block.ts`
- `packages/components/src/tiptap/lifecycle.test.ts`
- `packages/components/src/tiptap/lifecycle.ts`
- `packages/components/src/tiptap/markdown/history.ts`
- `packages/components/src/tiptap/markdown/runtime.ts`
- `packages/components/src/tiptap/markdown/useMarkdownEditor.test.tsx`
- `packages/components/src/tiptap/markdown/useMarkdownEditor.ts`
- `packages/components/src/tiptap/mention-popup.test.tsx`
- `packages/components/src/tiptap/official-toolbar.test.tsx`
- `packages/components/src/tiptap/placeholder.ts`
- `packages/components/src/tiptap/presets.test.tsx`
- `packages/components/src/tiptap/presets.ts`
- `packages/components/src/tiptap/table-editor.test.tsx`
- `packages/components/src/tiptap/table/TableControls.tsx`
- `packages/components/src/tiptap/table/node-view.ts`
- `packages/components/src/tiptap/testing/ExplicitToolbarEditor.tsx`
- `packages/components/src/tiptap/toolbar-wrapper.test.tsx`
- `packages/components/src/tiptap/types.ts`
- `packages/components/src/tiptap/useTiptapEditor.tsx`
- `tests/browser/tiptap-markdown.mjs`
- `tests/browser/tiptap-preview.mjs`

本文是评审后产生的报告，不属于上述源码候选。

## 测试意图核查

评审核对公开 Preset 与统一 Hook、初始化固定配置、单 Editor 接线、初始错误锁存、失败原子替换、真实 Undo/Redo 清空、交互 session 取消、原生表格只读、GFM Slash/图片 URL、兼容 Hook 与工具栏显式组合。自动测试使用真实 Editor/扩展与 ExUI，覆盖命令结果、正文、选区、历史、错误和实例归属，未发现阻塞测试缺口。

`table-editor.test.tsx` 的开发前键盘用例失败来自旧菜单导航断言；按当前两列菜单将向下移动由 3 次改为 7 次，仍通过键盘执行真实插表和结构断言，没有降低功能验收。

## 验证证据

独立评审角色实际执行：

- `pnpm exec vitest run packages/components/src/tiptap`：20 文件、403 测试通过。
- `pnpm --filter @workspace/components typecheck`：exit 0。

主代理实际执行：

- `pnpm typecheck`：exit 0。
- `pnpm build`：exit 0，包含 Website、SDK、Server 和 Outline 构建。
- `assertTiptapMarkdown`（包含 `assertTiptapPresets`）、`assertTiptapPreview`、`assertTiptapChromeInteractions`：真实 Playwright 浏览器通过。覆盖系统 HTML 剪贴板、Chromium CDP 中文 IME、Emoji 键盘、Slash H6/图片、危险地址拒绝、来源替换/Undo、共享 Viewer 更新、独立实例、完整富文本 Mention、原生拖动，以及原生表格只读/恢复。未出现 pageerror。
- 375px 深浅主题均无页面横向溢出；桌面、浅色/深色窄屏截图已视觉检查，位于 `output/playwright/presets-light-desktop.png`、`output/playwright/presets-light-mobile.png`、`output/playwright/presets-dark-mobile.png`。
- 生产 Web 可执行产物未检出 MarkdownDemo/TiptapPreview 及新增 DEV 文案；源码路由由 `import.meta.env.DEV` 限定。API 生成文件构建前后哈希一致。

独立评审角色未重复执行浏览器与完整构建；上述证据由主代理执行并如实分开报告。终审形成时根 `pnpm test` 尚在执行，其终态在下方交付验证补记中记录。

## 限制与交付边界

已有开发服务的 `/api/health` 返回失败，控制台有相应连通性日志；本次未修改后端，不把组件浏览器通过视为后端健康或部署验收。Contract 检查保留既有 3 条 schema 警告；构建/测试中的既有工具警告不在本次修复范围。生产直连 404、外部图片可达性、SSR 和第三方 Markdown 渲染一致性均不由此次源码评审证明。

本轮经过中期与最终两轮独立评审，均无遗留 findings。未请求 Commit，因此未暂存、未创建提交；未推送、未部署。About 内容、API 生成文件及其他无关用户改动保留。

## 交付验证补记

2026-10-15 完整 `pnpm test` 结束，exit 0。API Contract 生成、Website、runtime/Docs 脚本、Outline 前端 app/shared-node/shared-jsdom，以及全部九项 Outline 服务端隔离文件清单均通过。最后一组真实 OIDC 流程于本地时间 11:15:54 完成；没有跳过所要求的测试分组，也没有回退开发数据库。

主代理在完整测试结束后再次核验：36/36 源文件 SHA256 与独立终审完全一致；暂存区为空；两个 API 生成文件与构建前哈希一致。本报告是源码评审结束后生成的独立输出，不改变冻结候选。最终状态为 **Complete**：实现、目标与根验证、必要真实浏览器验收和完整工作树评审均通过；未请求提交。已知工具警告及开发后端健康日志保留在上述边界内，无遗留阻塞 finding。
