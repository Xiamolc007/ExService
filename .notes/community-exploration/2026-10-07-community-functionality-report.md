# 多 FiveM 服务器社区功能调研

当前 ExWebsite 已形成账号、加入申请和文档服务的基础，但尚未形成“发现多个服务器 → 获得各服资格 → 连接游戏 → 参与社区 → 求助与回访”的完整产品闭环。最值得先细化的方向是服务器发现与加入指引、审核权限与运营基础，以及账号交付可靠性；游戏身份绑定、各服准入和状态接入需要与实际服务器负责人一起确定事实来源。

本报告是供用户选择后续方向的**探索性候选**。下列优先级和最小范围均为建议，不代表用户已选定、团队已放行或已获实现授权。

## 1. 基准与判断方法

- 报告版本：`v1.0`；检索与源码核对日期：`2026-10-07`（Asia/Shanghai）。
- 主仓库 HEAD：`05b69c5f4194e9a878a94f98bd2a46b635252753`；Outline 子仓库 HEAD：`6c2279c2829f5f428eb695d88d01fdb69d9c6d54`。
- 实际分析对象是上述 HEAD **加当前工作树**。工作树已有其他任务的 Website 身份页、Outline 阅读界面及相关文档改动；这些不能视为已提交版本或已验收能力。附录记录关键源码文件 SHA256，便于 Reviewer 对照同一候选。
- 本报告保存于 `.notes/community-exploration/2026-10-07-community-functionality-report.md`，**未提交、未推送**。本轮只新增调研材料，保留已有改动；未修改生产代码、操作服务或数据库、部署，也未把建议写入 `.ai/`。
- 入口核对：`.ai/README.md`、`.ai/CONTEXT.md`、`.ai/databases/data-model.md`、`.ai/architectures/overview.md`、`.ai/architectures/monica-team/workflow.md`、文档集成知识、`README.md` 和 `docs/runtime.md`。当前事实再与 Contract、路由、调用、handler、service、物理 schema 交叉核对。
- 外部调研使用官方公开网页的实际打开与链接跳转，属于文本浏览核验；未登录、未提交申请、未购买、未加入 Discord、未启动游戏。动态数据和受保护后台不在核验范围。

状态用语统一如下，避免将代码存在写成用户可用：

| 状态 | 本报告含义 |
| --- | --- |
| 已实现闭环（源码） | 用户入口、前端调用、后端行为和持久数据链路均可追踪；仍须单独运行验收。 |
| 局部实现 | 有可执行环节，但交付渠道、权限、跨服务落地或后续动作缺口使目标流程不完整。 |
| 页面占位 | 可见元素存在，但没有对应可执行动作或业务页。 |
| 缺失（仓库内） | 综合路由表、完整 Contract、handler 登记、服务模块及数据结构，未找到承载该业务的链路。只对本仓库成立。 |
| 无法验证 | 缺少运行、内容、游戏服务器或外部平台证据；不能据此判定现实中没有该能力。 |

“已实现闭环（源码）”不是本轮浏览器 PASS。未运行 `pnpm test`、`pnpm typecheck` 或 `pnpm build`；已有测试文件只作为可核对的覆盖线索，不沿用其历史成功结果。**本报告不提供完整度百分比**，因为目标功能分母、权重和实际外部承接范围尚未确定。

## 2. 当前功能盘点

### 2.1 玩家进入与账号

