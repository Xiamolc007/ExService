# 统一文档界面验证记录

当前状态：**代码修复与自动检查已完成，整体交付仍缺真实账号验收**。三个实施任务均通过独立复审；最终初审的 7 个 P2 与 2 个 P3 已按完整清单集中修复。修复后的独立门禁以 `.superpowers/sdd/unified-docs-interface-implementation/final-re-review.md` 的实际结论为准，不以实现者自检替代。真实读者/编辑者、OIDC、后来会话、standalone 和 dev/full 验收仍为 NOT_EXECUTED。

## 范围与基线

- 实现依据为 `.notes/archive/docs-integration/specs/2026-10-05-unified-docs-interface-design.md`、`.notes/archive/docs-integration/rfcs/unified-docs-interface-rfc.md`，以及用户确认的 `.notes/docs-integration/previews/unified-docs-interface.html`。
- 加载/失败区使用 Icon、Title、Content；失败原因采用安全文案，Retry 启动实际读取。
- 父仓库基线为 `05b69c5f4194e9a878a94f98bd2a46b635252753`，Outline 为 `6c2279c2829f5f428eb695d88d01fdb69d9c6d54`。
- `.env.example`、`AGENTS.md`、`apps/web/src/pages/IdentityPage/IdentityStatusPage.tsx` 是预存改动，保留并排除本次交付。
- 未请求提交；本次没有暂存、提交、推送、部署、依赖变更或本地数据库准备操作。

## 已完成的自动与独立审查

| 范围 | 实际结果 |
| --- | --- |
| 基线 | Website SignedOutPage 3 tests、Outline WebsitePublic/PublicOnlyGate 17 tests、Outline types 和根 `pnpm typecheck` PASS。尚不能作为后续修改的最终结果。 |
| 共用呈现 | 聚焦 7 文件 / 30 tests、Outline types、18 路径格式检查与 type-aware lint PASS；独立初审发现 3 P2 与 1 P3，修复后 Spec PASS、Quality PASS。 |
| 公共读取首轮 | 聚焦 10 文件 / 55 tests、Outline types、23 路径格式检查与 type-aware lint PASS。含 42 项公共读取相关测试和 13 项共用呈现回归；不与其他轮次重复相加。 |
| 公共读取修复一 | Store/adapter 2 文件 / 41 tests、types、5 路径格式与 lint PASS。独立审查的 F1–F4 已关闭：撤权重读去重、离页取消树、404 旧导航投影、评论提交重试状态。 |
| 公共读取修复二 | Store 22 tests、types、2 路径格式与 lint PASS。网络/服务失败回归先 RED 后 GREEN；独立复审确认 F6 已关闭，Spec PASS、Quality Approved。 |
| 退出恢复首轮 | Outline 14 文件 / 140 tests、types、27 路径格式与 lint PASS；Website 3 文件 / 40 tests PASS。独立初审发现 P1 严格索引类型错误与 P2 发布入口绕过退出等待保护。 |
| 退出恢复修复一 | 发布快捷键与真实发布窗口测试先 RED 2 文件 / 5 failures 后 GREEN。受影响 Outline 7 文件 / 96 tests、Website 3 文件 / 42 tests、两端 types、5 路径格式与 type-aware lint PASS；独立复审原 P1/P2 ADDRESSED、零新增阻塞，Spec PASS、Quality Approved。 |
| 全局类型与构建 | 初次 `pnpm typecheck` FAIL（外层 exit 1 / Web tsc exit 2），修复后相同全局命令 PASS exit 0；本轮最终 Website 源码再次通过全局 types。随后串行 `pnpm build` PASS exit 0，包含 SDK、Website、Server、Outline 前端与服务端；返回按钮最后样式修改后再次完整构建 PASS exit 0。构建有 Vite 动态 import、包体积、Browserslist 等警告；不描述为无警告。 |
| 最终联合聚焦检查 | 波次前 24 project/file / 190 tests PASS；波次后旧路由 mock 与两份 TOC 断言失败，修正测试夹具且保留真实 Routes/Editor 后，`corepack yarn test <23 个精确测试路径>` PASS exit 0：25 project/file / 221 tests。列表为路径清单中的所有 Outline test 文件，另加原 `shared/utils/docsReturnPath.test.ts`；shared 在 node/jsdom 执行。不运行完整 Outline suite。 |
| 最后样式检查 | 最后只改恢复布局按钮 align-self，实际浏览器两阶段 Back 宽度 109.33px、居中；受影响 controller/Public/Logout 3 文件 / 37 tests、Outline types、精确 lint/格式 PASS。该结果与前一联合轮次不重复相加。 |
| Website 最终聚焦 | SignedOutPage、docsReturnPath、docsResumeNavigation 共 3 文件 / 50 tests，以及 web types PASS；共享向量现为 38 组。 |
| 全部 touched paths 的最终 code-review | 初审 FAIL：完整覆盖父仓 15、Outline 65 个路径（含完整 untracked），确认 7 个 P2、2 个 P3，无 P0/P1。修复后的完整范围为父仓 16、Outline 68；最终修复处置与结论见独立 final-re-review.md。任务级通过不能替代这一步。 |
| 全范围格式/lint/types | 最终 68 个 Outline 路径的 oxfmt --check 与 oxlint --type-aware PASS exit 0；Outline tsc PASS。初审 WebsitePublic 格式失败已经修正。 |

