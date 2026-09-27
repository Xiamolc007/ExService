# `web` 模块：申请、邀请注册与认证 UI

本文件说明共享认证 UI、应用流程和浏览器存储之间的边界。HTTP operation 与字段形状以 `api/openapi.yaml` 和生成 Client 类型为准。

_最后更新：2026-09-27_

## 责任分层

```text
packages/components
  登录与邀请表单 / AuthModal / JoinApplicationForm / JoinReviewDialog
          ↑ props 与回调
apps/web
  AuthFlow / InvitationRegistrationFlow / AuthProvider / 路由页面
          ↓
  @workspace/api-client
```

共享组件只管理字段、校验、焦点和可访问状态。它不读取浏览器存储、不调用 API、不决定导航。`apps/web` 负责请求分支、token 生命周期、SSO 上下文和整页跳转。设置 Modal 与 `/account/profile` 通过同一个设置控制层读取、更新及上传本人资料，界面由共享组件接收值和回调。

登录、邀请注册与申请表单使用 React Hook Form 与 Zod；服务端字段错误通过 `setError` 展示。`AuthForm` 只分派登录与图片验证码步骤；邀请的邮箱、数字码和完善资料各有独立表单。登录中的 Google、QQ 入口仅为禁用占位，不发请求，也不代表已经接入第三方认证。

普通登录与 SSO 密码登录先在凭据表单点击“继续”，再于同一认证容器切换到图片验证码步骤。该步骤目前只显示矩形图片占位与可留空的输入框，明确提示尚未启用校验；点击“登录”时才由 `AuthFlow` 调用对应 operation，不附加伪造的验证码凭证。邀请注册不经过这个占位步骤。

## 入口与容器

- 顶栏登录与注册使用受控 Modal；关闭会卸载当前流程。
- `/login` 使用 `AuthFlow`，`/register` 使用 `InvitationRegistrationPage`；两者位于 `RootLayout` 之外，不渲染站点顶栏或认证 Modal，复用认证背景与外围容器。
- 顶栏桌面与移动注册入口挂载同一个 `InvitationRegistrationFlow`；完成后在原 Dialog 切到普通登录。关闭按当前桌面或移动触发器恢复焦点。
- `/join` 与临时审核页 `/admin/join-applications` 位于 `RootLayout` 内。登录的加入回调先关闭 Dialog，再前往 `/join`。
- `/sso/success` 与 `/sso/*` 的兜底页面也位于 `RootLayout` 之外，不渲染站点顶栏；认证页面代码集中在 `apps/web/src/pages/AuthPage/`。
- 普通独立认证页通过左上角 Home 返回首页；带 `ssoRequestId` 的登录页面隐藏该入口。独立认证页与 SSO 成功页复用 `MeshGradient` 背景，共享组件不依赖着色器。
- 登录入口只要 URL 中出现 `ssoRequestId`，就必须通过格式与单值检查；空值、重复值或非法值显示无效入口，不能回退成普通登录。

图片验证码的取图与提交字段已在 Contract 中预留，真实校验启用前须单独决定有效期、重试规则以及要求凭证的版本策略。

## 申请与邀请注册

`JoinApplicationForm` 保持一个 RHF 草稿，分为联系方式（邮箱）、基本信息（用户名与 QQ）和确认提交三步，确认页只读；前进校验当前字段，最终提交校验全部字段，后退保留值。草稿不持久化，申请成功不会建立账号。审核和账号创建的职责及字段归属见 `.ai/databases/data-model.md`。

`InvitationRegistrationFlow` 在应用层控制 email、code、profile、registered 四个状态。邮箱通过只读资格检查后才挂载空验证码表单；检查不请求发码。验证成功取得完善凭证才挂载用户名与密码表单，邮箱只读，QQ 来自申请。主动重发使用服务器时间差计算冷却，采用条件式发送反馈；验证的失败重试由用户输入或显式重试按钮触发，不由渲染循环驱动。

独立页纯读取一次 URL 入口快照。合法 email 只预填，合法 email/code 才自动检查后验证；非法或重复参数不请求。passive effect 删除所有 code 参数并保留 `history.state`。自动链 Promise 与响应订阅分别保存：StrictMode 重新订阅同一次请求，实际返回、修改邮箱或卸载则拒绝迟到结果和通知。数字码、密码和完善凭证只在内存保存，返回或关闭清理，不写日志、路由 state 或浏览器存储。

