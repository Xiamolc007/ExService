# `mock-server` 模块：认证与邀请注册生命周期

本文件说明认证、加入申请和邀请服务之间的控制边界。HTTP 形状以 `api/openapi.yaml` 为唯一事实来源；表的职责、状态规则及跨实现约束统一见 `.ai/databases/data-model.md`。

_最后更新：2026-09-27_

## 组合与依赖

`apps/mock-server/src/server.ts` 打开固定 Mock 数据库，检查认证、资料、社区身份组及加入结构，校验验证码密钥与邮件链接站点配置，然后向 `createApp()` 注入 AuthService、ProfileService、JoinService 和 InvitationService。启动只检查，不迁移或恢复投递。SSO CLI 只依赖实际认证结构，不需要加入表、验证码密钥或身份组。

```text
Contract / Glue handlers
  ├─ AuthService       → 会话、登录、SSO
  ├─ ProfileService    → 本人资料、头像引用与文件
  ├─ JoinService       → 申请及审核事务
  └─ InvitationService → 资格、码、完善授权与账号创建
```

JoinService 与 InvitationService 共享一条 SQLite 连接。签发由同步事务内部调用完成，邮件和密码计算留在事务外。AuthService 不再拥有直接注册或邮件投递职责。`apps/mock-server/src/auth/create-services.ts` 负责纯组装，向登录与邀请服务注入同一个 ScryptPasswordHasher，不打开数据库或执行启动检查。

共享密码队列最多运行两项计算、等待十六项。工作完成时先把占用的名额直接交给已有等待者，只有没有等待者时才释放名额，避免等待者恢复前被新请求抢占。验证这一边界需保留真实队列，只控制底层密码计算的完成时机。

受保护 operation 由 Glue 的 Bearer handler 解析本站会话。退出、SSO 会话确认及异步头像处理在写入前复查会话；邀请完善只使用自己的短期凭证，不能用本站 token 代替。

## 申请、资格与完善的接缝

申请不建号，审核事务提交同意事实与邀请发送材料后才调用邮件适配器。投递结果更新自己的尝试记录，不回滚审核。详情读取根据当前邀请的码版本选择投递结果，避免迟到旧尝试覆盖新码。

完整申请采用一次 multipart 提交；传输解析与 Contract/语义验证结束后，JoinService 才写入短事务。原子性、一次申请规则和 legacy/版本 1 区分统一见 `.ai/databases/data-model.md`，不以缺少详情行掩盖新资料损坏。

结果查询直接在只读事务中读取状态与时钟，不复用 list/get：这两个审核 helper 会调用 InvitationService.cleanup。即使 HTTP 使用 POST 或只返回状态，也不能因此认定没有写入；应以业务表前后快照和过期时钟用例验证。查询不触发投递，内存 IP 请求计数不属于业务库修改。

只读资格检查在同步事务里取得一致快照，跳过惰性清理、投递恢复、密码计算和签发；只更新独立的内存 IP 请求计数。它用于决定前端是否进入验证码步骤。验证和完善都重新检查实际资格，不能信任先前的检查结果。

验证码验证消费码并交付完善凭证；只有完善阶段在异步哈希后再进入同步事务复查授权和邮箱唯一性，创建正式账号并完成邀请。已完成结果仅供原授权的有限幂等重试。时间、摘要和保留规则统一见 `.ai/databases/data-model.md`，不通过数据库已保存的 active 标签判断有效性。

审批在邮箱残余冷却内拒绝时，先做只读检查，不提交惰性清理或审批写入；已同意申请的相同决定优先幂等返回。边界背景见 `.notes/join-registration/rfcs/join-registration-rfc.md`。

## 邮件与失败恢复

邮件链接以校验后的 `MOCK_PUBLIC_WEB_BASE_URL` 通过 URL API 构造，不从请求 Host 获取。本地适配器在终端输出模拟邮件；真实邮件 provider 是独立的后续接入点。

事务先提交 pending 投递记录，适配器结束或超时后只能更新仍 pending 的对应尝试。后续请求限批处理丢失的 pending 投递和到期敏感材料；启动不会修复。只读资格检查与冷却拒绝的审批不运行这一清理。

失败窗口计数在同步事务返回判定后提交，再由事务外抛业务错误，避免抛错回滚防猜测计数。HTTP 错误和日志采用安全分类与固定文案，不记录原始异常对象、密码、验证码或凭证；统一入口是 `apps/mock-server/src/errors.ts`。

## 本站会话与 SSO

普通登录创建固定期限会话，原 token 只交付给浏览器，数据库保留摘要；使用不续期。SSO 请求由显式本地 CLI 创建，HTTP 接收端检查并通过密码或有效本站会话确认，不创建普通会话。相同用户确认幂等，不同用户不能覆盖已完成的请求。

认证清理仅处理会话与 SSO，加入状态由邀请服务清理。清理不迁移、不 reset、不删除数据库文件。旧直接注册路径随 Contract 0.4.0 退役，历史迁移保留，应用增量迁移时移除旧注册材料；迁移影响见 `.ai/databases/data-model.md`。

## 资料与头像

头像先写入固定目录，再在会话复核与数据库事务中提交引用，最后清理旧文件；失败清理新文件可能留下待显式核对的孤立文件，不能公开不存在的引用。公开图片仅依据当前数据库引用提供，不把头像目录作为静态目录公开。

新上传头像经 Sharp 方向修正、居中裁剪和编码，沿用 `.ai/decisions/mock-server/05-normalize-new-avatars-to-512-square.md` 的归一化决策。代理或 HTTPS 隧道使用受控 `MOCK_PUBLIC_AVATAR_BASE_URL`，不按请求 Host 生成 URL。

图片验证码仍是 Contract 预留的占位能力，只服务现有登录容器展示；没有服务端挑战验证，不能作为加入或登录的防护证据。
