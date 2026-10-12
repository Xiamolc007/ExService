# Server 认证、公开注册与社区准入生命周期

本文件说明认证、公开注册、第三方关联、社区申请与资料服务的控制边界。HTTP 形状以 `api/openapi.yaml` 为准；表职责和历史迁移规则见 `.ai/databases/data-model.md`。

_最后更新：2026-10-16_

## 组合与依赖

`apps/server/src/server.ts` 连接独立的 PostgreSQL `exre`，检查迁移和必需结构，显式传入可信 public origin，再注入认证、资料、注册、社区、通知、存储与支持中心业务对象。`apps/server/src/create-services.ts` 先组装共享 PasswordHasher 与 AuthService，再由 `createRegistrationServices` 组合 Cfx、通知、IdentityLinkService、RegistrationService、CommunityService 和 JoinService。公共能力属于 `apps/server/src/modules/`，社区申请与支持中心业务属于 `apps/server/src/domains/`；运行时不再注入 InvitationService。密码计算和邮件发送在事务外执行。显式 `IDENTITY_ENABLED=true` 时另行组装 Hydra OIDC、内部身份调用方密钥及撤销 outbox worker；未启用时身份 operation 不可用。启动只检查，不迁移或登记客户端。跨服务边界见 `.ai/architectures/identity/integration-boundaries.md`。

业务插件的依赖与构造依赖对应，各模块只声明自己的 decorator。RegistrationService 与 IdentityLinkService 的 start/close 由所属插件绑定；工厂不启动计时器。服务关闭先等待实际邮件、密码及关联写入 settle，再由应用所有者关闭数据库；模块不关闭注入的其他服务。注册启动恢复遗留 pending 投递，不创建数据库、不隐式 migration 或 reset。

受保护 operation 等待真实会话验证；写入前重新核验停用及撤销事实。社区 multipart 先认证再解析，Glue 在解析后继续复核，上传预算与清理保持共享 transport 规则。公开注册使用独立浏览器绑定及短期 grant，不能用本站会话代替。密码预算由共享 hasher 协调，登录与公开注册共用两项并行、十六项等待。

## 注册与关联

邮箱路径验证六位码后取得浏览器绑定 grant，强制设置密码再建号；注册不签发会话。Cfx sign-in 消费真实一次性 ticket：已有外部关联登录当前 UUID，重复邮箱返回 account-exists 并要求先登录再主动关联，其余返回短期注册 grant。Cfx 邮箱在注册界面只读，不据此声称本站邮箱已验证。

完善在事务外哈希密码，在事务内复核 grant、邮箱唯一及外部身份关系；成功重读返回原结果。主动关联要求当前账号、会话、浏览器和真实 attempt/ticket；解绑使旧关联意图失效，保留账号与密码。Cfx 基础消费约束见 `.ai/knowledge/cfx/identity-lifecycle.md`，浏览器与异步资源陷阱见 `.ai/knowledge/registration/browser-credentials-and-settlement.md`。

## 社区申请与决定

提交从真实 session 推导 UUID，按当前社区要求核验关联，保存账户与外部身份快照、表单和附件。申请归属、历史只读及唯一规则集中于数据模型。审核员必须有该社区的明确授权，平台 admin 不隐含审核资格。

写事务按 UUID 排序锁账户，再锁当前会话、社区及相应授权和申请。审批与拒绝写审核事实，并用通知 producer.publishInside 在同一连接发布必要结果事件；通过时同时写成员资格。相同决定重读不再次发布，相反决定冲突。解绑不取消待审申请，也不阻止形成决定。通知投影在提交后独立执行，失败不撤销决定。

## 邮件、SSO 与头像

邮件仅经 RegistrationMailer；缺失适配器返回明确不可用。开发模拟器须同时满足 NODE_ENV=development 与显式 SERVER_REGISTRATION_MAIL_SIMULATOR=true，单独终端通道不代表真实投递。可信 origin 来自配置，不从 Host 推断。失败窗口在提交计数后再返回错误，防止防猜测记录回滚；统一错误入口不记录或回显秘密及数据库异常。

普通登录签发固定期限本站会话；原 token 只交给浏览器，数据库保存摘要，使用不续期。SSO 请求由显式 CLI 创建，HTTP 接收端检查并确认，不创建普通会话。当前仍没有生产发起方或轮询协议。

账号停用、恢复与会话撤销的持久化规则见 `.ai/databases/data-model.md`。集成模式通过独立受控 CLI 停用或恢复账号；登录、SSO 接收、OIDC 接受和内部会话核验都复查停用事实。恢复后不会复活原会话。

头像先写入 `apps/server/data/avatars/`，随后复核会话和更新引用，最后清理旧文件；失败清理新文件，孤立旧文件留待显式核查。图片经 Sharp 归一化为 512×512 WebP，公开 URL 使用 SERVER_PUBLIC_AVATAR_BASE_URL。图片验证码仍是占位能力；网站侧社区要求满足不表示游戏已放行，也不构成公网部署验收。