Outline 使用独立 `corepack yarn vitest run --project app <聚焦测试路径>`、`corepack yarn tsc --noEmit --pretty false`、`corepack yarn oxfmt --check <精确路径>`、`corepack yarn oxlint --type-aware <精确路径>`。未运行完整 Outline suite。

## 隔离服务端回归

通过现有 `pnpm infra test <测试文件> <literal case>` 执行，使用临时 PostgreSQL/Redis；实际 Node 为受支持的 22.22.1，通过 `INTEGRATION_NODE_BIN` 显式指定。每个报告均为 1 passed / 0 failed / success，合计八个不同的既有用例。

| 测试文件与行为 | 结果 |
| --- | --- |
| `apps/outline/server/routes/api/public/public.test.ts`：草稿先过滤再分页，隐藏父节点的公开子节点提升为根 | PASS |
| 同文件：私有、草稿、缺失统一 404，撤销分享重新核验 | PASS |
| 同文件：搜索与分页仅包含当前公开行，无私有摘要 | PASS |
| 同文件：公开深链接的 SSR 正文与 canonical docs URL | PASS |
| 同文件：sitemap 仅有当前公开 canonical URL | PASS |
| `apps/outline/server/routes/api/attachments/attachments.test.ts`：附件按所属公开文档及当前引用授权，撤销后拒绝 | PASS |
| `apps/outline/server/routes/api/documents/websitePublicRead.test.ts`：登录 publicOnly 读者取得最小当前文档投影 | PASS |
| `apps/outline/server/routes/api/auth/websiteLogout.test.ts`：撤销核验 subject 与选定浏览器会话，保留其他会话 | PASS |

runner 的测试文件参数以 Outline 根目录为基准。原 RFC 的 runner 已过时，本次采用当前根 `package.json` 的 `pnpm infra test`。这些检查没有修改开发数据库；退出用例中的远端 WebsiteIdentityClient 撤销是 Mock，不能证明真实 OIDC 或后来建立的新浏览器会话。

报告目录在 `output/docs-integration-team/outline-tests/`：公开五例为 `5d5e4435-cfd1-4827-9a7d-d8fbebe7167c`，附件为 `8300650d-0014-434e-a9b3-ff7670b5fb21`，publicOnly 为 `7d9ee043-5936-42fd-8e52-27b97998d598`，退出为 `1a1900e9-f9b4-47f0-99a2-6b7688e0cfa4`。

## 浏览器证据与验收矩阵

浏览器使用 canonical `http://127.0.0.1:8080/docs/`。Mock 检查运行实际应用和富文本 Editor，仅拦截公共 RPC；它们不作为真实公开数据、账号权限或 OIDC 证据。截图位于 `output/playwright/unified-docs/`。

