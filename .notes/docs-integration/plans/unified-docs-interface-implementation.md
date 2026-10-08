# 统一文档界面实施计划

规格：`.notes/archive/docs-integration/specs/2026-10-05-unified-docs-interface-design.md`。
RFC：`.notes/archive/docs-integration/rfcs/unified-docs-interface-rfc.md`。
已确认界面：`.notes/docs-integration/previews/unified-docs-interface.html`。

## 全局约束

- 只在已有 Website 集成模式启用公共工作区布局；非集成 Outline 保持原行为。
- 公共数据只来自四个真实 Outline public RPC，不新增 Website operation、数据库或授权规则。
- 公共 DTO 不写入成员实体 store、IndexedDB；匿名不挂载个人/成员/历史/保存副请求。
- 共用呈现不强制依赖 User/Team；身份专属快捷键、WebSocket、通知和编辑逻辑保留在授权边界。
- 退出仍验证固定 auth.delete 响应；返回路径仅作导航提示，不能证明身份或公开可见性。
- 修改区域状态区统一 Icon、Title、Content；加载用旋转图标，失败用错误图标、安全失败原因和重试 Action。
- 保留用户已有工作区改动；不创建提交、推送、部署、修改依赖链接或重置数据。
- Outline 使用独立 Corepack/Yarn；数据库测试只用隔离 PostgreSQL/Redis。当前隔离入口为 `pnpm infra test`。
- 每个任务运行行为测试并做独立任务审查，最终 code-review 必须覆盖父仓库与子模块全部 touched paths。

## Task 1: 共用布局与呈现

抽取 DocsLayout、DocsNavigation 和 DocumentReadingFrame，使公共与成员使用同一布局/导航基础/正文排版。保留工作区 provider、分屏、编辑、目录偏好和个人功能的原有身份边界。公共目录呈现接口仅接受 headings 与导航回调。抽取搜索输入/结果所需的共用呈现边界，保留真实 DTO 字段差异。添加无 User/Team 呈现、状态区、导航和阅读框架的行为测试。

## Task 2: 公共 store 与路由

实现非持久 PublicDocsStore 及 RootStore 清理，完整集合分页与按展开集合聚合文档树、稳定排序、缺父/环保护、请求代次、in-flight 去重、重试与取消。WebsitePublic 接入共用呈现，分离身份探测/公共正文/搜索。公共深链接定位集合与祖先，PublicOnlyGate 保持安全副请求边界。测试超过100项、多页父子、后续集合页目标、无进展、失联/404、身份切换迟到结果及公共请求白名单。

## Task 3: 登录与退出阅读恢复

实现两端窄阅读路径校验器及相同测试向量；Outline 预检公开目标后给固定退出页加 docsReturnTo。退出等待立即禁用写操作，失败提供明确重试。Website 核验 signed-out/active/unavailable 并保护新 token，通过 docsResume 总览继续流程返回；Outline 用 Router 清除查询、匿名复核，再执行 SPA replace，避免私有目标 SSR 404。直接 /logout、失败、撤销、新会话和恶意路径均需测试。

## Task 4: 联合验证与知识同步

运行聚焦测试、Outline 类型/lint/格式化、Website 类型与完整构建，必要的隔离 Koa 回归。真实浏览器按 U01–U10 记录自动、Mock、真实 local 与未准备 dev/full 环境的不同证据。修复独立审查确认的问题，使用 codebase-documenter 同步已验证的 `.ai/` 模块知识，最后对全部工作树改动执行 code-review。所有阻塞未通过前不宣称完成。
