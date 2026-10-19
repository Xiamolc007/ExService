# API base URL 与开发期代理的陷阱

本页记录开发入口能打开、后续请求却失败时容易忽略的原因。进程、代理和可信转发的完整边界见 `.ai/architectures/runtime/runtime-boundaries.md`。

_最后更新：2026-10-19_

## 空字符串不能成为显式 API root

`VITE_API_BASE_URL=` 与未设置一样选择当前 origin `/api`。`apps/web/src/api/client.ts` 的 `installSdkIntegration()` 每次都先调用 `setBaseUrl`，参数为 `VITE_API_BASE_URL` 的 truthy 值，否则为当前 origin 加 `/api`，再选择应用会话范围和替换旧集成；因此空字符串不会直接传给 setter，从自定义 root 返回默认配置也会重设 SDK root。非空非法根地址会被 SDK 拒绝，保留原应用范围和集成，不能回退到 Website 根路径发送请求。SDK 配置隔离见 `.ai/architectures/sdk/client-boundaries.md`，Web 按 root 保存凭据及自定义 root 升级后的首次登录要求见 `.ai/architectures/web/authentication-flow.md`。

## 代理目标与启动方式有关

`apps/web/vite.config.ts` 使用 `127.0.0.1` 指向 Website Server。Windows 的 `localhost` 可能解析为 IPv6，而 Server 默认仅监听 IPv4，导致页面显示但 API 连接失败。根 supervisor 注入实际端口；直接运行包脚本则可能使用 Vite 缺省目标。排查须核对实际启动方式，不能沿用旧的“8080 就是 Server”假设。

Server 注册 `/api`，剥除会把健康请求送到 `/health` 得到 404。Docs 路径现在由主站路由决定，不存在文档 upstream 或 rewrite；静态内容编译不增加第二套 API。

## 固定端口失败会结束整组开发进程

Vite 的 `strictPort: true` 阻止静默换号；主入口监听失败会关闭 Vite，必需应用退出使 supervisor 清理本轮受管组。先明确处理冲突再重启，不能假定剩余 Server 仍提供正确身份链路。

## 入口可打开不代表身份或准备完成

同一主机的不同浏览器 origin 不共享 Website localStorage 身份。开发服务在页面加载前将别名 Host 重定向到显式 public origin，但不会搬运其他来源的旧 token；须在配置来源登录。单个 Website 健康响应、SPA 200 或 PM2 online 不证明 Hydra client 已验证或完整授权码流程通过。

`httpReady` 的显式 Host 分支使用 node:http/node:https 真正传递 Host，保留正常 TLS 和有界超时；无 Host 分支使用 fetch。普通 HTTP smoke 不能证明所有生产运输分支，不能全局忽略证书或改写浏览器 Origin 来消除错误。
