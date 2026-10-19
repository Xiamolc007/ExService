# `web` 模块：社区入口、邀请注册与认证 UI

本文件说明共享认证 UI、应用流程和浏览器存储之间的边界。HTTP operation 与字段形状以 `api/openapi.yaml` 和生成 Client 类型为准。

_最后更新：2026-10-19_

## 责任分层

```text
packages/components
  登录与邀请表单 / AuthModal
          ↑ props 与回调
apps/web
  AuthFlow / InvitationRegistrationFlow / AuthProvider / 路由页面
          ↓
  @workspace/api-client
```

共享组件只管理字段、校验、焦点和可访问状态。它不读取浏览器存储、不调用 API、不决定导航。`apps/web` 负责请求分支、token 生命周期、SSO 上下文和导航。设置 Modal 与 `/account/profile` 通过同一个设置控制层读取、更新及上传本人资料，界面由共享组件接收值和回调。

登录与邀请注册表单使用 React Hook Form 与 Zod；服务端字段错误通过 `setError` 展示。`AuthForm` 只分派登录与图片验证码步骤；邀请的邮箱、数字码和完善资料各有独立表单。登录中的 Google、QQ 入口仅为禁用占位，不发请求，也不代表已经接入第三方认证。

普通登录与 SSO 密码登录先在凭据表单点击“继续”，再于同一认证容器切换到图片验证码步骤。`AuthFlow` 请求 `/auth/captcha/challenges`，取图成功后提交 `captcha: { challengeId, answer }`；未取得挑战时保留现有可选验证码接口行为，不伪造凭证。webman 以 422 表示挑战错误或过期，页面换图并保留错误提示，只清空验证码字段。邀请注册使用自己的邮箱数字码步骤。

## 入口与容器

- 顶栏登录与注册使用受控 Modal；关闭会卸载当前流程。
- `/login` 使用 `AuthFlow`，`/register` 使用 `InvitationRegistrationPage`；两者位于 `RootLayout` 之外，不渲染站点顶栏或认证 Modal，复用认证背景与外围容器。
- 顶栏桌面与移动注册入口挂载同一个 `InvitationRegistrationFlow`；完成后在原 Dialog 切到普通登录。关闭按当前桌面或移动触发器恢复焦点。
- `/communities` 默认跳转至 `/communities/rifling-911`；社区页面 `/communities/rifling-911`、`/communities/caep` 位于 `RootLayout` 内。登录的加入回调先关闭 Dialog，再前往 `/communities/rifling-911`。顶栏不再提供 Join；Products 使用 `/products`，该内容页尚未实现。
- `/sso/success` 与 `/sso/*` 的兜底页面也位于 `RootLayout` 之外，不渲染站点顶栏；认证页面代码集中在 `apps/web/src/pages/AuthPage/`。
- 普通独立认证页通过左上角 Home 返回首页；带 `ssoRequestId` 的登录页面隐藏该入口。独立认证页与 SSO 成功页复用 `MeshGradient` 背景，共享组件不依赖着色器。
- 登录入口只要 URL 中出现 `ssoRequestId`，就必须通过格式与单值检查；空值、重复值或非法值显示无效入口，不能回退成普通登录。

当前 webman 后端的图片挑战有效期为五分钟、校验一次即失效，登录接口仍允许缺省 `captcha`；若改为强制校验，须同步调整接口约定与取图失败时的交互。

## 社区展示与邀请注册

社区页面保留介绍、既有图片和配置中的外部社区入口，不挂载在线申请表单。旧 `/join/rifling-911`、`/join/result` 和 `/admin/join-applications` 返回现有 404；通知正文也不再允许链接到旧 Join 页面。

申请提交、结果查询、审核、邀请重发及申请附件下载的八个 HTTP operation 已退役。既有邀请注册仍通过 `/auth/invitations/*` 工作；历史申请与邀请数据、内部服务和读取历史资料所需的 schema 保留，数据职责见 `.ai/databases/data-model.md`。

Hero 图片继续来自 `apps/web/public/images/heros/join/rifling-911/`。构建时按文件名排序收集支持的图片格式；多张图片时点击背景循环切换，也支持聚焦背景后按 Enter 或空格，不显示独立切换按钮；单张图片作为静态背景。

