# Webman 对接分支：URL、传参与响应变化说明

核对日期：2026-10-19。

本文记录 `codex/login-api-integration` 分支从起点 `3c46c81` 到 `473c5ca` 的全部六次功能提交，说明前端请求地址、传参和响应处理的变化。比较范围仅限 user-web 仓库；Webman 后端自身的改动另行记录。

## 1. 结论

整个分支修改过后端请求地址，也修改过部分请求参数。变化可以分为以下几类：

| 项目 | 变化 |
| --- | --- |
| Vite 开发代理 | 未显式指定端口时，默认后端从 `http://127.0.0.1:8080` 改为 `http://127.0.0.1:8787` |
| 注册首次发码 | 由请求 `/api/auth/invitations/check` 改为直接请求 `/api/auth/invitations/code` |
| 图片验证码 | 登录和注册流程开始调用 `/api/auth/captcha/challenges`；相应提交按条件携带 `captcha` |
| SSO 确认请求头 | 从使用客户端默认登录态，改为显式传递本次捕获的 `Authorization: Bearer <token>` |
| 其他业务接口 | 登录、用户资料、通知、偏好和反馈等原有接口路径保留；部分响应读取改为解开 Webman 的 `{ msg, data }` 包络 |
| 浏览器跳转 | `/sso/success` 路径保留，由整页跳转改为 React Router replace |

“接口路径保留”不代表开发环境实际请求目标完全不变：使用默认 Vite 代理时，这些接口也会随代理目标从原后端转向 Webman。

## 2. 核对的提交范围

| 提交 | 内容 | URL 或传参相关变化 |
| --- | --- | --- |
| `69ca53f` | 登录会话与资料接口对接 Webman | Vite 默认代理端口 `8080 → 8787`；适配用户响应字段及 HTTP 401 |
| `7002280` | 通知与偏好接口对接 Webman | 接口路径及传参保留，读取响应 `data` |
| `158f66f` | 注册流程对接 Webman | 适配响应包络，更新健康检查错误提示中的端口与启动说明 |
| `0d1999f` | 反馈流程对接 Webman | 保留反馈路径、请求参数和附件 multipart，读取响应 `data` |
| `07df1ac` | 登录与注册接入图片验证码 | 新增实际图片挑战请求，按条件附加 `captcha` |
| `473c5ca` | 注册、验证码与 SSO 修复 | 首次发码改调 `/auth/invitations/code`，移除自动验证的资格前置检查，SSO 确认显式传递令牌 |

## 3. 后端地址、代理与环境变量

### 3.1 Vite 默认代理目标发生变化

位置：`apps/web/vite.config.ts`。

修改前：

