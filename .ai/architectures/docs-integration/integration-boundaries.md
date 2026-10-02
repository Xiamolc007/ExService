# 文档集成的服务边界

本地集成将 Website 的账号和会话、Hydra 的 OIDC 协议、Outline 的文档数据与权限分开。Website HTTP operation 仍以 `api/openapi.yaml` 为准；本站持久化规则见 `.ai/databases/data-model.md`。本页记录源码中的控制流，不以定时器配置替代真实运行验收。

## 入口与进程

`apps/outline/` 是独立 Git submodule 和 Yarn 应用，不参加 Website 的 pnpm workspace。根目录 `compose.yaml` 联同 `compose.full.yaml` 或 `compose.dev.yaml` 运行 gateway、Hydra、PostgreSQL 和 Redis；完整模式运行应用容器，开发模式由 `scripts/docs-integration/command.mjs` 启动宿主机进程。gateway 将同域 `/docs` 路径交给 Outline，将 `/api` 交给 Website，并为 `identity.exwebsite.test` 暴露 Hydra 公共协议入口；管理与内部身份路径不经公共 gateway 暴露。Website 使用 `exre`，Outline 使用独立 `outline` 数据库，文档附件使用 Outline 独立存储。

根命令 `integration:configure` 配置本地目录和密钥，`integration:init` 显式准备数据库，`integration:migrate` 显式应用迁移，`integration:bootstrap` 显式指定首个文档管理员。`integration:up` 和 `integration:dev` 分别启动完整与开发模式；`integration:down` 停止所管运行资源。脚本检查主机名、模式冲突及初始化状态，不把普通服务启动当成迁移或管理员创建。身份停用与恢复使用 `auth:disable`、`auth:enable`；恢复后旧会话仍无效。这些命令的当前参数与环境要求以 `package.json` 和 `scripts/docs-integration/command.mjs` 为准。

## 身份与会话

浏览器继续以 Website Bearer 使用本站身份。Outline 通过 Hydra 授权码流程获取经验证的 issuer、subject、sid 和 `ex_session_id`，在 Website 内部 session check 核对 sid、subject、本站会话 ID 与有效期后，才关联 Outline 用户并创建 `ExternalSession`。Outline 的身份表在其自己的数据库；相同邮箱不构成自动账号合并依据。Website 的昵称、邮箱和头像更新通过资料版本同步，不能由迟到结果覆盖新版本。Website 的本地 CLI SSO 仍是独立的短期确认流程。

Outline 的受保护 HTTP 请求经 `SessionGuard` 同步核验 Website 会话；实时连接在租约到期前复核，失效通知促使连接尽快关闭。Website 退出只撤销当前本站会话组；账号停用撤销该账号的既有会话。撤销在 Website 事务提交后即阻止新的有效核验，后台 outbox 再逐 sid 清理 Hydra 并向 Outline 投递会话失效。投递快照、重试与清理保留规则集中在 `.ai/databases/data-model.md`。`apps/outline/server/routes/internalIdentity.ts` 按旧 Website sessionId 失效 Outline 会话和连接，迟到事件不能作用于恢复账号后的新会话。实时目标是五秒内拒绝后续受保护操作；具体时延须以真实多浏览器运行证据验收。

## 公开阅读与授权

Outline 的集合成员权限控制登录阅读、评论和编辑；Website 社区管理员身份不自动成为文档管理员。集合 Share 和当前文档状态共同决定匿名可见性，单篇旧 Share 不成为授权旁路。`apps/outline/server/commands/publicAccess.ts` 集中解析公共目录、搜索、文档和附件所需的可见性。`apps/outline/server/routes/app.ts` 为可见文档渲染标题、正文摘要、canonical 和 sitemap；不可见目标返回统一 404。`apps/outline/server/routes/api/attachments/access.ts` 还检查附件是否属于当前可读文档及已发布内容，不能仅凭附件地址取得私有字节。

## 浏览器请求边界

Outline 集成模式中，带会话 Cookie 的非安全方法须提供与 `env.URL` 精确相同的 Origin，并提交服务端签名的双提交 CSRF token。安全方法签发 token；本地 HTTP 使用 `csrfToken`、Path=/docs，HTTPS 使用唯一的 `__Host-csrfToken`、Path=/，后者遵循 `__Host-` Cookie 规则。只有四个明确的匿名读取 POST：`public.collections.list`、`public.documents.list`、`public.documents.info`、`public.documents.search` 免验 CSRF；其他合法读取 POST 也由 `apps/outline/app/utils/ApiClient.ts` 携带当前 token。协议回调另使用一次性 state、nonce 和 PKCE，不能把 CSRF Cookie 当作 OIDC 校验的替代品。
