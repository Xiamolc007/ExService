# 文档集成的服务边界

Website 管理账号与本站会话，Hydra 提供 OIDC 协议，Outline 管理文档、权限和附件。Website HTTP operation 以 `api/openapi.yaml` 为准；本站数据规则集中在 `.ai/databases/data-model.md`。本页集中记录当前实现的配置、准备、运行和恢复边界；浏览器与多设备撤销时延需另行验收。

_最后更新：2026-10-10_

## 运行与服务归属

日常入口由 `scripts/runtime/entry.mjs` 管理。配置、进程、容器与迁移维护边界集中在 `.ai/architectures/runtime/runtime-boundaries.md`，启动检查单见 `README.md`。根 `compose.yaml` 仅运行本地 PostgreSQL、Redis、Hydra；Website 与 Outline 是宿主机应用，服务器使用原生服务。历史模式入口和服务器 Docker 打包已退出源码，历史配置与持久数据不能由普通入口接管。

Outline 仍是独立 Git submodule/Yarn 应用，不属于 pnpm workspace，Website 不接管其 API。两套依赖树使用 registry `@exre/exui` 发布包和各自 lockfile；Outline 的 React 17 只消费框架无关 Tokens 与 CSS，Website 的 React 19 消费 React 组件。工具选择默认当前 Node，必须满足 Outline engines；可显式指定 `INTEGRATION_NODE_BIN`、`INTEGRATION_COREPACK_JS`，不固定历史本机工具目录。

普通启动只检查真实数据库、migration、身份 marker、client 与健康状态。数据库准备和迁移须显式执行；bootstrap 必须使用用户选择的已有 active Website UUID，不自动创建账号或恢复撤销的管理员权限。`DATABASE_URL` 是适配器给 Website 的派生值，源设置仅使用根配置的连接字段。

## 浏览器主题与界面语言

集成 Outline 与 Website 在同一浏览器存储分区、同一 origin 使用原始字符串 `localStorage.theme`，合法值为 `light`、`dark`、`system`；缺失或非法值解析为 `system`。Outline 不迁移 `UI_STORE.theme`，保存侧栏等属性时保留旧主题供独立模式使用。根级订阅重读当前存储并处理页面恢复，收到事件不反向写入；Website 通过 ExUI 公开 API 补偿迟到事件与恢复。跨 origin、跨设备同步不在此协议内，存储不可访问时 Outline 只保证本页切换。

`apps/outline/shared/styles/websiteTheme.css` 是 Website 已有黑白品牌覆盖的唯一来源，主站在 ExUI 样式之后导入它。集成 Outline 在布局阶段解析这份 CSS 的受覆盖变量，先应用有效 token，再解析 legacy 字段、语义字段和 recipe；不使用工作区品牌、交互页面查询参数或手机纯黑主题。打印使用局部浅色并恢复，不持久化。`website-theme-profile` 标记限制覆盖作用域；独立 Outline 保留原偏好和品牌行为。Website 构建须包含该 submodule 样式资源，Outline 构建不依赖父仓库文件。

集成有效默认语言为 `zh_CN`，新账号创建显式写入该语言，已有账号资料同步不改语言。根级语言投影只采用 `auth.info` 已验证账号的语言；缓存账号不作为语言权威，匿名和退出回到默认中文。语言切换串行收敛并更新 HTML `lang`/`dir`；独立模式仍沿用浏览器检测与原配置。公共页面复用已有翻译键，项目特有提示通过局部 `defaultValue` 与 `fallbackLng: []` 提供中文/英文回退，避免英文 fallback 遮蔽中文；locale catalog 只能由提取流程生成，文档正文与用户内容不翻译。

## 身份、自动登录与撤销

Website/Outline 各自解析不可变模式配置。local 使用 `ex-outline-local`、经校验回环 HTTP issuer/origin、精确 `<publicOrigin>/docs/auth/oidc.callback`、退出 `<publicOrigin>/identity/signed-out`；deployment 使用 `ex-outline` 和显式 HTTPS 地址。历史 dev/full 的 client 仍有协议兼容与 cleanup-only 投递语义，但不再提供运行编排入口。不允许 wildcard/任意 client 注册。Outline `URL` 带 `/docs`，`WEBSITE_URL` 是 Logo/身份页面返回主站的根地址，不可互换。