| 验收 | 当前证据与限制 |
| --- | --- |
| U01 匿名入口 | 实际 local 空公开总览、公共 shell、侧栏与登录入口 PASS。完整新浏览器身份生命周期待最终检查。 |
| U02 状态 | 浏览器 Mock 加载、503 安全原因、错误 Icon/Title/Content、Retry 恢复、减少动态效果 PASS；实际空集合列表 PASS。两阶段恢复失败均保留品牌/导航与状态焦点，Back 按钮宽度与布局复查 PASS Mock。 |
| U03 完整分页树 | Mock 101 集合 / 102 文档、后续集合目标、跨页父子树 PASS；实际 populated 数据验收 NOT_EXECUTED。 |
| U04 副请求与隐私 | Mock rich reader 没有 integrations、成员 documents.info、unfurl 或匿名 comments 请求；服务端私有/草稿/撤销回归 PASS。真实账号与网络矩阵待验收。 |
| U05 阅读与搜索 | Mock 原富文本正文、只读、搜索结果、侧栏开关、暗色及无横向溢出 PASS。最后复查 Home/search 真实点击和 H1 焦点、输入不丢焦点、桌面/390px 单目录开关、Enter/Space、标题 hash、侧栏 inert PASS Mock。最终深色 Search submit 使用原 36px/9999px 圆角主题 Button。真实 populated 附件及成员读取仍待验收。 |
| U06 登录/评论/编辑 | publicOnly 自动与隔离服务端证据已通过；真实读者、编辑者、登录后原地址、授权写操作 NOT_EXECUTED。 |
| U07 退出阅读恢复 | 实际 Website 匿名退出页 → docsResume → SPA 公共阅读，Mock 目标恢复成功。最终两阶段持续 503 各观测 5 次 info，错误安全、真实 Retry、正文 ?q=privacy、品牌/导航/焦点与 Back 宽度均 PASS Mock。模拟预检后撤销回总览并不显示目标标题 PASS Mock；单测另覆盖恢复期间取得旧树标题再 404 后全清。真实公开/私有退出、失败、新会话与身份失联浏览器检查 NOT_EXECUTED。 |
| U08 身份变化与迟到请求 | 公共 store/adapter 的请求代次回归 PASS；真实跨标签、OIDC 失败抑制与后来会话验收 NOT_EXECUTED。 |
| U09 恶意返回与公开服务端 | SSR/canonical/sitemap/附件/统一 404 的八例隔离子集 PASS；双端 38 组返回路径向量及实际恢复控制器、SignedOutPage 回归 PASS。 |
| U10 独立 Outline 与成员协作 | 独立分支代码和类型检查通过；真实 standalone、分屏、协作、个人功能浏览器验收 NOT_EXECUTED。 |

实际 local 当前没有公开集合，也没有用户提供的读者/编辑者测试账号。旧 dev/full 8090 环境没有准备，本次不为验收迁移、bootstrap 或重建资源。2026-10-06 后续检查中 `/docs/` 短暂返回 502，随后恢复 200，实际 `/api/health` 返回 JSON 200；未重启用户已有服务。`/health` 的 HTML 200 不是健康检查证据。

## 已知限制

- 初审没有将 MobX default-export 警告认定为新生产回归。路由 fixture 已修正；最终联合执行输出未出现该警告与 basename 警告。构建其他警告仍如实保留。
- jsdom 富文本安全/ref 集成 fixture 仅将 interaction plugins 替换为空列表，以隔离既有 DecorationSet CJS/ESM 问题；完整生产插件仅在浏览器 Mock 中通过，未宣称 jsdom 完整插件 PASS。
- fixture 文档不在真实数据库，HMR 或整页访问其深链接会得到真实 SSR 404；使用实际根入口和 SPA 导航验证 Mock，不将它视为真实 populated SSR 验收。
- 初审的 Home/焦点/恢复布局问题已修复并浏览器复查。新截图为 `mock-final-home-focus.png`、`mock-final-resume-controller-shell.png`、`mock-final-resume-reading-shell.png`、`mock-final-mobile-toc.png`、`mock-final-search-dark.png`；旧失败截图仅代表初审候选。
- 一次最终 TOC helper 在构建与后续页操作期间等根标题超时，未形成有效产品结论；顺序执行的全新根入口复测通过。一次恢复 shell helper 继承 390px 视口导致侧栏可见为 false，是正常手机隐藏状态；明确恢复 1440px 后两阶段通过。不同视口的结果不混用。
- 浏览器树取消重开追加检查第一次遇到会话/fixture 丢失与 502，之后一次 helper 未等待路由 effect 完成即放行旧响应，均未形成产品结论。恢复环境并修正同步后，实际 Mock 树请求保持 pending → 切换搜索 → 自动收起 → 重新展开发出第二次读取，通过；截图为 `mock-tree-cancel-reopen.png`。这不代替 F6 强制撤权/网络失败交错的真实权限验收。

最终初审确认的问题为：公共 Home 点击被当前项拦截、缺少内容焦点、两阶段恢复脱离共用布局、身份失败 Retry 重试错误操作、文档返回链接丢失合法 q、公共目录开关及手机目录缺失、修改区域状态契约未统一，以及原生按钮样式与格式门禁。完整清单已集中修复；逐项处置由独立复审记录，不能以实现者自检推断问题已关闭。

精确 touched paths 见 `.notes/docs-integration/reports/unified-docs-interface-paths.txt`，最终父仓库 16 个路径、Outline 子模块 68 个路径。三个原有父仓改动保持基线 diff，两个 HEAD 与暂存区均未改变。本次未请求提交，也不把 local/Mock 证据外推为真实账号、协作或部署验收。
