# API base URL 与开发期代理的陷阱

_最后更新：2026-10-05_

本页记录开发入口能打开、后续请求却失败时容易忽略的原因。普通开发入口的进程与路径分工见 `.ai/architectures/docs-integration/integration-boundaries.md`。

## 已知陷阱

### 空字符串 base URL 会绕过 `/api`

`VITE_API_BASE_URL=` 与未设置一样需要回退到 `/api`。`apps/web/src/api/client.ts` 使用 `||`；若改为 `??`，空字符串会先被 `new URL` 解析成 Website 根地址，再由共享 Client 把 operation 发向根路径，导致 API 请求 404。此处的 URL 规范化使旧的“模块加载阶段抛错”解释不再适用。

### 代理目标与启动方式有关

`apps/web/vite.config.ts` 使用 `127.0.0.1` 指向 Website Server。Windows 的 `localhost` 可能解析为 IPv6，而 Server 默认仅监听 IPv4，导致页面显示但 API 连接失败。根 supervisor 与单应用适配器按已验证配置注入端口；直接运行包脚本则可能使用 Vite 缺省目标。排查须核对实际启动方式，不能沿用旧的“8080 就是 Server”假设。入口与配置规则见 `.ai/architectures/docs-integration/integration-boundaries.md`。

### Website API 与 Outline 文档路径的前缀处理不同

Website Server 注册 `/api`，剥除会把健康请求送到 `/health` 得到 404。Outline 后端挂载与集成 Vite static 的规则不同，不能共享一个全局 rewrite；重复添加挂载也会使 SSR 图标、manifest 和深链接失效。准确前缀、Location/Cookie、HTTP/upgrade 内部拒绝及 standalone 例外见 `.ai/architectures/docs-integration/integration-boundaries.md`。相关实现为 `apps/web/dev-entry.ts`、`apps/outline/server/routes/app.ts`、`apps/outline/shared/utils/publicPath.ts`。

### 固定端口失败会结束整组开发进程

Vite 的 `strictPort: true` 阻止静默换号；主入口监听失败会关闭 Vite，必需应用退出使 supervisor 清理本轮受管组。先明确处理冲突再重启，不能假定剩余 Server 仍提供正确身份链路。完整归属和恢复规则见 `.ai/architectures/docs-integration/integration-boundaries.md`。

### 入口可打开不代表身份或准备完成

同一主机的不同浏览器 origin 不共享 Website localStorage 身份，不能用直接 Vite 页验证公共入口的自动登录。单个 Website readiness 成功、initialized 记录存在、或代理静态页返回 200，也不证明 Outline bootstrap、Hydra client 与完整身份链就绪。规范入口、逐阶段检查和 legacy awaiting-bootstrap 行为见 `.ai/architectures/docs-integration/integration-boundaries.md`。

带 Outline 会话 Cookie 从非配置 origin 访问时，`POST /docs/api/auth.info` 会在会话验证前被 CSRF 拒绝，返回 403 `csrf_error`、`Request origin is invalid`；公共目录仍可返回 200，页面因此可能同时显示空目录和登录状态不可用。先核对浏览器地址与保存的 `publicOrigin`，并在配置入口完成登录；不要通过重写浏览器 Origin 或扩大 CSRF allowlist 消除提示。目录接口的空 `data` 表示没有匿名可见文档集，不代表身份服务宕机。

### TLS 与 Host 的测试运输必须匹配生产链路

开发证书会改变旧 Outline 的真实传输，统一改成 HTTP 或全局忽略 TLS 会掩盖错误。Node 22 fetch 的显式 Host 行为也不能仅靠普通 HTTP smoke 推断；真实 gateway 需要批准 Host，就绪检查须验证生产 helper。确切旧 HTTP 传输与限定 TLS/Host 处理见 `.ai/architectures/docs-integration/integration-boundaries.md`。