| 功能 / 层级 | 状态与实际边界 | 仓库证据 |
| --- | --- | --- |
| 社区首页 / 社区级 | 页面占位。首页有视觉背景及“FiveM打开”“玩家社区”按钮；两个按钮未绑定点击、链接或连接地址。 | `apps/web/src/pages/Home.tsx` |
| 多社区导航 / 社区级 | 局部实现。静态导航列 Rifling 911、CAEP，Join 只有 Rifling 911；没有可管理的服务器目录、筛选或统一详情模型。社区名称不能等同于已对接的游戏服务器实例。 | `packages/components/src/SiteHeader.tsx`、`apps/web/src/App.tsx`、`apps/server/src/db/schema.ts` |
| Rifling 911 介绍与申请 / 当前单一入口 | 已实现闭环（源码）的申请提交部分。支持新玩家、经验玩家两套多步表单、承诺、经验附件、提交反馈、重复申请后去查询；提交进入 PostgreSQL。页面要求不等于已在游戏中执行年龄或资格检查。 | `apps/web/src/pages/JoinPage/Rifling-911/index.tsx`、`packages/components/src/join/CompleteJoinApplicationModal.tsx`、`apps/web/src/join/client.ts`、`apps/server/src/join/service.ts` |
| CAEP 页面 / 社区级历史介绍 | 局部静态内容及页面占位。正文明确“2022.12-2026.4 - CAEP已停止运营”，“关于CAEP”按钮无动作；本轮未向运营方核实真实停服事实。 | `apps/web/src/pages/JoinPage/CAEP/index.tsx` |
| 申请结果 / 社区级 | 已实现闭环（源码）。按邮箱主动查询待审、通过、拒绝、邀请到期、已注册等状态并给下一步。拒绝或过期转 QQ/KOOK 联系；没有站内复议、补充资料或处理进度。查询只凭邮箱，不证明邮箱持有者，增加详情前需重新审视隐私。 | `apps/web/src/pages/JoinResultPage/index.tsx`、`apps/server/src/join/service.ts` 的 `query`、`api/openapi.yaml` 的 `queryJoinApplicationResult` |
| 邀请验证与账号创建 / 社区级 | 局部实现。资格检查、验证码重发/核验、短期完善凭证、建号及转登录均可追踪；但实际 Server 组装没有注入邮件 provider，默认 mailer 只将邮件内容和验证码输出终端。`sent` 在此表示 adapter 成功返回，不能证明玩家收到邮箱邮件。 | `apps/web/src/invitations/InvitationRegistrationFlow.tsx`、`apps/server/src/invitations/service.ts`、`apps/server/src/invitations/mail.ts`、`apps/server/src/auth/create-services.ts`、`apps/server/src/server.ts` |
| 邮箱密码登录、本人资料、退出 / 社区级 | 已实现闭环（源码）。会话持久化、本人读取/更新、头像裁剪上传和移除、QQ/FiveM ID 修改、退出可追踪。邮箱界面只读；未找到自助密码找回/修改或账号恢复链路。 | `apps/web/src/auth/AuthFlow.tsx`、`apps/web/src/settings/useSettingsController.ts`、`packages/components/src/SettingsPanel.tsx`、`apps/server/src/auth/service.ts`、`apps/server/src/profile/service.ts`、`api/openapi.yaml` |
| 第三方登录与验证码防护 / 社区级 | 页面/接口占位。Google、QQ 登录按钮禁用；captcha handler 返回 1×1 PNG，登录服务不核验图片答案。邀请限流、冷却与密码计算资源预算已有实现，不能将它们等同于有效图片验证码。 | `packages/components/src/auth/LoginForm.tsx`、`apps/server/src/handlers/auth.ts`、`apps/server/src/auth/service.ts`、`apps/server/src/invitations/service.ts`、`tests/auth/shared-password-budget.test.ts` |
| 统一文档身份 / 社区级 | 局部实现，运行无法验证。Hydra OIDC、绑定、会话检查/撤销和 outbox 已有实现，Outline 有 OIDC 接入；当前配置的受信任 client 面向 Docs 和开发 probe，不能推导出游戏服 SSO 已接入。 | `apps/web/src/pages/IdentityPage/OidcPage.tsx`、`apps/server/src/identity/config.ts`、`apps/server/src/identity/oidc.ts`、`apps/server/src/identity/outbox.ts`、`apps/outline/plugins/oidc/server/auth/oidc.ts` |
| FiveM / Steam / Discord 可信绑定 / 社区到服务器 | 局部资料字段，可信绑定缺失。`fivemId` 可手填和重复，无验证事实；界面明确不用于认证、社区组或权限。未找到游戏端 challenge、绑定冲突、撤销和复核链路。 | `packages/components/src/SettingsPanel.tsx` 的 `AccountContent`、`apps/server/src/profile/service.ts`、`apps/server/src/db/schema.ts`、`.ai/databases/data-model.md` |

申请数据目前按**邮箱跨类别永久一次**约束，拒绝、邀请到期和注册完成不释放登记。`join_applications` 和表单没有 `serverId`，`applicationType` 表示新玩家/经验玩家，不表示服务器。将现有表单复制到另一服会涉及规则和模型变化，不能当作纯前端扩展。证据：`apps/server/src/db/schema.ts`、`apps/server/src/join/service.ts`、`.ai/databases/data-model.md`。

### 2.2 各服准入、内容、求助与运营