`InvitationRegistrationFlow` 在应用层控制 email、code、profile、registered 四个状态。邮箱通过 Zod 格式校验和规范化后，直接以 `{ email }` 请求 `/auth/invitations/code`，成功才挂载空验证码表单，不再请求邀请资格检查。webman 在生成验证码、写入冷却或发送邮件之前检查邮箱占用，已注册返回 409；页面将其展示为邮箱字段错误并停留邮箱步骤。重发遇到相同冲突则在验证码表单提示直接登录。发码响应不含邮箱，后续验证继续使用提交时的规范化邮箱。验证成功取得完善凭证才挂载用户名与密码表单，完成请求传递 `completionToken`、`nickname` 和 `password`。当前对接的 webman 后端返回秒级 `serverTime`、`resendAvailableAt`，页面将两者差值乘以 1000 计算冷却；429 采用 `Retry-After`。取到图片挑战时显示显式验证按钮，并按后端要求附加 `captcha: { challengeId, answer }`；没有图片时仍可通过六位数字输入触发验证。验证失败后的重试由用户输入或显式重试按钮触发，不由渲染循环驱动。

独立页纯读取一次 URL 入口快照。合法 email 只预填，合法 email/code 直接验证已有数字码，不检查邀请资格或重发覆盖旧码；非法或重复参数不请求。passive effect 删除所有 code 参数并保留 `history.state`。自动链 Promise 与响应订阅分别保存：StrictMode 重新订阅同一次请求，实际返回、修改邮箱或卸载则拒绝迟到结果和通知，图片挑战响应同样受请求代次保护。数字码、密码和完善凭证只在内存保存，返回或关闭清理，不写日志、路由 state 或浏览器存储。

注册成功清空敏感材料并使用 `ExMessage.info` 提示，随后一次性前往普通登录。页面 replace 到 `/login`，只用内存路由 state 传邮箱；弹窗切换原容器。手动前往登录或卸载清理自动切换计时器，不创建会话，不带入 SSO 上下文。资格检查与持续错误的通知规则统一见 `.ai/rules/frontend-notifications.md`。

入口 `apps/web/index.html` 在所有脚本和资源声明之前设置 `no-referrer`，避免邀请 URL 的邮箱和数字码进入资源请求的 Referer。Vite 会在该 meta 前注入开发脚本，因此 `apps/web/vite.config.ts` 还为本地开发服务设置 `Referrer-Policy: no-referrer` 响应头。URL 清理发生在 React 挂载后，不能替代加载前的入口策略；这些策略不会隐藏原始入口请求 URL。

邀请注册的持续错误由所属 RHF 表单持有，根错误展示与跨步骤挂载交接见 `.ai/knowledge/web/invitation-error-handoff.md`。

## 本站会话

普通登录成功后，若浏览器仍保存另一账号的 token，先撤销旧会话；明确的 `SESSION_INVALID` 表示旧会话已无效，可继续登录，其他撤销失败保留旧 token 并提供重试。写入前再次核对浏览器 token 未被其他页面替换，再把新 token 写入 `localStorage` 的 `exwebsite.auth.token`；成功写入后才整页导航或继续当前 OIDC challenge。`AuthProvider` 在启动与其他标签页 storage 事件后调用 `/auth/me` 恢复身份；浏览器存储本身不作为身份依据，旧 token 的迟到资料与错误不能覆盖后来保存的新会话。

明确的 `SESSION_INVALID` 只删除仍与本次请求匹配的 token，避免迟到响应清掉较新的登录；资料页读取或修改收到此错误时同步更新顶栏认证状态。临时网络错误保留 token 并显示可重试状态，资料读取失败也结束等待并允许重试。

主动退出由 `AuthProvider` 立即完成本地状态切换：删除 `localStorage` 的本站 token、当前标签页 `sessionStorage` 的 SSO 成功展示记录，清除 HTTP 客户端凭证和缓存的本人设置资料，关闭认证容器并切换为匿名。两种 storage 独立尝试清理，存储异常仍清除内存身份。已有身份查询的请求代次失效，不能恢复退出前的资料；主题等非认证偏好保留。

本地清理前捕获的 token 仅用于后台 `/auth/logout` 撤销请求，通过显式 Authorization 传递。API 拒绝、断网、超时或请求未完成均不阻止浏览器退出；请求结束不再修改本地身份，因此迟到结果不能清除后来登录的新会话。此路径不立即刷新页面，以免中断尚未送达服务端的撤销请求。本地退出不等于服务端撤销成功；跨服务会话撤销仍依赖服务端请求成功处理。

## 身份页面

