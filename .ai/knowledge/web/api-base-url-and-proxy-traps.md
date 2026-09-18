# API base URL 与开发期代理的陷阱

**结论：前端能否连通 Mock Server 取决于三个容易改错的点：空字符串 base URL 的回退、代理目标地址的解析方式，以及代理路径不做 rewrite。**

_最后更新：2026-09-17_

## 已知陷阱

### 1. `VITE_API_BASE_URL` 为空字符串时必须回退到 `/api`

`apps/web/src/api/client.ts` 使用 `import.meta.env.VITE_API_BASE_URL || '/api'`，而不是 `??`。

差别在于 `VITE_API_BASE_URL=`（显式设置为空字符串）时：`??` 会保留空字符串，`createApiClient` 会在**模块加载阶段**抛错，前端直接白屏，且报错出现在页面而不是请求日志里。改成 `??` 或删掉回退都会重新引入这个问题。

### 2. 代理目标必须写 `127.0.0.1`，不是 `localhost`

Vite 代理指向 `http://127.0.0.1:8080`，Mock Server 也只绑定 `127.0.0.1`。在 Windows 上 `localhost` 可能解析到 IPv6（`::1`），导致代理连不上只监听 IPv4 的服务。前端能打开、请求却失败时，先检查这一点。

### 3. 代理不做 rewrite

`/api` 前缀由 Mock Server 在注册 Glue 时自己声明。Vite 只做原样转发，不重写路径。如果给代理加上 `rewrite` 去掉 `/api`，服务端就会收到 `/health` 并返回 404。

### 4. `strictPort: true` 会让开发服务器直接失败

Vite 固定在 `8081` 且不允许自动换端口。端口被占用时 `pnpm dev` 会明确失败，同时 Mock Server 仍会正常启动 —— 这是有意的：静默换端口会让「前端代理没生效」这类问题变得更难定位。

## 证据

- `apps/web/src/api/client.ts` 中 `||` 的用法及其注释。
- `apps/web/vite.config.ts`：`MOCK_SERVER_ORIGIN`、`strictPort`、`proxy['/api']` 及其注释。
- `apps/mock-server/src/server.ts`：`HOST = '127.0.0.1'`。
- `apps/mock-server/src/app.ts`：`API_PREFIX = '/api'`。