注册成功清空敏感材料并使用 `ExMessage.info` 提示，随后一次性前往普通登录。页面 replace 到 `/login`，只用内存路由 state 传邮箱；弹窗切换原容器。手动前往登录或卸载清理自动切换计时器，不创建会话，不带入 SSO 上下文。资格检查与持续错误的通知规则统一见 `.ai/rules/frontend-notifications.md`。

入口 `apps/web/index.html` 在所有脚本和资源声明之前设置 `no-referrer`，避免邀请 URL 的邮箱和数字码进入资源请求的 Referer。Vite 会在该 meta 前注入开发脚本，因此 `apps/web/vite.config.ts` 还为本地开发服务设置 `Referrer-Policy: no-referrer` 响应头。URL 清理发生在 React 挂载后，不能替代加载前的入口策略；这些策略不会隐藏原始入口请求 URL。

## 本地申请审核

`JoinReviewPage` 使用生成 Client 的列表与详情类型，不读取 `/auth/me` 作为本期临时页面的访问前提。过滤变化重置分页偏移；列表与详情各用请求代次拒绝迟到结果，每次打开重新读取详情。

共享 `JoinReviewDialog` 接收展示内容和回调，不复制 DTO 或调用 API。申请与审核两个 Tab、标题和底部动作固定，内容区滚动。关闭保留过滤与分页；原列表行仍存在时恢复查看按钮焦点，行已被审批移除时回到可聚焦的列表操作。已经提交的审批不会因关闭 Dialog 撤销，完成后刷新列表；只有仍对应当前选择的结果才更新详情和通知。审核人未记录时不伪造身份。

## 本站会话

普通登录成功后先把 token 写入 `localStorage` 的 `exwebsite.auth.token`，成功写入后才整页导航。`AuthProvider` 在启动与其他标签页 storage 事件后调用 `/auth/me` 恢复身份；浏览器存储本身不作为身份依据。

明确的 `SESSION_INVALID` 只删除仍与本次请求匹配的 token，避免迟到响应清掉较新的登录；资料页读取或修改收到此错误时同步更新顶栏认证状态。临时网络错误保留 token 并显示可重试状态，资料读取失败也结束等待并允许重试。主动退出成功或退出请求收到会话失效后清除匹配 token 并刷新。

## 用户设置

登录用户菜单的“设置”和“个人资料”打开同一 Modal，分别默认选中通用和个人资料；`/account/profile` 以页面容器复用相同主体。共享界面负责分类、单项表单和头像裁剪；`apps/web/src/settings/` 负责经生成 Client 请求本人资料。通用分类的主题由 ExUI `ThemeProvider` 决定，Valtio 中的值只是读取投影。

设置资料只缓存在内存，按当前 token 归属并用请求代次拒绝迟到结果。重新打开会刷新，明确失效或账号切换会清空。保存成功先采用服务器返回的完整本人资料，再调用既有 `AuthContext.refreshProfile()` 同步顶栏；顶栏刷新失败不会回滚已经保存的设置。退出仍交给 `AuthContext.logout()`。设置状态与认证状态的职责依据见 `.ai/decisions/web/04-settings-state-separate-from-auth-context.md`。

## SSO 接收流程

SSO 页先检查请求，再尝试用已有本站 token 确认；失效 token 被清除后显示密码表单，网络或服务错误保留 token 并提供重试。密码确认使用独立 SSO operation，不把返回值写入 `localStorage`。

服务端确认完成后，当前标签页才把 `{ssoRequestId, confirmedAt}` 写入 `sessionStorage` 的 `exwebsite.auth.sso-success`，再整页替换到 `/sso/success`。成功页只接受五分钟内的当前标签页记录；该记录只控制提示，不是授权凭据。

成功页复用登录页的品牌 Icon 和外围 Glass 卡片。有效成功记录时提示“登录成功”“正在返回应用”，五秒后尝试关闭当前页面；浏览器可能拒绝脚本关闭非脚本打开的标签页，此时提示用户手动关闭。缺少有效记录时在同一卡片内直接显示居中的“发生错误”标题与原因，不叠加错误 Alert 的 Glass，并提供左上角 Home 入口；此时不启动关闭计时。
