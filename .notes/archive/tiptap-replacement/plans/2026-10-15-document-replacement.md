# Document Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. 用户已授权在当前专用 worktree 直接实施；不提交、不推送。

**Goal:** 集中双预设的替换协议与诊断，删除旧 Markdown Hook。

**Architecture:** 包内 ContentSession 组合两个 ContentAdapter。共享 gate 提供回执与诊断时序，完整 runtime 保留上传和 Mention，GFM guard 保留粘贴规则。

**Tech Stack:** TypeScript、React、Tiptap/ProseMirror、Vitest、Playwright。

**Spec:** `.notes/tiptap-replacement/specs/2026-10-15-document-replacement-design.md`；内部契约见 `.notes/tiptap-replacement/rfcs/document-replacement-rfc.md`。

## Global Constraints

- 删除旧入口，不留兼容层；不改变 JSON 格式或两个 preset 的内容规则。
- 不改无关工作，不提交、不部署；真实浏览器与自动测试分别报告。
- 替换拒绝保持状态；接纳后才清历史与失效会话。

## Task 1：共享协议与真实入口回归

Files：新增 `packages/components/src/tiptap/content-session.ts`、`content-gate.ts`；修改 `lifecycle.ts`、`markdown/runtime.ts`、`markdown/guard.ts`、`presets.test.tsx`。

Interfaces：`ContentAdapter` 提供 parse/validate/serialize；`ContentSession` 提供 read/export/replace/focus 和生命周期接线。

- [x] 运行现有 Tiptap 专项作为基线。
- [x] 添加双预设追加事务、独立快照、回调异常和重入通知回归；例如 `onChange(A)` 内替换 B，断言 `change:A, notice:A, change:B, notice:B` 且 A/B 分别返回自己的快照。
- [x] 执行 `pnpm exec vitest run packages/components/src/tiptap/presets.test.tsx`，确认新回归因现有行为失败。
- [x] 实现共享 gate 与会话，接线两个 runtime，保留上传/Mention 和粘贴独立规则。
- [x] 重跑新回归及 lifecycle/guard 专项直到通过。

## Task 2：删除兼容入口与迁移

Files：`markdown/useMarkdownEditor.ts`、`markdown/useMarkdownEditor.test.tsx`、`markdown/types.ts`、`markdown/index.ts`、`markdown/history.ts`、`markdown/extensions.ts`、`packages/components/src/index.ts`、`useTiptapEditor.tsx`、`apps/web/src/pages/Dev/TiptapPreview/MarkdownDemo.tsx`。

Interfaces：公开保留统一 Hook/handle、两个 preset、转换和 extensions 工厂；不再暴露旧 Hook/types。

- [x] 将旧 Hook 有效测试迁移到统一入口，保留 StrictMode、解绑交接、诊断和独立实例覆盖。
- [x] 删除旧 Hook 与 history 别名，迁移 DEV 示例、导出和内部类型。
- [x] 运行 `pnpm exec vitest run packages/components/src/tiptap --reporter=dot` 与 components 类型检查。

## Task 3：验证与知识同步

- [x] 顺序执行根类型检查、受影响构建；在可用的既有服务上运行 `tests/browser/tiptap-markdown.mjs` 相关流程。
- [x] 核对 diff 与所有调用迁移，按 codebase-documenter 更新 `.ai/knowledge/components/tiptap-content-boundaries.md` 中与实现有关的事实。
- [x] 记录实际通过项、限制与剩余风险，保留未提交工作。

## ????

??????????????????? `.notes/tiptap-replacement/reports/verification.md`?????????????????????????
