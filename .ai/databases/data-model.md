# 账号与加入申请数据模型

本文件记录表的业务职责、关系和跨实现必须保留的数据规则。它是修改模型前的设计入口，不代替可执行结构：当前 Mock SQLite 以 `apps/mock-server/src/db/schema.ts` 和 `apps/mock-server/drizzle/` 为准；HTTP 字段与行为以 `api/openapi.yaml` 为准。

_最后更新：2026-09-27_

## 适用范围

邀请生命周期依据 `.notes/join-registration/rfcs/join-registration-rfc.md`；完整申请与一次申请规则依据已批准的 `.notes/join-registration/rfcs/join-application-pages-rfc.md`，在实现与增量迁移完成后生效。旧直接注册尝试不转成申请或获批邀请，已有三字段申请保留为历史简版。职责和业务规则也是未来 PHP + MySQL 的目标模型，未来实现可以采用自己的物理结构；当前不存在经过验证的 MySQL 实现。

```mermaid
erDiagram
    auth_users ||--o{ auth_sessions : "持有会话"
    auth_users |o--o{ auth_sso_requests : "确认后关联"
    join_applications ||--o{ join_invitations : "同意后签发"
    join_applications ||--o| join_application_forms : "完整申请资料"
    join_applications ||--o{ join_application_attachments : "证明附件"
    join_applications ||--o| join_application_email_registry : "历史邮箱代表"
    auth_users |o--o{ join_applications : "审核人可选关联"
    auth_users |o--o{ join_invitations : "完成注册后关联"
    join_invitations ||--o{ join_delivery_attempts : "记录投递"
    auth_users ||--o{ community_group_memberships : "加入社区身份组"
    community_groups ||--o{ community_group_memberships : "包含成员"
    join_email_controls
```

`join_email_controls` 按规范化邮箱保存冷却和错误窗口，不与账号、申请建立外键。申请邮箱也不是账号外键：申请、同意和验证码验证均不创建正式账号。

## 表的职责与关键规则

| 当前 SQLite 表 | 职责 | 关键标识与约束 |
| --- | --- | --- |
| `auth_users` | 保存正式本站账号和基础资料。 | 账号 ID 稳定，邮箱唯一；名字、QQ 和 FiveM ID 可重复，QQ、FiveM ID 和头像引用可为空。只保存密码哈希。FiveM ID 是未经验证的声明，不参与认证或授权。头像引用由服务端生成，已引用对象只属于一个用户，图片字节不进入数据库。 |
| `join_applications` | 保存邮箱、申请名字、QQ、表单版本标记和审核事实，不保存密码。 | 状态为 pending、approved、rejected；同邮箱跨类别及所有状态只能提交一次，旧重复历史保留；重复提交不能覆盖原资料。同意、拒绝只从 pending 转换，相同决定幂等，相反决定冲突。本期审核人固定为空，预留账号关系不代表已实现授权。版本标记区分真实旧记录与新资料缺失，不能以缺少表单行推断为旧记录。 |
| `join_application_email_registry` | 持续登记已提交过申请的规范化邮箱，并关联该邮箱最近历史申请。 | 每邮箱一行，关联必须属于该邮箱；最近按提交时间降序、稳定 ID 降序确定。拒绝、邀请到期或注册完成都不释放登记，申请人不可修改。旧重复记录不删除，新增申请由登记唯一约束和受控事务阻止。 |
| `join_application_forms` | 保存完整申请的类别、版本及结构化回答与承诺。 | 每申请最多一行；所有新申请必须同时具有版本 1 标记和版本 1 表单，类别为全新或经验且与封闭 JSON 中类别一致。保存及读取按对应版本 Contract 验证；旧三字段记录版本 0、没有表单，不补造回答或承诺。缺失、损坏或错配的新表单属于数据错误，不能降级为旧记录。 |
| `join_application_attachments` | 保存与具体申请关联的可选证明文件元数据和 BLOB。 | 仅经验申请可有 0–5 个附件，每个 1 字节至 10 MiB，顺序 0–4 且申请内唯一；真实字节长度与摘要一致。所有关联外键限制删除历史，列表不读取 BLOB；下载必须核对申请归属，不提供公开路径或内联预览。 |
| `join_invitations` | 保存获批申请的验证资格、当前验证码、短期完善凭证和完成账号。 | 每条邀请关联一个申请，同申请最多一条 active 邀请。资格有效 7 天，码最长 10 分钟，凭证最长 30 分钟，均不能超过邀请截止时间。码只存绑定邀请及版本的 HMAC，凭证只存摘要。有效性按服务端时间复核，不只看持久化状态。 |
| `join_email_controls` | 按邮箱维护 60 秒发送冷却和 10 分钟错误窗口。 | 邮箱是主键；累计 5 次错误锁定至窗口结束，重发和邀请更新均不重置。未知邮箱也维护短期错误窗口。投递失败不撤销冷却。 |
| `join_delivery_attempts` | 保存每次验证码投递结果，区分审批事实和邮件交付。 | 邀请与码版本组合唯一；状态为 pending、sent、failed。不保存明文码、链接、邮件正文或原始异常。每次尝试只更新自身结果，超时后的迟到结果不能改回成功。 |
| `auth_sessions` | 保存普通登录产生的本站会话。 | token 只存摘要；必须关联正式账号，记录到期与撤销状态；不因使用续期。 |
| `auth_sso_requests` | 保存本地 CLI 创建、等待浏览器确认的短期 SSO 请求。 | 请求标识只存摘要；状态为 pending、completed，确认前可无用户，确认后关联用户；完成 SSO 不创建本站会话。 |
| `community_groups` | 保存需显式授予的社区身份组标识和展示名称。 | code 唯一且稳定；保留组 admin 表示管理员身份，展示名称不参与关联；普通身份不建组记录。 |
| `community_group_memberships` | 保存正式用户与显式授予身份组的多对多关系。 | 用户与组组合唯一且双方必须存在；正式账号无成员关系时为普通身份；申请和未完成邀请没有成员关系。 |