| 功能 / 层级 | 状态与实际边界 | 仓库证据 |
| --- | --- | --- |
| 申请审核工作台 / 当前加入流程 | 局部实现。列表/分页、详情、附件下载、同意/拒绝、重发、投递状态已接通；但各 `/admin/join/...` operation 使用 `security: []`，页面无角色门禁，handler/service 不检查审核人，数据库更新固定 `reviewed_by_user_id = NULL`。这是开发审核能力，不是可直接面向真实玩家资料的安全管理闭环。 | `api/openapi.yaml`、`apps/web/src/pages/JoinReviewPage/index.tsx`、`apps/server/src/app.ts`、`apps/server/src/handlers/join.ts`、`apps/server/src/join/service.ts`、`apps/server/src/join/transport.ts` |
| 社区身份组 / 社区级 | 局部数据基础。存在 group/member 表；普通账号无显式成员关系，admin 为预留显式组。没有将该组用于上述审核授权的入口，亦未找到站内组管理流程。 | `apps/server/src/db/schema.ts`、`apps/server/src/community/schema-check.ts`、`.ai/CONTEXT.md` |
| 各服白名单、职位、封禁、撤权 / 服务器级 | 缺失（仓库内），现实承接无法验证。没有 server/member/entitlement 等业务模型、按服申请或游戏端生效回执。Website 账号停用联动 Outline，不等于所有游戏服封禁。 | `api/openapi.yaml`、`apps/server/src/app.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/auth/service.ts` |
| 服务器连接、在线状态、人数、维护与排队 / 服务器级 | 首页连接入口占位；数据接入缺失（仓库内）。`getHealth` 仅返回 Website `ok`，不是 FiveM 实例状态。未找到游戏端 connector、状态采集/缓存/过期展示或排队链路。 | `apps/web/src/pages/Home.tsx`、`apps/server/src/handlers/health.ts`、`api/openapi.yaml`、`apps/server/src/app.ts` |
| 规则、攻略、搜索与文档评论 / 社区及文档集级 | 局部实现，实际内容和运行无法验证。Outline 有公开集合/文档列表、正文和搜索 RPC，前端有目录/搜索/阅读，受保护评论有读取与提交调用；成员编辑和协作由 Outline 管理。当前工作树仍有阅读界面改动。不能因为 Website Contract 没有文档 operation 就说文档不存在；也不能由代码证明规则已发布或权限已配置。 | `apps/outline/server/routes/api/public/index.ts`、`apps/outline/server/commands/publicAccess.ts`、`apps/outline/app/routes/index.tsx`、`apps/outline/app/scenes/WebsitePublic.tsx`、`apps/outline/app/scenes/WebsitePublic/PublicComments.tsx`、`.ai/architectures/docs-integration/integration-boundaries.md` |
| QQ / KOOK 交流 / 当前社区入口 | 局部外部链接。配置有两个 HTTPS 邀请地址，加入页和结果页消费；没有核验邀请有效性、外部群权限、机器人同步或响应时效。可外部承接交流，但不能记为站内论坛或完整求助流程。 | `apps/web/public/config.json`、`apps/web/src/join/community.ts`、`apps/web/src/pages/JoinResultPage/index.tsx` |
| Gallery、About / 社区级 | 导航占位。菜单有 `/gallery`、`/about`，`App.tsx` 没有匹配业务 route，会落入 NotFound。没有站内玩家作品提交、展示与审核链路。 | `packages/components/src/SiteHeader.tsx`、`apps/web/src/App.tsx` |
| 论坛、招募、玩家关系与组织 / 社区或服务器级 | 缺失（Website 内）；文档评论局部承担围绕文档的讨论。聊天、部门招募、角色关系可能由外部群或游戏内完成，无法验证，暂不建议重复搭建整套社交系统。 | Website 路由、Contract、handler 登记和 schema；Outline 评论消费点见上行。 |
| 帮助、投诉、封禁申诉、Bug/补偿 / 社区与服务器级 | 缺失（站内工单链路）。现有联系方式只提供跳转，没有案件编号、服务器归属、处理人、保密范围、回复/状态、独立复核或结果回执；游戏内及外部群实际流程需核实。 | `apps/web/src/pages/JoinResultPage/index.tsx`、Website 路由/Contract/schema 全量核对。 |
| 通知、公告、活动 / 社区和服务器级 | 局部即时反馈；持续通知与活动业务缺失。ExMessage 是当前动作提示，邀请邮件是特定投递，Outline 有自身工作区通知，均不能替代跨服务器订阅、活动报名、提醒、公告过期和已读状态。 | `apps/web/src/pages/JoinPage/Rifling-911/index.tsx`、`apps/server/src/invitations/service.ts`、`api/openapi.yaml`、`apps/server/src/db/schema.ts`、`apps/outline/app/components/AuthenticatedLayout.tsx` |
| 管理运营、运行与存储 / 社区级基础 | 局部实现。有账号停用/恢复 CLI、申请处理、请求标识、显式迁移和文件/COS 存储基础；没有统一的按服运营台、授权管理、审核人审计、工单/申请漏斗或持续接入健康视图。通用存储不等于投诉证据具备私有访问、保留和删除规则。 | `apps/server/src/cli/auth-disable.ts`、`apps/server/src/cli/auth-enable.ts`、`apps/server/src/errors.ts`、`apps/server/src/modules/storage/`、`docs/runtime.md` |

缺失判断基于多个入口交叉核对，不以某个关键词没有搜到为依据。源码闭环的覆盖线索包括 `tests/contract/join.test.ts`、`tests/join/postgres-flow.test.ts`、`tests/contract/auth.test.ts`、`tests/contract/profile.test.ts`、`tests/auth/identity.test.ts` 以及 Outline 公共阅读相关测试；**本轮未执行这些测试**。

## 3. 官方社区参考

以下五个社区均实际打开了官方公开页面；另附一个跨游戏样本。选择依据是功能分工与可观察信息价值，不是人气排名。统一检索日期为 **2026-10-07**；网页可能由工具缓存返回，日期代表本次检索，不保证每个动态字段在该时刻实时有效。页面自称“最大”“第一”等营销用语不作为结论。

### R1. RSM.GG：多服务器发现与状态信息

