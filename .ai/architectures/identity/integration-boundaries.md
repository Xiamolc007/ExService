# 独立身份系统的服务边界

Website 管理账号和本站会话，Hydra 提供 OIDC 协议。身份能力不依赖文档应用；HTTP 形状以 `api/openapi.yaml` 为准，持久数据规则见 `.ai/databases/data-model.md`，进程与资源见 `.ai/architectures/runtime/runtime-boundaries.md`。

_最后更新：2026-10-16_

## 配置与批准客户端

`apps/server/src/modules/identity/config.ts` 与 `scripts/runtime/settings.mjs` 经 `@workspace/common/node/identity-config` 调用 `parseIdentityConfiguration()`，统一验证显式传入的 mode、三个根 URL、local origin 互异、身份密钥、客户端和 cleanup-only 目标，返回冻结的配置与权限投影。Common 不读取环境、文件或运行状态；消费边界见 `.agents/rules/package-common.md`。Server 保留环境读取与 `IDENTITY_ENABLED` 开关，仅接受 `true`、`false`；未启用时不解析其余身份值，身份 operation 不可用。runtime 保留根配置来源、端口拓扑与环境投影，从 `RUNTIME_PROFILE` 派生 `IDENTITY_MODE=local|deployment`；身份密钥仍以共享规则校验，并保留根入口的缺失/格式诊断。空客户端不能省略基础配置。

`IDENTITY_CLIENTS_JSON` 是客户端数组，缺省 `[]`。每个记录包含唯一 `clientId`、显示名 `name`、精确 `redirectUri` 和 `postLogoutRedirectUri`、`scopes`、`clientSecret`，可选 `integrationKey` 和 `revocation: { url, key }`。重复 ID、未知字段、不合法 URL 与秘密拒绝；退役 ID `ex-outline-local`、`ex-outline` 不能登记。清单只由可信服务端和登记进程消费，不进入 Web 环境或日志。

local 回调使用带显式端口的 literal `127.0.0.1` HTTP，deployment 使用 HTTPS；均拒绝 userinfo、fragment、通配符及规范化歧义。回调保留合法精确 query；撤销 URL 不允许 query。scope 必须含 `openid`，仅接受当前实现的 `openid`、`profile`、`email`。现阶段只保留 confidential authorization-code client，不扩展 public client、其他 grant 或 refresh token。空集合拒绝所有客户端授权，不创建默认应用。

`integrationKey` 只为该客户端授予已有内部会话接口的调用身份，不同客户端不能复用；client secret 不参与 Website Bearer 或内部接口鉴权。`IDENTITY_OUTBOX_TARGETS_JSON` 是按 clientId 索引的 cleanup-only 目的地对象，仅供已有撤销事件使用，不加入批准客户端或内部调用方。与现役同名目标必须完全一致，缺失目标不得从当前配置借用地址或秘密。

## OIDC 与会话核验

`apps/server/src/modules/identity/api/operations.ts` 保留七个 operation：`inspectOidcRequest`、`acceptOidcLogin`、`acceptOidcConsent`、`acceptOidcLogout`、`checkLinkedSession`、`revokeLinkedSession`、`inspectIdentityUser`。Contract Test 继续检查真实 HTTP 与原始 handler 输出，不因客户端清单为空删除协议覆盖。

`oidc.ts` 先核对已配置 clientId、精确 callback 和请求 scope，再按 Hydra challenge 处理 login/consent/logout。login 与 consent 固定同一本站会话，使用稳定账号 ID、Hydra sid 和本站 sessionId；重试保持原关联，不允许失效会话建立新有效绑定。内部 session check 验证调用客户端及 subject/sid/sessionId，不以浏览器存储或显示名证明身份。本地 CLI SSO 保持独立流程。

浏览器身份页面和退出页的请求代次、当前 token 复核见 `.ai/architectures/web/authentication-flow.md`。昵称、邮箱与头像以 Website 资料为准；外部应用的使用权限不由本站登录自动授予。

## 撤销与目的地

`outbox.ts` 只对快照中的 clientId/hydraSid 执行 Hydra 撤销；配置了 `revocation` 时，再以固定 `{ eventId, sessionId }` 和 `X-Identity-Delivery-Key` 通知该应用。每次调用一秒超时，禁止跟随重定向，非成功响应、网络或解析失败保持 pending。未配置应用通知时仅清理 Hydra，不表示应用已实时强制退出。

完成标识为 `hydra:<clientId>:<hydraSid>` 与 `app:<clientId>:<hydraSid>`。缺失或未知目的地持续 pending，即使此前保存过部分完成标识也不能借用其他目的地完成事件。会话退出、账号停用、过期清理、重试保留和晚到事件隔离的唯一数据规则见 `.ai/databases/data-model.md`。

## 核验、登记与部署绑定

`scripts/runtime/hydra-client.mjs` 的 `verifyHydraClient()` 只读检查精确 callback、退出地址、scope、grant、response type、认证方法和秘密有效性。随机无效 code 探测应返回 `invalid_grant`；admin metadata 指纹不能代替实际凭据核验。`pnpm infra clients` 才幂等创建缺失 client，已有冲突失败，不覆盖或扩权。

校验模块以 `HydraClientCheckError.kind` 区分客户端缺失、配置冲突、凭据探测失败、非法配置、网络失败和未知检查失败。`scripts/runtime/applications.mjs` 按合法结构化类别生成运行诊断，不解释英文消息；网络原因仅保留已知安全码，其他未知或伪造错误固定安全失败。错误文案、日志和公开诊断不携带原始响应、配置值或凭据。token 探测的非预期有效 JSON 结果仍映射既有冲突诊断，不能据此断定密钥错误。

部署 receipt v2 由共享 `createIdentityBinding()` 固定 Website 实际数据库目标、public origin、issuer、Hydra admin、排序后的现役与 cleanup-only 目标、精确 callback/scope、可用内部能力及秘密 SHA-256 指纹，不保存原始秘密。`apps/server/src/modules/identity/deployment-binding.ts` 在 worker 启动前核验；runtime 的 `deployment.mjs` 普通启动只验证，只有显式 prepare 为无旧绑定的新环境建立记录。issuer、已有客户端路由或秘密改变需要明确维护，不能删除 pin 后重建来绕过检查。

两端构造的 `websiteTarget` 历来具有不同 JSON 键顺序；Server 按完整绑定深相等、runtime 按规范化摘要核验，不以原始 JSON 字节判断跨端身份一致。配置重构分别保持两端原有的 v2 字节投影，不重排字段或要求刷新 pin。

旧 v1 receipt 的转换必须保存匹配的原始备份并核验原配置、实际状态与未完成目标；不能映射的历史记录拒绝转换。退役维护及保留资源的再次核验见 runtime 边界。源码和隔离测试证明实现行为，不能替代第三方 provider、其他应用、真实数据库维护或公网部署验收。