## 注册与投递边界

完整申请、邮箱登记、表单和全部附件在一次短写事务中保存，任一步失败全部回滚，不留下半份资料或无效邮箱占用；邮箱竞争必须由数据库唯一约束裁决。已存在任意申请历史优先于正式账号冲突；申请提交不发邮件、不清理邀请、不创建账号。资料与承诺提交后不能由申请人修改。

历史迁移保留账号、申请、审核、邀请及投递记录；按规范化邮箱回填登记，异常邮箱或关联使迁移停止，不静默改值或删历史。查询在只读快照内计算：已完成邀请且正式用户存在优先，其余取最近申请及最新邀请；只计算到期，不更新状态或发送控制，不发码。损坏关联返回安全失败。

SQLite 附件字节只在固定 Mock 数据库内，不新增文件目录。未来 PHP + MySQL 可另行选择物理存储，但必须保留一次申请唯一性、完整表单版本、申请与附件原子一致性和受控读取边界。生产存储、权限和资料保留/删除策略另行设计；本期无自动删除或清理接口。备份会包含完整个人资料与附件，不纳入版本控制。

申请、邀请和投递事实保留供审核核对；敏感摘要在码消费或到期、凭证替换或到期、邀请到期时清除。验证码验证消耗码并签发完善凭证，不创建用户。新验证替换旧凭证，单独重发码不撤销已签发凭证。

完善事务创建账号并完成邀请：QQ 沿用申请、名字采用完善输入，头像和 FiveM ID 初始为空；不创建会话或身份组成员关系。完成后在原凭证期限内保留摘要及结果，只允许同一凭证重试得到原结果，不能覆盖账号名字或密码。密码哈希只在正式账号保存，异步哈希后必须在写入事务中复查凭证、资格和邮箱唯一性。

资格检查只读一致快照，不发码、不更新冷却或失败窗口、不清理到期状态、不返回申请资料或凭证。码过期、消费或投递失败不撤销尚未到期的邀请资格，用户仍可进入重发步骤；验证和完善必须独立复查资格。

审批事务先提交同意结果、邀请和投递记录，再在事务外调用适配器；投递失败不回滚审批。本期公开临时审核、审核人为空的边界只适用于本地 Mock，不是未来 PHP/MySQL 的生产权限方案。

新增 migration 先将旧 `auth_email_delivery` 的冷却迁入 `join_email_controls`，再移除 `auth_registrations` 和 `auth_email_delivery` 及其中的敏感材料；既有账号、资料、会话、SSO 与身份组关系保留。迁移前停止写入并以 SQLite backup API 备份，迁移后核对保留记录与外键。没有可重建旧敏感材料的自动逆迁移。操作边界见 `.ai/databases/knowledge/database-lifecycle-traps.md` 和 `.ai/databases/decisions/03-database-changes-only-by-explicit-command.md`。

## 头像与社区身份

本地头像字节在固定的 `apps/mock-server/data/avatars/`，数据库只保存引用；未来 PHP + MySQL 改用 COS 对象和公开 HTTPS 链接。两种实现均须保证本人资料不泄露给匿名调用方，公开图片不包含邮箱，清除或替换后旧引用不可继续公开读取。先写完新文件、再提交引用、最后清理旧文件；失败可留下待显式核对的孤立文件，不能留下指向未写完文件的引用。

社区身份组不映射游戏角色或 FiveM 权限。普通身份由正式账号存在隐含，不写成员关系；未登录者不因此取得普通身份。admin 只由受信任流程显式授予，注册不授予；现有正式账号迁移后身份关系保持原状。外键及组合唯一约束防止孤立与重复关系。当前没有管理员初始化、组管理或权限判断；admin 记录是后续授权规则依据。理由见 `.ai/databases/decisions/06-implicit-ordinary-explicit-admin-membership.md`。

## 修改模型时

职责、关系或数据规则变化前先更新本文件并评审 SQLite 与未来 MySQL 的影响，再修改 schema 和 migration。纯索引、迁移实现或测试数据调整不要求更新模型；实际字段和约束以实现文件核对。
