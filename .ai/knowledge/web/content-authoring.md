# 仓库内容编辑

内容作者编辑 MDX/YAML 后，开发页面会重新检查与刷新。发布构建复用同一检查，非法字段、引用或作者语法不会静默上线。

_最后更新：2026-10-12_

## 编辑 About

内容源位于 `apps/web/content/about/`。正文用 MDX，列表所需字段用 frontmatter；音乐与视频条目维护于 `media/items.yaml`。字段和默认值以 `apps/web/build/about/schema.ts` 为准。

首页 `hero.headline`、`hero.eyebrow` 和 `hero.summary` 用于文字 Hero；可选 `hero.lead` 提供右侧短引言。`introHeading` 是理念标题，首页 MDX 正文完整渲染在理念区。标题可沿用 `\n` 转义换行，长内容仍会自然换行。页面与阅读行为见 `.ai/architectures/web/content-rendering.md`。

`entryHeadlines` 与 `entryDescriptions` 仅允许 communities、projects、team、media、story、donations 六个可选非空字符串，分别覆盖首页栏目标题和简介；省略时使用对应栏目元数据。栏目标签和链接目标由 UI 与已校验注册表管理，不在这些字段中写 URL。

`cardImages` 使用相同六个 key，每项为集合 ImageRef；理念是正文区，没有图片 key。嵌套图片仍经过实际资源存在性与路径边界检查；未填写和浏览器加载失败均显示稳定占位。当前素材未提供，不填写虚构资源路径。`hero.image` 保留内容兼容，但文字 Hero 不消费它。

### 捐赠渠道与名单

`donations.mdx` 维护固定捐赠页的标题、简介与正文；`donations/items.yaml` 独立维护 channels 与 donors。渠道支持 id、name、可选 description、HTTPS url 和集合 qrCode ImageRef；url 与 qrCode 至少提供一个。捐赠者记录 id、nickname、YYYY-MM-DD 格式 date；日期必须是有效日历日期。列表顺序由作者维护，不按金额或时间自动排名。

渠道与捐赠者均支持 `draft: true`，未公开条目不会进入公开投影；清单不要移入 MDX frontmatter，原因见 `.ai/architectures/web/content-rendering.md`。id 在各自列表内必须唯一，含草稿。草稿引用的二维码也必须存在并遵守集合资源边界，草稿独占图片不公开。缺省列表为 []，页面显示整理中状态；只填写已核对并允许公开的昵称、日期和实际渠道，不编造示例捐赠记录或收款地址。

以下仅演示编辑格式，条目为草稿：

```yaml
channels:
  - id: example-channel
    name: 示例渠道
    url: https://example.com/support
    draft: true
donors:
  - id: example-donor
    nickname: 示例昵称
    date: '2026-10-12'
    draft: true
```

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

新栏目不必复制 About 编译器、代码块或加载状态机。模块边界见 `.ai/architectures/web/content-rendering.md`；About 的整体用户体验依据见 `.notes/about-us/specs/2026-10-12-about-us-design.md`，首页布局以 `.notes/about-us/specs/2026-10-12-about-us-refined-design.md` 为准。