```ts
const SERVER_ORIGIN = `http://127.0.0.1:${process.env.INTEGRATION_SERVER_PORT ?? '8080'}`
```

修改后：

```ts
const SERVER_ORIGIN = `http://127.0.0.1:${process.env.INTEGRATION_SERVER_PORT ?? '8787'}`
```

未显式设置 `INTEGRATION_SERVER_PORT` 时，Vite 将 `/api/*` 转发到 Webman 的 `8787` 端口。转发保留 `/api` 前缀，没有新增路径 rewrite。

例如，直接运行 Vite 且没有端口覆盖时：

```text
浏览器请求：http://127.0.0.1:8081/api/auth/login
修改前代理：http://127.0.0.1:8080/api/auth/login
修改后代理：http://127.0.0.1:8787/api/auth/login
```

### 3.2 保留的配置行为

| 配置或地址 | 分支前后情况 |
| --- | --- |
| 浏览器 API 基础路径 | 默认仍为当前站点下的 `/api` |
| `VITE_API_BASE_URL` | 仍可在前端构建或开发环境中覆盖 API 基础地址，读取逻辑未改 |
| `INTEGRATION_SERVER_PORT` | 仍可覆盖 Vite 的后端目标端口，优先于 `8787` 默认值 |
| `INTEGRATION_WEB_PORT` | Vite 自身默认仍为 `8081` |
| `SERVER_PUBLIC_WEB_BASE_URL` | canonical origin、HMR 和可信转发配置逻辑保留 |
| 生产域名 | 本次范围没有新增或替换硬编码的生产 API 域名 |

API 基础地址的实际计算逻辑位于 `apps/web/src/api/client.ts`，仍为：

```ts
new URL(import.meta.env.VITE_API_BASE_URL || '/api', pageOrigin).href.replace(/\/$/, '')
```

Vite 的开发代理配置不随静态构建产物提供反向代理服务；生产访问目标还取决于前端构建时的 `VITE_API_BASE_URL` 和部署网关。

### 3.3 区分直接运行 Vite 与统一运行器

上述 `8787` 是 Vite 配置的后备值。仓库统一运行器 `scripts/runtime/settings.mjs` 仍会向 Web 进程注入 `INTEGRATION_SERVER_PORT`，值来自运行器的 API 端口配置。

该运行器的原有默认值为公共入口 `8080`、Web `8081`、API `8082`；本分支没有修改运行器、`LOCAL_API_PORT` 或端口注入逻辑。运行器还固定向 Web 进程注入 `VITE_API_BASE_URL=/api`。因此通过 `pnpm dev` 启动时，应核对实际注入值，不能直接认定一定代理到 `8787`，也不能假设直接运行 Vite 时的环境覆盖会原样透传。

`apps/web/src/main.tsx` 中健康检查失败提示由 `8080` 改为 `8787`，属于诊断文案调整；健康检查请求本身仍为 `/api/health`。

## 4. 登录、注册与 SSO 的请求变化

下表使用浏览器实际路径，统一包含 `/api` 前缀。源码中的 `api.POST('/auth/...')` 会与 API 基础地址组合。

| 请求 | 修改前 | 修改后 | 参数是否变化 |
| --- | --- | --- | --- |
| 普通登录 `POST /api/auth/login` | JSON：`email`、`password` | 原字段保留，取到图片挑战且提交图片答案时附加 `captcha` | 是，实际请求开始携带已有可选字段 |
| 退出 `POST /api/auth/logout` | 原有 Bearer 令牌，无新增业务 body | 保留相同地址和传参 | 否 |
| 图片挑战 `POST /api/auth/captcha/challenges` | 登录、注册界面没有实际取图调用 | 进入图片验证码步骤或刷新图片时调用，无业务 body | 新增实际调用 |
| 首次发码 | `POST /api/auth/invitations/check`，body 为 `{ email }` | `POST /api/auth/invitations/code`，body 仍为 `{ email }` | URL 和操作语义变了；邮箱字段名未变 |
| 重发 `POST /api/auth/invitations/code` | JSON：`email` | 保留 | 否 |
| 验证邮箱 `POST /api/auth/invitations/verify` | JSON：`email`、`code` | 原字段保留，具备图片挑战及答案时附加 `captcha` | 是 |
| 完成注册 `POST /api/auth/invitations/complete` | JSON：`completionToken`、`nickname`、`password` | 保留 | 否 |
| SSO 检查 `POST /api/auth/sso/inspect` | JSON：`ssoRequestId` | 保留，开始校验返回 ID、状态与时间 | 请求未变，响应检查变了 |
| SSO 密码登录 `POST /api/auth/sso/login` | JSON：`ssoRequestId`、`email`、`password` | 原字段保留，按条件附加 `captcha` | 是 |
| SSO 已有会话确认 `POST /api/auth/sso/confirm` | JSON：`ssoRequestId`，使用客户端默认令牌 | JSON 不变；显式设置本次捕获令牌的 Authorization 头 | body 未变，请求头设置方式变了 |

### 4.1 注册首次发码示例

修改前请求：

```http
POST /api/auth/invitations/check
Content-Type: application/json
```

修改后请求：

```http
POST /api/auth/invitations/code
Content-Type: application/json
```

两者提交的 JSON 字段相同：

```json
{
  "email": "member@example.com"
}
```

邮箱在前端格式校验后仍执行去首尾空格和转小写，没有将参数改为 `mail`、`username` 或其他名称。

行为变化为：首次点击直接申请发送验证码，成功后才进入验证码步骤；不再单独请求邀请资格。Webman 返回 409 表示邮箱已注册时，前端显示“该邮箱已注册，请直接登录”，停留邮箱步骤。

URL 已携带合法 `email` 和六位 `code` 的自动注册入口，现在直接调用 `/api/auth/invitations/verify`，不再先请求 `/api/auth/invitations/check`。验证使用入口中已规范化的邮箱，不再依赖资格响应里的 `email`。

### 4.2 新增的实际图片验证码传参

普通登录示例：

```json
{
  "email": "member@example.com",
  "password": "EXAMPLE_PASSWORD",
  "captcha": {
    "challengeId": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "answer": "abcd"
  }
}
```

SSO 密码登录在上述 body 中继续携带 `ssoRequestId`。注册邮箱验证码校验则提交：

```json
{
  "email": "member@example.com",
  "code": "001234",
  "captcha": {
    "challengeId": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    "answer": "abcd"
  }
}
```

其中 `code` 是邮箱里的六位数字码，使用字符串保留前导零；`captcha.answer` 是图片答案，两者含义不同。挑战 ID 与答案均使用用户当前这次挑战的真实值，示例值不可直接用于验证。

当前前端只在已取得图片挑战且提交了图片答案时拼入 `captcha`。未取得挑战时不伪造该字段；该行为仍依赖 Webman 对可选验证码的支持。

### 4.3 SSO 确认的请求头

```http
POST /api/auth/sso/confirm
Content-Type: application/json
Authorization: Bearer <本次捕获的本站登录令牌>
```

```json
{
  "ssoRequestId": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
}
```

没有将 token 加入 URL 或 JSON body。显式指定请求头用于锁定本次确认使用的身份，避免请求过程中其他页面更换登录态后混用账号；响应处理也会再次核对当前令牌。

## 5. 路径与传参保持的模块

以下模块主要适配 Webman 响应包络及会话错误判断。路径参数仍放在 URL，查询参数仍放在 query，JSON 与附件提交方式保留。

### 5.1 用户资料与头像

| 请求 | 传参 | 变化 |
| --- | --- | --- |
| `GET /api/auth/me` | Bearer 登录令牌，无业务 body | URL 与传参未变 |
| `PATCH /api/auth/me` | 根据编辑字段提交 `nickname`、`qq` 或 `fivemId`；移除头像时提交 `{ avatar: null }` | 原有字段和提交方式保留 |
| `POST /api/auth/me/avatar` | JSON：`imageBase64`、`mediaType` | URL 与传参未变 |

用户资料响应新增了集中适配：从 `data.username` 读取界面昵称，从 `data.avatar` 读取头像，用户 ID 转为界面使用的字符串，`fivemId` 展示值设为 `null`。

`username → nickname` 和 `avatar → avatarUrl` 属于响应到界面的映射，没有把资料保存请求的 `nickname` 改名为 `username`。表中表示当前前端调用方式，不表示 Webman 接受直接修改游戏身份；游戏身份仍需走绑定流程。

### 5.2 通知与通知偏好

| 请求 | 原有且保留的传参 |
| --- | --- |
| `GET /api/notifications/summary` | 无业务 body |
| `GET /api/notifications` | query：`view`、`limit`，有下一页时附加 `cursor` |
| `GET /api/notifications/{notificationId}` | path：`notificationId` |
| `PATCH /api/notifications/{notificationId}/state` | path：`notificationId`；JSON：`read`、`expectedRevision` |
| `POST /api/notifications/read-all` | JSON：`requestId`、`readThroughToken` |
| `POST /api/notifications/clear-preview` | JSON：`{}` |
| `POST /api/notifications/clear-all` | JSON：`requestId`、`clearSnapshotToken` |
| `GET /api/notification-preferences` | 无业务 body |
| `PUT /api/notification-preferences` | JSON：`expectedRevision`、`optionalCategories` |

通知列表的 `view` 仍使用 `unread` 或 `history`；本分支未新增筛选 query。通知日期的前端回归测试要求服务端提供毫秒时间，具体时间输出修复位于配套 Webman 后端，不属于前端请求参数变化。

### 5.3 反馈工单

| 请求 | 原有且保留的传参 |
| --- | --- |
| `GET /api/support/feedback/options` | query：`area`，调用默认值仍为 `development` |
| `POST /api/support/feedback/submissions` | JSON：`submissionKey`、`form`、`attachments`，表单及附件声明结构保留 |
| `GET /api/support/feedback/submissions/{submissionId}` | path：`submissionId` |
| `GET /api/support/feedback/submissions/lookup` | query：`submissionKey` |
| `PUT /api/support/feedback/submissions/{submissionId}/attachments/{attachmentId}` | path：`submissionId`、`attachmentId`；multipart 字段 `file`，保留原始文件名 |
| `POST /api/support/feedback/submissions/{submissionId}/advance` | path：`submissionId`；JSON：`expectedRevision`、`intent` |

附件仍通过 `FormData.append('file', file, file.name)` 上传，没有改为 Base64、没有更换上传接口，也没有把字段名改为 `files` 或 `attachment`。保存到 `public/uploads` 是配套 Webman 后端的文件落盘变化。

## 6. 响应与错误处理变化

### 6.1 读取 Webman 响应包络

Webman 成功响应通常为：

```json
{
  "msg": "ok",
  "data": {
    "token": "EXAMPLE_TOKEN"
  }
}
```

| 场景 | 分支起点的读取方式 | 当前读取方式 |
| --- | --- | --- |
| 普通登录 | `result.token` | `result.data.token` |
| 本人资料 | 直接读取 `nickname`、`avatarUrl` | 读取包络内的 `username`、`avatar` 并映射 |
| 注册、通知、偏好、反馈 | 直接使用返回的业务对象 | 经 `unwrapEnvelope` 读取 `data` |
| SSO 检查与完成响应 | 未核对全部返回身份和状态 | 解包后核对 `ssoRequestId`、状态与有效时间 |

`unwrapEnvelope` 在返回对象有 `data` 时取该字段，否则保留原对象。普通登录与部分用户资料路径还直接按 Webman 包络读取；因此不能认为仅把代理端口改回旧服务，就能完整恢复原 Fastify 行为。

### 6.2 错误与时间字段

- 会话失效判断由主要依赖 `SESSION_INVALID` 错误码，改为按 HTTP 401 处理，适配 Webman 的错误体。
- 注册首次发码遇到 409，提示邮箱已注册并停留邮箱步骤；重发遇到相同冲突也提示直接登录。
- 邮箱或密码错误按 HTTP 400 显示；图片验证码错误按 HTTP 422 换图并保留提示。
- 限流仍使用 HTTP 429 与 `Retry-After`；没有新增用于限流的请求字段。
- 注册发码的 `serverTime`、`resendAvailableAt` 按 Webman 秒级响应处理，前端计算差值后乘以 1000。它们是响应字段，不能据此把其他时间字段也一律按秒处理。
- SSO 请求信息与通知展示使用毫秒时间。

## 7. 登录页与跳转地址

| 项目 | 变化 |
| --- | --- |
| 普通登录 `/login` | 路径保留 |
| SSO 入口 `/login?ssoRequestId=<请求ID>` | 路径、query 名称及 43 位请求 ID 规则保留 |
| SSO 成功 `/sso/success` | 路径保留，由 `window.location.replace` 改为 React Router 的 `navigate(..., { replace: true })` |
| 无效 SSO 请求的返回入口 | 增加“返回首页”按钮，前往 `/` |

Webman 设备码初始化、令牌领取接口 `/api/oauth/device/init` 和 `/api/oauth/device/token` 属于应用服务端流程；本分支没有在 user-web 中新增这些调用，也没有将应用密钥加入网页请求。

## 8. 契约与运行边界

本次六个提交没有修改 `api/` 的 OpenAPI 定义、生成 Client 类型、SDK HTTP 实现或统一运行器。本文描述的是已提交前端的真实调用变化，不表示这些公共契约已同步调整。

需要特别区分图片验证码字段：

- `api/schemas/auth.yaml` 的普通登录与 SSO 密码请求已经声明可选 `captcha`，分支使前端实际开始使用它。
- `api/schemas/join.yaml` 的 `InvitationVerifyRequest` 当前仍只声明 `email`、`code`，并设有 `additionalProperties: false`；前端实际新增的注册 `captcha` 与该声明存在差异。Webman 已接收该字段，严格按原契约校验的服务可能拒绝它，不能将此项描述为“契约也已同步完成”。

因此接入时应同时核对后端地址、请求字段、响应包络和状态码。当前分支的 Webman 适配不等于仓库统一运行器及原 Fastify/Hydra 服务已经整体迁移。

## 9. 核对来源

本说明基于 `3c46c81..473c5ca` 的逐提交差异及对应源码：

- 地址与代理：`apps/web/vite.config.ts`、`apps/web/src/api/client.ts`、`scripts/runtime/settings.mjs`。
- 登录与 SSO：`apps/web/src/auth/AuthFlow.tsx`、`apps/web/src/auth/AuthContext.tsx`。
- 注册：`apps/web/src/invitations/InvitationRegistrationFlow.tsx`。
- 用户资料：`apps/web/src/settings/useSettingsController.ts`。
- 通知：`apps/web/src/notifications/useNotificationsController.ts`、`apps/web/src/notifications/useNotificationPreferencesController.ts`。
- 反馈：`apps/web/src/pages/Support/feedback/api.ts`、`apps/web/src/pages/Support/feedback/flow.ts`。
- 请求声明：`api/schemas/auth.yaml`、`api/schemas/join.yaml`、`api/schemas/support.yaml`、`api/schemas/notifications.yaml`。

核对属于提交记录与源码审查，不额外声称线上部署、外部域名或所有运行入口已经验收。
