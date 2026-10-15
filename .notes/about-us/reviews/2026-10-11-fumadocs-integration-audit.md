# Fumadocs 接入影响审查

日期：2026-10-11。范围：About 内容层及未来文档组件的接入选择；不实施业务页面，不接入 Tebex，不迁移 Outline。

## 结论

采用 Fumadocs MDX/Core 的构建时内容能力，并将少量文档组件适配为 ExUI/CSS Modules，可以保留现有 Vite、React Router 声明式 SPA、Fastify 和 Contract-first 架构。这是局部集成，工作主要集中在 Web 内容编译、内容适配层和文档组件。

直接引入完整 Fumadocs UI 布局、默认 RootProvider 和全局样式则有明显更大的影响，不作为本次推荐方案。源码组件复用属于本地维护的适配版本，不等于完整 UI 包的自动升级能力。

## 当前项目证据

- `apps/web/package.json`：Vite 8.3、React 19.3、React Router 8.4、ExUI 0.8、Zod 4.6.5。
- `apps/web/src/main.tsx`、`apps/web/src/App.tsx`：单一 BrowserRouter，声明式路由，无 SSR。
- `apps/web/vite.config.ts`：现有 runtime 入口、代理、HMR 和安全边界；不应替换为文档站模板。
- `apps/web/src/routes/RootLayout.tsx`：已有顶栏、认证、设置和通知生命周期。
- `apps/web/src/settings/WebsiteThemePreferenceReconciliation.tsx` 和 `.ai/architectures/docs-integration/integration-boundaries.md`：Website 与 Outline 共享主题偏好协议。
- `pnpm-workspace.yaml`：`autoInstallPeers: false`，已允许 esbuild 安装脚本；Outline 不属于 pnpm workspace。
- `scripts/runtime/build.mjs`：现有构建阶段不需要数据库或运行服务。
- `vitest.config.ts`：当前没有 MDX 转换插件；导入实际内容的测试需提供适配，或通过独立内容构建与浏览器验证覆盖。
- 已安装 ExUI 发布包提供 `@exre/exui/docs/theme.css`，但该入口同时导入 Token 样式、Fumadocs shadcn 色彩和 preset。直接在当前入口使用会重复 Token 导入，并增加全局样式影响。

## 分项影响

| 项目 | 推荐方案的影响 |
| --- | --- |
| 框架与路由 | 小：增加内容路由和 URL 到内容的映射，保留 BrowserRouter 与已有布局。 |
| Web 构建 | 中：增加 MDX 插件、集合配置、构建时 schema 校验和内容分块；配置及生成目录需要明确类型检查与忽略规则。 |
| 样式与主题 | 小至中：文档组件使用 CSS Modules 和已有 ExUI token，继续由 ExUI 管理主题。 |
| 依赖 | 增加编译工具依赖；不要求 Next.js。选取源码组件应逐项移除重复 UI 实现依赖。 |
| Fastify、Contract、数据库 | 静态内容无需修改；未来交易业务另按现有 Contract-first 边界接入。 |
| Outline | 保留 `/docs` 归属，新插件文档使用独立 Website 路径。 |
| 测试 | 增加内容校验、导航、代码复制与主题场景；不改变现有数据库测试流程。 |
| SEO | 本次接入不自动实现 SSR、每页静态 HTML 或分享卡片；这些能力需另行设计。 |

## 发现与选择

### 当前独立 meta Macro 路径有可复现运行时故障

隔离验证使用 `fumadocs-mdx@15.4.7`、`fumadocs-core@16.17.1`。`defineCollections({ type: 'meta' })` 的生成调用传入 `meta` 属性，而 runtime Macro 的 `meta()` 读取 `entries` 属性，浏览器初始化集合时抛出 `TypeError: Cannot convert undefined or null to object`。类型检查和构建不会暴露该故障。

Macro runtime 还引用具有 Node 文件系统方法的 server runtime，构建出现浏览器 externalization 警告。推荐方案改为常规集合配置，浏览器仅加载已编译内容，不导入 server 集合入口。未修补依赖或提出全站迁移。

### MDX 插件默认会合并 Vite 配置

审查的版本默认调整依赖优化、SSR externalization 和一个构建 alias。隔离候选使用 `updateViteConfig: false` 和 `macro: false`，仍通过开发与生产验证。实际项目接入时应审查最终合并配置，保留现有代理、HMR、安全头和 React 单实例约束。

### 直接 UI 包会增加第二套界面实现

`fumadocs-ui@16.17.1` 的依赖包含 Radix 组件、`next-themes`、motion 等；其 CodeBlock 模块还导入 Tabs。按需导入不等于消除安装依赖。标准样式包含 Tailwind/preset 与全局颜色调整，默认 RootProvider 会管理主题。

因此优先选取 CodeBlock、Steps、Files 等文档专用源码组件，逐项适配 ExUI 操作控件、CSS Modules 和已有主题。保留上游许可证与来源，明确本地升级维护责任。完整 UI 包及其默认主题提供器未做浏览器集成验收。

## 验证边界

所有实验均在仓库外的临时目录执行，采用项目相同的主要前端版本，并引用当前安装的 ExUI 发布包。没有修改项目依赖、lockfile、生产代码或运行配置。实验使用简化首页和内容页，不是实际业务首页。

| 状态 | 检查 |
| --- | --- |
| PASS | 常规配置方案的严格 TypeScript 检查与 Vite 生产构建。 |
| PASS | Chrome 加载生产内容页，渲染 MDX、YAML 和构建时 Lua 高亮。 |
| PASS | Chrome 开发模式下 MDX/YAML 热更新，以及声明式 Link 导航。 |
| PASS | 非法 YAML URL 在构建时被 schema 拒绝。 |
| PASS | 推荐候选的浏览器 chunk 模块清单没有 MDX 编译器、Shiki 引擎、Zod、Node 文件系统或新增 Radix 实现模块。 |
| PASS | 隔离依赖树未安装 Next.js；开发与预览进程已停止。 |
| FAIL | 当前版本的独立 YAML meta Macro 浏览器初始化；已排除该接入路径。 |
| NOT_EXECUTED | 当前项目完整构建、测试和真实业务页面回归。 |
| NOT_EXECUTED | 完整 Fumadocs UI 的实际包体积、样式、主题和弹窗回归。 |
| NOT_EXECUTED | 适配后的完整 CodeBlock 行为、复制交互和无障碍验收。 |
| NOT_EXECUTED | 集成代理下的 HMR、Outline 主题同步、SEO 和部署验收。 |

小规模样例的构建时间与包体积不作为全站性能预算。

## 官方参考

- [Vite 接入](https://www.fumadocs.dev/docs/mdx/vite)
- [集合与构建时校验](https://www.fumadocs.dev/docs/mdx/collections)
- [Macro API](https://www.fumadocs.dev/docs/mdx/macro)
- [代码块与源码接入](https://www.fumadocs.dev/docs/ui/components/codeblock)
- [UI 主题与全局样式影响](https://www.fumadocs.dev/docs/ui/theme)
- [MDX 发布元数据](https://registry.npmjs.org/fumadocs-mdx/15.4.7)
- [UI 发布元数据](https://registry.npmjs.org/fumadocs-ui/16.17.1)
