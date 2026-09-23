# `web` 模块：认证 UI 与浏览器状态

本文件说明共享认证 UI、应用流程和浏览器存储之间的边界。HTTP operation 与字段形状以 `api/openapi.yaml` 和生成 Client 类型为准。

_最后更新：2026-09-23_

## 责任分层

```text
packages/components
  AuthForm / AuthModal / AuthArea
          ↑ props 与回调
apps/web
  AuthFlow / AuthProvider / 路由页面
          ↓
  @workspace/api-client
```

共享组件只管理字段、校验、焦点和可访问状态。它不读取浏览器存储、不调用 API、不决定导航。`apps/web` 负责请求分支、token 生命周期、SSO 上下文和整页跳转。个人资料页将资料表单留在共享组件中，通过应用层的生成 Client 读取、更新及上传头像。

登录、注册与验证码表单使用 React Hook Form 与 Zod；服务端字段错误通过 `setError` 展示。登录与注册由 `AuthForm` 分派，应用层负责请求与流程状态。登录中的 Google、QQ 入口仅为禁用占位，不发请求，也不代表已经接入第三方认证。

普通登录、SSO 密码登录和注册资料先在凭据表单点击“继续”，再于同一认证容器切换到图片验证码步骤。该步骤目前只显示矩形图片占位与可留空的输入框，明确提示尚未启用校验；点击“登录”或“注册”时才由 `AuthFlow` 调用原认证 operation，不附加伪造的验证码凭证。注册请求成功后再进入独立的邮箱验证码步骤。图片验证码输入与邮箱验证码各用自己的表单和标签，避免将两者混同。

## 入口与容器

- 顶栏登录与注册使用受控 Modal；关闭会卸载当前流程。
- `/login` 与 `/register` 使用相同 `AuthFlow` 的独立页面容器，位于 `RootLayout` 之外，不渲染站点顶栏或认证 Modal。
- `/sso/success` 与 `/sso/*` 的兜底页面也位于 `RootLayout` 之外，不渲染站点顶栏；认证页面代码集中在 `apps/web/src/pages/AuthPage/`。
- 普通独立认证页通过左上角 Home 返回首页；带 `ssoRequestId` 的页面隐藏该入口。表单中的入口负责登录/注册路由切换；独立认证页与 SSO 成功页复用 `MeshGradient` 背景，共享组件不依赖着色器。
- 只要 URL 中出现 `ssoRequestId`，就必须通过格式与单值检查；空值、重复值或非法值显示无效入口，不能回退成普通登录。

注册流程只在组件内存保存密码和验证码；不收集确认密码或 QQ 号。进入邮箱验证步骤即清空密码。刷新或关闭不会把注册进度持久化；关闭认证容器或切换模式会清理暂存凭据。图片验证码的取图与提交字段已在 Contract 中预留，真实校验启用前须单独决定有效期、重试规则以及要求凭证的版本策略。

## 本站会话

普通登录成功后先把 token 写入 `localStorage` 的 `exwebsite.auth.token`，成功写入后才整页导航。`AuthProvider` 在启动与其他标签页 storage 事件后调用 `/auth/me` 恢复身份；浏览器存储本身不作为身份依据。

明确的 `SESSION_INVALID` 只删除仍与本次请求匹配的 token，避免迟到响应清掉较新的登录；资料页读取或修改收到此错误时同步更新顶栏认证状态。临时网络错误保留 token 并显示可重试状态，资料读取失败也结束等待并允许重试。主动退出成功或退出请求收到会话失效后清除匹配 token 并刷新。

## SSO 接收流程

SSO 页先检查请求，再尝试用已有本站 token 确认；失效 token 被清除后显示密码表单，网络或服务错误保留 token 并提供重试。密码确认使用独立 SSO operation，不把返回值写入 `localStorage`。

服务端确认完成后，当前标签页才把 `{ssoRequestId, confirmedAt}` 写入 `sessionStorage` 的 `exwebsite.auth.sso-success`，再整页替换到 `/sso/success`。成功页只接受五分钟内的当前标签页记录；该记录只控制提示，不是授权凭据。

成功页复用登录页的品牌 Icon 和外围 Glass 卡片。有效成功记录时提示“登录成功”“正在返回应用”，五秒后尝试关闭当前页面；浏览器可能拒绝脚本关闭非脚本打开的标签页，此时提示用户手动关闭。缺少有效记录时在同一卡片内直接显示居中的“发生错误”标题与原因，不叠加错误 Alert 的 Glass，并提供左上角 Home 入口；此时不启动关闭计时。