[官方首页](https://rsm.gg/)直接给 View servers 和 Discord 入口；[服务器总览](https://rsm.gg/servers)有游戏服列表、人数/延迟历史、CDN 统计与服务器更新区域。适合借鉴“先选服，再连接”的信息层级。它偏 Freeroam，准入复杂度与严肃 RP 不同，不能直接照搬。

**可核实程度：**页面文本可读，但动态列表、图表值没有完整呈现；首页抓取出现“0 other players”，不能据此认定停服。无法核实在线规模或“largest”说法。网站展示的游戏内功能仅是官方介绍，本轮没有游玩验证。

### R2. New Day RP：申请前信息与社区回访

[官方论坛](https://newdayrp.com/)可观察到 FAQ、Rules、Get Whitelisted、Wiki、Discord、Calendar 导航及公告、指南和近期帖子；[官方规则帖](https://newdayrp.com/threads/new-day-rp-rules-and-guidelines.24/)引导通过 support ticket 咨询。可借鉴“申请之前有规则，回访有新内容”的入口组织。论坛不等于 ExWebsite 必须重建论坛，现有 Outline 与外部群可先分工。

**可核实程度：**首页显示论坛统计和近期活动，是存在历史内容的信号；未独立核验统计，也不把注册会员数等同活跃玩家。Get Whitelisted 链接打开未取得可用正文，后续 `/whitelist/` 探索请求返回 403；未验证申请提交、后台审核或日历报名。

### R3. Circuit Roleplay：进入、回访与外部求助的明确分工

[官方首页](https://www.circuitrp.com/)连接规则、攻略、FAQ、申请、Play 和创作者入口；[Play 页面](https://www.circuitrp.com/queue)明确要求 Discord 登录后查看服务器访问资格和进入队列；[Support 页面](https://www.circuitrp.com/support)明确将账号、购买及申请问题交 Discord ticket，同时提供 FAQ/指南。适合借鉴“有账号后还要解释游戏访问资格”与明确求助责任。本站已有邮箱账号，Discord 可作为外部协作入口，不能据此改成唯一身份来源。

**可核实程度：**[Applications 页面](https://www.circuitrp.com/applications)只观察到职位/特殊角色申请说明，未取得表单；队列与资格数据受登录限制，人数停留在 Checking 状态。未验证实际排队/权限同步，也未核实玩家规模。赞助层级的公开展示不构成本项目商业化建议。

### R4. Nopixel：按服务器区分支持渠道

[官方首页](https://www.nopixel.net/)有更新内容与规则入口；[官方 Rulebook](https://www.nopixel.net/rules)标注最后更新 `2026-09-07`，公开说明 V、4.0、Public 使用不同的 Hub、论坛或游戏内报告渠道，并说明 Discord 为社区交流用途。可借鉴“每服明确去哪报告”的路由原则和规则版本信息。它自身渠道复杂，本站可先做清晰分流，不需先复制 Hub。

**可核实程度：**上述分工属于官方规则说明，未登录 Hub、验证游戏命令或处罚后台。没有可核实的当前活跃规模，不据品牌知名度给功能排序。

### R5. New Dawn RP：轻量官网与专业文档分工

[官方首页](https://www.newdawnrp.com/)集中提供加入、文档、规则、Discord 和商店入口；由其导航打开的[官方文档](https://docs.newdawnrp.com/)返回职业教程正文。可借鉴官网负责入口、文档服务负责攻略的分工，契合本站 Outline 边界。法语社区、单服入口及商业入口与本站目标不同。

**可核实程度：**本次文档根地址返回 Interim 职业文章，不能当作完整文档总览；首页登录和加入动作的动态行为未验证。无可靠规模/热门程度证据；不据导航存在推导账号绑定或白名单自动化。

### R6. Rustafied：补充的跨游戏运营内容样本

[官方首页](https://www.rustafied.com/)可见日期明确的更新文章，以及账号门户、Support 和 VIP 链接。可借鉴持续更新让玩家回访的方式；Rust 的 wipe 节奏不能直接套到 FiveM RP。

**可核实程度：**只确认公开内容及入口。[账号门户](https://my.rustafied.com/)和[支持页](https://www.rustafied.com/support)本次返回 403，服务器列表探索请求不可访问；不把它作为已核实多服管理、申诉或身份能力的证据，也不引用无法核实的规模。

### 无法纳入主要比较的来源

[Eclipse RP 论坛](https://forum.eclipse-rp.net/)与[BadlandsRP 论坛](https://badlandsrp.com/)搜索摘要显示值得调查的支持/交流栏目，但实际打开均返回 403；[Grand RP](https://gta5grand.com/)也返回 403。[GTA World 主页](https://gta.world/)跳转至 global 域名后没有可读正文。这些是**本次工具访问失败**，不等于站点失效或社区停运；不以搜索摘要替代实际浏览，不计入前五个样本，也不据此断言后台能力。

## 4. 按玩家流程看差距

| 流程与玩家问题 | 当前可用基础 / 缺口 | 玩家与运营影响 | 建议方向 |
| --- | --- | --- | --- |
| 进入：我该选哪一服？ | 静态社区导航；无服务器对比、运行状态、连接动作，首页按钮占位。 | 介绍、停运社区与可加入服务器容易混淆，进入成本高。 | D1、D5 |
| 进入：申请后怎样成为玩家？ | 提交/查询/注册链路存在；终端 mailer、按邮箱一次规则、无各服生效确认。 | 网站获批不等于能进游戏；真实邮箱投递及进服落地仍断开。 | D3、D4 |
| 进入：谁能看到和批准资料？ | 审核操作无认证；审核人不记录。 | 玩家资料保护和审核责任追溯不足，不能直接作为安全运营入口。 | D2 |
| 参与：去哪读规则、找同伴？ | Outline 阅读/评论、QQ/KOOK 链接；未核实内容；Gallery/About 未落地。 | 缺少统一导览；但交流可能已在群与游戏内，未必需要新论坛。 | D1、D7 |
| 参与：能在哪服担任什么角色？ | 自填 FiveM ID、社区组基础；无验证绑定、各服资格/职位模型。 | 玩家无法知道缺哪个条件，运营可能重复人工核对。 | D4 |
| 求助：问题找谁、进展在哪？ | 拒绝/到期只转联系社区；无按服帮助入口和可追踪案件。 | 跨服投错渠道、重复描述、无结果回执；是否已有群工单需核实。 | D6 |
| 回访：服务器是否维护，有什么新事？ | Website health、即时消息；无游戏状态、公告范围/到期、订阅活动。 | 回站缺少行动理由，重要变更依赖外部群消息；通知易错发全社区。 | D5、D8 |
| 运营：哪个环节卡住？ | 审核列表/投递状态、账号 CLI；无完整按服责任/审计/积压和接入视图。 | 难解释失败、追溯决定和发现长期积压，扩到多服后成本增加。 | D2、D5；后续按需求增指标 |

推荐的网站职责是提供跨服发现、统一账号、明确资格、稳定入口和可追踪的必要流程。游戏内职业/经济/角色、即时聊天、Discord/QQ/KOOK 社群和现有工单可以继续由各服或外部平台承接；网站只呈现经过授权的必要信息和下一步。

## 5. 八个可选择的细化方向

这些方向可分别立项讨论，选择其中一个不意味着选择其余方向；有共享前置条件的功能仍需先满足对应条件。相对工作量以现有账号、Contract-first 与 Outline 基础为参照：**小**主要是内容/导航及有限页面，**中**涉及新增 Contract/数据流程，**大**包含游戏端协议或跨系统权限。它们不是工期承诺，正式估算需先确定服务器数量、实际外部能力和数据责任人。

### D1. 服务器目录与“开始游玩”指引

- **目标用户与问题：**新玩家、跨服玩家；无法判断服的玩法、准入要求、运行/停运状态和下一步。
- **最小范围：**目录 + 每服详情；包含玩法、语言/时间安排、规则、申请方式、连接/复制地址、社区及帮助入口。停运/未接入单独标识；首页动作通向目录或明确目标。配置式静态首版即可，不包含实时人数或通用 CMS。
- **依赖：**前端目录/详情和动作状态；后端静态首版可不新增业务 API，后续动态管理须新增 Contract；服务器负责人提供并核对 join 地址及规则，首版不必安装游戏插件。
- **权限与数据风险：**连接/外链来源需受控；避免展示私有 IP、内部管理地址或把未知状态写为在线。获批按钮不得暗示游戏资格已生效。
- **价值 / 工作量：**高，直接修复进入断点；小到中。
- **验收结果：**玩家能分辨可加入、停运与未接入对象，从首页到目标服规则、申请/连接及帮助入口可连续完成；桌面/手机、链接失效和无连接配置状态均有明确反馈。
- **阶段：**第一阶段优先。可与 D2/D3 并列选择，真实运行信息依赖 D5。

### D2. 安全审核与运营责任基础

- **目标用户与问题：**审核员、社区运营、申请人；资料访问和审核决定缺少权限与责任记录。
- **最小范围：**在当前申请工作台落实服务端认证/角色授权，记录真实审核人、时间、决定及必要操作审计；定义只读/审核最小权限，处理人员停用后失权。不先做通用权限平台或各服白名单管理。
- **依赖：**前端认证失败/无权/并发冲突反馈；后端 Contract security、handler 授权及审核事务；数据模型评审、migration、受信任管理账号授予流程。当前社区 admin 表只是基础，需确定谁可授予；不依赖游戏插件。
- **权限与数据风险：**权限授予本身敏感；防止任意账号提权、附件越权、审计内保存验证码/秘密；避免用 UI 隐藏代替服务端授权。现有无鉴权审核行为会改变，须审查兼容影响。
- **价值 / 工作量：**高，保护加入流程与玩家资料；中。
- **验收结果：**匿名和普通账号不能列出/下载/批准资料；授权人员可以操作且事实可追溯；撤权及时生效；原有幂等和并发冲突规则保持有证据的行为。
- **阶段：**第一阶段优先，是把当前审核用于真实玩家资料的前置条件；角色政策属于待确认设计。

### D3. 账号交付与恢复

- **目标用户与问题：**获批但未收到验证码的玩家、遗忘密码的老玩家；加入后无法可靠得到或找回账号。
- **最小范围：**先将邀请 adapter 接到真实邮件渠道并准确区分请求受理、provider 接收与可观察失败，提供冷却/重试指引；再做自助密码恢复。邮箱修改、社交登录和 MFA 可另选，不打包为首版要求。
- **依赖：**前端重发、失败、到期、恢复状态；后端 mailer 配置、投递处理及恢复 Contract/凭证；邮件渠道与发信域名由运营提供。游戏端无必需依赖。邮件渠道未取得前可细化/做隔离验证，真实投递验收须有合法测试收件箱。
- **权限与数据风险：**凭证一次使用、过期、限流、账号枚举、恢复后会话处理；不能把 provider 接收写成必然到达。保留现有“申请阶段不建号”的规则；恢复不得绕过停用或各服准入。
- **价值 / 工作量：**高；邮件接入中，加入恢复后中到大。
- **验收结果：**指定隔离收件箱可接收邀请并完成注册；投递失败不撤销审批，重试不重复建号；恢复凭证不能重放、不能操作其他账号，成功后会话处理符合获批策略。
- **阶段：**第一阶段先邮件可靠性，第二阶段恢复；不因做账号恢复默认开放自由注册。

### D4. 可信游戏身份与各服准入状态

- **目标用户与问题：**同一社区多服玩家、各服管理员；网站账号与实际游戏账号无可信关联，获批与入服资格不一致。
- **最小范围：**先选一个真实服务器 pilot，用短期一次性 challenge 由受信任游戏端确认账号控制；呈现未绑定/待确认/已绑定/冲突/撤销。随后分别记录社区账号与“用户—服务器”准入关系，展示各服资格及同步状态；首版不统一全部服职位、经济或跨服封禁。
- **依赖：**前端绑定和按服资格页；后端新的 Contract、验证/绑定唯一性与生命周期、按服授权及回执；服务器端受信任 resource/adapter、身份标识说明和负责人。复用现有身份基础须专门审查，Docs OIDC 和自填 `fivemId` 不能直接作为游戏认证。
- **权限与数据风险：**身份标识选择、共享账号、换绑、盗绑、服务器 impersonation、过期挑战、离线撤权；不默认“一服处罚全社区”。永久一次申请规则与各服重复申请冲突，须先选定社区注册和服务器准入的分工，再评审模型/兼容策略。
- **价值 / 工作量：**战略价值高；大。无服务器接入承诺时，不适合作为纯网站任务估算。
- **验收结果：**真实 pilot 可完成绑定；错误/过期/重复挑战失败；A 服权限不会自动授给 B 服；授予、拒绝、撤销和同步失败都有真实服务端证据，离线/延迟不冒充已生效。
- **阶段：**第二阶段先 pilot；跨服扩展、封禁联动及职位权限为第三阶段候选，均需业务规则确认。

### D5. 服务器状态与只读接入

- **目标用户与问题：**准备进入游戏的玩家、服务器值班人员；Website 可用无法说明游戏服可用。
- **最小范围：**每服运行/维护/未知状态、公开人数及最后采集时间；受控来源采集、缓存与超时，管理员可登记维护说明。首版不展示个人在线名单、角色财产或写游戏数据库。
- **依赖：**前端目录卡/详情中的状态、过期/失联反馈；后端 Contract、采集调度与状态持久/缓存、监控；各服提供可授权读取的状态来源或最小 adapter，先确定能公开的字段。D1 提供合适展示入口。
- **权限与数据风险：**不接受任意用户 URL 探测，控制 SSRF、采集频率、签名/来源真实性；人数只做聚合，超时展示未知，不把旧人数当实时。公开 ping 不能证明玩家自身线路质量。
- **价值 / 工作量：**高；中，来源不统一时增大。
- **验收结果：**正常、维护、离线、采集失联和过期可区分；连接操作按状态给合理提示；单服失败不拖垮目录；无法获取人数时保持未知，有最后更新时间可核对。
- **阶段：**第二阶段；已有可靠数据源时可提前与 D1 合并，不先追求队列或完整数据平台。

### D6. 帮助、投诉与申诉分流

- **目标用户与问题：**进服失败、申请被拒、遭遇违规或处罚的玩家；不知道责任人和保密渠道。
- **最小范围：**第一步做社区/各服帮助入口与问题分类，明确紧急游戏内帮助、账号、申请、Bug、举报、申诉各去哪；已有外部 ticket 则引导并说明需要的资料。只有确认外部无法提供追踪时，再做私有案件编号、回复、状态和独立复核；首版不自动更改游戏处罚。
- **依赖：**前端分类/按服选择和无资格者仍可用的入口；分流首版后端可无新业务 API，站内案件则需 Contract、私有附件、案件授权/状态及运营工作台；各服提供责任人、现有渠道和处理约定，处罚查询仅在后续获授权后接入。
- **权限与数据风险：**投诉可能涉及隐私或举报工作人员；案件默认不公开，严格参与者/处理人范围，定义冲突回避、证据保留和删除规则。通用公开存储 URL 不可直接复用为投诉证据；申诉不能要求被封账号仍拥有正常游戏权限。
- **价值 / 工作量：**高；分流小，私有站内案件大。
- **验收结果：**玩家无需重复选错渠道；每类每服有明确责任入口和失效替代；若选择站内版，非参与者不可读，提交/回复/关闭/复核可追踪，撤权后附件访问失效。
- **阶段：**第一阶段分流，第二阶段核实外部实际流程后决定是否站内化。参考 R3/R4，不能默认 Discord 承接一切。

### D7. 内容导览、作品与轻量交流

- **目标用户与问题：**新人、内容贡献者、回访玩家；内容与交流入口分散，作品导航没有落地。
- **最小范围：**先组织按服规则/新手文档和更新内容，使用现有 Outline；选择落地 Gallery 为经审核的玩家作品展示，或移除未落地入口。交流继续导向 QQ/KOOK/Discord，先验证邀请与运营责任；论坛、私信和好友系统独立后选。
- **依赖：**前端内容导航/作品列表/空态；后端作品提交/审核 Contract 与媒体数据（若选择投稿），文档内容由 Outline 管理，不在 Website 重建文档 API；运营供稿/审核人，游戏端非必需。
- **权限与数据风险：**内容版权与肖像、敏感游戏信息、恶意附件、公开/私有误混、滥用审核；Outline 阅读评论不意味着所有人有发布权。先确认投稿授权和审核职责。
- **价值 / 工作量：**中到高，取决于持续内容供给；内容导览小，投稿中。
- **验收结果：**新人可找到目标服有效规则/指引，私有文档不因聚合泄露标题；作品经审核后才展示，有撤下入口；空内容不留无动作按钮，外部群失效有替代联系。
- **阶段：**第一阶段整理内容与入口，第三阶段按真实投稿需求选择作品/论坛；无需等待游戏数据接入。

### D8. 公告、活动与回访提醒

- **目标用户与问题：**已注册玩家、活动组织者；跨服重要变更、活动时间和报名散落群聊。
- **最小范围：**社区/按服公告范围、生效与过期时间；活动时间、时区、条件、报名/取消与容量。先提供网站展示及自愿订阅的一种通知渠道；站内通知中心、Discord bot 和更多渠道分别扩展，不先做复杂推荐。
- **依赖：**前端公告/活动详情、报名和提醒偏好；后端 Contract、活动/报名事务、投递与幂等；运营持续发布，邮件提醒依赖 D3。只有资格受限的活动依赖 D4，纯社区活动不必先接游戏服务器。
- **权限与数据风险：**按服受众隔离、报名信息可见性、消息重复/错发、退订、时区与人数竞争；活动报名不自动授予游戏职位或进服权。
- **价值 / 工作量：**中到高，有稳定活动供给时较高；中。
- **验收结果：**A 服限定公告不误发 B 服；过期公告不仍显示为当前；容量最后一位并发报名无超额；取消/改期通知不重复且可退订；失联提示不虚报已送达。
- **阶段：**第三阶段为默认建议；近期已有稳定活动计划时，可提前独立选择网站展示首版。

## 6. 建议组合与先后关系

| 用户想优先改善的目标 | 建议组合 | 可先交付的结果 |
| --- | --- | --- |
| 让新人真正开始游玩 | D1 + D3，D2 作真实审核的前置 | 有目标服务器、能可靠注册、知道接下来去哪；仍明确外部白名单生效边界。 |
| 建立多服身份与权限基础 | D2 + D4 pilot，再接 D5 | 一个真实服务器的可信身份、资格和同步失败可追踪，再验证复制到第二服。 |
| 降低群里重复答疑与投诉 | D6 分流 + D7 文档导览 | 玩家按问题和服务器找到责任入口，保留已有效的外部 ticket。 |
| 增强玩家参与和回访 | D7 + D8 | 有持续内容与活动理由，前提是运营能持续供稿和处理报名。 |

第一阶段建议处理“进得来、资料安全、找得到人”：D1、D2、D3 邮件、D6 分流、D7 内容整理。第二阶段处理真实服务器接入：D4 单服 pilot、D5、D3 恢复，以及经核实才选择的站内工单。第三阶段再按需求扩展跨服权限、作品投稿、活动订阅或论坛。阶段不是已批准路线图，用户可以只选一个方向。

暂缓默认引入商城、积分、游戏资产展示、跨服角色/经济、跨服封禁和复杂好友系统。样本有商业或角色功能不代表本站缺它们就“不完整”；这些功能需要运营目标、明确权限及数据来源，部分应继续留在游戏内。

## 7. 下一轮细化所需核实项与验收局限

以下不阻塞本次报告，但会决定被选方向的范围与估算：

1. 真正需要对接的 FiveM 实例清单、运营负责人、连接地址、是否同一治理主体；CAEP 的历史内容与现状需由负责人确认。
2. 加入社区账号、Rifling 911 申请与各服 whitelist 的关系；已有账号加入第二服是否需要新申请、拒绝后的复议/重申请政策。
3. 各服实际保存哪些身份标识，有没有受信任 resource/API、现有白名单与撤权机制；不默认游戏框架相同。
4. QQ/KOOK/Discord 现有群、机器人、工单和权限能力，游戏内 `/report` 等渠道是否存在、谁受理、是否有保密/申诉流程。
5. 可公开的服务器状态字段、规则与新手文档是否已发布、哪些文档集私有，以及稳定内容/活动供给。
6. 邮件 provider 与测试收件渠道，账号恢复责任人；任何秘密由既有安全配置管理，不写入报告。

**本轮验证记录：**

- 源码核对：已执行，只读核对路由、完整 operation 清单与 handler 登记、相关 service/schema、前端入口及 Outline 公共读取消费点。
- 外部引用：已执行，五个主要官方社区及一个补充样本有可读页面；受限和失败请求已分别记录。
- 自动测试/构建：`NOT_EXECUTED`；报告变更不触发产品功能验收，且本轮禁止操作数据库/服务。
- Website/Outline 真实浏览器、真实邮件、FiveM、群机器人及后台：`NOT_EXECUTED`。源码链路不能证明当前已有环境能让玩家完成流程。
- 公网部署：`NOT_EXECUTED`；本阶段不部署上线。
- 独立 Reviewer：交付时尚未执行；Lead 安排核对本报告同一版本、关键源码 hash、外部引用与建议边界后，再向用户交付选择。

报告中的缺口用于决定下一步调研/设计，不作为无证据的线上故障报告。后续共享工作树或外部网页变化时，相关结论需要重新核对。

## 附录：关键源码候选指纹

下表是本次只读核对期间的文件字节 SHA256；这些文件含已提交和未提交内容。它只固定功能判断所依赖的主要消费点，不是整个仓库的冻结快照。Reviewer 若发现 hash 不同，应对变化部分刷新证据。

| 仓库相对路径 | SHA256 |
| --- | --- |
| `api/openapi.yaml` | `19f9751ae5734ad16cfdef8f5a5c867f6885217a820abccd4faf68a5152844cb` |
| `apps/web/src/App.tsx` | `23f217bed5171d92a118883eb1fbd269a63e7cb47463309d7552a83516649502` |
| `apps/web/src/pages/Home.tsx` | `595b89e13cf27bc97391e5e75ec28c548fa733c1c2f1e5052e8fa108dcf11c69` |
| `apps/web/src/pages/JoinPage/Rifling-911/index.tsx` | `200dae778ca6f4f1e0e8c851fe0283fd34a0426606b4175f7692093bb55a830a` |
| `apps/web/src/pages/JoinPage/CAEP/index.tsx` | `1cf82a4bedd2a32e59d9e63fa8c8137110c85fbae9c64c8baea892b556641292` |
| `apps/web/src/pages/JoinResultPage/index.tsx` | `9e9431e44310d34686ea74914daa8ebdb6f40d1fbb345f852c355eae5ae03bc1` |
| `apps/web/src/pages/JoinReviewPage/index.tsx` | `56a80338da78c3cbdc0ca222bcaa34dacdb720555cd67ecf94ef974b6c080d98` |
| `apps/web/src/invitations/InvitationRegistrationFlow.tsx` | `476209c30663db8dad5a3271b6869ad49fdaadc81f8c77d73b7f7435a120d301` |
| `apps/web/src/auth/AuthFlow.tsx` | `e82f9df099abb9e7d38dae1ac5d4cb17fb9504f5b75713a8dddb34062e5c8af8` |
| `apps/web/src/settings/SettingsExperience.tsx` | `64a5107ab333019d60605b0e5df008b2c238e9c016533dc9f11926cfbfdfb914` |
| `apps/web/src/settings/useSettingsController.ts` | `70e0d8f0af001a5a0ad849e4e8350d569c473f77737b8a6b83c301245bd06b53` |
| `apps/web/src/pages/IdentityPage/OidcPage.tsx` | `1b487940c9cda73ac864bb37fea07c16636a9ab60aba18bd3b1dade91feb9ed8` |
| `packages/components/src/SiteHeader.tsx` | `ce741529cd022e9494e7d3c9d2c4201ec5927864c91914a7a37decbd5742331e` |
| `packages/components/src/SettingsPanel.tsx` | `e0a0ed1af1cfc7b9ffe7b3da48a8ed79c2e119a2e2ee24d4e9287bef0ece592e` |
| `apps/web/public/config.json` | `03308e72a35a30e95be2609554c441f478870cfe9ccf6778eafe7c933a170e89` |
| `apps/server/src/app.ts` | `a92303d491017055a73cd4b47abf5da07a9d6ee1f764e5273f213aeb471a5d55` |
| `apps/server/src/server.ts` | `520b22bc42b35d012522ff6f850dd96f797082e5009db1fc9de4e2693177f8f4` |
| `apps/server/src/db/schema.ts` | `fe5eaefdb39c2eb3be160ce2429f0f35b069e2375ce47d117c2d26467003d2fd` |
| `apps/server/src/handlers/join.ts` | `ab3e1c2109851ee32d193fa479e8131511ce2c5dffd7a7a5b1d99df28be4316a` |
| `apps/server/src/join/service.ts` | `892d4f0032ee208f3c7ddd2a3fdcba2f3cc6fd43236c0150d0436ed2864e119c` |
| `apps/server/src/join/transport.ts` | `db3e70096e4716e949859823c39f00e211aabf5c4a1505f07e95088660525af6` |
| `apps/server/src/invitations/service.ts` | `68c618df9ed80905a3f60fe20115f9e66b61a6b3bfe3bb8b53e5395df2c79461` |
| `apps/server/src/invitations/mail.ts` | `03e6fc56ffa8397824ca3e96f651de80a375c84ff764f0c991f92e948f722859` |
| `apps/server/src/auth/create-services.ts` | `e0f681759c3af19a849b02ecdc48a8c2c59a24fa5c38c56d4364944da22f365a` |
| `apps/server/src/auth/service.ts` | `e8147f5532970477769290ecbbb1f01e5cd9dce7b03b519ab260c79effcabd88` |
| `apps/server/src/handlers/auth.ts` | `39f41a10e1b7f6b1d639b14d71139b7c6f412383c1b9d4b1042a028b0d22ef2e` |
| `apps/server/src/profile/service.ts` | `6f3970ccc952f3b313899f7e835949e3235e0d64f8698c5f8ee2f39898c5128c` |
| `apps/server/src/identity/config.ts` | `4316fbb8c9d9e8e954409c0630c77201bd348c0490cf04f9c2524b99c274dd9a` |
| `apps/server/src/identity/oidc.ts` | `e44a11e6976bb84d626c8e9f81197cc49035c9a71a75ab5bb2d72020810ac1c5` |
| `apps/server/src/identity/outbox.ts` | `445a21ea80f4450c45437422d27370e16fe4a7e4a38f9ba6cd54e935e611cb11` |
| `apps/outline/app/routes/index.tsx` | `2575cdb1bf108f29847263d44aa62b8ae00399c069a1f9a1eae755536e56461e` |
| `apps/outline/app/scenes/WebsitePublic.tsx` | `53cb9a4bd1947ba6b96ebcc02564e6b20d0eeaa79b9b850ea4a4b4605ed10ed6` |
| `apps/outline/app/scenes/WebsitePublic/PublicComments.tsx` | `e1511cefa3c7436df9878827ca5c12c3993e440cc77a62ce189a99093525b7ff` |
| `apps/outline/server/routes/api/public/index.ts` | `0e41d2189e5a699adbb9c60746b511c0f911e1b3ec3b399c1e80ac3abfe58758` |
| `apps/outline/server/commands/publicAccess.ts` | `1b7464bd95fcfc6d88bb7ffa271cb37b366b70d81ff9abb7d480f212f0b88bef` |
| `apps/outline/plugins/oidc/server/auth/oidc.ts` | `48106acd5179e3bb2a8020b0681269a22c1caeec59f41283094b80eb55d34048` |
