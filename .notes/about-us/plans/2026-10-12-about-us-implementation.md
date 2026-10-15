# 通用内容层与 About Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. 用户已授权本轮实现，按顺序在当前独立工作树执行，不创建提交。

**Goal:** 完成 About 页面，并为 Website 后续集合提供通用 Fumadocs 内容编译与渲染能力。

**Architecture:** 构建核心接收集合定义，返回公开文档、资源和元数据。About 适配层拥有字段、关联及路由；浏览器通过固定动态 import 加载正文，共享 UI 使用 ExUI。

**Tech Stack:** Vite、React Router、Fumadocs MDX 15.4.7/Core 16.17.1、Zod、Vitest、ExUI。

**Spec:** `.notes/about-us/specs/2026-10-12-about-us-design.md`

## Global Constraints

- 保留单一 BrowserRouter、ThemeProvider 与 ExMessage 宿主；不增加 Next.js 或完整 Fumadocs UI。
- 不改 HTTP Contract、数据库、Outline 或部署状态。
- 内容为仓库内受限静态 MDX/YAML；草稿不进入公开 import 图。
- 当前仅本地实现、验证和独立工作树评审，不提交、推送或上线。

## Task 1：可复用编译及公开注册表

Files: `apps/web/build/content/`、`apps/web/build/about/`、`apps/web/source.config.ts`、`apps/web/vite.config.ts`、`apps/web/package.json`、`apps/web/tsconfig.json`、`pnpm-lock.yaml`、`.gitignore`、`tests/content/`。

Interfaces: `readContent(definition)` 返回公开 `documents/assets/data`；`contentPlugin(definitions)` 提供 `virtual:content/<namespace>`；About 定义导出 `aboutDefinition`。

- [x] 先测第二个集合、草稿排除、非法字段、静态表达式、引用与资源边界，再实现解析及两遍校验。
- [x] 运行 `pnpm exec vitest run tests/content --maxWorkers 2`，确认缺少实现造成失败，然后实现同一链路。
- [x] 配置精确依赖、编译 preset、虚拟注册表、独立 `content:check` 和 HMR。
- [x] 使用真实 Vite build 夹具验证高亮、独立正文、草稿及 Node 模块排除。

```ts
expect((await readContent(fixtureDefinition)).documents.map(doc => doc.id)).toEqual(['intro.mdx'])
```

## Task 2：通用浏览器加载与正文组件

Files: `apps/web/src/content/`、`packages/components/src/content/`、`packages/components/src/index.ts`。

Interfaces: `createContentStore(loaders)` 提供 `load(id)` 与 `clear()`；`useContent(store,id)` 返回 loading/ready/error 和 retry；MDX 映射允许业务扩展覆盖。

- [x] 先测失败重试、并发请求共享、A/B 切换与卸载隔离。
- [x] 先测两个代码块分别复制自己的原始代码，再实现 CodeBlock、图片 fallback、Callout 和 Prose。
- [x] 运行内容和组件针对性测试，验证无全局样式/额外通知宿主。

```ts
await expect(store.load('page')).rejects.toThrow()
await expect(store.load('page')).resolves.toBe(module)
```

## Task 3：About 页面与现有导航集成

Files: `apps/web/content/about/`、`apps/web/src/content/about/`、`apps/web/src/pages/AboutUs/`、`apps/web/src/App.tsx`、`packages/components/src/SiteHeader.tsx` 及测试、`scripts/runtime/tests.mjs`。

Interfaces: 注册表按规范地址查询页面；AboutLayout 注入成员打开行为；模板渲染固定栏目、详情、时间线和媒体。

- [x] 写路径匹配、栏目/面包屑、成员 Modal、Media 和未知 slug 的行为测试。
- [x] 创建标注占位的完整内容，保留真实资料补充边界；实现无图 fallback。
- [x] 实现 `/about` 跳转、移动目录、阅读位置、标题/焦点与锚点定位。
- [x] 补测试 watcher 的内容及配置入口，排除生成目录。

```ts
expect(isAboutPath('/aboutus/projects/sample')).toBe(true)
expect(isAboutPath('/aboutus-other')).toBe(false)
```

## Task 4：验收与知识维护

- [x] 执行 `content:check`、针对性测试、`pnpm typecheck`、`pnpm test`、`pnpm build`，记录实际退出状态并区分基线失败。
- [x] 浏览器验证各栏目、深链接、键盘、目录、Modal、复制和筛选；检查浅深主题与不同视口。
- [x] 用 codebase-documenter 更新已验证的 `.ai/` 内容层边界及编辑说明。
- [x] 用 code-review 的 working-tree 模式独立审查精确 touched paths；修复阻塞问题后复核。