`apps/web/src/App.tsx` 注册 `/identity/login`、`/identity/consent`、`/identity/logout` 和 `/identity/signed-out`。挑战页面通过生成的 API Client 检查或接受 Hydra challenge；已有有效本站 Bearer 可直接完成登录与授权，缺少会话时经现有登录 UI。挑战与当前 token 不匹配时重新开始，避免迟到响应将旧身份带入新会话。

身份密码登录将目标服务说明放在共享表单的标题区，通过可选 `description` 展示，并在验证码步骤继续保留；表单显示时不再叠加外围登录标题。页面底部的信息入口通过 `OidcSharingDialog` 打开独立 ExUI Dialog，只描述 challenge 检查返回的 scope：`openid` 为账号身份，`profile` 为基本资料，`email` 为邮箱；每项使用图标、标题与用途说明，原始 scope 收在弹窗内的技术详情。其他 scope 保留原标识，不推断权限。关闭、Esc 或“知道了”返回入口并保留表单输入；该弹窗只供查看，不增加授权确认步骤，已有会话仍按原流程自动继续。

生成 Client 经 ExAxios 直接返回成功数据，失败抛出 `ExAxiosError`，身份页面按其状态码和错误码决定重试、重新开始或拒绝无效入口。身份路由中的会话失效由当前页面继续处理；共享请求层同步浏览器会话后不把该路由跳到普通 `/login`，以保留 challenge 和退出确认流程。

`/identity/signed-out` 重新验证当前 token，只删除已确认无效且仍匹配的 token；请求代次与会话变化订阅使迟到退出检查不能清除后来登录的新账号。该页只提供首页返回，不读取旧 Docs return/resume 参数或自动导航。服务端撤销仍是会话有效性的依据。跨服务边界见 `.ai/architectures/identity/integration-boundaries.md`。

## 用户设置

登录用户菜单的“设置”和“个人资料”打开同一 Modal，分别默认选中通用和个人资料；`/account/profile` 以页面容器复用相同主体。共享界面负责分类、单项表单和头像裁剪；`apps/web/src/settings/` 负责经生成 Client 请求本人资料。通用分类的主题由 ExUI `ThemeProvider` 决定，Valtio 中的值只是读取投影。

设置资料只缓存在内存，按当前 token 归属并用请求代次拒绝迟到结果。重新打开会刷新，明确失效或账号切换会清空。保存成功先采用服务器返回的完整本人资料，再调用既有 `AuthContext.refreshProfile()` 同步顶栏；顶栏刷新失败不会回滚已经保存的设置。退出仍交给 `AuthContext.logout()`。设置状态与认证状态的职责依据见 `.ai/decisions/web/04-settings-state-separate-from-auth-context.md`。

## SSO 接收流程

当前 webman 接入使用设备码 SSO：插件以应用凭据调用 `/api/oauth/device/init`，打开返回的 `verification_uri_web`（用户站点 `/login?ssoRequestId=…`），浏览器确认后由插件轮询 `/api/oauth/device/token` 领取 OAuth 访问令牌。浏览器不持有应用密钥或轮询令牌。站点地址由后端 `config/userweb.php` 的 `USER_WEB_URL` 决定。此流程与 `/identity/*` 的 Hydra challenge 是独立协议。

SSO 页先检查请求 ID、服务端状态和毫秒时间，再尝试用捕获的本站 token 通过显式 Authorization 确认。确认返回 401 时只清除仍匹配的旧 token 并显示密码表单；网络或服务错误保留 token 并提供重试。400、403、404、409 以及已过期的请求终止重试并提示重新发起。已经完成的请求直接显示成功页，不再重复确认。密码确认使用独立 SSO operation，不把返回值写入 `localStorage`。迟到响应受请求代次和当前 token 检查保护。

确认响应的请求 ID 和完成状态匹配后，当前标签页才把 `{ssoRequestId, confirmedAt}` 写入 `sessionStorage` 的 `exwebsite.auth.sso-success`，再通过 React Router replace 到 `/sso/success`。成功页只接受五分钟内的当前标签页记录；该记录只控制提示，不是授权凭据。

成功页复用登录页的品牌 Icon 和外围 Glass 卡片。有效成功记录时提示“登录成功”“正在返回应用”，五秒后尝试关闭当前页面；浏览器可能拒绝脚本关闭非脚本打开的标签页，此时提示用户手动关闭。缺少有效记录时在同一卡片内直接显示居中的“发生错误”标题与原因，不叠加错误 Alert 的 Glass，并提供左上角 Home 入口；此时不启动关闭计时。
