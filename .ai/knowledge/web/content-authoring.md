# 仓库内容编辑

内容作者编辑 MDX/YAML 后，开发页面会重新检查与刷新。发布构建复用同一检查，非法字段、引用或作者语法不会静默上线。

_最后更新：2026-10-12_

## 编辑 About

内容源位于 `apps/web/content/about/`。正文用 MDX，列表所需字段用 frontmatter；音乐与视频条目维护于 `media/items.yaml`。字段和默认值以 `apps/web/build/about/schema.ts` 为准。

固定首页与栏目介绍不能缺失或设为草稿。社区、项目和成员文件 basename 必须与 slug 一致。未知事实明确使用占位、unknown 或 draft，不填写未经核实的运营状态、日期或来源。

```mdx
---
title: 项目标题
description: 一句话介绍
slug: example-project
status: unknown
draft: true
---

## 为什么做

介绍问题与思路。
```

正文从二级标题开始，不重复模板 h1。支持标准 Markdown、表格和 fenced code；Lua、JavaScript、TypeScript、JSON、YAML、Bash 在构建时高亮，未知语言保留名称并按纯文本展示。

```mdx
<Callout title="阅读提示" kind="note">说明文字。</Callout>
<ContentImage image={{src: "assets/example.webp", alt: "图片说明", width: 1200, height: 800}} />
<AboutLink target="page:projects">查看项目</AboutLink>
<MemberButton slug="example-contributor">查看贡献者</MemberButton>
```

作者组件的属性必须是字符串或静态 JSON 形态值；不允许 import/export、任意表达式、事件属性、原始 HTML、展开或函数调用。组件白名单及属性契约在 About schema 中登记。MDX 是仓库编辑契约，不是执行不可信输入的沙箱。

普通外链须为没有凭据的 HTTPS URL；内部链接、完整解码后的锚点、AboutLink 和 related 目标必须已存在。slug/id 直接校验原始 ASCII kebab-case 值，不自动修剪空格，防止校验结果与静态 JSX 渲染值不同。公开条目不能引用草稿；草稿仍需有效字段和存在的引用。加入入口只能用于 active 社区，且目标要通过校验。

图片放入该集合 assets 目录，提供非空 alt 与正整数宽高。路径不能跳出资源目录；替换失败的图片仍显示 fallback。发布前由作者核对真实比例、版权与图注，不把宽高存在校验当作图片内容验收。

执行 `pnpm --filter @workspace/web content:check` 检查已注册集合；真实编译与前端验证使用 `pnpm --filter @workspace/web build` 和项目测试流程。

## 增加其他内容栏目

1. 为新业务创建内容目录与 schema/定义，复用 `ContentDefinition`，给出独立 namespace、文件分类、组件属性检查和公开投影。业务引用规则留在该适配器中。
2. 在 `apps/web/build/collections.ts` 注册定义，在 `apps/web/source.config.ts` 显式导出相应 Fumadocs 集合。配置文件变更按 Vite 提示重启开发服务。
3. 声明 `virtual:content/<namespace>` 的浏览器类型，通过 `createContentStore(loaders)` 与 `useContent` 加载正文。复用 `createMdxComponents`，注入本业务链接、资源和特殊组件。
4. 在 Web 中定义页面与导航，不把路由或交易数据放入通用组件。为该集合添加字段、引用、草稿和实际编译测试。

新栏目不必复制 About 编译器、代码块或加载状态机。模块边界见 `.ai/architectures/web/content-rendering.md`；About 的用户体验依据仍保留在 `.notes/about-us/specs/2026-10-12-about-us-design.md`。