根级 `WebsiteIdentityController` 通过同源 `WebsiteSessionProbe` `/identity/status` 交换粗粒度 active/anonymous/unavailable，校验 origin/source/nonce，最多一秒，不交换 Bearer/资料/token。active 发起已有 OIDC，匿名直接公共阅读；运行中身份服务不可用保持公共页与可重试状态。标签页 sessionStorage 仅存安全 returnPath、随机 attemptId、时间；同路径十分钟内抑制重复自动尝试，被动刷新不清失败记录。成功关联清除，另一安全路径或到期允许新尝试；失败 fragment 抑制自动跳转，显式操作可重试。公共与成员的呈现、临时 DTO 及请求代次边界见 `.ai/architectures/docs-integration/unified-reading-interface.md`。

OIDC 保留 state/nonce/PKCE、签名、issuer/audience、userinfo.sub、sid/`ex_session_id` 核验。begin 成功设置 client-qualified、HttpOnly、SameSite=Lax、Path=/docs/auth、十分钟随机 browser-proof cookie；Redis 仅存摘要，callback 消费 state/换 token 前验证发起浏览器，结果清除 cookie。他人浏览器不能消费原流程。可信故障返回校验后的原 docs path/query 与 `#website-signin-unavailable`；不可信 state/proof 返回 `/docs/`。returnPath 拒绝外域、反斜杠、控制字符、编码穿越与非 docs 路径。

Outline 仅在 Website internal session check 确认 subject/sid/本站 sessionId/有效期后建立 `ExternalSession`。邮箱相同不自动合并，资料版本同步防止迟到覆盖；本站 CLI SSO 是独立流程。`SessionGuard` 同步核对受保护 HTTP，实时连接按租约复核；事务撤销立即阻止新有效核验，outbox 再按旧 sid/sessionId 清理，迟到停用不撤销恢复后的新会话。五秒实时目标需真实多浏览器验收，快照/保留规则见 `.ai/databases/data-model.md`。

outbox 按固定 clientId 独立选择 Hydra admin、Outline internal URL 与原 delivery key，幂等键含 clientId，probe 仅清 Hydra。当前目标不可覆盖；其他目标仅从完整原配置或严格 `IDENTITY_OUTBOX_TARGETS_JSON` 装载。未知、缺失、不可达目标保持 pending，不用当前模式秘密补齐。cleanup-only 目标不扩大 OIDC 批准 client 或内部 session-check 权限。

历史 full 调用方清理旧 `ex-outline-local` 的协议兼容允许 cleanup-only 目标使用 literal `host.docker.internal`、HTTP、显式非默认端口；原端口、delivery key 与 issuer 来源仍须保留。这不提供当前 Docker 应用编排，不改当前 local auth origin，也不授予 cleanup client 认证权限。DNS/adapter/映射验证不等于成功投递，旧目标离线仍 pending。

## 公开授权与代理

Outline 集合成员权限控制登录阅读/评论/编辑，Website 社区管理员不自动成为文档管理员。集合 Share 与当前发布状态共同决定匿名可见，旧单篇 Share 不提供旁路。`apps/outline/server/commands/publicAccess.ts` 统一目录/搜索/文档/附件可见性；SSR 提供公开标题/正文摘要/canonical/sitemap，私有、草稿、缺失统一 404。附件须属于可读已发布内容，不能只凭 URL 读私有字节。

集成模式的文档集保持 `permission: null` 与 `commenting: true`，通过成员和群组授予访问与编辑能力。`apps/outline/app/components/Collection/CollectionForm.tsx` 的创建、编辑表单使用这些固定值，并禁用工作区默认权限与评论开关；独立 Outline 保留原设置能力。服务端 `apps/outline/server/commands/integratedCollectionSettings.ts` 仍校验这些约束。`Integrated collections require private access and reader comments` 是参数校验错误；`collections.create` 在此之前已经检查创建权限，不能将这一 400 响应解释为账号没有创建权限。

local 公共入口与直接 Vite 在 HTTP/upgrade 转发前拒绝规范化 `/api/internal`、`/docs/internal` 根及后代，含编码、斜杠/反斜杠、点段和畸形 escape 绕过。Hydra admin 不经公共代理。`/docs` 308 至 `/docs/` 保留 query；Website `/api` 保留，Outline 后端仅剥一次 `/docs`，集成 Vite 静态保留 `/docs/static/`。standalone Outline 保留直接 URL、static strip/TLS，不能套用集成前缀规则。

Outline 本地附件存储的上传地址与文件读取地址由 `apps/outline/server/storage/files/LocalStorage.ts` 根据 `env.URL` 的公开挂载路径生成。集成模式使用 `/docs/api/files.create` 与 `/docs/api/files.get`；遗漏 `/docs` 会让请求进入 Website Contract 路由并返回 `NOT_FOUND`。独立根路径部署仍使用 `/api/files.create` 与 `/api/files.get`，Website Contract 不登记 Outline 附件路由。

私有附件的授权入口由 `apps/outline/server/models/Attachment.ts` 的 `getRedirectUrl` 生成，也必须保留公开挂载路径：集成模式为 `/docs/api/attachments.redirect`，独立根路径部署为 `/api/attachments.redirect`。仅修正上传与文件读取地址仍会让上传后的图片加载落入 Website Contract。编辑器 `apps/outline/shared/editor/commands/insertFiles.ts` 须等待图片加载再替换占位；加载失败通过上传 Promise 拒绝进入同一清理流程，移除占位、通知错误并结束上传状态，不能在 DOM 事件回调里直接抛错。

可信 forwarding/mount headers 只来自已验证 public origin；浏览器 Origin 不改写，hostile/缺失 Origin 仍被上游 CSRF 拒绝。Location 仅对 allowlist 的 Outline 未挂载路径添加前缀，外部、Website identity、Hydra、已挂载地址保持。Cookie 保留 Path：`exdocs_access` 为 `/docs`，HTTP `csrfToken` 为 `/docs`，HTTPS 唯一 `__Host-csrfToken` 为 `/`，不全局 cookiePathRewrite。

带会话的非安全方法要求精确 origin 与签名双提交 CSRF，安全方法签发 token；四个匿名读 POST `public.collections.list`、`public.documents.list`、`public.documents.info`、`public.documents.search` 免 CSRF，其余合法读 POST 也携带 token。OIDC browser proof/state/nonce/PKCE 不由 CSRF cookie 替代。

集成页面启动所需的 `auth.config` 是公开配置读取，`apps/outline/app/stores/AuthStore.ts` 必须以 `credentials: "omit"` 请求它，避免同主机其他服务或历史登录残留的 `accessToken` 触发会话 CSRF 检查并阻断匿名目录。`apps/outline/app/utils/ApiClient.ts` 将调用方的 credentials 策略传给真实 fetch，未指定时仍为 `same-origin`；`auth.info` 等受保护请求继续携带会话并接受原有 CSRF 校验。公开配置可读取不代表 `localhost` 与配置的 `127.0.0.1` 可互换，登录及写入仍须使用配置中的 public origin。本地集成的 Website 两个开发入口在服务页面前核对 Host：不同来源的 GET/HEAD 以不缓存的 307 跳到配置来源并保留路径和 query，其他方法返回 421；内部路径仍优先拒绝。这样本站 Bearer 的浏览器存储、同源身份探测与 OIDC challenge 使用同一来源。历史别名下的会话不会跨来源搬运，须在配置来源重新登录一次；独立模式保留原入口行为。

文件上传占位通过 `apps/outline/shared/editor/lib/uploadPlaceholder.tsx` 创建独立 React root，不能继承外层 styled-components 主题。其 `FileExtension.tsx` 使用框架无关 ExUI 字体和圆角 token，避免插入普通附件时因缺少 `theme.exui` 中断上传。

local HMR 从 public origin 派生。`httpReady` 显式 Host 分支使用 node:http/node:https 真正传递 Host，保留手动 redirect、真实 Response/expected 和正常 TLS；无 Host 分支使用 fetch。请求、body/expected、剩余总 deadline 与必需 child 退出均受限，不能以另一 smoke helper 或无限等待替代真实就绪。
